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

/** Someone holding every key of this feature but one: proves the route asks for that one, and no other. */
const KEYS = ['Sale.Create', 'Shift.Open', 'Shift.Close', 'Cash.Variance.Acknowledge', 'Cash.Count.View'];
const allBut = (t: Trading, key: string) => t.staff(KEYS.filter((k) => k !== key));

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

  it("UX-35, UX-33, CD-01: the till's own shift read still finds its shift while the drawer is counted, and none once it is closed", async () => {
    const t = await trading();
    const tillShift = async () => (await call('GET', `/stores/${t.storeId}/shift`, t.cashier.as)).json().shift;
    await shiftMove(t.cashier.as, t.shift, 'begin count');
    expect(await tillShift(), 'counting, not "no shift": opening another would be refused').toMatchObject({ id: t.shift, status: 'Reconciling' });
    await count(t, 2_250);
    await shiftMove(t.cashier.as, t.shift, 'close', { closingFloat: 1_000 });
    expect(await tillShift()).toBeNull();
  });

  it("MS-04: another organization's shift is not found", async () => {
    const t = await trading();
    const other = await trading();
    const response = await shiftMove(other.cashier.as, t.shift, 'begin count');
    expect(response.statusCode).toBe(404);
    expect(await shiftStatus(t.shift)).toBe('Open');
  });
});

const count = (t: Trading, countedAmount: number, as: Headers = t.cashier.as, shift = t.shift, store = t.storeId) =>
  call('POST', `/stores/${store}/shifts/${shift}/counts`, as, { countedAmount });

describe('the count (CD-20, CD-21, CD-22, CD-31, SM-57; RT-243, RT-244, RT-526)', () => {
  it('CD-20, SS042: the drawer is counted only while the shift is being counted', async () => {
    const t = await trading();
    const early = await count(t, 2_250);
    expect(early.statusCode).toBe(409);
    expect(early.json().error).toEqual({
      code: 'not_counting',
      message: 'This shift is Open. Begin the count before counting the drawer.',
    });
    const rows = await db.app.query('SELECT 1 FROM shift_count WHERE cash_shift_id = $1', [t.shift]);
    expect(rows.rows).toHaveLength(0);
  });

  it('CD-21, CD-22, CD-31, RT-243, RT-244: a submitted count reveals the expected amount and the variance, counted minus expected, both from the server', async () => {
    const t = await trading();
    await shiftMove(t.cashier.as, t.shift, 'begin count');
    const short = await count(t, 2_200);
    expect(short.statusCode).toBe(201);
    // Expected = the float 1000 + the 1250 of cash applied to the sale (CD-06); nothing the client sent.
    expect(short.json()).toMatchObject({ passNumber: 1, countedAmount: 2_200, expectedAmount: 2_250, variance: -50, countedBy: t.cashier.id, acknowledgedBy: null });
    const over = await count(t, 2_300);
    expect(over.json()).toMatchObject({ passNumber: 2, countedAmount: 2_300, expectedAmount: 2_250, variance: 50 });
  });

  it('UX-34, OQ-020: a pass is shown with the threshold it is judged against, beside the counted, expected and variance', async () => {
    const t = await trading();
    await shiftMove(t.cashier.as, t.shift, 'begin count');
    const pass = (await count(t, 2_200)).json();
    expect(pass).toMatchObject({ countedAmount: 2_200, expectedAmount: 2_250, variance: -50, tolerance: 0 });
    expect((await acknowledge(t, pass.id, t.reason)).json(), 'and after its acknowledgement').toMatchObject({ variance: -50, tolerance: 0 });
  });

  it('SM-57, RT-244, CD-24: a recount is a new pass; the earlier pass stands, and no counted amount is ever edited', async () => {
    const t = await trading();
    await shiftMove(t.cashier.as, t.shift, 'begin count');
    const first = (await count(t, 2_000)).json();
    await count(t, 2_250);
    const passes = await db.app.query('SELECT pass_number, counted_amount FROM shift_count WHERE cash_shift_id = $1 ORDER BY pass_number', [t.shift]);
    expect(passes.rows).toEqual([
      { pass_number: 1, counted_amount: '2000' },
      { pass_number: 2, counted_amount: '2250' },
    ]);
    const edit = await db.app.query('UPDATE shift_count SET counted_amount = 2250 WHERE id = $1', [first.id]).catch((e: { code?: string }) => e.code);
    expect(edit, 'the runtime role cannot rewrite a count').toBe('42501');
  });

  it('CD-20, AC-01, CD-04, MS-02: counting needs Shift.Close, a whole non-negative amount, and the shift of this store', async () => {
    const t = await trading();
    await shiftMove(t.cashier.as, t.shift, 'begin count');
    expect((await count(t, 2_250, (await allBut(t, 'Shift.Close')).as)).statusCode, 'every key but Shift.Close').toBe(403);
    expect((await count(t, -1)).statusCode, 'never negative').toBe(400);
    expect((await call('POST', `/stores/${t.storeId}/shifts/${t.shift}/counts`, t.cashier.as, { countedAmount: 12.5 })).statusCode, 'minor units').toBe(400);
    expect((await count(t, 2_250, t.cashier.as, randomUUID())).statusCode, 'no such shift here').toBe(404);
    const other = await trading();
    expect((await count(t, 2_250, other.cashier.as, t.shift, other.storeId)).statusCode, "this shift, through another organization's store").toBe(404);
    expect((await db.app.query('SELECT 1 FROM shift_count WHERE cash_shift_id = $1', [t.shift])).rows).toHaveLength(0);
  });
});

const acknowledge = (t: Trading, countId: string, reasonCodeId: string | undefined, as: Headers = t.manager.as, shift = t.shift) =>
  call('POST', `/stores/${t.storeId}/shifts/${shift}/counts/${countId}/acknowledge`, as, reasonCodeId === undefined ? {} : { reasonCodeId });

describe('acknowledging a variance (CD-23, CD-24, BI-25; RT-245; OQ-020)', () => {
  it('CD-23, RT-245, OQ-020: a non-zero variance is acknowledged with Cash.Variance.Acknowledge and a reason; the server records who and when', async () => {
    const t = await trading();
    await shiftMove(t.cashier.as, t.shift, 'begin count');
    const pass = (await count(t, 2_200)).json();
    const refused = await acknowledge(t, pass.id, t.reason, (await allBut(t, 'Cash.Variance.Acknowledge')).as);
    expect(refused.statusCode, 'every key but Cash.Variance.Acknowledge').toBe(403);
    const done = await acknowledge(t, pass.id, t.reason);
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({ id: pass.id, variance: -50, acknowledgedBy: t.manager.id, reasonCodeId: t.reason, acknowledgedAt: expect.any(String) });
  });

  it('CD-23, OQ-020: tolerance is zero, so only a non-zero variance is acknowledged; a matching count has nothing to acknowledge', async () => {
    const t = await trading();
    await shiftMove(t.cashier.as, t.shift, 'begin count');
    const exact = (await count(t, 2_250)).json();
    const response = await acknowledge(t, exact.id, t.reason);
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toEqual({
      code: 'nothing_to_acknowledge',
      message: 'This count matches the expected amount, so there is no variance to acknowledge.',
    });
  });

  it('BI-25, SS024, CD-23: the reason is required, live, and the organization\'s own', async () => {
    const t = await trading();
    await shiftMove(t.cashier.as, t.shift, 'begin count');
    const pass = (await count(t, 2_200)).json();
    expect((await acknowledge(t, pass.id, undefined)).statusCode, 'no reason').toBe(400);
    const theirs = await trading();
    expect((await acknowledge(t, pass.id, theirs.reason)).json().error.code, "another organization's reason").toBe('invalid_reference');
    await ok('POST', `/reason-codes/${theirs.reason}/archive`, theirs.owner, {});
    expect((await acknowledge(t, pass.id, theirs.reason)).json().error.code, "s24.3: another organization's reason says nothing of its state").toBe('invalid_reference');
    await ok('POST', `/reason-codes/${t.reason}/archive`, t.owner, {});
    expect((await acknowledge(t, pass.id, t.reason)).json().error.code, 'an archived reason').toBe('SS024');
    const unacknowledged = await db.app.query('SELECT acknowledged_by FROM shift_count WHERE id = $1', [pass.id]);
    expect(unacknowledged.rows).toEqual([{ acknowledged_by: null }]);
  });

  it('CD-23, CD-24, SS001: an acknowledgement is written once, and never changes the counted amount', async () => {
    const t = await trading();
    await shiftMove(t.cashier.as, t.shift, 'begin count');
    const pass = (await count(t, 2_200)).json();
    await acknowledge(t, pass.id, t.reason);
    const again = await acknowledge(t, pass.id, t.reason);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('SS001');
    const row = await db.app.query('SELECT counted_amount, variance FROM shift_count WHERE id = $1', [pass.id]);
    expect(row.rows, 'the variance stands as counted').toEqual([{ counted_amount: '2200', variance: '-50' }]);
  });

  it('OQ-020, BI-26: no higher threshold is configured, so the second-approver rule is not applied: one person may count and acknowledge', async () => {
    const t = await trading();
    const both = await t.staff(['Shift.Close', 'Cash.Variance.Acknowledge']);
    await shiftMove(both.as, t.shift, 'begin count');
    const pass = (await count(t, 2_100, both.as)).json();
    expect((await acknowledge(t, pass.id, t.reason, both.as)).json()).toMatchObject({ countedBy: both.id, acknowledgedBy: both.id });
  });

  it('MS-02, MS-04: only a count of this shift, in this store, is acknowledged', async () => {
    const t = await trading();
    await shiftMove(t.cashier.as, t.shift, 'begin count');
    const pass = (await count(t, 2_200)).json();
    expect((await acknowledge(t, randomUUID(), t.reason)).statusCode, 'no such count').toBe(404);
    expect((await acknowledge(t, pass.id, t.reason, t.manager.as, randomUUID())).statusCode, 'no such shift here').toBe(404);
    const other = await trading();
    await shiftMove(other.cashier.as, other.shift, 'begin count');
    const theirs = (await count(other, 2_200)).json();
    expect((await acknowledge(t, theirs.id, t.reason)).statusCode, "another shift's count, named under this shift").toBe(404);
    const through = await call('POST', `/stores/${other.storeId}/shifts/${t.shift}/counts/${pass.id}/acknowledge`, other.manager.as, { reasonCodeId: other.reason });
    expect(through.statusCode, "this shift, through another organization's store").toBe(404);
    const untouched = await db.app.query('SELECT acknowledged_by FROM shift_count WHERE id = ANY($1)', [[pass.id, theirs.id]]);
    expect(untouched.rows).toEqual([{ acknowledged_by: null }, { acknowledged_by: null }]);
  });
});

const close = (t: Trading, closingFloat: number, as: Headers = t.cashier.as) => shiftMove(as, t.shift, 'close', { closingFloat });
const closingFloats = async (shift: string) =>
  (await db.app.query("SELECT direction, amount, created_by FROM cash_transaction WHERE cash_shift_id = $1 AND type = 'ClosingFloat'", [shift])).rows;

describe('the close (s22.11 close; CD-20, CD-23, CD-25, SM-57; RT-526, RT-244, RT-246; OQ-014)', () => {
  it('CD-20, RT-526, s22.11: a count with no variance closes under Shift.Close; the declared float is written as a ClosingFloat cash row, and the server records who closed and when', async () => {
    const t = await trading();
    await shiftMove(t.cashier.as, t.shift, 'begin count');
    await count(t, 2_250);
    const closed = await close(t, 1_000);
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toEqual({ subject: t.shift, state: 'Closed', changed: true });
    const shift = await db.app.query('SELECT status, closed_by, closed_at IS NOT NULL AS stamped FROM cash_shift WHERE id = $1', [t.shift]);
    expect(shift.rows).toEqual([{ status: 'Closed', closed_by: t.cashier.id, stamped: true }]);
    expect(await closingFloats(t.shift), 'cash-management s5: the float handed on leaves the drawer').toEqual([
      { direction: 'Out', amount: '1000', created_by: t.cashier.id },
    ]);
    const events = await db.app.query("SELECT actor_id FROM audit_event WHERE entity_id = $1 AND event_type = 'Shift.Close'", [t.shift]);
    expect(events.rows, 's22.11: the close is audited as Shift.Close').toEqual([{ actor_id: t.cashier.id }]);
  });

  it('CD-20, CD-04, s24.2: the closing float is declared in whole non-negative minor units, and a malformed close is refused before permission is checked', async () => {
    const t = await trading();
    await shiftMove(t.cashier.as, t.shift, 'begin count');
    await count(t, 2_250);
    const undeclared = await shiftMove(t.cashier.as, t.shift, 'close');
    expect(undeclared.statusCode).toBe(400);
    expect(undeclared.json().error).toEqual({ code: 'invalid_request', message: 'The request is not valid: check payload.' });
    expect((await close(t, -1)).statusCode, 'never negative').toBe(400);
    expect((await close(t, 12.5)).statusCode, 'minor units').toBe(400);
    expect((await shiftMove(t.manager.as, t.shift, 'close')).statusCode, 'the same answer, with or without Shift.Close').toBe(400);
    expect((await close(t, 1_000, t.manager.as)).statusCode, 'no Shift.Close').toBe(403);
    expect(await shiftStatus(t.shift)).toBe('Reconciling');
    expect((await close(t, 0)).json().state, 'a zero float is still a declaration').toBe('Closed');
    expect(await closingFloats(t.shift)).toEqual([{ direction: 'Out', amount: '0', created_by: t.cashier.id }]);
  });

  it('SM-55, CD-20: a shift is counted before it closes', async () => {
    const t = await trading();
    const uncounted = await close(t, 1_000);
    expect(uncounted.statusCode).toBe(409);
    expect(uncounted.json().error.code, 'Open does not go straight to Closed').toBe('illegal_transition');
    await shiftMove(t.cashier.as, t.shift, 'begin count');
    const outsider = await close(t, 1_000, (await allBut(t, 'Shift.Close')).as);
    expect(outsider.statusCode, 's8.4, s24.3: the permission is checked before anything about the count is said').toBe(403);
    const noCount = await close(t, 1_000);
    expect(noCount.statusCode).toBe(409);
    expect(noCount.json().error).toEqual({ code: 'not_counted', message: 'Count the drawer before closing the shift.' });
    expect(await shiftStatus(t.shift)).toBe('Reconciling');
    expect(await closingFloats(t.shift)).toEqual([]);
  });

  it('CD-25, CD-23, RT-244: an unacknowledged variance blocks the close, and nothing of the refused close stays; once acknowledged, the shift closes', async () => {
    const t = await trading();
    await shiftMove(t.cashier.as, t.shift, 'begin count');
    const short = (await count(t, 2_200)).json();
    const blocked = await close(t, 1_000);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toEqual({
      code: 'variance_unacknowledged',
      message: 'The latest count differs from the expected amount, and nobody has acknowledged the difference. Acknowledge it with a reason, or count the drawer again.',
      countId: short.id,
    });
    expect(await shiftStatus(t.shift)).toBe('Reconciling');
    expect(await closingFloats(t.shift)).toEqual([]);
    await acknowledge(t, short.id, t.reason);
    expect((await close(t, 1_000)).json().state).toBe('Closed');
  });

  it('CD-25, SM-57, AU-05: the close is decided on the latest pass: a later pass needs its own acknowledgement, and a matching recount closes, in the name of whoever closes', async () => {
    const t = await trading();
    await shiftMove(t.cashier.as, t.shift, 'begin count');
    const first = (await count(t, 2_200)).json();
    await acknowledge(t, first.id, t.reason);
    const second = (await count(t, 2_300)).json();
    expect((await close(t, 1_000)).json().error).toMatchObject({ code: 'variance_unacknowledged', countId: second.id });
    await count(t, 2_250);
    const closer = await t.staff(['Shift.Close']);
    expect((await close(t, 1_000, closer.as)).json().state).toBe('Closed');
    const shift = await db.app.query('SELECT closed_by, status_changed_by FROM cash_shift WHERE id = $1', [t.shift]);
    expect(shift.rows, 'the closer, not the cashier who opened it').toEqual([{ closed_by: closer.id, status_changed_by: closer.id }]);
    expect(await closingFloats(t.shift)).toEqual([{ direction: 'Out', amount: '1000', created_by: closer.id }]);
  });

  it('SM-04, SM-57: closing again changes nothing and declares no second float; a closed shift takes no further count or acknowledgement', async () => {
    const t = await trading();
    await shiftMove(t.cashier.as, t.shift, 'begin count');
    const short = (await count(t, 2_200)).json();
    await count(t, 2_250);
    await close(t, 1_000);
    expect((await close(t, 500)).json()).toEqual({ subject: t.shift, state: 'Closed', changed: false });
    expect((await closingFloats(t.shift)).map((row) => row.amount)).toEqual(['1000']);
    const recount = await count(t, 2_250);
    expect(recount.statusCode).toBe(409);
    expect(recount.json().error).toEqual({ code: 'not_counting', message: 'This shift is Closed, so its drawer is no longer being counted.' });
    const late = await acknowledge(t, short.id, t.reason);
    expect(late.statusCode).toBe(409);
    expect(late.json().error.code).toBe('not_counting');
    expect((await db.app.query('SELECT acknowledged_by FROM shift_count WHERE id = $1', [short.id])).rows).toEqual([{ acknowledged_by: null }]);
  });

  it('OQ-014, CD-25, CD-26, RT-246: both undecided edges stay refused: a counted shift does not go back to trading, and a closed shift is not reopened, not even by the Owner', async () => {
    const t = await trading();
    await shiftMove(t.cashier.as, t.shift, 'begin count');
    expect((await shiftMove(t.owner, t.shift, 'reopen')).json().error.code).toBe('illegal_transition');
    const back = await db.app
      .query("UPDATE cash_shift SET status = 'Open', status_changed_by = $2 WHERE id = $1", [t.shift, t.cashier.id])
      .catch((e: { code?: string }) => e.code);
    expect(back, 'Reconciling to Open is not an edge, at any privilege').toBe('SS004');
    await count(t, 2_250);
    await close(t, 1_000);
    const reopen = await shiftMove(t.owner, t.shift, 'reopen');
    expect(reopen.statusCode).toBe(409);
    expect(reopen.json().error.code).toBe('illegal_transition');
    expect(await shiftStatus(t.shift)).toBe('Closed');
  });
});

describe('guards in the database (SM-57, AU-05, SS024)', () => {
  const code = (run: Promise<unknown>) => run.then(() => 'accepted', (e: { code?: string }) => e.code);

  it('SM-57, AU-05, SS001: who changed a shift and who closed it change only with its status, at any privilege; a closed shift cannot be rewritten', async () => {
    const t = await trading();
    const open = await code(db.app.query('UPDATE cash_shift SET status_changed_by = $2 WHERE id = $1', [t.shift, t.manager.id]));
    expect(open, 'an open shift: no status change, no new actor').toBe('SS001');
    await shiftMove(t.cashier.as, t.shift, 'begin count');
    await count(t, 2_250);
    await close(t, 1_000);
    for (const db_ of [db.app, db.owner]) {
      expect(await code(db_.query('UPDATE cash_shift SET closed_by = $2 WHERE id = $1', [t.shift, t.manager.id])), 'who closed it').toBe('SS001');
      expect(await code(db_.query('UPDATE cash_shift SET status_changed_by = $2 WHERE id = $1', [t.shift, t.manager.id])), 'who changed it').toBe('SS001');
    }
    const row = await db.app.query('SELECT closed_by, status_changed_by FROM cash_shift WHERE id = $1', [t.shift]);
    expect(row.rows).toEqual([{ closed_by: t.cashier.id, status_changed_by: t.cashier.id }]);
  });

  it("SS024, BI-25, BI-40: the database itself refuses an archived reason on a count's acknowledgement", async () => {
    const t = await trading();
    await shiftMove(t.cashier.as, t.shift, 'begin count');
    const pass = (await count(t, 2_200)).json();
    await ok('POST', `/reason-codes/${t.reason}/archive`, t.owner, {});
    const refused = await code(
      db.app.query('UPDATE shift_count SET acknowledged_by = $2, reason_code_id = $3 WHERE id = $1', [pass.id, t.manager.id, t.reason]),
    );
    expect(refused).toBe('SS024');
    expect((await db.app.query('SELECT acknowledged_by FROM shift_count WHERE id = $1', [pass.id])).rows).toEqual([{ acknowledged_by: null }]);
  });
});

const screen = (t: Trading, as: Headers = t.manager.as, shift = t.shift) => call('GET', `/stores/${t.storeId}/shifts/${shift}`, as);

describe('the shift screen (CD-30, CD-31; RT-527, RT-243; actors-and-roles s2.10 Cash.Count.View)', () => {
  it('CD-30, RT-527: the screen answers four questions: what should be here, what is here, the difference against its threshold, and why, with what happens now', async () => {
    const t = await trading();
    expect((await screen(t)).json()).toMatchObject({
      id: t.shift, status: 'Open', terminalId: t.till, openedBy: t.cashier.id, expected: null, counted: null, variance: null, tolerance: 0, why: null, next: 'begin count',
    });
    await shiftMove(t.cashier.as, t.shift, 'begin count');
    expect((await screen(t)).json()).toMatchObject({ status: 'Reconciling', expected: null, next: 'count' });
    const short = (await count(t, 2_200)).json();
    expect((await screen(t)).json()).toMatchObject({ expected: 2_250, counted: 2_200, variance: -50, tolerance: 0, why: null, next: 'acknowledge' });
    await acknowledge(t, short.id, t.reason);
    expect((await screen(t)).json()).toMatchObject({
      variance: -50,
      why: { reasonCodeId: t.reason, reason: 'Drawer short', acknowledgedBy: t.manager.id, acknowledgedAt: expect.any(String) },
      next: 'close',
    });
    await close(t, 1_000);
    expect((await screen(t)).json()).toMatchObject({ status: 'Closed', closedBy: t.cashier.id, closedAt: expect.any(String), variance: -50, next: null });
  });

  it('CD-30, RT-527: the screen names the till and the people: who opened, counted and closed, and the approver of a difference', async () => {
    const t = await trading();
    await db.owner.query("UPDATE employee SET preferred_name = 'Cass' WHERE id = $1", [t.cashier.id]);
    await db.owner.query("UPDATE employee SET preferred_name = 'Mona' WHERE id = $1", [t.manager.id]);
    const closer = await t.staff(['Shift.Close']);
    await db.owner.query("UPDATE employee SET preferred_name = 'Cole' WHERE id = $1", [closer.id]);
    await shiftMove(t.cashier.as, t.shift, 'begin count');
    const short = (await count(t, 2_200)).json();
    await acknowledge(t, short.id, t.reason);
    await close(t, 1_000, closer.as);
    const shown = (await screen(t)).json();
    expect(shown).toMatchObject({
      terminalLabel: 'Till 1',
      openedByName: 'Cass Employee',
      closedByName: 'Cole Employee',
      why: { reason: 'Drawer short', acknowledgedBy: t.manager.id, acknowledgedByName: 'Mona Employee' },
    });
    expect(shown.passes).toEqual([expect.objectContaining({ countedByName: 'Cass Employee', acknowledgedByName: 'Mona Employee' })]);
    const listed = (await call('GET', `/stores/${t.storeId}/shifts`, t.manager.as)).json().items[0];
    expect(listed).toMatchObject({ terminalLabel: 'Till 1', openedByName: 'Cass Employee', why: { acknowledgedByName: 'Mona Employee' } });
  });

  it('CD-30, CD-25, SM-57: the latest pass answers, and every pass stands in the variance history, in order, with its acknowledgement', async () => {
    const t = await trading();
    await shiftMove(t.cashier.as, t.shift, 'begin count');
    const first = (await count(t, 2_200)).json();
    await acknowledge(t, first.id, t.reason);
    await count(t, 2_250);
    const shown = (await screen(t)).json();
    expect(shown, 'a count with no difference has nothing to explain').toMatchObject({ counted: 2_250, variance: 0, why: null, next: 'close' });
    expect(shown.passes).toEqual([
      expect.objectContaining({ passNumber: 1, countedAmount: 2_200, expectedAmount: 2_250, variance: -50, acknowledgedBy: t.manager.id, reason: 'Drawer short' }),
      expect.objectContaining({ passNumber: 2, countedAmount: 2_250, expectedAmount: 2_250, variance: 0, acknowledgedBy: null, reason: null }),
    ]);
  });

  it('CD-21, CD-31, RT-243: before a count is submitted, the screen does not say what the drawer should hold, even to someone who also counts', async () => {
    const t = await trading();
    const both = await t.staff(['Shift.Close', 'Cash.Count.View']);
    await shiftMove(both.as, t.shift, 'begin count');
    const blind = (await screen(t, both.as)).json();
    expect(blind).toMatchObject({ expected: null, counted: null, variance: null, passes: [] });
    // Every number anywhere in the answer: only the tolerance, so nothing from which the expected 2250 could be read.
    const numbers = (value: unknown): unknown[] =>
      typeof value === 'number' ? [value] : value !== null && typeof value === 'object' ? Object.values(value).flatMap(numbers) : [];
    expect(numbers(blind)).toEqual([0]);
    expect(numbers((await call('GET', `/stores/${t.storeId}/shifts`, both.as)).json())).toEqual([0]);
  });

  it("actors-and-roles s2.10, MS-02: reading counts needs Cash.Count.View in the store, and finds only this store's shifts", async () => {
    const t = await trading();
    const others = await allBut(t, 'Cash.Count.View');
    expect((await screen(t, others.as)).statusCode, 'every key but Cash.Count.View').toBe(403);
    expect((await call('GET', `/stores/${t.storeId}/shifts`, others.as)).statusCode, 'the list too').toBe(403);
    expect((await screen(t, t.manager.as, randomUUID())).statusCode, 'no such shift').toBe(404);
    const other = await trading();
    expect((await screen(t, t.manager.as, other.shift)).statusCode, "another organization's shift, asked through this store").toBe(404);
    expect((await call('GET', `/stores/${other.storeId}/shifts/${other.shift}`, t.manager.as)).statusCode, "another organization's store").toBe(403);
  });

  it("CD-30, MS-02: the store's shifts are listed newest first with the same answers, and can be filtered by status", async () => {
    const t = await trading();
    const other = await trading();
    await shiftMove(t.cashier.as, t.shift, 'begin count');
    await count(t, 2_250);
    await close(t, 500);
    const next = ((await ok('POST', `/stores/${t.storeId}/shift`, t.cashier.as, { openingFloat: 500 })).shift as { id: string }).id;
    const all = (await call('GET', `/stores/${t.storeId}/shifts`, t.manager.as)).json();
    expect(all.items.map((s: { id: string }) => s.id), "newest first, and none of another organization's").toEqual([next, t.shift]);
    expect(all.items[1]).toMatchObject({ status: 'Closed', expected: 2_250, counted: 2_250, variance: 0, tolerance: 0, why: null, next: null });
    expect(all.items[1].passes, 'the history is on the shift itself').toBeUndefined();
    const closed = (await call('GET', `/stores/${t.storeId}/shifts?status=Closed`, t.manager.as)).json();
    expect(closed.items.map((s: { id: string }) => s.id)).toEqual([t.shift]);
    expect((await call('GET', `/stores/${t.storeId}/shifts?limit=1`, t.manager.as)).json().items).toHaveLength(1);
    expect((await call('GET', `/stores/${t.storeId}/shifts?status=Balanced`, t.manager.as)).statusCode, 'not a shift status').toBe(400);
    expect((await call('GET', `/stores/${other.storeId}/shifts`, other.manager.as)).json().items.map((s: { id: string }) => s.id)).toEqual([other.shift]);
  });
});
