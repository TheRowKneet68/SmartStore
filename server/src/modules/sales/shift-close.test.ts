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
const call = (method: 'GET' | 'POST' | 'PUT', url: string, as: Headers, payload?: object) =>
  app.inject({ method, url: `/api/v1${url}`, headers: as, ...(payload ? { payload } : {}) });

async function ok(method: 'POST' | 'PUT', url: string, as: Headers, payload: object): Promise<Record<string, unknown>> {
  const response = await call(method, url, as, payload);
  expect(response.statusCode, `${method} ${url}: ${response.body}`).toBeLessThan(300);
  return response.json();
}

/**
 * A store trading at one till, built through the routes (TEST-ONLY): an item at 1250, cash enabled, an active till, a
 * shift opened with a float of 1000, and one cash sale of the item, so the drawer is expected to hold 2250 (`CD-06`).
 * The cashier may sell and open and close shifts; the manager may acknowledge variances and read counts.
 */
async function trading() {
  const o = await onboard(db.app, onboardingAnswers());
  const owner = signedInAs(o.ownerEmployeeId, o.organizationId);
  const unit = (await ok('POST', '/units', owner, { code: 'EA', name: 'Each', quantityKind: 'Countable', scale: 0 })).id as string;
  const tax = (await ok('POST', '/tax-categories', owner, { code: 'STD', name: 'TEST-ONLY standard' })).id as string;
  await ok('POST', `/tax-categories/${tax}/rates`, owner, { jurisdiction: 'TEST-ONLY', ratePercent: '10' });
  const category = (await ok('POST', '/categories', owner, { name: 'Groceries', parentId: null, sortOrder: 1 })).id as string;
  const product = (await ok('POST', '/products', owner, { categoryId: category, name: 'Oat milk' })).id as string;
  await ok('POST', `/products/${product}/variants`, owner, {
    baseUnitId: unit,
    taxCategoryId: tax,
    price: { amount: 1_250 },
    barcodes: [{ value: '012345678905', kind: 'UPC_A' }],
  });
  await ok('POST', '/transitions', owner, { machine: 'Product', event: 'activate', subject: product });
  const cash = (await ok('POST', '/payment-methods', owner, { code: 'CASH', name: 'Cash', methodType: 'Cash' })).id as string;
  await ok('PUT', `/stores/${o.storeId}/payment-methods/${cash}`, owner, { enabled: true });
  const till = (await ok('POST', `/stores/${o.storeId}/terminals`, owner, { code: 'T1', label: 'Till 1' })).id as string;
  await ok('POST', '/transitions', owner, { machine: 'Device', event: 'activate', subject: till });
  const staff = (keys: string[], terminal?: string) =>
    employeeWithAccess(db.app, o.organizationId, keys, { assignedStore: o.storeId, accessStores: [o.storeId] }).then((id) => ({
      id,
      as: signedInAs(id, o.organizationId, terminal),
    }));
  const cashier = await staff(['Sale.Create', 'Shift.Open', 'Shift.Close'], till);
  const manager = await staff(['Cash.Variance.Acknowledge', 'Cash.Count.View']);
  const reason = (await ok('POST', '/reason-codes', owner, { code: 'SHORT', name: 'Drawer short' })).id as string;
  const shift = ((await ok('POST', `/stores/${o.storeId}/shift`, cashier.as, { openingFloat: 1_000 })).shift as { id: string }).id;
  const scanned = await call('GET', `/stores/${o.storeId}/scan/012345678905`, cashier.as);
  await ok('POST', `/stores/${o.storeId}/sales`, cashier.as, {
    clientOperationId: randomUUID(),
    lines: [{ quote: scanned.json().quote, quantity: 1 }],
    cash: { tendered: 1_250 },
  });
  return { ...o, owner, till, cashier, manager, reason, shift, staff };
}
type Trading = Awaited<ReturnType<typeof trading>>;

const shiftMove = (as: Headers, subject: string, event: string, payload?: object) =>
  call('POST', '/transitions', as, { machine: 'Shift', event, subject, ...(payload ? { payload } : {}) });
const shiftStatus = async (shift: string) =>
  (await db.app.query<{ status: string }>('SELECT status FROM cash_shift WHERE id = $1', [shift])).rows[0]!.status;

describe('beginning the count (s22.11 begin count; CD-20, CD-21, BI-39)', () => {
  it('CD-20, s22.11, SM-55: beginning the count needs Shift.Close, and moves the shift from Open to Reconciling', async () => {
    const t: Trading = await trading();
    const seller = await t.staff(['Sale.Create', 'Shift.Open'], t.till);
    const refused = await shiftMove(seller.as, t.shift, 'begin count');
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.message).toContain('Shift.Close');
    expect(await shiftStatus(t.shift)).toBe('Open');

    const begun = await shiftMove(t.cashier.as, t.shift, 'begin count');
    expect(begun.statusCode).toBe(200);
    expect(begun.json()).toEqual({ subject: t.shift, state: 'Reconciling', changed: true });
    const event = await db.app.query(
      "SELECT actor_id FROM audit_event WHERE entity_id = $1 AND event_type = 'Shift.StateChange'",
      [t.shift],
    );
    expect(event.rows, 's22.11: begin count is audited as Shift.StateChange').toEqual([{ actor_id: t.cashier.id }]);
  });

  it('BI-39, SM-04: a shift being counted sells nothing, and beginning again changes nothing', async () => {
    const t = await trading();
    await shiftMove(t.cashier.as, t.shift, 'begin count');
    const scanned = await call('GET', `/stores/${t.storeId}/scan/012345678905`, t.cashier.as);
    const sale = await call('POST', `/stores/${t.storeId}/sales`, t.cashier.as, {
      clientOperationId: randomUUID(),
      lines: [{ quote: scanned.json().quote, quantity: 1 }],
      cash: { tendered: 1_250 },
    });
    expect(sale.statusCode).toBe(409);
    expect(sale.json().error.code).toBe('no_open_shift');
    const again = await shiftMove(t.cashier.as, t.shift, 'begin count');
    expect(again.json()).toEqual({ subject: t.shift, state: 'Reconciling', changed: false });
  });

  it("MS-04: another organization's shift is not found", async () => {
    const t = await trading();
    const other = await trading();
    const response = await shiftMove(other.cashier.as, t.shift, 'begin count');
    expect(response.statusCode).toBe(404);
    expect(await shiftStatus(t.shift)).toBe('Open');
  });
});
