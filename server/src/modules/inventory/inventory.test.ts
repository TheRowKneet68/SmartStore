import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { onboard } from '../../onboarding.ts';
import { signedInAs, testApp } from '../../../test/app.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { employeeWithAccess, insertStore, insertWarehouse, onboardingAnswers } from '../../../test/fixtures.ts';

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
const call = (method: 'GET' | 'POST' | 'DELETE', url: string, as: Headers, payload?: object) =>
  app.inject({ method, url: `/api/v1${url}`, headers: as, ...(payload ? { payload } : {}) });
async function ok(method: 'POST' | 'DELETE', url: string, as: Headers, payload?: object) {
  const response = await call(method, url, as, payload);
  expect(response.statusCode, `${method} ${url}: ${response.body}`).toBeLessThan(300);
  return response.json();
}

/** An onboarded store with one stocked item (no stock yet), a reason, and staff holding the given keys in the store. */
async function store() {
  const o = await onboard(db.app, onboardingAnswers());
  const owner = signedInAs(o.ownerEmployeeId, o.organizationId);
  const unit = (await ok('POST', '/units', owner, { code: 'EA', name: 'Each', quantityKind: 'Countable', scale: 0 })).id;
  const category = (await ok('POST', '/categories', owner, { name: 'Goods', parentId: null, sortOrder: 1 })).id;
  const product = (await ok('POST', '/products', owner, { categoryId: category, name: 'Widget' })).id;
  const variant = (await ok('POST', `/products/${product}/variants`, owner, { baseUnitId: unit, price: { amount: 100 } })).id as string;
  const reason = (await ok('POST', '/reason-codes', owner, { code: 'COUNT', name: 'Count correction' })).id as string;
  const staff = async (keys: string[]) => signedInAs(await employeeWithAccess(db.app, o.organizationId, keys, { assignedStore: o.storeId, accessStores: [o.storeId] }), o.organizationId);
  return { ...o, owner, variant, reason, location: o.defaultLocationId, staff };
}
type Store = Awaited<ReturnType<typeof store>>;

const onHand = async (s: Store) =>
  (await db.app.query<{ on_hand: string }>('SELECT on_hand::text FROM stock_balance WHERE variant_id = $1 AND storage_location_id = $2', [s.variant, s.location])).rows[0]?.on_hand ?? null;
const move = (as: Headers, subject: string, event: string) => call('POST', '/transitions', as, { machine: 'StockAdjustment', event, subject });

describe('reason codes (BI-25, IV-33)', () => {
  it('IV-33, SS024: reason codes are the organization\'s; any of its employees reads the live list; an archived one takes no new document', async () => {
    const s = await store();
    const nobody = await s.staff([]);
    expect((await call('GET', '/reason-codes', nobody)).json().items).toEqual([{ id: s.reason, code: 'COUNT', name: 'Count correction' }]);
    expect((await call('POST', '/reason-codes', nobody, { code: 'X', name: 'X' })).statusCode, 'Config.Organization').toBe(403);
    expect((await ok('POST', `/reason-codes/${s.reason}/archive`, s.owner)).changed).toBe(true);
    expect((await call('GET', '/reason-codes', nobody)).json().items).toEqual([]);
    const refused = await call('POST', `/stores/${s.storeId}/adjustments`, s.owner, { reasonCodeId: s.reason });
    expect(refused.json().error.code).toBe('SS024');
  });
});

describe('the stock adjustment (s22.17; IV-32..IV-35, BI-26, BI-27, UX-36, UX-37)', () => {
  it('IV-32, UX-36, UX-37, IV-34: a draft with its number; a count line keeps the counted and system quantities and moves their difference', async () => {
    const s = await store();
    const doc = await ok('POST', `/stores/${s.storeId}/adjustments`, s.owner, { reasonCodeId: s.reason, note: 'Shelf count' });
    expect(doc).toMatchObject({ kind: 'Adjustment', status: 'Draft', documentNumber: expect.any(Number), reason: 'Count correction', lines: [] });
    const counted = await ok('POST', `/stores/${s.storeId}/adjustments/${doc.id}/lines`, s.owner, { variantId: s.variant, locationId: s.location, countedQuantity: '7' });
    expect(counted.lines).toEqual([
      expect.objectContaining({ movementType: 'ADJUSTMENT_IN', direction: 'In', quantity: '7.0000', countedQuantity: '7.0000', systemQuantity: '0.0000' }),
    ]);
    const damaged = await ok('POST', `/stores/${s.storeId}/adjustments/${doc.id}/lines`, s.owner, { variantId: s.variant, locationId: s.location, movementType: 'DAMAGE', quantity: '2' });
    expect(damaged.lines[1]).toMatchObject({ movementType: 'DAMAGE', direction: 'Out', quantity: '2.0000', countedQuantity: null });
    const same = await call('POST', `/stores/${s.storeId}/adjustments/${doc.id}/lines`, s.owner, { variantId: s.variant, locationId: s.location, countedQuantity: '0' });
    expect(same.json().error.code).toBe('no_difference');
    expect((await ok('DELETE', `/stores/${s.storeId}/adjustments/${doc.id}/lines/${damaged.lines[1].id}`, s.owner)).lines).toHaveLength(1);
  });

  it('BI-26, IV-35, BI-27, RT-486: submitted by one person and approved by another; stock moves only when posted, all at once', async () => {
    const s = await store();
    const adjuster = await s.staff(['Inventory.Adjust']);
    const approver = await s.staff(['Inventory.Adjust.Large.Approve']);
    const doc = await ok('POST', `/stores/${s.storeId}/adjustments`, adjuster, { reasonCodeId: s.reason });
    await ok('POST', `/stores/${s.storeId}/adjustments/${doc.id}/lines`, adjuster, { variantId: s.variant, locationId: s.location, countedQuantity: '7' });
    await ok('POST', `/stores/${s.storeId}/adjustments/${doc.id}/lines`, adjuster, { variantId: s.variant, locationId: s.location, movementType: 'DAMAGE', quantity: '2' });
    expect((await move(adjuster, doc.id, 'submit')).json().state).toBe('PendingApproval');
    const late = await call('POST', `/stores/${s.storeId}/adjustments/${doc.id}/lines`, adjuster, { variantId: s.variant, locationId: s.location, movementType: 'LOSS', quantity: '1' });
    expect(late.json().error.code, 'lines change only in draft').toBe('SS018');
    expect((await move(adjuster, doc.id, 'approve')).statusCode, 'approving needs its own key').toBe(403);
    const both = await s.staff(['Inventory.Adjust', 'Inventory.Adjust.Large.Approve']);
    const doc2 = await ok('POST', `/stores/${s.storeId}/adjustments`, both, { reasonCodeId: s.reason });
    await ok('POST', `/stores/${s.storeId}/adjustments/${doc2.id}/lines`, both, { variantId: s.variant, locationId: s.location, countedQuantity: '1' });
    await move(both, doc2.id, 'submit');
    expect((await move(both, doc2.id, 'approve')).json().error.message, 'never the submitter').toBe('The approver must be someone other than the person who submitted it.');

    expect((await move(approver, doc.id, 'approve')).json().state).toBe('Approved');
    expect(await onHand(s), 'approved is not posted').toBeNull();
    expect((await move(adjuster, doc.id, 'post')).json().state).toBe('Posted');
    expect(await onHand(s)).toBe('5.0000');
    const read = await call('GET', `/stores/${s.storeId}/adjustments/${doc.id}`, adjuster);
    expect(read.statusCode, 'reading needs Inventory.View').toBe(403);
    const viewed = await call('GET', `/stores/${s.storeId}/adjustments/${doc.id}`, s.owner);
    expect(viewed.json()).toMatchObject({ status: 'Posted', submittedBy: expect.any(String), approvedBy: expect.any(String) });
  });

  it('IV-12, RT-062, SM-04: a posted adjustment is reversed by compensating movements, once; a repeat changes nothing', async () => {
    const s = await store();
    const doc = await ok('POST', `/stores/${s.storeId}/adjustments`, s.owner, { reasonCodeId: s.reason });
    await ok('POST', `/stores/${s.storeId}/adjustments/${doc.id}/lines`, s.owner, { variantId: s.variant, locationId: s.location, countedQuantity: '4' });
    await move(s.owner, doc.id, 'submit');
    await move(await s.staff(['Inventory.Adjust.Large.Approve']), doc.id, 'approve');
    await move(s.owner, doc.id, 'post');
    expect(await onHand(s)).toBe('4.0000');
    expect((await move(s.owner, doc.id, 'reverse')).json()).toMatchObject({ state: 'Reversed', changed: true });
    expect(await onHand(s)).toBe('0.0000');
    expect((await move(s.owner, doc.id, 'reverse')).json()).toMatchObject({ state: 'Reversed', changed: false });
    const ledger = await db.app.query("SELECT movement_type, direction FROM inventory_movement WHERE stock_adjustment_id = $1 ORDER BY seq", [doc.id]);
    expect(ledger.rows).toEqual([{ movement_type: 'ADJUSTMENT_IN', direction: 'In' }, { movement_type: 'REVERSAL', direction: 'Out' }]);
  });

  it('IV-16, BI-36, RT-483: under BlockNegative a posting that would go below zero is refused, and nothing moves', async () => {
    const s = await store();
    await ok('POST', `/stores/${s.storeId}/settings`, s.owner, { taxMode: 'Inclusive', negativeStockPolicy: 'BlockNegative', returnWindowDays: 30, defaultReturnDisposition: 'Quarantine' });
    const doc = await ok('POST', `/stores/${s.storeId}/adjustments`, s.owner, { reasonCodeId: s.reason });
    await ok('POST', `/stores/${s.storeId}/adjustments/${doc.id}/lines`, s.owner, { variantId: s.variant, locationId: s.location, movementType: 'LOSS', quantity: '3' });
    await move(s.owner, doc.id, 'submit');
    await move(await s.staff(['Inventory.Adjust.Large.Approve']), doc.id, 'approve');
    const refused = await move(s.owner, doc.id, 'post');
    expect(refused.json().error.code).toBe('SS011');
    expect((await call('GET', `/stores/${s.storeId}/adjustments/${doc.id}`, s.owner)).json().status, 'still approved').toBe('Approved');
    expect(await onHand(s)).toBeNull();
  });
});

describe('opening balances and who may move stock (inventory-domain s5, IV-14, IV-37)', () => {
  it('inventory-domain s5: opening stock is loaded under Config.Organization and approved under Import.Approve', async () => {
    const s = await store();
    const adjuster = await s.staff(['Inventory.Adjust']);
    expect((await call('POST', `/stores/${s.storeId}/opening-balances`, adjuster, { reasonCodeId: s.reason })).statusCode).toBe(403);
    const loader = await s.staff(['Config.Organization']);
    const doc = await ok('POST', `/stores/${s.storeId}/opening-balances`, loader, { reasonCodeId: s.reason });
    expect(doc.kind).toBe('OpeningBalance');
    await ok('POST', `/stores/${s.storeId}/opening-balances/${doc.id}/lines`, loader, { variantId: s.variant, locationId: s.location, quantity: '12' });
    expect((await move(loader, doc.id, 'submit')).json().state).toBe('PendingApproval');
    const adjustApprover = await s.staff(['Inventory.Adjust.Large.Approve']);
    expect((await move(adjustApprover, doc.id, 'approve')).json().error.message).toContain('Import.Approve');
    expect((await move(await s.staff(['Import.Approve']), doc.id, 'approve')).json().state).toBe('Approved');
    expect((await move(loader, doc.id, 'post')).json().state).toBe('Posted');
    expect(await onHand(s)).toBe('12.0000');
  });

  it('IV-37, AC-01: a cashier can never adjust stock', async () => {
    const s = await store();
    const cashier = await s.staff(['Sale.Create', 'Shift.Open', 'Product.View', 'Price.View']);
    expect((await call('POST', `/stores/${s.storeId}/adjustments`, cashier, { reasonCodeId: s.reason })).statusCode).toBe(403);
  });
});

describe("a store's stock, and only its own (IV-01, IV-06, MS-02, MS-16, IV-09)", () => {
  it('MS-16, MS-02: a line only at the store\'s own locations; stock and ledger show only the store, the ledger under its own key', async () => {
    const s = await store();
    const other = await insertStore(db.app, s.organizationId);
    const elsewhere = await insertWarehouse(db.app, s.organizationId, other);
    const doc = await ok('POST', `/stores/${s.storeId}/adjustments`, s.owner, { reasonCodeId: s.reason });
    const foreign = await call('POST', `/stores/${s.storeId}/adjustments/${doc.id}/lines`, s.owner, { variantId: s.variant, locationId: elsewhere.defaultLocationId, countedQuantity: '1' });
    expect(foreign.json().error.code).toBe('invalid_location');
    await ok('POST', `/stores/${s.storeId}/adjustments/${doc.id}/lines`, s.owner, { variantId: s.variant, locationId: s.location, countedQuantity: '3' });
    await move(s.owner, doc.id, 'submit');
    await move(await s.staff(['Inventory.Adjust.Large.Approve']), doc.id, 'approve');
    await move(s.owner, doc.id, 'post');

    const locations = (await call('GET', `/stores/${s.storeId}/locations`, s.owner)).json().items;
    expect(locations.map((l: { id: string }) => l.id)).toEqual([s.location]);
    const stock = (await call('GET', `/stores/${s.storeId}/stock`, s.owner)).json().items;
    expect(stock).toEqual([expect.objectContaining({ variantId: s.variant, locationId: s.location, onHand: '3.0000', product: 'Widget' })]);
    expect((await call('GET', `/stores/${other}/stock`, s.owner)).statusCode, 'no access to another store (EM-13, MS-03)').toBe(403);
    const viewer = await s.staff(['Inventory.View']);
    expect((await call('GET', `/stores/${s.storeId}/movements`, viewer)).statusCode, 'the ledger is Inventory.Ledger.View').toBe(403);
    const ledger = (await call('GET', `/stores/${s.storeId}/movements`, s.owner)).json().items;
    expect(ledger).toEqual([expect.objectContaining({ movementType: 'ADJUSTMENT_IN', quantity: '3.0000', resultingBalance: '3.0000', stockAdjustmentId: doc.id })]);

    const drift = await db.app.query('SELECT * FROM inventory_ledger_drift()');
    expect(drift.rows, 'IV-09: every balance agrees with its ledger').toEqual([]);
  });
});
