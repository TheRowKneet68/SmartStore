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
const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, as: Headers, payload?: object) =>
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
    await store(); // another organization, with a reason code of its own that must not show here
    const nobody = await s.staff([]);
    expect((await call('GET', '/reason-codes', nobody)).json().items).toEqual([{ id: s.reason, code: 'COUNT', name: 'Count correction' }]);
    expect((await call('POST', '/reason-codes', nobody, { code: 'X', name: 'X' })).statusCode, 'Config.Organization').toBe(403);
    expect((await ok('POST', `/reason-codes/${s.reason}/archive`, s.owner)).changed).toBe(true);
    expect((await ok('POST', `/reason-codes/${s.reason}/archive`, s.owner)).changed, 'once').toBe(false);
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

    // UX-37: a recount sets the counted quantity beside the system's, which is now 5.
    const recount = await ok('POST', `/stores/${s.storeId}/adjustments`, adjuster, { reasonCodeId: s.reason });
    const line = await ok('POST', `/stores/${s.storeId}/adjustments/${recount.id}/lines`, adjuster, { variantId: s.variant, locationId: s.location, countedQuantity: '3' });
    expect(line.lines[0]).toMatchObject({ movementType: 'ADJUSTMENT_OUT', direction: 'Out', quantity: '2.0000', countedQuantity: '3.0000', systemQuantity: '5.0000' });
  });

  it('IV-23: a balance another transaction holds is waited for only so long; then nothing is saved and the answer says to retry', async () => {
    const s = await store();
    const doc = await ok('POST', `/stores/${s.storeId}/adjustments`, s.owner, { reasonCodeId: s.reason });
    await ok('POST', `/stores/${s.storeId}/adjustments/${doc.id}/lines`, s.owner, { variantId: s.variant, locationId: s.location, countedQuantity: '4' });
    await move(s.owner, doc.id, 'submit');
    await move(await s.staff(['Inventory.Adjust.Large.Approve']), doc.id, 'approve');
    const first = await ok('POST', `/stores/${s.storeId}/adjustments`, s.owner, { reasonCodeId: s.reason });
    await ok('POST', `/stores/${s.storeId}/adjustments/${first.id}/lines`, s.owner, { variantId: s.variant, locationId: s.location, countedQuantity: '1' });
    await move(s.owner, first.id, 'submit');
    await move(await s.staff(['Inventory.Adjust.Large.Approve']), first.id, 'approve');
    await move(s.owner, first.id, 'post'); // the balance row exists now
    const holder = await db.owner.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM stock_balance WHERE variant_id = $1 AND storage_location_id = $2 FOR UPDATE', [s.variant, s.location]);
      const started = Date.now();
      const blocked = await move(s.owner, doc.id, 'post');
      expect(blocked.json().error).toEqual({ code: 'busy_item', message: 'Another till is using one of these items right now. Nothing was saved; try again.' });
      expect(Date.now() - started, 'bounded by the lock timeout').toBeLessThan(10_000);
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
    expect((await call('GET', `/stores/${s.storeId}/adjustments/${doc.id}`, s.owner)).json().status).toBe('Approved');
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

    // "Reverse any movement" is Inventory.Adjust, for an opening balance too (inventory-domain s5).
    expect((await move(loader, doc.id, 'reverse')).statusCode).toBe(403);
    expect((await move(adjuster, doc.id, 'reverse')).json().state).toBe('Reversed');
    expect(await onHand(s)).toBe('0.0000');
    const wrongFamily = await call('POST', `/stores/${s.storeId}/adjustments/${doc.id}/lines`, adjuster, { variantId: s.variant, locationId: s.location, countedQuantity: '1' });
    expect(wrongFamily.statusCode, 'an opening balance is not reached through the adjustment routes').toBe(404);
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

    // A document is reached only through its own store, even by someone with access to both.
    const both = signedInAs(
      await employeeWithAccess(db.app, s.organizationId, ['Inventory.View'], { assignedStore: null, accessStores: [s.storeId, other] }),
      s.organizationId,
    );
    expect((await call('GET', `/stores/${s.storeId}/adjustments/${doc.id}`, both)).statusCode).toBe(200);
    expect((await call('GET', `/stores/${other}/adjustments/${doc.id}`, both)).statusCode).toBe(404);
  });
});

describe('warehouses and storage locations (RT-003, MS-15, MS-17, RT-057, WH-01, WH-03, WH-04)', () => {
  it('RT-003, MS-15: requires Config.Organization; creates a store-attached warehouse with its default location', async () => {
    const s = await store();
    const nobody = await s.staff([]);
    expect((await call('POST', '/warehouses', nobody, { kind: 'StoreAttached', code: 'WH-A', name: 'Attached', storeId: s.storeId })).statusCode).toBe(403);
    const wh = await ok('POST', '/warehouses', s.owner, { kind: 'StoreAttached', code: 'WH-A', name: 'Attached', storeId: s.storeId });
    expect(wh.id).toBeDefined();
    expect(wh.defaultLocationId).toBeDefined();
    const list = (await call('GET', '/warehouses', s.owner)).json();
    expect(list.items.some((w: { id: string }) => w.id === wh.id)).toBe(true);
  });

  it('RT-003, MS-15: creates a central warehouse; storeId not allowed for Central', async () => {
    const s = await store();
    const bad = await call('POST', '/warehouses', s.owner, { kind: 'Central', code: 'WH-C', name: 'Central', storeId: s.storeId });
    expect(bad.statusCode).toBe(422);
    const central = await ok('POST', '/warehouses', s.owner, { kind: 'Central', code: 'WH-C', name: 'Central' });
    expect(central.id).toBeDefined();
  });

  it('MS-17, WH-03, WH-04: lists storage locations; creates a new location under a warehouse', async () => {
    const s = await store();
    const wh = await ok('POST', '/warehouses', s.owner, { kind: 'StoreAttached', code: 'WH-B', name: 'Store B', storeId: s.storeId });
    const locs = (await call('GET', `/warehouses/${wh.id}/storage-locations`, s.owner)).json();
    expect(locs.items).toHaveLength(1);
    expect(locs.items[0].locationType).toBe('Default');
    const extra = await ok('POST', `/warehouses/${wh.id}/storage-locations`, s.owner, { code: 'RCV', name: 'Receiving', locationType: 'Receiving', isSellable: false });
    expect(extra.id).toBeDefined();
    const after = (await call('GET', `/warehouses/${wh.id}/storage-locations`, s.owner)).json();
    expect(after.items).toHaveLength(2);
  });

  it('MS-04: a warehouse from another org is not visible', async () => {
    const s = await store();
    const other = await store();
    const wh = await ok('POST', '/warehouses', other.owner, { kind: 'Central', code: 'WH-X', name: 'Other' });
    expect((await call('GET', `/warehouses/${wh.id}/storage-locations`, s.owner)).statusCode).toBe(404);
  });
});

describe('stock counts (IV-25..IV-30, SM-81..SM-84, RT-071, D-09)', () => {
  // All StockCount transitions have requires_reason=true in state_machine_edge; the audit trigger
  // reads smartstore.reason_code_id set by auditContext.  Always pass s.reason (IV-28, AU-12).
  const countMove = (as: Headers, subject: string, event: string, reasonCodeId: string) =>
    call('POST', '/transitions', as, { machine: 'StockCount', event, subject, reasonCodeId });

  it('IV-25: creates an Open count; Inventory.Count.Create required', async () => {
    const s = await store();
    const noKey = await s.staff([]);
    expect((await call('POST', `/stores/${s.storeId}/stock-counts`, noKey, { scope: 'Location' })).statusCode).toBe(403);
    const res = await call('POST', `/stores/${s.storeId}/stock-counts`, s.owner, { scope: 'Location', note: 'Test count' });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ status: 'Open', scope: 'Location', note: 'Test count', lines: [] });
    expect(body.documentNumber).toBeDefined();
  });

  it('IV-26: expected_quantity frozen from current ledger balance when the line is added', async () => {
    const s = await store();
    const count = (await call('POST', `/stores/${s.storeId}/stock-counts`, s.owner, { scope: 'Location' })).json();
    const withLine = (await call('POST', `/stores/${s.storeId}/stock-counts/${count.id}/lines`, s.owner,
      { variantId: s.variant, locationId: s.location })).json();
    expect(withLine.lines).toHaveLength(1);
    // No stock loaded yet: balance is zero (IV-26)
    expect(withLine.lines[0]).toMatchObject({ expectedQuantity: '0.0000', countedQuantity: null, movedSinceSnapshot: false });
    // Duplicate line is refused
    const dup = await call('POST', `/stores/${s.storeId}/stock-counts/${count.id}/lines`, s.owner,
      { variantId: s.variant, locationId: s.location });
    expect(dup.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('IV-28, IV-29: entering counted quantity — negative rejected; variance requires reason; zero-variance accepted; IN/OUT direction set', async () => {
    const s = await store();
    const count = (await call('POST', `/stores/${s.storeId}/stock-counts`, s.owner, { scope: 'Location' })).json();
    const withLine = (await call('POST', `/stores/${s.storeId}/stock-counts/${count.id}/lines`, s.owner,
      { variantId: s.variant, locationId: s.location })).json();
    const lineId = withLine.lines[0].id;

    // IV-29: negative rejected by schema validation
    expect((await call('PUT', `/stores/${s.storeId}/stock-counts/${count.id}/lines/${lineId}`, s.owner,
      { countedQuantity: '-1' })).statusCode).toBe(400);

    // IV-28: variance without reason rejected
    expect((await call('PUT', `/stores/${s.storeId}/stock-counts/${count.id}/lines/${lineId}`, s.owner,
      { countedQuantity: '5' })).json().error.code).toBe('missing_reason');

    // zero-variance (count = 0 = expected): no reason needed
    expect((await call('PUT', `/stores/${s.storeId}/stock-counts/${count.id}/lines/${lineId}`, s.owner,
      { countedQuantity: '0' })).statusCode).toBe(200);

    // variance with reason: accepted; COUNT_VARIANCE_IN because counted > expected
    const res = (await call('PUT', `/stores/${s.storeId}/stock-counts/${count.id}/lines/${lineId}`, s.owner,
      { countedQuantity: '3', reasonCodeId: s.reason })).json();
    expect(res.lines[0]).toMatchObject({ countedQuantity: '3.0000', movementType: 'COUNT_VARIANCE_IN', direction: 'In' });
  });

  it('IV-27, SM-83: movedSinceSnapshot flag appears after a movement to the counted location', async () => {
    const s = await store();
    const approver = await s.staff(['Inventory.Adjust.Large.Approve']);
    const count = (await call('POST', `/stores/${s.storeId}/stock-counts`, s.owner, { scope: 'Location' })).json();
    await call('POST', `/stores/${s.storeId}/stock-counts/${count.id}/lines`, s.owner,
      { variantId: s.variant, locationId: s.location });

    const before = (await call('GET', `/stores/${s.storeId}/stock-counts/${count.id}`, s.owner)).json();
    expect(before.lines[0].movedSinceSnapshot).toBe(false);

    // Post an adjustment so an inventory_movement lands after the count line's created_at
    const adj = (await call('POST', `/stores/${s.storeId}/adjustments`, s.owner, { reasonCodeId: s.reason })).json();
    await ok('POST', `/stores/${s.storeId}/adjustments/${adj.id}/lines`, s.owner,
      { variantId: s.variant, locationId: s.location, movementType: 'FOUND', quantity: '3' });
    await move(s.owner, adj.id, 'submit');
    await move(approver, adj.id, 'approve');
    await move(s.owner, adj.id, 'post');

    const after = (await call('GET', `/stores/${s.storeId}/stock-counts/${count.id}`, s.owner)).json();
    expect(after.lines[0].movedSinceSnapshot).toBe(true);
  });

  it('IV-28: posting refused when any line is uncounted; zero-variance count posts without movements', async () => {
    const s = await store();
    const count = (await call('POST', `/stores/${s.storeId}/stock-counts`, s.owner, { scope: 'Location' })).json();
    const withLine = (await call('POST', `/stores/${s.storeId}/stock-counts/${count.id}/lines`, s.owner,
      { variantId: s.variant, locationId: s.location })).json();
    const lineId = withLine.lines[0].id;

    // before hook rejects posting with uncounted line
    expect((await countMove(s.owner, count.id, 'post', s.reason)).json().error.code).toBe('uncounted_lines');

    // enter zero-variance and post: no movements written, state becomes Posted
    await call('PUT', `/stores/${s.storeId}/stock-counts/${count.id}/lines/${lineId}`, s.owner, { countedQuantity: '0' });
    expect((await countMove(s.owner, count.id, 'post', s.reason)).json().state).toBe('Posted');
    const n = await db.app.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM inventory_movement WHERE stock_count_id = $1', [count.id],
    );
    expect(n.rows[0]!.n).toBe(0);
  });

  it('SM-81, IV-30: posting writes COUNT_VARIANCE_IN movement; SM-82: reverse writes COUNT_VARIANCE_REVERSAL', async () => {
    const s = await store();
    const count = (await call('POST', `/stores/${s.storeId}/stock-counts`, s.owner, { scope: 'Location' })).json();
    const withLine = (await call('POST', `/stores/${s.storeId}/stock-counts/${count.id}/lines`, s.owner,
      { variantId: s.variant, locationId: s.location })).json();
    await call('PUT', `/stores/${s.storeId}/stock-counts/${count.id}/lines/${withLine.lines[0].id}`, s.owner,
      { countedQuantity: '5', reasonCodeId: s.reason });

    expect((await countMove(s.owner, count.id, 'post', s.reason)).json().state).toBe('Posted');
    expect(await onHand(s)).toBe('5.0000');

    const posted = await db.app.query<{ movement_type: string; direction: string; quantity: string }>(
      'SELECT movement_type, direction, quantity::text FROM inventory_movement WHERE stock_count_id = $1 ORDER BY seq',
      [count.id],
    );
    expect(posted.rows).toEqual([{ movement_type: 'COUNT_VARIANCE_IN', direction: 'In', quantity: '5.0000' }]);

    // SM-82: reverse compensates with COUNT_VARIANCE_REVERSAL
    expect((await countMove(s.owner, count.id, 'reverse', s.reason)).json().state).toBe('Reversed');
    expect(await onHand(s)).toBe('0.0000');
    const all = await db.app.query<{ movement_type: string; direction: string }>(
      'SELECT movement_type, direction FROM inventory_movement WHERE stock_count_id = $1 ORDER BY seq',
      [count.id],
    );
    expect(all.rows).toEqual([
      { movement_type: 'COUNT_VARIANCE_IN', direction: 'In' },
      { movement_type: 'COUNT_VARIANCE_REVERSAL', direction: 'Out' },
    ]);
  });

  it('D-09: cancel sets Cancelled; listing filters by status', async () => {
    const s = await store();
    const count = (await call('POST', `/stores/${s.storeId}/stock-counts`, s.owner, { scope: 'Location' })).json();
    expect((await countMove(s.owner, count.id, 'cancel', s.reason)).json().state).toBe('Cancelled');
    expect((await call('GET', `/stores/${s.storeId}/stock-counts/${count.id}`, s.owner)).json().status).toBe('Cancelled');

    const open = (await call('POST', `/stores/${s.storeId}/stock-counts`, s.owner, { scope: 'Location' })).json();
    const listOpen = (await call('GET', `/stores/${s.storeId}/stock-counts?status=Open`, s.owner)).json();
    expect(listOpen.items.every((i: { status: string }) => i.status === 'Open')).toBe(true);
    expect(listOpen.items.some((i: { id: string }) => i.id === open.id)).toBe(true);
    expect(listOpen.items.some((i: { id: string }) => i.id === count.id)).toBe(false);
  });
});

describe('stock transfers (IV-39..IV-45, RT-078..RT-080, SM-77)', () => {
  // Helper: insert a Transit storage_location for tests via db.owner (bypasses smartstore_app column grants).
  async function insertTransitLocation(organizationId: string, warehouseId: string): Promise<string> {
    const { rows } = await db.owner.query<{ id: string }>(
      `INSERT INTO storage_location (organization_id, warehouse_id, warehouse_kind, code, name, location_type, is_sellable)
       VALUES ($1, $2, 'StoreAttached', 'TRANSIT', 'Transit', 'Transit', false) RETURNING id`,
      [organizationId, warehouseId],
    );
    return rows[0]!.id;
  }

  // Helper: approve a transfer directly via db.owner to bypass the OpenDecision gate (OQ-039).
  async function approveDirectly(transferId: string, approverId: string): Promise<void> {
    await db.owner.query(
      `UPDATE stock_transfer SET status = 'Approved', approved_by = $2, status_changed_by = $2 WHERE id = $1`,
      [transferId, approverId],
    );
  }

  const xferMove = (as: Headers, subject: string, event: string) =>
    call('POST', '/transitions', as, { machine: 'StockTransfer', event, subject });

  it('IV-39: create a draft transfer; add and remove lines; validate transit location type', async () => {
    const s = await store();
    const creator = await s.staff(['Inventory.Transfer.Create']);
    const { warehouseId: wh2, defaultLocationId: toLoc } = await insertWarehouse(db.app, s.organizationId, s.storeId);
    const transitLoc = await insertTransitLocation(s.organizationId, s.warehouseId);

    // non-Transit location is refused
    const bad = await call('POST', `/stores/${s.storeId}/stock-transfers`, creator, {
      fromLocationId: s.location, toLocationId: toLoc, transitLocationId: s.location,
    });
    expect(bad.json().error.code).toBe('invalid_transit');

    const doc = (await call('POST', `/stores/${s.storeId}/stock-transfers`, creator, {
      fromLocationId: s.location, toLocationId: toLoc, transitLocationId: transitLoc, note: 'Test move',
    })).json();
    expect(doc).toMatchObject({ status: 'Draft', documentNumber: expect.any(Number), lines: [] });
    expect(doc.transitLocation).toBe('Transit');

    const withLine = (await call('POST', `/stores/${s.storeId}/stock-transfers/${doc.id}/lines`, creator,
      { variantId: s.variant, quantity: '3' })).json();
    expect(withLine.lines).toHaveLength(1);
    expect(withLine.lines[0]).toMatchObject({ quantity: '3.0000', receivedQuantity: '0.0000' });

    // duplicate variant is refused (unique constraint)
    const dup = await call('POST', `/stores/${s.storeId}/stock-transfers/${doc.id}/lines`, creator,
      { variantId: s.variant, quantity: '1' });
    expect(dup.statusCode).toBe(409);

    const removed = (await call('DELETE', `/stores/${s.storeId}/stock-transfers/${doc.id}/lines/${withLine.lines[0].id}`, creator)).json();
    expect(removed.lines).toHaveLength(0);

    // list
    const list = (await call('GET', `/stores/${s.storeId}/stock-transfers`, creator)).json();
    expect(list.items.some((i: { id: string }) => i.id === doc.id)).toBe(true);
    void wh2;
  });

  it('IV-43, SM-77a: submit → PendingApproval; cancel from Draft → Cancelled', async () => {
    const s = await store();
    const creator = await s.staff(['Inventory.Transfer.Create']);
    const { defaultLocationId: toLoc } = await insertWarehouse(db.app, s.organizationId, s.storeId);
    const transitLoc = await insertTransitLocation(s.organizationId, s.warehouseId);

    const doc = (await call('POST', `/stores/${s.storeId}/stock-transfers`, creator, {
      fromLocationId: s.location, toLocationId: toLoc, transitLocationId: transitLoc,
    })).json();
    await call('POST', `/stores/${s.storeId}/stock-transfers/${doc.id}/lines`, creator,
      { variantId: s.variant, quantity: '5' });

    expect((await xferMove(creator, doc.id, 'submit')).json().state).toBe('PendingApproval');

    // lines are locked in PendingApproval
    const late = await call('POST', `/stores/${s.storeId}/stock-transfers/${doc.id}/lines`, creator,
      { variantId: s.variant, quantity: '1' });
    expect(late.json().error.code).toBe('not_found'); // assertDraft fails → 404

    // approve is OpenDecision — refused with specific code
    const refused = (await xferMove(creator, doc.id, 'approve')).json();
    expect(refused.error.code).toBe('not_permitted');

    // cancel from Draft works
    const doc2 = (await call('POST', `/stores/${s.storeId}/stock-transfers`, creator, {
      fromLocationId: s.location, toLocationId: toLoc, transitLocationId: transitLoc,
    })).json();
    expect((await xferMove(creator, doc2.id, 'cancel')).json().state).toBe('Cancelled');
  });

  it('IV-39, IV-40, IV-41, RT-079: dispatch writes TRANSFER_OUT/IN; receive writes the return pair; balances settle', async () => {
    const s = await store();
    const dispatcher = await s.staff(['Inventory.Transfer.Create', 'Inventory.Transfer.Dispatch']);
    const receiver   = await s.staff(['Inventory.Transfer.Receive']);
    const { defaultLocationId: toLoc } = await insertWarehouse(db.app, s.organizationId, s.storeId);
    const transitLoc = await insertTransitLocation(s.organizationId, s.warehouseId);

    // Seed 10 units at the source location using the owner (IV-39 needs stock to dispatch)
    const adj = (await ok('POST', `/stores/${s.storeId}/adjustments`, s.owner, { reasonCodeId: s.reason })).id;
    await ok('POST', `/stores/${s.storeId}/adjustments/${adj}/lines`, s.owner, { variantId: s.variant, locationId: s.location, countedQuantity: '10' });
    await call('POST', '/transitions', s.owner, { machine: 'StockAdjustment', event: 'submit', subject: adj });
    await call('POST', '/transitions', s.owner, { machine: 'StockAdjustment', event: 'approve', subject: adj });
    await call('POST', '/transitions', s.owner, { machine: 'StockAdjustment', event: 'post', subject: adj });

    const doc = (await call('POST', `/stores/${s.storeId}/stock-transfers`, dispatcher, {
      fromLocationId: s.location, toLocationId: toLoc, transitLocationId: transitLoc,
    })).json();
    await call('POST', `/stores/${s.storeId}/stock-transfers/${doc.id}/lines`, dispatcher,
      { variantId: s.variant, quantity: '4' });
    await xferMove(dispatcher, doc.id, 'submit');
    const approverEmpId = await employeeWithAccess(db.app, s.organizationId, [], { assignedStore: s.storeId, accessStores: [s.storeId] });
    await approveDirectly(doc.id, approverEmpId);

    expect((await xferMove(dispatcher, doc.id, 'dispatch')).json().state).toBe('InTransit');

    // movements: TRANSFER_OUT from source + TRANSFER_IN to transit
    const { rows: afterDispatch } = await db.app.query(
      `SELECT storage_location_id, movement_type, direction, quantity::text
       FROM inventory_movement WHERE stock_transfer_id = $1 ORDER BY movement_type, direction`,
      [doc.id],
    );
    expect(afterDispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ movement_type: 'TRANSFER_OUT', direction: 'Out', storage_location_id: s.location, quantity: '4.0000' }),
      expect.objectContaining({ movement_type: 'TRANSFER_IN',  direction: 'In',  storage_location_id: transitLoc, quantity: '4.0000' }),
    ]));

    expect((await xferMove(receiver, doc.id, 'receive_all')).json().state).toBe('Received');

    // after receive: two more movements (TRANSFER_OUT from transit, TRANSFER_IN to dest)
    const { rows: afterReceive } = await db.app.query(
      `SELECT storage_location_id, movement_type, direction, quantity::text
       FROM inventory_movement WHERE stock_transfer_id = $1 ORDER BY movement_type, direction, storage_location_id`,
      [doc.id],
    );
    expect(afterReceive).toHaveLength(4);
    expect(afterReceive).toEqual(expect.arrayContaining([
      expect.objectContaining({ movement_type: 'TRANSFER_IN',  direction: 'In',  storage_location_id: toLoc,      quantity: '4.0000' }),
      expect.objectContaining({ movement_type: 'TRANSFER_OUT', direction: 'Out', storage_location_id: transitLoc, quantity: '4.0000' }),
    ]));

    // received_quantity is stamped on each line (IV-41)
    const detail = (await call('GET', `/stores/${s.storeId}/stock-transfers/${doc.id}`, dispatcher)).json();
    expect(detail.lines[0].receivedQuantity).toBe('4.0000');
  });

  it('RT-080: receive_all is refused when the receiver is the dispatcher', async () => {
    const s = await store();
    const both = await s.staff(['Inventory.Transfer.Create', 'Inventory.Transfer.Dispatch', 'Inventory.Transfer.Receive']);
    const { defaultLocationId: toLoc } = await insertWarehouse(db.app, s.organizationId, s.storeId);
    const transitLoc = await insertTransitLocation(s.organizationId, s.warehouseId);

    const doc = (await call('POST', `/stores/${s.storeId}/stock-transfers`, both, {
      fromLocationId: s.location, toLocationId: toLoc, transitLocationId: transitLoc,
    })).json();
    await call('POST', `/stores/${s.storeId}/stock-transfers/${doc.id}/lines`, both,
      { variantId: s.variant, quantity: '1' });
    await xferMove(both, doc.id, 'submit');
    const approverEmpId = await employeeWithAccess(db.app, s.organizationId, [], { assignedStore: s.storeId, accessStores: [s.storeId] });
    await approveDirectly(doc.id, approverEmpId);
    await xferMove(both, doc.id, 'dispatch');
    const refused = (await xferMove(both, doc.id, 'receive_all')).json();
    expect(refused.error.code).toBe('sep_of_duties');
  });

  it('IV-44, MS-04: a transfer is store-scoped; another store\'s employee cannot see or mutate it', async () => {
    const s  = await store();
    const s2 = await store();
    const c1 = await s.staff(['Inventory.Transfer.Create']);
    const c2 = await s2.staff(['Inventory.Transfer.Create']);
    const { defaultLocationId: toLoc } = await insertWarehouse(db.app, s.organizationId, s.storeId);
    const transitLoc = await insertTransitLocation(s.organizationId, s.warehouseId);

    const doc = (await call('POST', `/stores/${s.storeId}/stock-transfers`, c1, {
      fromLocationId: s.location, toLocationId: toLoc, transitLocationId: transitLoc,
    })).json();

    expect((await call('GET', `/stores/${s2.storeId}/stock-transfers/${doc.id}`, c2)).statusCode).toBe(404);
    expect((await call('POST', `/stores/${s2.storeId}/stock-transfers/${doc.id}/lines`, c2,
      { variantId: s.variant, quantity: '1' })).statusCode).toBe(404);
  });
});
