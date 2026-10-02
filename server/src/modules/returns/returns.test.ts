import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { onboard } from '../../onboarding.ts';
import { signedInAs, testApp } from '../../../test/app.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { employeeWithAccess, insertLocation, onboardingAnswers } from '../../../test/fixtures.ts';

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
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, as: Headers, payload?: object) =>
  app.inject({ method, url: `/api/v1${url}`, headers: as, ...(payload ? { payload } : {}) });

async function ok(method: 'POST' | 'PUT', url: string, as: Headers, payload: object): Promise<Json> {
  const response = await call(method, url, as, payload);
  expect(response.statusCode, `${method} ${url}: ${response.body}`).toBeLessThan(300);
  return response.json();
}

/**
 * A store that has sold something, built through the routes, in TEST-ONLY terms: an inclusive 10% tax, an active till, a
 * clerk at it who can sell, return and draft and pay refunds, a manager who approves, and a second location of each
 * kind a return can be sent to.
 */
async function returnsShop() {
  const o = await onboard(db.app, onboardingAnswers());
  const owner = signedInAs(o.ownerEmployeeId, o.organizationId);
  const unit = (await ok('POST', '/units', owner, { code: 'EA', name: 'Each', quantityKind: 'Countable', scale: 0 })).id as string;
  const tax = (await ok('POST', '/tax-categories', owner, { code: 'STD', name: 'TEST-ONLY standard' })).id as string;
  await ok('POST', `/tax-categories/${tax}/rates`, owner, { jurisdiction: 'TEST-ONLY', ratePercent: '10' });
  const category = (await ok('POST', '/categories', owner, { name: 'Groceries', parentId: null, sortOrder: 1 })).id as string;
  const item = async (name: string, amount: number, barcode: { value: string; kind: string }) => {
    const product = (await ok('POST', '/products', owner, { categoryId: category, name })).id as string;
    await ok('POST', `/products/${product}/variants`, owner, { baseUnitId: unit, taxCategoryId: tax, price: { amount }, barcodes: [barcode] });
    await ok('POST', '/transitions', owner, { machine: 'Product', event: 'activate', subject: product });
  };
  await item('Oat milk', 1_250, { value: '012345678905', kind: 'UPC_A' });
  await item('Bread', 500, { value: '4006381333931', kind: 'EAN13' });
  const cash = (await ok('POST', '/payment-methods', owner, { code: 'CASH', name: 'Cash', methodType: 'Cash' })).id as string;
  await ok('PUT', `/stores/${o.storeId}/payment-methods/${cash}`, owner, { enabled: true });
  const till = (await ok('POST', `/stores/${o.storeId}/terminals`, owner, { code: 'T1', label: 'Till 1' })).id as string;
  await ok('POST', '/transitions', owner, { machine: 'Device', event: 'activate', subject: till });
  const staff = (keys: string[], at?: string) =>
    employeeWithAccess(db.app, o.organizationId, keys, { assignedStore: o.storeId, accessStores: [o.storeId] }).then((id) => signedInAs(id, o.organizationId, at));
  const clerk = await staff(['Sale.Create', 'Sale.View', 'Shift.Open', 'Return.Create', 'Sale.Refund', 'Refund.Pay'], till);
  const manager = await staff(['Return.Approve', 'Sale.Refund.Large.Approve', 'Return.Create', 'Sale.Refund']);
  const manager2 = await staff(['Return.Approve', 'Sale.Refund.Large.Approve']);
  const reason = (await ok('POST', '/reason-codes', owner, { code: 'WHY', name: 'Because' })).id as string;

  const where = await db.app.query<{ warehouse_id: string; id: string }>(
    `SELECT l.id, l.warehouse_id FROM storage_location l JOIN warehouse w ON w.id = l.warehouse_id WHERE w.store_id = $1 AND l.is_sellable`,
    [o.storeId],
  );
  const sellable = where.rows[0]!.id;
  const quarantine = await insertLocation(db.app, o.organizationId, where.rows[0]!.warehouse_id, 'StoreAttached', 'Quarantine', false);

  await ok('POST', `/stores/${o.storeId}/shift`, clerk, { openingFloat: 10_000 });
  const quote = async (code: string) => (await call('GET', `/stores/${o.storeId}/scan/${code}`, clerk)).json().quote as string;
  const sale = (await ok('POST', `/stores/${o.storeId}/sales`, clerk, {
    clientOperationId: randomUUID(),
    lines: [
      { quote: await quote('012345678905'), quantity: 2 },
      { quote: await quote('4006381333931'), quantity: 1 },
    ],
    cash: { tendered: 5_000 },
  })) as Json;
  const milk = sale.lines.find((l: Json) => l.description === 'Oat milk') as Json;
  const bread = sale.lines.find((l: Json) => l.description === 'Bread') as Json;
  const store = `/stores/${o.storeId}`;
  const go = (as: Headers, machine: string, event: string, subject: string, extra: object = {}) =>
    call('POST', '/transitions', as, { machine, event, subject, ...extra });
  return { ...o, owner, clerk, manager, manager2, reason, sellable, quarantine, sale, milk, bread, store, go, till };
}
type ReturnsShop = Awaited<ReturnType<typeof returnsShop>>;

const open = (s: ReturnsShop, as: Headers = s.clerk, saleId = s.sale.saleId as string, operation = randomUUID()) =>
  call('POST', `${s.store}/returns`, as, { clientOperationId: operation, saleId });
const addLine = (s: ReturnsShop, id: string, line: Json, as: Headers = s.clerk) =>
  call('POST', `${s.store}/returns/${id}/lines`, as, {
    clientOperationId: randomUUID(),
    disposition: 'Sellable',
    locationId: s.sellable,
    ...line,
  });
const onHand = async (variantId: string, location: string): Promise<string> =>
  (await db.app.query<{ n: string }>(`SELECT coalesce(sum(delta), 0)::text AS n FROM inventory_movement WHERE variant_id = $1 AND storage_location_id = $2`, [variantId, location])).rows[0]!.n;
const saleNow = async (s: ReturnsShop): Promise<Json> => (await call('GET', `${s.store}/sales/${s.sale.saleId}`, s.clerk)).json();

describe('returns: goods back against a sale (RR-01, RR-08, RR-13, RR-14, RR-17)', () => {
  it('RR-14, RR-15, RR-17, SP-66, SM-38: a return is opened, filled, and posted; stock comes back and the sold line counts it; a repeat opens nothing', async () => {
    const s = await returnsShop();
    const operation = randomUUID();
    const first = await open(s, s.clerk, s.sale.saleId, operation);
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ documentNumber: 1, status: 'Draft', saleId: s.sale.saleId, lines: [] });
    const again = await open(s, s.clerk, s.sale.saleId, operation);
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(first.json().id);

    const id = first.json().id as string;
    const withLine = await addLine(s, id, { saleLineId: s.milk.saleLineId, quantity: '1' });
    expect(withLine.statusCode, withLine.body).toBe(201);
    expect(withLine.json().lines).toMatchObject([{ saleLineId: s.milk.saleLineId, quantity: '1.0000', disposition: 'Sellable', locationId: s.sellable }]);
    const variant = withLine.json().lines[0].variantId as string;
    // Nothing but the sale has moved before posting (BI-27): the two sold, none back.
    expect(await onHand(variant, s.sellable)).toBe('-2.0000');

    const posted = await s.go(s.clerk, 'CustomerReturn', 'post', id);
    expect(posted.json(), posted.body).toMatchObject({ state: 'Posted', changed: true });
    // The sale sold two of the milk and nothing stocked it, so the sold line gave the stock -2 and the return brought 1 back.
    const moves = await db.app.query(
      `SELECT movement_type, direction, quantity::text AS quantity, disposition FROM inventory_movement WHERE customer_return_id = $1`,
      [id],
    );
    expect(moves.rows).toEqual([{ movement_type: 'SALE_RETURN', direction: 'In', quantity: '1.0000', disposition: 'Sellable' }]);
    const now = await saleNow(s);
    expect(now.status).toBe('PartiallyReturned');
    expect(now.lines.find((l: Json) => l.saleLineId === s.milk.saleLineId).returnedQuantity).toBe('1.0000');
    expect(await onHand(variant, s.sellable)).toBe((-2 + 1).toFixed(4));

    // A posted return is never un-posted and its lines are fixed (SM-38, SS018).
    expect((await s.go(s.clerk, 'CustomerReturn', 'cancel', id, { reasonCodeId: s.reason })).statusCode).toBe(409);
    expect((await addLine(s, id, { saleLineId: s.milk.saleLineId, quantity: '1' })).json().error.code).toBe('SS018');

    // The rest comes back in a second return, and the sale moves on to Returned through the contracted edges.
    const second = (await open(s)).json().id as string;
    await addLine(s, second, { saleLineId: s.milk.saleLineId, quantity: '1' });
    await addLine(s, second, { saleLineId: s.bread.saleLineId, quantity: '1' });
    expect((await s.go(s.clerk, 'CustomerReturn', 'post', second)).json().state).toBe('Posted');
    expect((await saleNow(s)).status).toBe('Returned');
    const drift = await db.app.query('SELECT count(*)::int AS n FROM sale_counter_drift()');
    expect(drift.rows[0].n).toBe(0);
  });

  it('RR-14, RT-148: more than is still returnable is refused naming what is left, as it is built and at posting', async () => {
    const s = await returnsShop();
    const id = (await open(s)).json().id as string;
    const over = await addLine(s, id, { saleLineId: s.milk.saleLineId, quantity: '3' });
    expect(over.statusCode).toBe(409);
    expect(over.json().error).toMatchObject({ code: 'SS046', remaining: '2.0000' });
    // Two drafts that each fit cannot both post: the atomic bound is the posting.
    const a = (await open(s)).json().id as string;
    const b = (await open(s)).json().id as string;
    await addLine(s, a, { saleLineId: s.milk.saleLineId, quantity: '2' });
    await addLine(s, b, { saleLineId: s.milk.saleLineId, quantity: '2' });
    expect((await s.go(s.clerk, 'CustomerReturn', 'post', a)).statusCode).toBe(200);
    const second = await s.go(s.clerk, 'CustomerReturn', 'post', b);
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toMatchObject({ code: 'SS046', remaining: '0.0000' });
  });

  it('RR-17, RR-18, RR-19, BE-36: a disposition is required, and each one goes only to its own kind of location', async () => {
    const s = await returnsShop();
    const id = (await open(s)).json().id as string;
    const none = await call('POST', `${s.store}/returns/${id}/lines`, s.clerk, {
      clientOperationId: randomUUID(), saleLineId: s.milk.saleLineId, quantity: '1', locationId: s.sellable,
    });
    expect(none.statusCode, 'no default disposition').toBe(400);
    const wrong = await addLine(s, id, { saleLineId: s.milk.saleLineId, quantity: '1', disposition: 'Damaged' });
    expect(wrong.json().error.code, 'damaged goods to a sellable location').toBe('SS047');
    const quarantined = await addLine(s, id, { saleLineId: s.milk.saleLineId, quantity: '1', disposition: 'Quarantine', locationId: s.quarantine });
    expect(quarantined.statusCode, quarantined.body).toBe(201);
    expect((await s.go(s.clerk, 'CustomerReturn', 'post', id)).statusCode).toBe(200);
    const moved = await db.app.query(`SELECT disposition, storage_location_id FROM inventory_movement WHERE customer_return_id = $1`, [id]);
    expect(moved.rows).toEqual([{ disposition: 'Quarantine', storage_location_id: s.quarantine }]);

    // MS-16: goods come back to a location of this store, and no other.
    const elsewhere = await onboard(db.app, onboardingAnswers());
    const theirs = (await db.app.query<{ id: string }>(
      `SELECT l.id FROM storage_location l JOIN warehouse w ON w.id = l.warehouse_id WHERE w.store_id = $1`,
      [elsewhere.storeId],
    )).rows[0]!.id;
    const other = (await open(s)).json().id as string;
    expect((await addLine(s, other, { saleLineId: s.milk.saleLineId, quantity: '1', locationId: theirs })).json().error.code).toBe('invalid_location');
  });

  it('RR-08, RR-13, BI-16, MS-04: a return is of one sale of this store, and a line is of that sale', async () => {
    const s = await returnsShop();
    const elsewhere = await returnsShop();
    expect((await open(s, s.clerk, elsewhere.sale.saleId)).statusCode, "another store's sale").toBe(404);
    expect((await open(s, s.clerk, randomUUID())).statusCode, 'no such sale').toBe(404);
    const id = (await open(s)).json().id as string;
    const foreign = await addLine(s, id, { saleLineId: elsewhere.milk.saleLineId, quantity: '1' });
    expect(foreign.statusCode, 'a line of another sale').toBe(404);
    // Another store's return does not exist to this caller.
    const theirs = (await open(elsewhere, elsewhere.clerk)).json().id as string;
    expect((await addLine(s, theirs, { saleLineId: s.milk.saleLineId, quantity: '1' })).statusCode).toBe(404);
    expect((await s.go(s.clerk, 'CustomerReturn', 'post', theirs)).statusCode).toBe(404);
    expect((await addLine(s, theirs, { saleLineId: elsewhere.milk.saleLineId, quantity: '1' })).statusCode, "another store's return and its own line").toBe(404);
  });

  it('RR-16, SM-04: a repeated line is not added twice, and a draft line can be removed', async () => {
    const s = await returnsShop();
    const id = (await open(s)).json().id as string;
    const operation = randomUUID();
    const body = { clientOperationId: operation, saleLineId: s.bread.saleLineId, quantity: '1', disposition: 'Sellable', locationId: s.sellable };
    expect((await call('POST', `${s.store}/returns/${id}/lines`, s.clerk, body)).statusCode).toBe(201);
    const repeat = await call('POST', `${s.store}/returns/${id}/lines`, s.clerk, body);
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json().lines).toHaveLength(1);
    const lineId = repeat.json().lines[0].id as string;
    const removed = await call('DELETE', `${s.store}/returns/${id}/lines/${lineId}`, s.clerk);
    expect(removed.json().lines).toHaveLength(0);
    expect((await call('DELETE', `${s.store}/returns/${id}/lines/${lineId}`, s.clerk)).statusCode).toBe(404);
    // A line of another return cannot be removed through this one.
    const other = (await open(s)).json().id as string;
    const kept = (await addLine(s, other, { saleLineId: s.bread.saleLineId, quantity: '1' })).json().lines[0].id as string;
    expect((await call('DELETE', `${s.store}/returns/${id}/lines/${kept}`, s.clerk)).statusCode).toBe(404);
  });

  it('SM-42, BI-40, D-16: a draft is cancelled only with a live reason, by Return.Create, and moves nothing; an empty return cannot post', async () => {
    const s = await returnsShop();
    const id = (await open(s)).json().id as string;
    const empty = await s.go(s.clerk, 'CustomerReturn', 'post', id);
    expect(empty.statusCode).toBe(409);
    expect(empty.json().error.code).toBe('empty_return');
    await addLine(s, id, { saleLineId: s.bread.saleLineId, quantity: '1' });
    const noReason = await s.go(s.clerk, 'CustomerReturn', 'cancel', id);
    expect(noReason.json().error.code).toBe('SS055');
    const cancelled = await s.go(s.clerk, 'CustomerReturn', 'cancel', id, { reasonCodeId: s.reason });
    expect(cancelled.json().state).toBe('Cancelled');
    const row = await db.app.query(`SELECT cancel_reason_code_id FROM customer_return WHERE id = $1`, [id]);
    expect(row.rows[0].cancel_reason_code_id).toBe(s.reason);
    const moved = await db.app.query(`SELECT count(*)::int AS n FROM inventory_movement WHERE customer_return_id = $1`, [id]);
    expect(moved.rows[0].n).toBe(0);
    const audited = await db.app.query(`SELECT event_type FROM audit_event WHERE entity_id = $1 ORDER BY seq`, [id]);
    expect(audited.rows.map((r: Json) => r.event_type)).toContain('Return.StateChange');
  });

  it('AC-01, D-16: every step is a permission the gate checks, and no other key stands in for it', async () => {
    const s = await returnsShop();
    const bystander = signedInAs(
      await employeeWithAccess(db.app, s.organizationId, ['Sale.View', 'Return.Approve', 'Sale.Refund', 'Refund.Pay'], { assignedStore: s.storeId, accessStores: [s.storeId] }),
      s.organizationId,
    );
    const denied = await open(s, bystander);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('forbidden');
    const id = (await open(s)).json().id as string;
    await addLine(s, id, { saleLineId: s.bread.saleLineId, quantity: '1' });
    expect((await addLine(s, id, { saleLineId: s.bread.saleLineId, quantity: '1' }, bystander)).statusCode).toBe(403);
    expect((await s.go(bystander, 'CustomerReturn', 'post', id)).statusCode, 'posting is Return.Create').toBe(403);
    expect((await s.go(bystander, 'CustomerReturn', 'cancel', id, { reasonCodeId: s.reason })).statusCode).toBe(403);
    expect((await call('POST', `${s.store}/returns/${id}/late-approval`, s.clerk, { reasonCodeId: s.reason })).statusCode, 'approving is Return.Approve').toBe(403);
    expect((await call('POST', `${s.store}/returns`, {}, { clientOperationId: randomUUID(), saleId: s.sale.saleId })).statusCode).toBe(401);
  });
});

describe('the return window (RR-10, RR-11, AP-08)', () => {
  const age = (s: ReturnsShop, days: number) =>
    db.owner.query('UPDATE sale SET business_date = business_date - $2::integer WHERE id = $1', [s.sale.saleId, days]);

  it('RR-10, RR-11, RT-150: past the window a return posts only with a late approval by Return.Approve, who is neither its opener nor its poster', async () => {
    const s = await returnsShop();
    await age(s, 40);
    const id = (await open(s)).json().id as string;
    await addLine(s, id, { saleLineId: s.bread.saleLineId, quantity: '1' });
    const closed = await s.go(s.clerk, 'CustomerReturn', 'post', id);
    expect(closed.statusCode).toBe(409);
    expect(closed.json().error.code).toBe('SS048');
    expect(closed.json().error.windowClosedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const late = `${s.store}/returns/${id}/late-approval`;
    expect((await call('POST', late, s.clerk, { reasonCodeId: s.reason })).statusCode, 'the opener holds no Return.Approve').toBe(403);
    const opener = signedInAs(
      await employeeWithAccess(db.app, s.organizationId, ['Return.Create', 'Return.Approve'], { assignedStore: s.storeId, accessStores: [s.storeId] }),
      s.organizationId,
    );
    const mine = (await open(s, opener)).json().id as string;
    await addLine(s, mine, { saleLineId: s.bread.saleLineId, quantity: '1' }, opener);
    const self = await call('POST', `${s.store}/returns/${mine}/late-approval`, opener, { reasonCodeId: s.reason });
    expect(self.statusCode, 'approving your own return').toBe(422);

    const approved = await call('POST', late, s.manager, { reasonCodeId: s.reason });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json().lateReasonCodeId).toBe(s.reason);
    expect((await s.go(s.clerk, 'CustomerReturn', 'post', id)).json().state).toBe('Posted');
    // Once posted, who approved and why is fixed (SS001), and approval is for a draft only.
    expect((await call('POST', late, s.manager2, { reasonCodeId: s.reason })).json().error.code).toBe('not_a_draft');
  });

  it('RR-10, OQ-023: a return inside the window needs no approval', async () => {
    const s = await returnsShop();
    await age(s, 30);
    const id = (await open(s)).json().id as string;
    await addLine(s, id, { saleLineId: s.bread.saleLineId, quantity: '1' });
    expect((await s.go(s.clerk, 'CustomerReturn', 'post', id)).statusCode).toBe(200);
  });
});

const draft = (s: ReturnsShop, body: Json, as: Headers = s.clerk) =>
  call('POST', `${s.store}/refunds`, as, { clientOperationId: randomUUID(), method: 'OriginalTender', paymentId: s.sale.payments[0].paymentId, saleId: s.sale.saleId, ...body });
const stateOf = async (id: string): Promise<string> => (await db.app.query<{ status: string }>('SELECT status FROM refund WHERE id = $1', [id])).rows[0]!.status;
const refundedOf = async (lineId: string): Promise<number> =>
  Number((await db.app.query<{ n: string }>('SELECT refunded_amount AS n FROM sale_line WHERE id = $1', [lineId])).rows[0]!.n);

/** Drafts, submits and approves a refund, leaving it `Approved` and ready to pay. */
async function approved(s: ReturnsShop, body: Json): Promise<string> {
  const made = await draft(s, body);
  expect(made.statusCode, made.body).toBe(201);
  const id = made.json().id as string;
  expect((await s.go(s.clerk, 'Refund', 'submit', id)).json().state).toBe('PendingApproval');
  expect((await s.go(s.manager, 'Refund', 'approve', id)).json().state).toBe('Approved');
  return id;
}

describe('refunds: money back for a sale (RR-01, RR-03, RR-22, RR-24, PY-25, PY-27)', () => {
  it('RR-22, RR-24, PY-27, RT-156, RR-06: a cash refund is drafted, submitted, approved by someone else and paid from the drawer in one step; the line holds it and the tax is in proportion', async () => {
    const s = await returnsShop();
    const made = await draft(s, { lines: [{ saleLineId: s.milk.saleLineId, amount: 1_250 }], reasonCodeId: s.reason });
    expect(made.statusCode, made.body).toBe(201);
    // Half of a 2,500 line that carried 227 tax: 113.5 rounds half away from zero to 114 (RR-06, overview s3.1).
    expect(made.json()).toMatchObject({ documentNumber: 1, status: 'Draft', method: 'OriginalTender', disbursement: 'Drawer', amount: 1_250, taxAmount: 114, currencyCode: 'XTS' });
    const id = made.json().id as string;

    expect((await s.go(s.clerk, 'Refund', 'approve', id)).statusCode, 'no skipping the submit').toBe(409);
    expect((await s.go(s.clerk, 'Refund', 'submit', id)).json().state).toBe('PendingApproval');
    expect((await s.go(s.clerk, 'Refund', 'approve', id)).statusCode, 'the clerk holds no approval key').toBe(403);
    expect((await s.go(s.manager, 'Refund', 'approve', id)).json().state).toBe('Approved');
    // Nothing is held, and no money has moved, until it is paid (BI-27).
    expect(await refundedOf(s.milk.saleLineId)).toBe(0);

    const paid = await s.go(s.clerk, 'Refund', 'submit to provider', id);
    expect(paid.statusCode, paid.body).toBe(200);
    expect(paid.json().state, 'paid and completed as one event').toBe('Completed');
    const out = await db.app.query(`SELECT type, direction, amount FROM cash_transaction WHERE refund_id = $1`, [id]);
    expect(out.rows).toEqual([{ type: 'RefundFromDrawer', direction: 'Out', amount: '1250' }]);
    expect((await saleNow(s)).lines.find((l: Json) => l.saleLineId === s.milk.saleLineId).refundedAmount).toBe(1_250);
    expect(Number((await db.app.query('SELECT refunded_tax_amount AS n FROM sale_line WHERE id = $1', [s.milk.saleLineId])).rows[0].n)).toBe(114);
    // The rest of the line carries the tax that completes the proportion: 227 in all, never more (RR-06).
    const rest = await approved(s, { lines: [{ saleLineId: s.milk.saleLineId, amount: 1_250 }], reasonCodeId: s.reason });
    expect(Number((await db.app.query('SELECT tax_amount AS n FROM refund WHERE id = $1', [rest])).rows[0].n)).toBe(113);
    expect((await s.go(s.clerk, 'Refund', 'submit to provider', rest)).json().state).toBe('Completed');

    const events = await db.app.query(`SELECT event_type FROM audit_event WHERE entity_id = $1 ORDER BY seq`, [id]);
    expect(events.rows.map((r: Json) => r.event_type)).toEqual(expect.arrayContaining(['Approval.Decided', 'Payment.Refund']));
    const drift = await db.app.query('SELECT count(*)::int AS n FROM sale_counter_drift()');
    expect(drift.rows[0].n).toBe(0);
    // A completed refund is frozen (BI-09, SS035).
    expect((await s.go(s.clerk, 'Refund', 'cancel', id, { reasonCodeId: s.reason })).statusCode).toBe(409);
  });

  it('RR-03, RR-24, PY-22, EC-02, RT-145: more than is left of a line is refused naming it, as drafted and at the hold, and a second draft of the same money cannot also be paid', async () => {
    const s = await returnsShop();
    const over = await draft(s, { lines: [{ saleLineId: s.milk.saleLineId, amount: 2_501 }], reasonCodeId: s.reason });
    expect(over.statusCode).toBe(409);
    expect(over.json().error).toMatchObject({ code: 'SS049', remaining: '2500' });

    // Two drafts that each fit: only one can take the hold.
    const first = await approved(s, { lines: [{ saleLineId: s.milk.saleLineId, amount: 2_000 }], reasonCodeId: s.reason });
    const second = await approved(s, { lines: [{ saleLineId: s.milk.saleLineId, amount: 2_000 }], reasonCodeId: s.reason });
    expect((await s.go(s.clerk, 'Refund', 'submit to provider', first)).json().state).toBe('Completed');
    const blocked = await s.go(s.clerk, 'Refund', 'submit to provider', second);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toMatchObject({ code: 'SS049', remaining: '500' });
    expect(await stateOf(second), 'refused whole, still approved').toBe('Approved');
    // Cancelling needs a reason; a cancelled refund cannot be paid.
    expect((await s.go(s.clerk, 'Refund', 'cancel', second)).json().error.code).toBe('SS055');
    expect((await s.go(s.clerk, 'Refund', 'cancel', second, { reasonCodeId: s.reason })).json().state).toBe('Cancelled');
    expect((await s.go(s.clerk, 'Refund', 'submit to provider', second)).json().error.code).toBe('illegal_transition');
  });

  it('RR-22, PY-25, PY-27, BI-09: a cash refund names no tender; an original-tender refund names a captured payment of this sale; a drawer refund is drafted at a till', async () => {
    const s = await returnsShop();
    const cash = await draft(s, { method: 'Cash', paymentId: undefined, lines: [{ saleLineId: s.bread.saleLineId, amount: 500 }], reasonCodeId: s.reason });
    expect(cash.statusCode, cash.body).toBe(201);
    expect(cash.json()).toMatchObject({ method: 'Cash', paymentId: null, disbursement: 'Drawer' });
    expect((await draft(s, { method: 'Cash', lines: [{ saleLineId: s.bread.saleLineId, amount: 500 }], reasonCodeId: s.reason })).statusCode, 'cash with a tender').toBe(400);
    expect((await draft(s, { paymentId: undefined, lines: [{ saleLineId: s.bread.saleLineId, amount: 500 }], reasonCodeId: s.reason })).statusCode, 'a tender with none named').toBe(400);
    const stranger = await draft(s, { paymentId: randomUUID(), lines: [{ saleLineId: s.bread.saleLineId, amount: 500 }], reasonCodeId: s.reason });
    expect(stranger.json().error.code, 'not a payment of this sale').toBe('SS050');
    const back = await draft(s, { lines: [{ saleLineId: s.bread.saleLineId, amount: 500 }], reasonCodeId: s.reason }, s.manager);
    expect(back.statusCode).toBe(409);
    expect(back.json().error.code).toBe('not_at_a_till');
  });

  it("MS-04: another store's sale does not exist to the caller", async () => {
    const s = await returnsShop();
    const elsewhere = await returnsShop();
    const foreign = await draft(s, { saleId: elsewhere.sale.saleId, paymentId: elsewhere.sale.payments[0].paymentId, lines: [{ saleLineId: elsewhere.bread.saleLineId, amount: 500 }], reasonCodeId: s.reason });
    expect(foreign.statusCode).toBe(404);
  });

  it('BI-39, PY-27: a drawer refund is drafted only while the till has an open shift', async () => {
    const s = await returnsShop();
    await db.owner.query(`UPDATE cash_shift SET status = 'Reconciling', status_changed_by = opened_by WHERE cash_drawer_id IN (SELECT id FROM cash_drawer WHERE pos_terminal_id = $1)`, [s.till]);
    const refused = await draft(s, { lines: [{ saleLineId: s.bread.saleLineId, amount: 500 }], reasonCodeId: s.reason });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('no_open_shift');
  });

  it('RR-35, PY-26, RT-157: a refund with no return needs a reason; a repeat of the operation id drafts nothing new; a line is of the sale and appears once', async () => {
    const s = await returnsShop();
    const lines = [{ saleLineId: s.bread.saleLineId, amount: 500 }];
    const noReason = await draft(s, { lines });
    expect(noReason.statusCode).toBe(422);
    expect(noReason.json().error.message).toMatch(/needs a reason/);
    const operation = randomUUID();
    const first = await draft(s, { lines, reasonCodeId: s.reason, clientOperationId: operation });
    const again = await draft(s, { lines, reasonCodeId: s.reason, clientOperationId: operation });
    expect([first.statusCode, again.statusCode]).toEqual([201, 200]);
    expect(again.json().id).toBe(first.json().id);
    expect((await draft(s, { lines: [{ saleLineId: randomUUID(), amount: 5 }], reasonCodeId: s.reason })).statusCode).toBe(404);
    expect((await draft(s, { lines: [...lines, ...lines], reasonCodeId: s.reason })).statusCode).toBe(400);
    expect((await draft(s, { lines: [], reasonCodeId: s.reason })).statusCode).toBe(400);
    expect((await draft(s, { lines: [{ saleLineId: s.bread.saleLineId, amount: 0 }], reasonCodeId: s.reason })).statusCode).toBe(400);
  });

  it('RR-01, SS051: a refund for a return pays only the lines the posted return took back', async () => {
    const s = await returnsShop();
    const ret = (await open(s)).json().id as string;
    await addLine(s, ret, { saleLineId: s.milk.saleLineId, quantity: '1' });
    // Drafted against a return that is not posted, the refund cannot be paid.
    const early = await approved(s, { lines: [{ saleLineId: s.milk.saleLineId, amount: 1_250 }], returnId: ret });
    expect((await s.go(s.clerk, 'Refund', 'submit to provider', early)).json().error.code).toBe('SS051');
    expect((await s.go(s.clerk, 'CustomerReturn', 'post', ret)).statusCode).toBe(200);
    expect((await s.go(s.clerk, 'Refund', 'submit to provider', early)).json().state, 'the posted return took the milk back').toBe('Completed');
    // A line the return did not take back cannot ride on it as if it were not goodwill.
    const lines = [{ saleLineId: s.bread.saleLineId, amount: 500 }];
    const bread = await approved(s, { lines, returnId: ret });
    expect((await s.go(s.clerk, 'Refund', 'submit to provider', bread)).json().error.code).toBe('SS051');
    // A return of another sale cannot be linked.
    const elsewhere = await returnsShop();
    const theirs = (await open(elsewhere, elsewhere.clerk)).json().id as string;
    expect((await draft(s, { lines, returnId: theirs })).json().error.code).toBe('invalid_reference');
  });

  it('BI-26, AP-08, AP-03, D-16: the approver is not the submitter; paying is Refund.Pay and nothing else; creating and cancelling are Sale.Refund; the lines are fixed after submission', async () => {
    const s = await returnsShop();
    const id = (await draft(s, { lines: [{ saleLineId: s.bread.saleLineId, amount: 500 }], reasonCodeId: s.reason })).json().id as string;
    const issuer = signedInAs(
      await employeeWithAccess(db.app, s.organizationId, ['Sale.Refund', 'Sale.Refund.Large.Approve'], { assignedStore: s.storeId, accessStores: [s.storeId] }),
      s.organizationId,
    );
    expect((await s.go(issuer, 'Refund', 'submit', id)).json().state).toBe('PendingApproval');
    const self = await s.go(issuer, 'Refund', 'approve', id);
    expect(self.statusCode, 'the submitter approving their own').toBe(422);
    expect(self.json().error.message).toMatch(/someone other/);
    expect((await s.go(s.manager2, 'Refund', 'approve', id)).json().state).toBe('Approved');

    const payer = await s.go(issuer, 'Refund', 'submit to provider', id);
    expect(payer.statusCode, 'Sale.Refund is not Refund.Pay (D-16)').toBe(403);
    expect(payer.json().error.message).toMatch(/Refund\.Pay/);
    // Lines are fixed once submitted (AP-03).
    const lineId = (await db.app.query('SELECT id FROM refund_line WHERE refund_id = $1', [id])).rows[0].id as string;
    expect(await db.app.query('DELETE FROM refund_line WHERE id = $1', [lineId]).catch((e: { code: string }) => e.code)).toBe('SS018');
    // A key that only pays cannot draft or cancel.
    const payOnly = signedInAs(
      await employeeWithAccess(db.app, s.organizationId, ['Refund.Pay'], { assignedStore: s.storeId, accessStores: [s.storeId] }),
      s.organizationId,
    );
    expect((await draft(s, { lines: [{ saleLineId: s.bread.saleLineId, amount: 500 }], reasonCodeId: s.reason }, payOnly)).statusCode).toBe(403);
    expect((await s.go(payOnly, 'Refund', 'cancel', id, { reasonCodeId: s.reason })).statusCode).toBe(403);
    expect((await s.go(issuer, 'Refund', 'cancel', id, { reasonCodeId: s.reason })).json().state).toBe('Cancelled');
  });

  it('PY-27, PT-03, SS025: a drawer refund is paid at a till in service, and refuses whole otherwise', async () => {
    const s = await returnsShop();
    const id = await approved(s, { lines: [{ saleLineId: s.bread.saleLineId, amount: 500 }], reasonCodeId: s.reason });
    expect((await s.go(s.owner, 'Device', 'disable', s.till, { reasonCodeId: s.reason })).json().state).toBe('Disabled');
    expect((await s.go(s.clerk, 'Refund', 'submit to provider', id)).json().error.code).toBe('SS025');
    expect(await stateOf(id), 'refused whole: not held, not paid').toBe('Approved');
    expect(await refundedOf(s.bread.saleLineId)).toBe(0);
    expect((await s.go(s.owner, 'Device', 'activate', s.till, { reasonCodeId: s.reason })).json().state).toBe('Active');
    expect((await s.go(s.clerk, 'Refund', 'submit to provider', id)).json().state).toBe('Completed');
  });

  it('RR-23, PY-25: a refund to a card goes to the provider, which is not available yet, so it is refused whole and nothing is held', async () => {
    const s = await returnsShop();
    const id = await approved(s, { lines: [{ saleLineId: s.bread.saleLineId, amount: 500 }], reasonCodeId: s.reason });
    // There is no card payment in the slice, so the refund is re-routed as one to a card tender would be.
    await db.owner.query(
      `UPDATE refund SET disbursement = 'Provider', pos_terminal_id = NULL, cash_drawer_id = NULL, cash_shift_id = NULL WHERE id = $1`,
      [id],
    );
    const refused = await s.go(s.clerk, 'Refund', 'submit to provider', id);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('provider_not_available');
    expect(await stateOf(id)).toBe('Approved');
    expect(await refundedOf(s.bread.saleLineId)).toBe(0);
  });
});
