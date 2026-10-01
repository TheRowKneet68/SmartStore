import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { onboard } from '../../onboarding.ts';
import { signedInAs, testApp } from '../../../test/app.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { employeeWithAccess, onboardingAnswers } from '../../../test/fixtures.ts';

let db: TestDb;
let app: FastifyInstance;

beforeAll(async () => {
  db = await createTestDb();
  app = await testApp(db);
});

afterAll(async () => {
  await app.close();
  await db.drop();
});

type Headers = Record<string, string>;
const call = (method: 'GET' | 'POST' | 'PUT', url: string, as: Headers, payload?: object, on: FastifyInstance = app) =>
  on.inject({ method, url: `/api/v1${url}`, headers: as, ...(payload ? { payload } : {}) });

async function ok(method: 'POST' | 'PUT', url: string, as: Headers, payload: object): Promise<Record<string, unknown>> {
  const response = await call(method, url, as, payload);
  expect(response.statusCode, `${method} ${url}: ${response.body}`).toBeLessThan(300);
  return response.json();
}

/**
 * A store ready to trade, built through the routes: onboarded (TEST-ONLY), two priced, taxed items at a TEST-ONLY 10%
 * inclusive rate, cash enabled, an active till, and a cashier signed in at it.
 */
async function shop() {
  const o = await onboard(db.app, onboardingAnswers());
  const owner = signedInAs(o.ownerEmployeeId, o.organizationId);
  const unit = (await ok('POST', '/units', owner, { code: 'EA', name: 'Each', quantityKind: 'Countable', scale: 0 })).id as string;
  const tax = (await ok('POST', '/tax-categories', owner, { code: 'STD', name: 'TEST-ONLY standard' })).id as string;
  await ok('POST', `/tax-categories/${tax}/rates`, owner, { jurisdiction: 'TEST-ONLY', ratePercent: '10' });
  const category = (await ok('POST', '/categories', owner, { name: 'Groceries', parentId: null, sortOrder: 1 })).id as string;
  const item = async (name: string, amount: number, barcode: { value: string; kind: string }) => {
    const product = (await ok('POST', '/products', owner, { categoryId: category, name })).id as string;
    const variant = (await ok('POST', `/products/${product}/variants`, owner, { baseUnitId: unit, taxCategoryId: tax, price: { amount }, barcodes: [barcode] })).id as string;
    await ok('POST', '/transitions', owner, { machine: 'Product', event: 'activate', subject: product });
    return variant;
  };
  const milk = await item('Oat milk', 1_250, { value: '012345678905', kind: 'UPC_A' });
  const bread = await item('Bread', 500, { value: '4006381333931', kind: 'EAN13' });
  const cash = (await ok('POST', '/payment-methods', owner, { code: 'CASH', name: 'Cash', methodType: 'Cash' })).id as string;
  await ok('PUT', `/stores/${o.storeId}/payment-methods/${cash}`, owner, { enabled: true });
  const till = (await ok('POST', `/stores/${o.storeId}/terminals`, owner, { code: 'T1', label: 'Till 1' })).id as string;
  await ok('POST', '/transitions', owner, { machine: 'Device', event: 'activate', subject: till });
  const cashier = await employeeWithAccess(db.app, o.organizationId, ['Sale.Create', 'Sale.View', 'Shift.Open'], {
    assignedStore: o.storeId,
    accessStores: [o.storeId],
  });
  return { ...o, owner, milk, bread, cash, till, cashier, at: signedInAs(cashier, o.organizationId, till) };
}
type Shop = Awaited<ReturnType<typeof shop>>;

const openShift = (s: Shop, float = 1_000) => ok('POST', `/stores/${s.storeId}/shift`, s.at, { openingFloat: float });
const quote = async (s: Shop, code: string, on: FastifyInstance = app) => {
  const scanned = await call('GET', `/stores/${s.storeId}/scan/${code}`, s.at, undefined, on);
  expect(scanned.statusCode, scanned.body).toBe(200);
  return scanned.json().quote as string;
};
const sell = (s: Shop, lines: { quote: string; quantity: number }[], tendered: number, operation = randomUUID(), on: FastifyInstance = app) =>
  call('POST', `/stores/${s.storeId}/sales`, s.at, { clientOperationId: operation, lines, cash: { tendered } }, on);

describe('a cash sale at the till (s22.6, SP-01, SP-02, PY-38, RT-119)', () => {
  it('SP-01, SP-02, PR-39, RT-146, CD-18: one transaction numbers the sale, prices it from its quotes, captures the cash, moves the stock and gives the change', async () => {
    const s = await shop();
    await openShift(s);
    const lines = [
      { quote: await quote(s, '012345678905'), quantity: 2 },
      { quote: await quote(s, '4006381333931'), quantity: 1 },
    ];
    const response = await sell(s, lines, 5_000);
    expect(response.statusCode).toBe(201);
    const sale = response.json();
    // Inclusive 10%: 2500 - round(2500 / 1.1) = 227, and 500 - round(500 / 1.1) = 45, in exact numeric.
    expect(sale).toMatchObject({
      documentNumber: 1,
      currencyCode: 'XTS',
      subtotal: 3_000,
      taxTotal: 272,
      totalDue: 3_000,
      tendered: 5_000,
      change: 2_000,
      lines: [
        { lineNumber: 1, description: 'Oat milk', quantity: '2.0000', unitPrice: 1_250, lineTotal: 2_500 },
        { lineNumber: 2, description: 'Bread', quantity: '1.0000', unitPrice: 500, lineTotal: 500 },
      ],
    });
    const effects = await db.app.query(
      `SELECT (SELECT json_agg(json_build_object('status', p.status, 'amount', p.amount, 'tendered', p.tendered_amount)) FROM payment p
               JOIN checkout c ON c.id = p.checkout_id JOIN sale x ON x.checkout_id = c.id WHERE x.id = $1) AS payments,
              (SELECT json_agg(quantity::text ORDER BY quantity) FROM inventory_movement WHERE sale_id = $1 AND movement_type = 'SALE') AS moved,
              (SELECT amount FROM cash_transaction WHERE sale_id = $1 AND type = 'ChangeDisbursed') AS change,
              (SELECT json_agg(entry_method || ':' || scanned_barcode ORDER BY line_number) FROM sale_line WHERE sale_id = $1) AS entries,
              (SELECT count(*)::int FROM audit_event WHERE entity_id = $1 AND event_type = 'Sale.Completed') AS completed`,
      [sale.saleId],
    );
    expect(effects.rows[0]).toEqual({
      payments: [{ status: 'Captured', amount: 3_000, tendered: 5_000 }],
      moved: ['1.0000', '2.0000'],
      change: '2000',
      entries: ['Scanned:012345678905', 'Scanned:4006381333931'],
      completed: 1,
    });
  });

  it('SM-04, BI-28, architecture s10.4: the same operation id, repeated or concurrent, returns the one sale', async () => {
    const s = await shop();
    await openShift(s);
    const lines = [{ quote: await quote(s, '4006381333931'), quantity: 1 }];
    const operation = randomUUID();
    const first = await sell(s, lines, 500, operation);
    const again = await sell(s, lines, 500, operation);
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(200);
    expect(again.json().saleId).toBe(first.json().saleId);

    const racing = randomUUID();
    const both = await Promise.all([sell(s, lines, 500, racing), sell(s, lines, 500, racing)]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([200, 201]);
    expect(both[0]!.json().saleId).toBe(both[1]!.json().saleId);
    const count = await db.app.query('SELECT count(*)::int AS n FROM sale WHERE store_id = $1', [s.storeId]);
    expect(count.rows[0]).toEqual({ n: 2 });
  });

  it('RT-124, EC-07: a line keeps the price it was quoted, though the price changes before the sale is saved', async () => {
    const s = await shop();
    await openShift(s);
    const old = await quote(s, '012345678905');
    await ok('POST', `/variants/${s.milk}/prices`, s.owner, { amount: 1_400 });
    expect((await call('GET', `/stores/${s.storeId}/scan/012345678905`, s.at)).json().price.amount, 'the next cart').toBe(1_400);
    const sale = await sell(s, [{ quote: old, quantity: 1 }], 1_250);
    expect(sale.statusCode).toBe(201);
    expect(sale.json().lines[0].unitPrice).toBe(1_250);
  });

  it('D4 s3, BI-30: only a quote this server signed, for this store, and not too old, prices a line', async () => {
    const s = await shop();
    await openShift(s);
    const good = await quote(s, '4006381333931');
    const [body, signature] = good.split('.');
    const payload = JSON.parse(Buffer.from(body!, 'base64url').toString('utf8'));
    const cheaper = Buffer.from(JSON.stringify({ ...payload, unitPrice: 1 })).toString('base64url');
    const forged = await sell(s, [{ quote: `${cheaper}.${signature}`, quantity: 1 }], 1);
    expect(forged.statusCode).toBe(400);
    expect(forged.json().error.code).toBe('invalid_quote');

    const other = await shop();
    const theirs = await quote(other, '4006381333931');
    expect((await sell(s, [{ quote: theirs, quantity: 1 }], 500)).json().error.code, "another store's quote").toBe('invalid_quote');

    const brief = await testApp(db, { quoteMaxAgeMinutes: 0.001 });
    const stale = await quote(s, '4006381333931', brief);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const expired = await sell(s, [{ quote: stale, quantity: 1 }], 500, randomUUID(), brief);
    expect(expired.json().error).toEqual({ code: 'quote_expired', message: 'A price on this cart is too old. Scan the items again.' });
    await brief.close();
  });

  it('UX-17, RT-119: an underpayment is named, and nothing is saved', async () => {
    const s = await shop();
    await openShift(s);
    const response = await sell(s, [{ quote: await quote(s, '012345678905'), quantity: 1 }], 1_000);
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toEqual({ code: 'underpaid', message: 'The cash given is less than the total due.', totalDue: 1_250, tendered: 1_000 });
    const left = await db.app.query('SELECT (SELECT count(*)::int FROM checkout WHERE store_id = $1) AS checkouts, (SELECT count(*)::int FROM payment WHERE store_id = $1) AS payments', [s.storeId]);
    expect(left.rows[0]).toEqual({ checkouts: 0, payments: 0 });
  });
});

describe('what a sale needs first (BI-39, PT-01, PY-05, RT-423, CD-01, CD-03)', () => {
  it('BI-39, PT-01: a sale needs a session at a till, and an open shift there', async () => {
    const s = await shop();
    const lines = [{ quote: await quote(s, '4006381333931'), quantity: 1 }];
    expect((await sell(s, lines, 500)).json().error.code).toBe('no_open_shift');
    await openShift(s);
    const nowhere = await call('POST', `/stores/${s.storeId}/sales`, signedInAs(s.cashier, s.organizationId), { clientOperationId: randomUUID(), lines, cash: { tendered: 500 } });
    expect(nowhere.json().error).toEqual({ code: 'not_at_a_till', message: 'Sign in at a till to do this.' });
  });

  it('PY-05, SS045: cash must be enabled at the store', async () => {
    const s = await shop();
    await openShift(s);
    await ok('PUT', `/stores/${s.storeId}/payment-methods/${s.cash}`, s.owner, { enabled: false });
    const response = await sell(s, [{ quote: await quote(s, '4006381333931'), quantity: 1 }], 500);
    expect(response.json().error.code).toBe('cash_not_accepted');
  });

  it('CD-01, CD-11, s22.11: a till has one open shift, opened with its counted float; opening needs Shift.Open', async () => {
    const s = await shop();
    const opened = await openShift(s, 2_500);
    expect(opened.shift).toMatchObject({ status: 'Open', openedBy: s.cashier, openingFloat: 2_500 });
    expect((await call('GET', `/stores/${s.storeId}/shift`, s.at)).json().shift).toMatchObject({ status: 'Open' });
    const twice = await call('POST', `/stores/${s.storeId}/shift`, s.at, { openingFloat: 0 });
    expect(twice.json().error.message).toBe('This till already has a shift that is not closed.');
    const seller = await employeeWithAccess(db.app, s.organizationId, ['Sale.Create'], { assignedStore: s.storeId, accessStores: [s.storeId] });
    expect((await call('POST', `/stores/${s.storeId}/shift`, signedInAs(seller, s.organizationId, s.till), { openingFloat: 0 })).statusCode).toBe(403);
  });

  it('RT-423, PT-03, s22.12: a registered till trades only once activated, which needs Device.Edit', async () => {
    const s = await shop();
    const till = (await ok('POST', `/stores/${s.storeId}/terminals`, s.owner, { code: 'T2', label: 'Till 2' })).id as string;
    const listed = (await call('GET', `/stores/${s.storeId}/terminals`, s.owner)).json().items;
    expect(listed.find((t: { id: string }) => t.id === till)).toMatchObject({ status: 'Registered', mode: 'Standard', drawerId: expect.any(String) });
    const at2 = signedInAs(s.cashier, s.organizationId, till);
    expect((await call('POST', `/stores/${s.storeId}/shift`, at2, { openingFloat: 0 })).json().error.code).toBe('SS025');
    await ok('POST', '/transitions', s.owner, { machine: 'Device', event: 'activate', subject: till });
    expect((await call('POST', `/stores/${s.storeId}/shift`, at2, { openingFloat: 0 })).statusCode).toBe(201);
  });
});
