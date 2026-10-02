import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, inTransaction, sqlState, TEST_CONTEXT, type TestDb } from './db.ts';
import {
  actor,
  adjust,
  approveRefund,
  cashRefund,
  draftAdjustment,
  draftRefund,
  draftReturn,
  ensureTestCurrency,
  insertOrganization,
  insertPrice,
  insertReasonCode,
  planSale,
  postReturn,
  sell,
  setPaymentStatus,
  setRefundStatus,
  soldLines,
  startCheckout,
  submitSale,
  TEST_CURRENCY,
  tillWorld,
  withReason,
} from './fixtures.ts';

/** Domain 6 — Audit. Design: docs/database/D6-AUDIT.md */

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
  await ensureTestCurrency(db.owner);
});
afterAll(async () => {
  await db.drop();
});

interface AuditRow {
  event_type: string;
  entity_type: string;
  store_id: string | null;
  actor_id: string | null;
  effective_actor_id: string | null;
  source: string;
  correlation_id: string;
  reason_code_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

const eventsFor = async (entityId: string) =>
  (await db.app.query<AuditRow>('SELECT * FROM audit_event WHERE entity_id = $1 ORDER BY seq', [entityId])).rows;
const typesFor = async (entityId: string) => (await eventsFor(entityId)).map((e) => e.event_type);
const eventCount = async (org: string) =>
  Number((await db.app.query<{ n: string }>('SELECT count(*) AS n FROM audit_event WHERE organization_id = $1', [org])).rows[0]!.n);
const breaks = async (org: string) => (await db.app.query('SELECT * FROM audit_chain_breaks($1)', [org])).rows;

/** Runs `fn` in a transaction with the named context settings replaced (an empty string clears one). */
const withContext = <T>(settings: Record<string, string>, fn: (c: pg.PoolClient) => Promise<T>) =>
  inTransaction(db.app, async (c) => {
    for (const [name, value] of Object.entries(settings)) {
      await c.query('SELECT set_config($1, $2, true)', [`smartstore.${name}`, value]);
    }
    return fn(c);
  });

describe('the closed vocabulary and the contract (AU-11, AU-12, D-06, s22)', () => {
  it('AU-12, AU-12b, D-06: the vocabulary is exactly the documented set, plus Cash.In from s22.11', async () => {
    const { rows } = await db.app.query<{ code: string }>('SELECT code FROM audit_event_type ORDER BY code');
    const au12 = [
      'Inventory.Movement', 'Inventory.Adjustment', 'Inventory.FEFOOverride', 'Payment.Capture', 'Payment.Refund',
      'Payment.Provider.Configure', 'Cash.PayOut', 'Sale.Void', 'Shift.Close', 'Price.Change', 'Security.Login',
      'Security.Logout', 'Security.SessionEnded', 'Security.LoginFailed', 'Security.PermissionDenied',
      'Security.Role.Assign', 'Security.Impersonate', 'Data.Export', 'Offline.SyncApplied',
      'Offline.SyncAppliedWithAdjustment', 'Offline.SyncRejected', 'Approval.Decided', 'Notification.Sent',
      'Product.Archive', 'Employee.Terminate', 'Audit.EventExpired',
    ];
    const d06 = [
      'Product.StateChange', 'Inventory.BatchStateChange', 'Purchase.OrderStateChange', 'Purchase.ReceiptStateChange',
      'Purchase.InvoiceStateChange', 'Purchase.PayableCreated', 'Purchase.PayableSettled', 'Sale.Completed',
      'Return.StateChange', 'Refund.StateChange', 'Customer.StateChange', 'Employee.StateChange', 'Payment.StateChange',
      'Shift.StateChange', 'Shift.Reopened', 'Device.ModeChange', 'Device.StateChange', 'Inventory.CountStateChange',
      'Inventory.TransferStateChange', 'Rfid.Credential.StateChange',
    ];
    expect(rows.map((r) => r.code)).toEqual([...au12, ...d06, 'Cash.In'].sort());
  });

  it('RT-292, D-06, s22: each creation and edge of the built machines records the event its contract row names', async () => {
    // [machine, from ('*' = creation), to, event type or null, reason required]
    const contract: [string, string, string, string | null, boolean][] = [
      ['Product', '*', 'Draft', null, false],
      ['Product', 'Draft', 'Active', 'Product.StateChange', false],
      ['Product', 'Active', 'Discontinued', 'Product.StateChange', true],
      ['Product', 'Discontinued', 'Active', 'Product.StateChange', true],
      ['Product', 'Active', 'Hidden', 'Product.StateChange', true],
      ['Product', 'Hidden', 'Active', 'Product.StateChange', true],
      ...['Draft', 'Active', 'Discontinued', 'Hidden'].map(
        (from): [string, string, string, string, boolean] => ['Product', from, 'Archived', 'Product.Archive', true],
      ),
      ['StockAdjustment', '*', 'Draft', null, false],
      ['StockAdjustment', 'Draft', 'PendingApproval', null, false],
      ['StockAdjustment', 'PendingApproval', 'Approved', 'Approval.Decided', false],
      ['StockAdjustment', 'Approved', 'Posted', 'Inventory.Adjustment', true],
      ['StockAdjustment', 'Draft', 'Cancelled', 'Inventory.Adjustment', true],
      ['StockAdjustment', 'Posted', 'Reversed', 'Inventory.Adjustment', true],
      ['Sale', '*', 'Completed', 'Sale.Completed', false],
      ['Sale', 'Completed', 'Voided', 'Sale.Void', true],
      ['Sale', 'Completed', 'PartiallyReturned', null, false],
      ['Sale', 'PartiallyReturned', 'Returned', null, false],
      ['Payment', '*', 'Pending', 'Payment.StateChange', false],
      ['Payment', 'Pending', 'Authorized', 'Payment.StateChange', false],
      ['Payment', 'Authorized', 'Captured', 'Payment.Capture', false],
      ['Payment', 'Pending', 'Voided', 'Payment.StateChange', false],
      ['Payment', 'Authorized', 'Voided', 'Payment.StateChange', false],
      ['Payment', 'Pending', 'Declined', 'Payment.StateChange', false],
      ['Payment', 'Pending', 'Failed', 'Payment.StateChange', false],
      ['Shift', '*', 'Open', null, false],
      ['Shift', 'Open', 'Reconciling', 'Shift.StateChange', false],
      ['Shift', 'Reconciling', 'Closed', 'Shift.Close', false],
      ['Shift', 'Reopened', 'Reconciling', 'Shift.Close', false],
      ['Device', '*', 'Registered', 'Device.StateChange', false],
      ['Device', 'Registered', 'Active', 'Device.StateChange', false],
      ['Device', 'Active', 'Disabled', 'Device.StateChange', true],
      ['Device', 'Disabled', 'Active', 'Device.StateChange', true],
      ...['Registered', 'Active', 'Disabled'].map(
        (from): [string, string, string, string, boolean] => ['Device', from, 'Retired', 'Device.StateChange', true],
      ),
      ['CustomerReturn', '*', 'Draft', null, false],
      ['CustomerReturn', 'Draft', 'Posted', null, false],
      ['CustomerReturn', 'Draft', 'Cancelled', 'Return.StateChange', true],
      ['Refund', '*', 'Draft', null, false],
      ['Refund', 'Draft', 'PendingApproval', null, false],
      ['Refund', 'PendingApproval', 'Approved', 'Approval.Decided', false],
      ['Refund', 'Approved', 'Processing', null, false],
      ['Refund', 'Processing', 'Completed', 'Payment.Refund', false],
      ['Refund', 'Processing', 'Failed', 'Payment.Refund', false],
      ['Refund', 'Failed', 'Cancelled', 'Refund.StateChange', true], // D-19
      ['Refund', 'Failed', 'Processing', null, false],
      ['Refund', 'Draft', 'Cancelled', 'Refund.StateChange', true], // D-17 item 5
      ['Refund', 'Approved', 'Cancelled', 'Refund.StateChange', true],
      ['Refund', 'Processing', 'Cancelled', 'Refund.StateChange', true],
    ];
    const machines = [...new Set(contract.map((c) => c[0]))];
    const { rows } = await db.app.query<{ machine: string; from_state: string; to_state: string; type: string | null; reason: boolean }>(
      `SELECT machine, '*' AS from_state, state AS to_state, creation_audit_event_type AS type, false AS reason
       FROM state_machine_state WHERE is_initial AND machine = ANY ($1)
       UNION ALL
       SELECT machine, from_state, to_state, audit_event_type, requires_reason FROM state_machine_edge WHERE machine = ANY ($1)`,
      [machines],
    );
    const key = (c: unknown[]) => JSON.stringify(c);
    expect(rows.map((r) => key([r.machine, r.from_state, r.to_state, r.type, r.reason])).sort()).toEqual(contract.map(key).sort());
  });

  it('AU-11, RT-465: a free-text event type is refused', async () => {
    const org = await insertOrganization(db.app);
    const attempt = db.app.query(`SELECT record_audit_event('Security.Whatever', $1, NULL, 'employee', NULL, NULL)`, [org]);
    expect(await sqlState(attempt)).toBe('23503');
  });
});

describe('written with the change (AU-01, AU-03, AU-04, AU-07, AU-08)', () => {
  it('AU-01, AU-03, SP-02, RT-290: a cash sale writes its payment, sale, stock and change events in its completion transaction', async () => {
    const t = await tillWorld(db.app);
    const plan = await planSale(db.app, t, [{ variant: t.variant, quantity: 2 }], []);
    plan.tenders = [{ type: 'Cash', amount: plan.totalDue, tendered: plan.totalDue + 50 }];
    plan.change = 50;
    const { saleId } = await submitSale(db.app, t, plan);

    expect(await typesFor(saleId)).toEqual(['Sale.Completed']);
    const payment = await db.app.query<{ id: string }>(
      'SELECT p.id FROM payment p JOIN sale s ON s.checkout_id = p.checkout_id WHERE s.id = $1',
      [saleId],
    );
    expect(await typesFor(payment.rows[0]!.id)).toEqual(['Payment.StateChange', 'Payment.StateChange', 'Payment.Capture']);
    const movement = await db.app.query<{ id: string }>('SELECT id FROM inventory_movement WHERE sale_id = $1', [saleId]);
    expect(await typesFor(movement.rows[0]!.id)).toEqual(['Inventory.Movement']);
    const change = await db.app.query<{ id: string }>('SELECT id FROM cash_transaction WHERE sale_id = $1', [saleId]);
    expect(await typesFor(change.rows[0]!.id)).toEqual(['Cash.PayOut']);

    const [completed] = await eventsFor(saleId);
    expect(completed).toMatchObject({
      entity_type: 'sale',
      store_id: t.store,
      actor_id: TEST_CONTEXT.actor,
      source: 'API',
      correlation_id: TEST_CONTEXT.correlation,
    });
  });

  it('AU-01, RT-290: a change that fails leaves no event', async () => {
    const t = await tillWorld(db.app);
    const before = await eventCount(t.org);
    const plan = await planSale(db.app, t, [{ variant: t.variant, quantity: 1 }], []);
    plan.tenders = [{ type: 'Cash', amount: plan.totalDue - 1, tendered: plan.totalDue - 1 }];
    expect(await sqlState(submitSale(db.app, t, plan))).toBe('SS034');
    expect(await eventCount(t.org)).toBe(before);
  });

  it('AU-04, RT-464: a movement records what happened, including the resulting balance', async () => {
    const t = await tillWorld(db.app, { stock: 10 });
    const { rows } = await db.app.query<{ id: string }>('SELECT id FROM inventory_movement WHERE variant_id = $1', [t.variant]);
    const [event] = await eventsFor(rows[0]!.id);
    expect(event!.event_type).toBe('Inventory.Movement');
    expect(event!.after).toMatchObject({ movement_type: 'OPENING_BALANCE', resulting_balance: 10 });
  });

  it('AU-07, AU-08, RT-464: the store comes from the entity, and an update records only the fields that changed', async () => {
    const t = await tillWorld(db.app);
    await insertPrice(db.app, t.org, t.variant, 150);
    const orgPrice = await db.app.query<{ id: string }>(
      'SELECT id FROM variant_price WHERE variant_id = $1 AND amount = 150',
      [t.variant],
    );
    expect((await eventsFor(orgPrice.rows[0]!.id))[0]).toMatchObject({ event_type: 'Price.Change', store_id: null });
    const storePrice = await db.app.query<{ id: string }>(
      `INSERT INTO store_variant_price (store_id, organization_id, variant_id, currency_code, amount, created_by)
       VALUES ($1, $2, $3, $4, 140, $5) RETURNING id`,
      [t.store, t.org, t.variant, TEST_CURRENCY, actor()],
    );
    expect((await eventsFor(storePrice.rows[0]!.id))[0]).toMatchObject({ event_type: 'Price.Change', store_id: t.store });

    await withReason(db.app, t.reason, `UPDATE product SET status = 'Hidden', status_changed_by = $2 WHERE id = $1`, [t.product, actor()]);
    const hide = (await eventsFor(t.product)).at(-1)!;
    expect(hide.event_type).toBe('Product.StateChange');
    expect(Object.keys(hide.after!).sort()).toEqual(['status', 'status_changed_at', 'status_changed_by']);
    expect(hide.before).toMatchObject({ status: 'Active' });
    expect(hide.after).toMatchObject({ status: 'Hidden' });
  });
});

describe('the authenticated context (AU-05, AU-06, AU-10)', () => {
  it('AU-05, AU-10, RT-293: a change without the actor, the source or the correlation id is refused and leaves nothing', async () => {
    const t = await tillWorld(db.app);
    const prices = async () => (await db.app.query('SELECT 1 FROM variant_price WHERE variant_id = $1', [t.variant])).rows.length;
    const before = await prices();
    for (const setting of ['actor_id', 'source', 'correlation_id']) {
      const attempt = withContext({ [setting]: '' }, (c) => insertPrice(c, t.org, t.variant, 120));
      expect(await sqlState(attempt), setting).toBe('SS054');
    }
    const unknownSource = withContext({ source: 'Telepathy' }, (c) => insertPrice(c, t.org, t.variant, 120));
    expect(await sqlState(unknownSource), 'a source outside the vocabulary').toBe('23514');
    expect(await prices()).toBe(before);
  });

  it('AU-05, RT-293: the event names the authenticated actor, not the actor a request wrote into the row', async () => {
    const t = await tillWorld(db.app);
    const claimed = actor();
    await withReason(db.app, t.reason, `UPDATE product SET status = 'Hidden', status_changed_by = $2 WHERE id = $1`, [t.product, claimed]);
    const hide = (await eventsFor(t.product)).at(-1)!;
    expect(hide.actor_id).toBe(TEST_CONTEXT.actor);
    expect(hide.after).toMatchObject({ status_changed_by: claimed });
  });

  it('AU-06, RT-294: an impersonated change records both principals, and they differ', async () => {
    const t = await tillWorld(db.app);
    const effective = randomUUID();
    await withContext({ effective_actor_id: effective }, (c) => insertPrice(c, t.org, t.variant, 160));
    const price = await db.app.query<{ id: string }>('SELECT id FROM variant_price WHERE variant_id = $1 AND amount = 160', [t.variant]);
    expect((await eventsFor(price.rows[0]!.id))[0]).toMatchObject({ actor_id: TEST_CONTEXT.actor, effective_actor_id: effective });
    const self = withContext({ effective_actor_id: TEST_CONTEXT.actor }, (c) => insertPrice(c, t.org, t.variant, 170));
    expect(await sqlState(self)).toBe('23514');
  });
});

describe('reasons (BI-25, s22 preconditions)', () => {
  it('BI-25, SM-13: a transition whose contract needs a reason carries one, a live one of its own organization, or is refused', async () => {
    const t = await tillWorld(db.app);
    const hide = `UPDATE product SET status = 'Hidden', status_changed_by = $2 WHERE id = $1`;
    expect(await sqlState(db.app.query(hide, [t.product, actor()])), 'no reason').toBe('SS055');
    const archived = await insertReasonCode(db.app, t.org);
    await db.app.query('UPDATE reason_code SET archived_by = $2 WHERE id = $1', [archived, actor()]);
    expect(await sqlState(withReason(db.app, archived, hide, [t.product, actor()])), 'an archived reason').toBe('SS024');
    const foreign = await insertReasonCode(db.app, await insertOrganization(db.app));
    expect(await sqlState(withReason(db.app, foreign, hide, [t.product, actor()])), "another organization's reason").toBe('23503');
    await withReason(db.app, t.reason, hide, [t.product, actor()]);
    expect((await eventsFor(t.product)).at(-1)).toMatchObject({ event_type: 'Product.StateChange', reason_code_id: t.reason });
  });

  it('SM-60b, SM-59, HD-08: disabling a till, and putting it into maintenance, need a reason; training does not', async () => {
    const t = await tillWorld(db.app);
    const disable = `UPDATE pos_terminal SET status = 'Disabled', status_changed_by = $2 WHERE id = $1`;
    expect(await sqlState(db.app.query(disable, [t.terminal, actor()])), 'disable').toBe('SS055');
    expect(await sqlState(db.app.query(`UPDATE pos_terminal SET mode = 'Maintenance' WHERE id = $1`, [t.terminal])), 'maintenance').toBe('SS055');
    expect(await sqlState(db.app.query(`UPDATE pos_terminal SET mode = 'Training' WHERE id = $1`, [t.terminal])), 'training').toBeUndefined();
    await withReason(db.app, t.reason, `UPDATE pos_terminal SET mode = 'Standard' WHERE id = $1`, [t.terminal]);
    await withReason(db.app, t.reason, disable, [t.terminal, actor()]);
    expect(await typesFor(t.terminal)).toEqual([
      'Device.StateChange', 'Device.StateChange', 'Device.ModeChange', 'Device.ModeChange', 'Device.StateChange',
    ]);
  });
});

describe('the AU-03 floor, domain by domain (RT-292)', () => {
  it('CD-11, CD-18, CD-20, s22.11: every cash transaction and every shift step is audited', async () => {
    const t = await tillWorld(db.app, { stock: 0 });
    expect(await typesFor(t.shift), 'opening records no shift event of its own').toEqual([]);
    const float = await db.app.query<{ id: string }>(`SELECT id FROM cash_transaction WHERE cash_shift_id = $1`, [t.shift]);
    expect(await typesFor(float.rows[0]!.id)).toEqual(['Cash.In']);

    await db.app.query(`UPDATE cash_shift SET status = 'Reconciling', status_changed_by = $2 WHERE id = $1`, [t.shift, actor()]);
    await db.app.query(
      `INSERT INTO shift_count (cash_shift_id, store_id, organization_id, counted_amount, counted_by) VALUES ($1, $2, $3, 1000, $4)`,
      [t.shift, t.store, t.org, actor()],
    );
    const closing = await db.app.query<{ id: string }>(
      `INSERT INTO cash_transaction (cash_shift_id, cash_drawer_id, store_id, type, direction, amount, currency_code, created_by)
       VALUES ($1, $2, $3, 'ClosingFloat', 'Out', 1000, $4, $5) RETURNING id`,
      [t.shift, t.drawer, t.store, TEST_CURRENCY, actor()],
    );
    await db.app.query(`UPDATE cash_shift SET status = 'Closed', closed_by = $2, status_changed_by = $2 WHERE id = $1`, [t.shift, actor()]);
    expect(await typesFor(t.shift)).toEqual(['Shift.StateChange', 'Shift.Close']);
    expect(await typesFor(closing.rows[0]!.id)).toEqual(['Cash.PayOut']);
  });

  it('IV-33, s22.17: an adjustment records its approval, its posting and each movement; a cancellation is recorded too', async () => {
    const t = await tillWorld(db.app, { stock: 0 });
    const a = await adjust(db.app, t, [{ variant: t.variant, location: t.location, type: 'FOUND', quantity: 2 }]);
    expect(await typesFor(a.id)).toEqual(['Approval.Decided', 'Inventory.Adjustment']);
    const moves = await db.app.query<{ id: string }>('SELECT id FROM inventory_movement WHERE stock_adjustment_id = $1', [a.id]);
    expect(await typesFor(moves.rows[0]!.id)).toEqual(['Inventory.Movement']);
    const draft = await draftAdjustment(db.app, t, [{ variant: t.variant, location: t.location, type: 'LOSS', quantity: 1 }]);
    await db.app.query(`UPDATE stock_adjustment SET status = 'Cancelled', status_changed_by = $2 WHERE id = $1`, [draft.id, actor()]);
    expect(await typesFor(draft.id)).toEqual(['Inventory.Adjustment']);
  });

  it('PY-13, PY-54, AU-03: every payment state change is audited, a decline included', async () => {
    const t = await tillWorld(db.app);
    const checkout = await startCheckout(db.app, t);
    const p = await db.app.query<{ id: string }>(
      `INSERT INTO payment (checkout_id, store_id, organization_id, payment_method_id, method_type, currency_code, amount,
         sequence_number, created_by, status_changed_by)
       VALUES ($1, $2, $3, $4, 'Card', $5, 100, 1, $6, $6) RETURNING id`,
      [checkout, t.store, t.org, t.card, TEST_CURRENCY, actor()],
    );
    await setPaymentStatus(db.app, p.rows[0]!.id, 'Declined');
    expect(await typesFor(p.rows[0]!.id)).toEqual(['Payment.StateChange', 'Payment.StateChange']);
  });

  it('RR-17, SM-40, PY-27: a return records its movements and its cancellation; a refund its approval, payment and drawer payout', async () => {
    const t = await tillWorld(db.app);
    const { saleId } = await sell(db.app, t, [{ variant: t.variant, quantity: 2 }]);
    const [line] = await soldLines(db.app, saleId);

    const r = await draftReturn(db.app, t, saleId, [{ line: line!, quantity: 1 }]);
    await postReturn(db.app, r);
    expect(await typesFor(r.id), 'posting is recorded by its movements').toEqual([]);
    const back = await db.app.query<{ id: string }>('SELECT id FROM inventory_movement WHERE customer_return_id = $1', [r.id]);
    expect((await eventsFor(back.rows[0]!.id))[0]).toMatchObject({ event_type: 'Inventory.Movement', after: { disposition: 'Sellable' } });
    const cancelled = await draftReturn(db.app, t, saleId, [{ line: line!, quantity: 1 }]);
    await db.app.query(
      `UPDATE customer_return SET status = 'Cancelled', cancel_reason_code_id = $2, status_changed_by = $3 WHERE id = $1`,
      [cancelled.id, t.reason, actor()],
    );
    expect((await eventsFor(cancelled.id))[0]).toMatchObject({ event_type: 'Return.StateChange', reason_code_id: t.reason });

    const refund = await cashRefund(db.app, t, saleId, { returnId: r.id, lines: [{ line: line!, amount: 100 }] });
    expect(await typesFor(refund)).toEqual(['Approval.Decided', 'Payment.Refund']);
    const payout = await db.app.query<{ id: string }>('SELECT id FROM cash_transaction WHERE refund_id = $1', [refund]);
    expect(await typesFor(payout.rows[0]!.id)).toEqual(['Cash.PayOut']);
    const { id: withdrawn } = await draftRefund(db.app, t, saleId, { reason: t.reason, lines: [{ line: line!, amount: 100 }] });
    await approveRefund(db.app, withdrawn);
    await setRefundStatus(db.app, withdrawn, 'Cancelled', t.reason);
    expect(await typesFor(withdrawn)).toEqual(['Approval.Decided', 'Refund.StateChange']);
  });
});

describe('immutable and closed to the application (AU-02, AU-32, RT-291)', () => {
  it('AU-02, BI-24, RT-291: no role can change or delete an event or a chain link, or empty the log', async () => {
    const t = await tillWorld(db.app, { stock: 0 });
    const { rows } = await db.app.query<{ id: string }>('SELECT id FROM audit_event WHERE organization_id = $1 LIMIT 1', [t.org]);
    const id = rows[0]!.id;
    expect(await sqlState(db.app.query(`UPDATE audit_event SET source = 'UI' WHERE id = $1`, [id])), 'app update').toBe('42501');
    expect(await sqlState(db.app.query('DELETE FROM audit_event WHERE id = $1', [id])), 'app delete').toBe('42501');
    expect(await sqlState(db.owner.query(`UPDATE audit_event SET source = 'UI' WHERE id = $1`, [id])), 'owner update').toBe('SS010');
    expect(await sqlState(db.owner.query('DELETE FROM audit_event WHERE id = $1', [id])), 'owner delete').toBe('SS010');
    const link = db.owner.query('UPDATE audit_chain_link SET hash = prev_hash WHERE audit_event_id = $1', [id]);
    expect(await sqlState(link), 'owner rewrites a link').toBe('SS010');
    expect(await sqlState(db.owner.query('DELETE FROM audit_chain_link WHERE audit_event_id = $1', [id])), 'owner deletes a link').toBe('SS010');
    expect(await sqlState(db.owner.query('TRUNCATE audit_event, audit_chain_link')), 'owner truncates').toBe('SS010');
  });

  it('AU-05, RT-293: the application cannot write an event except through record_audit_event', async () => {
    const t = await tillWorld(db.app, { stock: 0 });
    const direct = db.app.query(
      `INSERT INTO audit_event (organization_id, event_type, entity_type, actor_id, source, correlation_id)
       VALUES ($1, 'Security.Login', 'employee', $2, 'API', $3)`,
      [t.org, actor(), randomUUID()],
    );
    expect(await sqlState(direct), 'insert').toBe('42501');
    const writer = db.app.query(`SELECT write_audit_event('Payment.Capture', 'payment', NULL, '{}'::jsonb, false)`);
    expect(await sqlState(writer), 'the internal writer').toBe('42501');

    // Behind the functions, the table itself: even the owner cannot record an event with no actor, or with the store of
    // another organization.
    const raw = (type: string, store: string | null, who: string | null) =>
      db.owner.query(
        `INSERT INTO audit_event (organization_id, store_id, event_type, entity_type, actor_id, source, correlation_id)
         VALUES ($1, $2, $3, 'employee', $4, 'API', $5)`,
        [t.org, store, type, who, randomUUID()],
      );
    expect(await sqlState(raw('Security.Logout', null, null)), 'no actor').toBe('23514');
    const elsewhere = await tillWorld(db.app, { stock: 0 });
    expect(await sqlState(raw('Security.Logout', elsewhere.store, actor())), "another organization's store").toBe('23503');
  });

  it('AU-12a, AU-14, AU-15, RT-296: the application records its own events, with the actor from the session, and never the database\'s', async () => {
    const t = await tillWorld(db.app, { stock: 0 });
    const employee = randomUUID();
    const record = (type: string, c: pg.Pool | pg.PoolClient = db.app) =>
      c.query<{ id: string }>(`SELECT record_audit_event($1, $2, $3, 'employee', $4, '{"device":"till"}'::jsonb) AS id`, [
        type,
        t.org,
        t.store,
        employee,
      ]);
    const login = await record('Security.Login');
    const [event] = (await db.app.query<AuditRow>('SELECT * FROM audit_event WHERE id = $1', [login.rows[0]!.id])).rows;
    expect(event).toMatchObject({ event_type: 'Security.Login', actor_id: TEST_CONTEXT.actor, store_id: t.store, after: { device: 'till' } });
    expect(await sqlState(record('Payment.Capture')), 'a database event').toBe('SS056');
    const failed = await withContext({ actor_id: '' }, (c) => record('Security.LoginFailed', c));
    const [anonymous] = (await db.app.query<AuditRow>('SELECT * FROM audit_event WHERE id = $1', [failed.rows[0]!.id])).rows;
    expect(anonymous!.actor_id).toBeNull();
    expect(await sqlState(withContext({ actor_id: '' }, (c) => record('Security.Logout', c))), 'a sign-out has an actor').toBe('SS054');
  });
});

describe('the per-organization chain (AU-29, AU-30, RT-302)', () => {
  it('AU-29, RT-302: every event is linked, in order, into its organization\'s chain, and the check finds no break', async () => {
    const t = await tillWorld(db.app);
    await sell(db.app, t, [{ variant: t.variant, quantity: 1 }]);
    // The chain tables are the owner's; the application only calls the check.
    const { rows } = await db.owner.query<{ events: string; links: string; top: string }>(
      `SELECT (SELECT count(*) FROM audit_event WHERE organization_id = $1) AS events,
              (SELECT count(*) FROM audit_chain_link WHERE organization_id = $1) AS links,
              (SELECT last_seq FROM audit_chain_head WHERE organization_id = $1) AS top`,
      [t.org],
    );
    expect(Number(rows[0]!.events)).toBeGreaterThan(10);
    expect(rows[0]!.links).toBe(rows[0]!.events);
    expect(rows[0]!.top).toBe(rows[0]!.events);
    expect(await breaks(t.org)).toEqual([]);
    // The canonical form does not depend on the session: a check run in another time zone agrees.
    const elsewhere = await withContext({}, async (c) => {
      await c.query(`SET LOCAL TimeZone = 'Pacific/Chatham'`);
      return (await c.query('SELECT * FROM audit_chain_breaks($1)', [t.org])).rows;
    });
    expect(elsewhere).toEqual([]);
  });

  it('AU-29, RT-302: thirty concurrent transactions link without a gap, a fork or a deadlock', async () => {
    const t = await tillWorld(db.app, { stock: 0 });
    const before = await eventCount(t.org);
    const wide = new pg.Pool({ connectionString: db.appUrl, max: 10 });
    try {
      await Promise.all(
        Array.from({ length: 30 }, () =>
          wide.query(`SELECT record_audit_event('Security.Login', $1, $2, 'employee', $3, NULL)`, [t.org, t.store, randomUUID()]),
        ),
      );
    } finally {
      await wide.end();
    }
    expect(await eventCount(t.org)).toBe(before + 30);
    expect(await breaks(t.org)).toEqual([]);
  });

  it('AU-30, AU-31, EC-76: an altered, removed or unlinked event breaks the chain, and the check reports it without repairing', async () => {
    // Only the owner, in this private database, can switch the guards off: the tampering AU-31 says the chain must expose.
    const tamper = async (statements: string[], id: string) => {
      await db.owner.query('ALTER TABLE audit_event DISABLE TRIGGER tg_audit_event_immutable');
      await db.owner.query('ALTER TABLE audit_chain_link DISABLE TRIGGER tg_audit_chain_link_immutable');
      try {
        for (const sql of statements) await db.owner.query(sql, [id]);
      } finally {
        await db.owner.query('ALTER TABLE audit_event ENABLE TRIGGER tg_audit_event_immutable');
        await db.owner.query('ALTER TABLE audit_chain_link ENABLE TRIGGER tg_audit_chain_link_immutable');
      }
    };
    const remove = ['DELETE FROM audit_chain_link WHERE audit_event_id = $1', 'DELETE FROM audit_event WHERE id = $1'];
    const world = async () => {
      const t = await tillWorld(db.app, { stock: 0 });
      const { rows } = await db.app.query<{ id: string }>(
        'SELECT id FROM audit_event WHERE organization_id = $1 ORDER BY seq',
        [t.org],
      );
      expect(await breaks(t.org)).toEqual([]);
      return { org: t.org, ids: rows.map((r) => r.id) };
    };
    const problems = async (org: string) => (await breaks(org)).map((b) => b.problem as string).sort();

    const altered = await world();
    await tamper([`UPDATE audit_event SET after = '{}'::jsonb WHERE id = $1`], altered.ids[1]!);
    expect(await problems(altered.org)).toEqual(['the event was altered']);

    const middle = await world();
    await tamper(remove, middle.ids[1]!);
    expect(await problems(middle.org)).toEqual(['a link is missing before this one', 'does not continue from the link before it']);

    const tail = await world();
    await tamper(remove, tail.ids.at(-1)!);
    expect(await problems(tail.org)).toEqual(['the chain ends before its recorded head']);

    const unlinked = await world();
    await db.owner.query('ALTER TABLE audit_event DISABLE TRIGGER tg_audit_event_chain');
    try {
      await db.owner.query(
        `INSERT INTO audit_event (organization_id, event_type, entity_type, actor_id, source, correlation_id)
         VALUES ($1, 'Security.Login', 'employee', $2, 'API', $3)`,
        [unlinked.org, actor(), randomUUID()],
      );
    } finally {
      await db.owner.query('ALTER TABLE audit_event ENABLE TRIGGER tg_audit_event_chain');
    }
    expect(await problems(unlinked.org)).toEqual(['the event is not in the chain']);
  });
});
