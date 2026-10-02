import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { onboard } from '../../onboarding.ts';
import { signedInAs, testApp } from '../../../test/app.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { employeeWithAccess, insertWarehouse, onboardingAnswers } from '../../../test/fixtures.ts';

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
 * A store ready to trade, built through the routes: onboarded (TEST-ONLY) in `taxMode`, two priced, taxed items at a
 * TEST-ONLY 10% rate, cash enabled, an active till, and a cashier signed in at it. `item` adds another.
 */
async function shop(taxMode: 'Inclusive' | 'Exclusive' = 'Inclusive') {
  const answers = onboardingAnswers();
  answers.store.taxMode = taxMode;
  const o = await onboard(db.app, answers);
  const owner = signedInAs(o.ownerEmployeeId, o.organizationId);
  const unit = (await ok('POST', '/units', owner, { code: 'EA', name: 'Each', quantityKind: 'Countable', scale: 0 })).id as string;
  const tax = (await ok('POST', '/tax-categories', owner, { code: 'STD', name: 'TEST-ONLY standard' })).id as string;
  await ok('POST', `/tax-categories/${tax}/rates`, owner, { jurisdiction: 'TEST-ONLY', ratePercent: '10' });
  const category = (await ok('POST', '/categories', owner, { name: 'Groceries', parentId: null, sortOrder: 1 })).id as string;
  const item = async (name: string, amount: number, barcode: { value: string; kind: string }, other: { unit?: string; tax?: string } = {}) => {
    const product = (await ok('POST', '/products', owner, { categoryId: category, name })).id as string;
    const variant = (await ok('POST', `/products/${product}/variants`, owner, {
      baseUnitId: other.unit ?? unit, taxCategoryId: other.tax ?? tax, price: { amount }, barcodes: [barcode],
    })).id as string;
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
  return { ...o, owner, milk, bread, cash, till, cashier, item, at: signedInAs(cashier, o.organizationId, till) };
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

    // A true race: the table is held until both repeats have looked for an earlier sale, found none, and wait to insert.
    // The loser then meets the database's key (uq_checkout_operation) and must answer with the winner's sale.
    const holder = await db.owner.connect();
    await holder.query('BEGIN; LOCK TABLE checkout IN SHARE MODE');
    const racing = randomUUID();
    const racers = Promise.all([sell(s, lines, 500, racing), sell(s, lines, 500, racing)]);
    let waiting = 0;
    for (let i = 0; i < 100 && waiting < 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const { rows } = await holder.query(`SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted AND relation = 'checkout'::regclass
                                           AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`);
      waiting = rows[0].n;
    }
    await holder.query('COMMIT');
    holder.release();
    expect(waiting, 'both repeats reached the database together').toBe(2);
    const both = await racers;
    expect(both.map((r) => r.statusCode).sort()).toEqual([200, 201]);
    expect(both[0]!.json().saleId).toBe(both[1]!.json().saleId);

    // A repeat is answered from the sale made, not checked again: a retry after the store stops taking cash still gets it.
    await ok('PUT', `/stores/${s.storeId}/payment-methods/${s.cash}`, s.owner, { enabled: false });
    const later = await sell(s, lines, 500, operation);
    expect(later.statusCode, later.body).toBe(200);
    expect(later.json().saleId).toBe(first.json().saleId);
    const count = await db.app.query('SELECT count(*)::int AS n FROM sale WHERE store_id = $1', [s.storeId]);
    expect(count.rows[0]).toEqual({ n: 2 });
  });

  it('SP-33: where the store prices tax-exclusive, the tax is added to the price', async () => {
    const s = await shop('Exclusive');
    await openShift(s);
    const response = await sell(s, [{ quote: await quote(s, '012345678905'), quantity: 1 }], 1_375);
    expect(response.statusCode, response.body).toBe(201);
    // Exclusive 10%: round(1250 * 10 / 100) = 125 on top.
    expect(response.json()).toMatchObject({ subtotal: 1_250, taxTotal: 125, totalDue: 1_375, change: 0, lines: [{ unitPrice: 1_250, lineTotal: 1_375 }] });
  });

  it('SP-33: a line whose tax category has no rate in force yet is refused by name, and nothing is saved', async () => {
    const s = await shop();
    await openShift(s);
    const later = (await ok('POST', '/tax-categories', s.owner, { code: 'NEW', name: 'TEST-ONLY not yet in force' })).id as string;
    await ok('POST', `/tax-categories/${later}/rates`, s.owner, { jurisdiction: 'TEST-ONLY', ratePercent: '10', effectiveFrom: new Date(Date.now() + 86_400_000).toISOString() });
    await s.item('Candles', 300, { value: 'CANDLE-1', kind: 'Internal' }, { tax: later });
    const response = await sell(s, [{ quote: await quote(s, 'CANDLE-1'), quantity: 1 }], 300);
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toEqual({ code: 'no_tax_rate', message: 'Candles has no tax rate in force, so it cannot be sold.' });
    expect((await db.app.query('SELECT 1 FROM checkout WHERE store_id = $1', [s.storeId])).rows).toEqual([]);
  });

  it("PR-15, IV-15, PR-14, RT-491: a service is sold without moving stock, the stocked line beside it moves, and the sale freezes the service unit's kind", async () => {
    const s = await shop();
    await openShift(s);
    const service = (await ok('POST', '/units', s.owner, { code: 'SVC', name: 'Service', quantityKind: 'Service', scale: 0 })).id as string;
    await s.item('Gift wrap', 200, { value: 'WRAP-1', kind: 'Internal' }, { unit: service });
    const lines = [{ quote: await quote(s, 'WRAP-1'), quantity: 1 }, { quote: await quote(s, '4006381333931'), quantity: 1 }];
    const response = await sell(s, lines, 700);
    expect(response.statusCode, response.body).toBe(201);
    const moved = await db.app.query('SELECT variant_id FROM inventory_movement WHERE sale_id = $1', [response.json().saleId]);
    expect(moved.rows).toEqual([{ variant_id: s.bread }]);
    // The sale line is the service unit's only use: no movement or adjustment line names it.
    const changed = await db.app.query("UPDATE unit SET quantity_kind = 'Countable' WHERE id = $1", [service]).then(() => 'changed', (e: { code?: string }) => e.code);
    expect(changed, 'sold once, so its kind cannot change').toBe('SS021');
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
    expect((await sell(s, [{ quote: `${good}.x`, quantity: 1 }], 500)).json().error.code, 'a quote is its two parts, nothing added').toBe('invalid_quote');

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

  it('RT-489, UX-48: an item found by name is sold as selected, with no barcode on its line', async () => {
    const s = await shop();
    await openShift(s);
    const found = (await call('GET', `/stores/${s.storeId}/items?name=bread`, s.at)).json().items;
    expect(found.map((i: { description: string }) => i.description)).toEqual(['Bread']);
    const sale = await sell(s, [{ quote: found[0].quote, quantity: 1 }], 500);
    expect(sale.statusCode, sale.body).toBe(201);
    const entries = await db.app.query('SELECT entry_method, scanned_barcode FROM sale_line WHERE sale_id = $1', [sale.json().saleId]);
    expect(entries.rows).toEqual([{ entry_method: 'Selected', scanned_barcode: null }]);
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
  it('BI-39, PT-01, s22.6: a sale needs Sale.Create, a session at a till, and an open shift there', async () => {
    const s = await shop();
    const lines = [{ quote: await quote(s, '4006381333931'), quantity: 1 }];
    expect((await sell(s, lines, 500)).json().error.code).toBe('no_open_shift');
    await openShift(s);
    const nowhere = await call('POST', `/stores/${s.storeId}/sales`, signedInAs(s.cashier, s.organizationId), { clientOperationId: randomUUID(), lines, cash: { tendered: 500 } });
    expect(nowhere.json().error).toEqual({ code: 'not_at_a_till', message: 'Sign in at a till to do this.' });
    const viewer = await employeeWithAccess(db.app, s.organizationId, ['Sale.View'], { assignedStore: s.storeId, accessStores: [s.storeId] });
    const refused = await call('POST', `/stores/${s.storeId}/sales`, signedInAs(viewer, s.organizationId, s.till), { clientOperationId: randomUUID(), lines, cash: { tendered: 500 } });
    expect(refused.statusCode, 'Sale.View is not Sale.Create').toBe(403);
  });

  it("PT-02, OQ-019: a store's tills are its own; the list shows only them, a session at another store's till does nothing here, and a till names its location where there is a choice", async () => {
    const s = await shop();
    const other = await shop();
    const tills = async () => ((await call('GET', `/stores/${s.storeId}/terminals`, s.owner)).json().items as { id: string; sellFromLocationId: string }[]);
    expect((await tills()).map((t) => t.id)).toEqual([s.till]);
    const astray = await call('GET', `/stores/${s.storeId}/shift`, signedInAs(s.cashier, s.organizationId, other.till));
    expect(astray.json().error).toEqual({ code: 'not_at_a_till', message: 'This session is at a till of another store.' });

    // A second sellable location (a second store-attached warehouse; there is no route for one yet, OQ-026).
    const { defaultLocationId: annex } = await insertWarehouse(db.app, s.organizationId, s.storeId);
    const unnamed = await call('POST', `/stores/${s.storeId}/terminals`, s.owner, { code: 'T2', label: 'Till 2' });
    expect(unnamed.statusCode).toBe(400);
    expect(unnamed.json().error).toEqual({ code: 'invalid_request', message: 'Name the sellable location this till sells from.' });
    const named = (await ok('POST', `/stores/${s.storeId}/terminals`, s.owner, { code: 'T2', label: 'Till 2', sellFromLocationId: annex })).id as string;
    expect((await tills()).find((t) => t.id === named)?.sellFromLocationId).toBe(annex);
  });

  it('PY-05, SS045: cash must be enabled at the store', async () => {
    const s = await shop();
    await openShift(s);
    await ok('PUT', `/stores/${s.storeId}/payment-methods/${s.cash}`, s.owner, { enabled: false });
    const response = await sell(s, [{ quote: await quote(s, '4006381333931'), quantity: 1 }], 500);
    expect(response.json().error.code).toBe('cash_not_accepted');
  });

  it("PY-03, PY-05, architecture s24.3: an organization lists and enables only its own payment methods", async () => {
    const s = await shop();
    const other = await shop();
    expect((await call('GET', '/payment-methods', s.owner)).json().items).toEqual([{ id: s.cash, code: 'CASH', name: 'Cash', methodType: 'Cash' }]);
    const enable = (method: string) => call('PUT', `/stores/${s.storeId}/payment-methods/${method}`, s.owner, { enabled: true });
    expect((await enable(randomUUID())).json().error.code, 'an unknown method').toBe('not_found');
    expect((await enable(other.cash)).json().error.code, "another organization's method").toBe('not_found');
    const written = await db.app.query('SELECT 1 FROM store_payment_method WHERE store_id = $1 AND payment_method_id = $2', [s.storeId, other.cash]);
    expect(written.rows).toEqual([]);
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

/** A second till in the same store, with its own cashier signed in at it and a shift open. */
async function secondTill(s: Shop) {
  const till = (await ok('POST', `/stores/${s.storeId}/terminals`, s.owner, { code: 'T2', label: 'Till 2' })).id as string;
  await ok('POST', '/transitions', s.owner, { machine: 'Device', event: 'activate', subject: till });
  const cashier = await employeeWithAccess(db.app, s.organizationId, ['Sale.Create', 'Sale.View', 'Shift.Open'], { assignedStore: s.storeId, accessStores: [s.storeId] });
  const at = signedInAs(cashier, s.organizationId, till);
  await ok('POST', `/stores/${s.storeId}/shift`, at, { openingFloat: 0 });
  return { till, cashier, at };
}
const sold = async (s: Shop, code: string, tendered: number, at: Headers = s.at) => {
  const scanned = await call('GET', `/stores/${s.storeId}/scan/${code}`, at);
  const sale = await call('POST', `/stores/${s.storeId}/sales`, at, { clientOperationId: randomUUID(), lines: [{ quote: scanned.json().quote, quantity: 1 }], cash: { tendered } });
  expect(sale.statusCode, sale.body).toBe(201);
  return sale.json() as { saleId: string; documentNumber: number };
};
const numbers = (body: { items: { documentNumber: number }[] }) => body.items.map((i) => i.documentNumber);

describe('reading sales (MS-02, SP-58, RT-140, architecture s18.5)', () => {
  it("MS-02, s18.5: the store's sales are listed newest first, a page at a time, and filtered by business date, till and cashier", async () => {
    const s = await shop();
    await openShift(s);
    await sold(s, '012345678905', 1_250);
    await sold(s, '4006381333931', 500);
    const two = await secondTill(s);
    const third = await sold(s, '012345678905', 2_000, two.at);
    const other = await shop();
    await openShift(other);
    await sold(other, '012345678905', 1_250);

    const list = (query = '') => call('GET', `/stores/${s.storeId}/sales${query}`, s.owner).then((r) => r.json());
    const all = await list();
    expect(numbers(all), "newest first, and none of another organization's").toEqual([3, 2, 1]);
    expect(all.items[0]).toMatchObject({
      saleId: third.saleId, terminalId: two.till, terminalLabel: 'Till 2', employeeId: two.cashier, cashierName: 'Test Employee',
      totalDue: 1_250, currencyCode: expect.any(String), status: 'Completed', receiptStatus: null, businessDate: expect.any(String),
    });
    expect((await call('GET', `/stores/${s.storeId}/sales/${third.saleId}`, s.owner)).json(), 'one sale').toMatchObject({ saleId: third.saleId, documentNumber: 3, totalDue: 1_250 });
    const first = await list('?limit=2');
    expect(numbers(first)).toEqual([3, 2]);
    expect(first.next, 's18.5: a cursor while the page is full, as on every list').toBe('2');
    const second = await list(`?limit=2&after=${first.next}`);
    expect(numbers(second)).toEqual([1]);
    expect(second.next).toBeNull();
    expect(first.before, "the cursor's first name, kept for the screens written against it").toBe(2);
    expect(numbers(await list(`?limit=2&before=${first.before}`))).toEqual([1]);
    expect(numbers(await list(`?terminalId=${two.till}`))).toEqual([3]);
    expect(numbers(await list(`?employeeId=${s.cashier}`))).toEqual([2, 1]);
    const today = all.items[0].businessDate as string;
    expect(numbers(await list(`?from=${today}&to=${today}`))).toEqual([3, 2, 1]);
    expect(numbers(await list('?to=2000-01-01'))).toEqual([]);
    expect(numbers(await list('?from=2999-01-01'))).toEqual([]);
    expect((await call('GET', `/stores/${s.storeId}/sales?from=yesterday`, s.owner)).statusCode, 'a date is a date').toBe(400);
  });

  it('MS-02, actors-and-roles s2.4: reading sales needs Sale.View in the store', async () => {
    const s = await shop();
    const seller = await employeeWithAccess(db.app, s.organizationId, ['Sale.Create'], { assignedStore: s.storeId, accessStores: [s.storeId] });
    expect((await call('GET', `/stores/${s.storeId}/sales`, signedInAs(seller, s.organizationId))).statusCode).toBe(403);
    const other = await shop();
    expect((await call('GET', `/stores/${other.storeId}/sales`, s.owner)).statusCode, "another organization's store").toBe(403);
  });
});

describe('the receipt (SP-57..SP-60, SP-03, RT-140, UX-22)', () => {
  const receipt = (s: Shop, sale: string, as: Headers = s.at) => call('GET', `/stores/${s.storeId}/sales/${sale}/receipt`, as);
  const outcome = (s: Shop, sale: string, status: string) => call('PUT', `/stores/${s.storeId}/sales/${sale}/receipt-status`, s.at, { status });
  const reprint = (s: Shop, sale: string, reasonCodeId?: string, as: Headers = s.at) =>
    call('POST', `/stores/${s.storeId}/sales/${sale}/reprints`, as, reasonCodeId === undefined ? {} : { reasonCodeId });

  it('SP-57, SP-59, SP-60: the receipt renders the stored sale with its mandatory content, and carries no cost', async () => {
    const s = await shop();
    await openShift(s);
    const sale = await sold(s, '012345678905', 2_000);
    const shown = await receipt(s, sale.saleId);
    expect(shown.statusCode).toBe(200);
    expect(shown.json()).toMatchObject({
      saleId: sale.saleId,
      documentNumber: 1,
      businessDate: expect.any(String),
      completedAt: expect.any(String),
      store: { name: expect.any(String), code: expect.any(String) },
      taxMode: 'Inclusive',
      minorUnitExponent: expect.any(Number),
      lines: [{ lineNumber: 1, description: 'Oat milk', quantity: '1', unitPrice: 1_250, lineTotal: 1_250 }],
      taxTotal: expect.any(Number),
      totalDue: 1_250,
      payments: [{ method: 'Cash', amount: 1_250, tendered: 2_000 }],
      change: 750,
      reprint: null,
    });
    expect(shown.body, 'SP-60: no cost or margin field').not.toMatch(/cost|margin/i);
  });

  it('D-16 (Q13), SP-57, MS-02: reading a receipt is receipt issuance, under Sale.Create; Sale.View alone lists and opens sales, and reads no receipt', async () => {
    const s = await shop();
    await openShift(s);
    const sale = await sold(s, '012345678905', 1_250);
    const seller = await employeeWithAccess(db.app, s.organizationId, ['Sale.Create'], { assignedStore: s.storeId, accessStores: [s.storeId] });
    expect((await receipt(s, sale.saleId, signedInAs(seller, s.organizationId))).statusCode, 'a cashier without Sale.View').toBe(200);
    const reader = signedInAs(await employeeWithAccess(db.app, s.organizationId, ['Sale.View'], { assignedStore: s.storeId, accessStores: [s.storeId] }), s.organizationId);
    expect((await receipt(s, sale.saleId, reader)).statusCode).toBe(403);
    expect((await call('GET', `/stores/${s.storeId}/sales/${sale.saleId}`, reader)).statusCode, "the sale's detail").toBe(200);
    expect((await call('GET', `/stores/${s.storeId}/sales`, reader)).statusCode, 'the list').toBe(200);
  });

  it('SP-03, SP-58, UX-22: the till records whether the first print worked, once; a failure puts the sale in the reprint queue', async () => {
    const s = await shop();
    await openShift(s);
    const failed = await sold(s, '012345678905', 1_250);
    const printed = await sold(s, '4006381333931', 500);
    expect((await outcome(s, failed.saleId, 'Failed')).json()).toEqual({ saleId: failed.saleId, receiptStatus: 'Failed', changed: true });
    expect((await outcome(s, failed.saleId, 'Failed')).json(), 'reported twice, recorded once').toMatchObject({ changed: false });
    const flip = await outcome(s, failed.saleId, 'Printed');
    expect(flip.statusCode).toBe(409);
    expect(flip.json().error.code).toBe('receipt_status_recorded');
    expect((await outcome(s, printed.saleId, 'Printed')).json().receiptStatus).toBe('Printed');
    expect((await outcome(s, printed.saleId, 'Reprinted')).statusCode, 'a reprint is its own act').toBe(400);
    await sold(s, '4006381333931', 500);
    const queue = (await call('GET', `/stores/${s.storeId}/sales?receipt=Failed`, s.owner)).json();
    expect(numbers(queue), 'the reprint queue').toEqual([1]);
    expect(numbers((await call('GET', `/stores/${s.storeId}/sales?receipt=None`, s.owner)).json()), 'not reported yet').toEqual([3]);
    const reader = await employeeWithAccess(db.app, s.organizationId, ['Sale.View'], { assignedStore: s.storeId, accessStores: [s.storeId] });
    const refused = await call('PUT', `/stores/${s.storeId}/sales/${printed.saleId}/receipt-status`, signedInAs(reader, s.organizationId), { status: 'Printed' });
    expect(refused.statusCode, 'recording a print is receipt issuance: Sale.Create').toBe(403);
  });

  it("SP-57, BI-11, BI-25, owner's instruction of 2026-10-01: a reprint needs a live reason of the organization, is recorded with who, when and why, carries a reprint banner, and repeats the original numbers exactly", async () => {
    const s = await shop();
    await openShift(s);
    const sale = await sold(s, '012345678905', 2_000);
    const original = (await receipt(s, sale.saleId)).json();
    await ok('POST', `/variants/${s.milk}/prices`, s.owner, { amount: 1_500 });

    expect((await reprint(s, sale.saleId)).statusCode, 'no reason').toBe(400);
    const elsewhere = await shop();
    const theirs = (await ok('POST', '/reason-codes', elsewhere.owner, { code: 'COPY', name: 'Copy' })).id as string;
    expect((await reprint(s, sale.saleId, theirs)).json().error.code, "another organization's reason").toBe('invalid_reference');
    await ok('POST', `/reason-codes/${theirs}/archive`, elsewhere.owner, {});
    expect((await reprint(s, sale.saleId, theirs)).json().error.code, "s24.3: and nothing of its state").toBe('invalid_reference');
    const stale = (await ok('POST', '/reason-codes', s.owner, { code: 'OLD', name: 'Old reason' })).id as string;
    await ok('POST', `/reason-codes/${stale}/archive`, s.owner, {});
    expect((await reprint(s, sale.saleId, stale)).json().error.code, 'an archived reason').toBe('SS024');

    const copy = (await ok('POST', '/reason-codes', s.owner, { code: 'COPY', name: 'Customer copy' })).id as string;
    const reader = await employeeWithAccess(db.app, s.organizationId, ['Sale.View'], { assignedStore: s.storeId, accessStores: [s.storeId] });
    expect((await reprint(s, sale.saleId, copy, signedInAs(reader, s.organizationId))).statusCode, 'reprinting is receipt issuance: Sale.Create').toBe(403);
    const reprinted = await reprint(s, sale.saleId, copy, s.owner);
    expect(reprinted.statusCode).toBe(201);
    const { reprint: banner, receiptStatus, ...numbersAgain } = reprinted.json();
    expect(banner, 'the banner that tells the copy from the original').toEqual({ reprintedAt: expect.any(String), reason: 'Customer copy' });
    expect(receiptStatus).toBe('Reprinted');
    const { reprint: _none, receiptStatus: _was, ...originalNumbers } = original;
    expect(numbersAgain, 'the original numbers, not the new price').toEqual(originalNumbers);
    const rows = await db.app.query('SELECT reason_code_id, reprinted_by FROM receipt_reprint WHERE sale_id = $1', [sale.saleId]);
    expect(rows.rows, 'who reprinted, not who sold').toEqual([{ reason_code_id: copy, reprinted_by: s.ownerEmployeeId }]);
    expect((await reprint(s, sale.saleId, copy)).statusCode, 'reprinted again, recorded again').toBe(201);
    expect((await db.app.query('SELECT 1 FROM receipt_reprint WHERE sale_id = $1', [sale.saleId])).rows).toHaveLength(2);
    const rewrite = (pool: typeof db.app) =>
      pool.query('UPDATE receipt_reprint SET reason_code_id = $2 WHERE sale_id = $1', [sale.saleId, copy]).then(() => 'accepted', (e: { code?: string }) => e.code);
    expect(await rewrite(db.app), 'a reprint record is never rewritten by the application').toBe('42501');
    expect(await rewrite(db.owner), 'nor by the schema owner').toBe('SS010');
  });

  it('MS-02: a sale of another store is not found here, has no receipt here, and cannot be reprinted from here', async () => {
    const s = await shop();
    const other = await shop();
    await openShift(other);
    const theirs = await sold(other, '012345678905', 1_250);
    expect((await call('GET', `/stores/${s.storeId}/sales/${theirs.saleId}`, s.owner)).statusCode).toBe(404);
    expect((await receipt(s, theirs.saleId, s.owner)).statusCode).toBe(404);
    const reason = (await ok('POST', '/reason-codes', s.owner, { code: 'COPY', name: 'Customer copy' })).id as string;
    expect((await reprint(s, theirs.saleId, reason, s.owner)).statusCode).toBe(404);
    expect((await call('PUT', `/stores/${s.storeId}/sales/${theirs.saleId}/receipt-status`, s.owner, { status: 'Printed' })).statusCode).toBe(404);
  });
});

describe("the till's other edges (s22.12 disable, retire; HD-08, HD-31, HD-32; OQ-025)", () => {
  const device = (as: Headers, event: string, subject: string, reasonCodeId?: string) =>
    call('POST', '/transitions', as, { machine: 'Device', event, subject, ...(reasonCodeId === undefined ? {} : { reasonCodeId }) });
  const tillStatus = async (s: Shop, till: string) =>
    ((await call('GET', `/stores/${s.storeId}/terminals`, s.owner)).json().items as { id: string; status: string }[]).find((t) => t.id === till)?.status;

  it('s22.12, HD-31, CD-20: disabling a till needs Device.Disable and a reason; it then sells nothing and opens no shift, and its open shift can still be counted and closed', async () => {
    const s = await shop();
    await openShift(s);
    const reason = (await ok('POST', '/reason-codes', s.owner, { code: 'FAULT', name: 'Till fault' })).id as string;
    const editor = await employeeWithAccess(db.app, s.organizationId, ['Device.Edit', 'Device.View'], { assignedStore: s.storeId, accessStores: [s.storeId] });
    const refused = await device(signedInAs(editor, s.organizationId), 'disable', s.till, reason);
    expect(refused.statusCode, 'Device.Edit is not Device.Disable').toBe(403);
    expect(refused.json().error.message).toContain('Device.Disable');
    const unreasoned = await device(s.owner, 'disable', s.till);
    expect(unreasoned.json().error.code, 'a reason, always').toBe('SS055');
    expect(await tillStatus(s, s.till)).toBe('Active');

    expect((await device(s.owner, 'disable', s.till, reason)).json()).toEqual({ subject: s.till, state: 'Disabled', changed: true });
    const event = await db.app.query("SELECT reason_code_id FROM audit_event WHERE entity_id = $1 AND event_type = 'Device.StateChange' AND after ->> 'status' = 'Disabled'", [s.till]);
    expect(event.rows).toEqual([{ reason_code_id: reason }]);
    const sale = await sell(s, [{ quote: await quote(s, '012345678905'), quantity: 1 }], 1_250);
    expect(sale.json().error.code, 'turned off by an administrator').toBe('SS025');

    // The money in the drawer is still reconciled: nothing in the close depends on the till being in service.
    await ok('POST', '/transitions', s.owner, { machine: 'Shift', event: 'begin count', subject: (await call('GET', `/stores/${s.storeId}/shift`, s.at)).json().shift.id });
    const shift = (await call('GET', `/stores/${s.storeId}/shift`, s.at)).json().shift.id as string;
    await ok('POST', `/stores/${s.storeId}/shifts/${shift}/counts`, s.owner, { countedAmount: 1_000 });
    expect((await ok('POST', '/transitions', s.owner, { machine: 'Shift', event: 'close', subject: shift, payload: { closingFloat: 0 } })).state).toBe('Closed');
    expect((await call('POST', `/stores/${s.storeId}/shift`, s.at, { openingFloat: 0 })).json().error.code, 'no new shift at a disabled till').toBe('SS025');
  });

  it('D-16, HD-32, s22.12: a disabled till goes back into service with Device.Disable and a reason, and trades again', async () => {
    const s = await shop();
    const reason = (await ok('POST', '/reason-codes', s.owner, { code: 'FAULT', name: 'Till fault' })).id as string;
    await device(s.owner, 'disable', s.till, reason);
    const editor = await employeeWithAccess(db.app, s.organizationId, ['Device.Edit', 'Device.View'], { assignedStore: s.storeId, accessStores: [s.storeId] });
    const refused = await device(signedInAs(editor, s.organizationId), 'activate', s.till, reason);
    expect(refused.statusCode, 'Device.Edit activates a new till, but does not re-enable one').toBe(403);
    expect(refused.json().error.message).toContain('Device.Disable');
    expect((await device(s.owner, 'activate', s.till)).json().error.code, 'a reason, always').toBe('SS055');
    expect(await tillStatus(s, s.till)).toBe('Disabled');
    expect((await device(s.owner, 'activate', s.till, reason)).json()).toEqual({ subject: s.till, state: 'Active', changed: true });
    await openShift(s);
    expect((await sell(s, [{ quote: await quote(s, '4006381333931'), quantity: 1 }], 500)).statusCode, 'in service again').toBe(201);
  });

  it('s22.12, HD-08, BI-40: retiring needs Device.Edit and a reason; a retired till is never deleted, and nothing leaves Retired', async () => {
    const s = await shop();
    const reason = (await ok('POST', '/reason-codes', s.owner, { code: 'GONE', name: 'Replaced' })).id as string;
    const disabler = await employeeWithAccess(db.app, s.organizationId, ['Device.Disable'], { assignedStore: s.storeId, accessStores: [s.storeId] });
    expect((await device(signedInAs(disabler, s.organizationId), 'retire', s.till, reason)).statusCode, 'Device.Disable is not Device.Edit').toBe(403);
    expect((await device(s.owner, 'retire', s.till)).json().error.code, 'a reason, always').toBe('SS055');
    expect((await device(s.owner, 'retire', s.till, reason)).json()).toEqual({ subject: s.till, state: 'Retired', changed: true });
    expect(await tillStatus(s, s.till), 'still listed, with its history').toBe('Retired');
    expect((await device(s.owner, 'retire', s.till, reason)).json(), 'retiring again changes nothing').toEqual({ subject: s.till, state: 'Retired', changed: false });
    for (const event of ['disable', 'activate']) {
      expect((await device(s.owner, event, s.till, reason)).json().error.code, event).toBe('illegal_transition');
    }
    const registered = (await ok('POST', `/stores/${s.storeId}/terminals`, s.owner, { code: 'T9', label: 'Never used' })).id as string;
    expect((await device(s.owner, 'retire', registered, reason)).json().state, 'a till never activated can be retired too').toBe('Retired');
  });
});
