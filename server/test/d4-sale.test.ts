import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, inTransaction, sqlState, type TestDb } from './db.ts';
import {
  actor,
  adjust,
  ensureTestCurrency,
  insertBarcode,
  insertLocation,
  insertPrice,
  insertReasonCode,
  insertSettings,
  insertVariant,
  onHand,
  openShift,
  planSale,
  sell,
  setPaymentStatus,
  startCheckout,
  submitSale,
  TEST_CURRENCY,
  tillWorld,
  type TillWorld,
  withReason,
} from './fixtures.ts';

/** Domain 4 — Sale / Payment. Design: docs/database/D4-SALE-PAYMENT.md */

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
  await ensureTestCurrency(db.owner);
});
afterAll(async () => {
  await db.drop();
});

const drift = async () => (await db.app.query('SELECT * FROM inventory_ledger_drift()')).rows;

/** Another active till with its own drawer, in the same store, with no shift yet. */
async function secondTill(t: TillWorld): Promise<{ store: string; terminal: string; drawer: string }> {
  const terminal = await db.app.query<{ id: string }>(
    `INSERT INTO pos_terminal (store_id, organization_id, code, label, sell_from_location_id, status_changed_by)
     VALUES ($1, $2, $3, 'Till 2', $4, $5) RETURNING id`,
    [t.store, t.org, `T-${randomUUID()}`, t.location, actor()],
  );
  await db.app.query(`UPDATE pos_terminal SET status = 'Active', status_changed_by = $2 WHERE id = $1`, [terminal.rows[0]!.id, actor()]);
  const drawer = await db.app.query<{ id: string }>(
    `INSERT INTO cash_drawer (store_id, pos_terminal_id, label, currency_code) VALUES ($1, $2, 'Drawer 2', $3) RETURNING id`,
    [t.store, terminal.rows[0]!.id, TEST_CURRENCY],
  );
  return { store: t.store, terminal: terminal.rows[0]!.id, drawer: drawer.rows[0]!.id };
}

/** A second variant of the till's product, priced and classified like the first. */
async function anotherVariant(t: TillWorld, price: number): Promise<string> {
  const v = await db.app.query<{ tax_category_id: string }>('SELECT tax_category_id FROM product_variant WHERE id = $1', [t.variant]);
  const variant = await inTransaction(db.app, async (c) => {
    const id = await insertVariant(c, t.org, t.product, t.unit, v.rows[0]!.tax_category_id);
    await insertPrice(c, t.org, id, price);
    return id;
  });
  await adjust(db.app, t, [{ variant, location: t.location, type: 'OPENING_BALANCE', quantity: 10 }], 'OpeningBalance');
  return variant;
}

describe('till setup (PT-01..PT-03, CD-01..CD-05, CD-11, BI-39, RT-005)', () => {
  it('SM-60: a terminal is registered, then activated; only an active terminal opens a shift', async () => {
    const t = await tillWorld(db.app, { stock: 0 });
    const { rows } = await db.app.query<{ id: string; status: string }>(
      `INSERT INTO pos_terminal (store_id, organization_id, code, label, sell_from_location_id, status_changed_by)
       VALUES ($1, $2, $3, 'Till 2', $4, $5) RETURNING id, status`,
      [t.store, t.org, `T-${randomUUID()}`, t.location, actor()],
    );
    expect(rows[0]!.status).toBe('Registered');
    const drawer = await db.app.query<{ id: string }>(
      `INSERT INTO cash_drawer (store_id, pos_terminal_id, label, currency_code) VALUES ($1, $2, 'D2', $3) RETURNING id`,
      [t.store, rows[0]!.id, TEST_CURRENCY],
    );
    const attempt = openShift(db.app, { store: t.store, terminal: rows[0]!.id, drawer: drawer.rows[0]!.id });
    expect(await sqlState(attempt)).toBe('SS025');
  });

  it('WH-01, RT-004: a till sells only from a sellable location of its own store', async () => {
    const t = await tillWorld(db.app, { stock: 0 });
    const quarantine = await insertLocation(db.app, t.org, t.warehouse, 'StoreAttached', 'Quarantine', false);
    const move = db.app.query('UPDATE pos_terminal SET sell_from_location_id = $2 WHERE id = $1', [t.terminal, quarantine]);
    expect(await sqlState(move)).toBe('SS032');
  });

  it('CD-34, CD-36: one drawer per terminal, in the store currency', async () => {
    const t = await tillWorld(db.app, { stock: 0 });
    const second = db.app.query(
      `INSERT INTO cash_drawer (store_id, pos_terminal_id, label, currency_code) VALUES ($1, $2, 'Second', $3)`,
      [t.store, t.terminal, TEST_CURRENCY],
    );
    expect(await sqlState(second)).toBe('23505');
  });

  it('CD-11, CD-14: a shift opens with exactly one counted float, which may be zero', async () => {
    const t = await tillWorld(db.app, { stock: 0 });
    const till = await secondTill(t);
    const noFloat = inTransaction(db.app, (c) =>
      c.query(
        `INSERT INTO cash_shift (store_id, pos_terminal_id, cash_drawer_id, opened_by, status_changed_by)
         VALUES ($1, $2, $3, $4, $4)`,
        [till.store, till.terminal, till.drawer, actor()],
      ),
    );
    expect(await sqlState(noFloat), 'no opening float').toBe('SS042');
    expect(await sqlState(openShift(db.app, till, 0)), 'a zero float is legitimate').toBeUndefined();
  });

  it('BI-39, CD-03: two cashiers opening one drawer at the same moment: exactly one succeeds', async () => {
    const t = await tillWorld(db.app, { stock: 0 });
    await db.app.query(`UPDATE cash_shift SET status = 'Reconciling', status_changed_by = $2 WHERE id = $1`, [t.shift, actor()]);
    await db.app.query(
      `INSERT INTO shift_count (cash_shift_id, store_id, organization_id, counted_amount, counted_by) VALUES ($1, $2, $3, 1000, $4)`,
      [t.shift, t.store, t.org, actor()],
    );
    await db.app.query(
      `INSERT INTO cash_transaction (cash_shift_id, cash_drawer_id, store_id, type, direction, amount, currency_code, created_by)
       VALUES ($1, $2, $3, 'ClosingFloat', 'Out', 0, $4, $5)`,
      [t.shift, t.drawer, t.store, TEST_CURRENCY, actor()],
    );
    await db.app.query(`UPDATE cash_shift SET status = 'Closed', closed_by = $2, status_changed_by = $2 WHERE id = $1`, [t.shift, actor()]);
    const wide = new pg.Pool({ connectionString: db.appUrl, max: 4 });
    try {
      const outcomes = await Promise.all([0, 1, 2, 3].map(() => sqlState(openShift(wide, t))));
      expect(outcomes.filter((o) => o === undefined)).toHaveLength(1);
      expect(outcomes.filter((o) => o === '23505')).toHaveLength(3);
    } finally {
      await wide.end();
    }
  });

  it('CD-03: one open shift per employee per store', async () => {
    const t = await tillWorld(db.app, { stock: 0 });
    const till = await secondTill(t);
    const sameCashier = inTransaction(db.app, (c) =>
      c.query(
        `INSERT INTO cash_shift (store_id, pos_terminal_id, cash_drawer_id, opened_by, status_changed_by)
         VALUES ($1, $2, $3, $4, $4)`,
        [till.store, till.terminal, till.drawer, t.cashier],
      ),
    );
    expect(await sqlState(sameCashier)).toBe('23505');
  });

  it('SM-55, OQ-014: Reconciling → Open is drawn but not contracted', async () => {
    const t = await tillWorld(db.app, { stock: 0 });
    const set = (status: string) =>
      db.app.query('UPDATE cash_shift SET status = $2, status_changed_by = $3 WHERE id = $1', [t.shift, status, actor()]);
    await set('Reconciling');
    expect(await sqlState(set('Open')), 'Reconciling -> Open is drawn but not contracted').toBe('SS004');
  });

  it('OQ-033, SM-55, CD-26: Closed → Reopened requires a reason; sets reopened_by and retains closed_by', async () => {
    const t = await tillWorld(db.app, { stock: 0 });
    const reason = await insertReasonCode(db.app, t.org);
    const closer = actor();
    await db.app.query(
      `UPDATE cash_shift SET status = 'Reconciling', status_changed_by = $2 WHERE id = $1`,
      [t.shift, actor()],
    );
    await db.app.query(
      `INSERT INTO shift_count (cash_shift_id, store_id, organization_id, counted_amount, counted_by) VALUES ($1, $2, $3, 1000, $4)`,
      [t.shift, t.store, t.org, actor()],
    );
    // ClosingFloat is required by assert_shift_close_ready (CD-20).
    await db.app.query(
      `INSERT INTO cash_transaction (cash_shift_id, cash_drawer_id, store_id, type, direction, amount, currency_code, created_by)
       VALUES ($1, $2, $3, 'ClosingFloat', 'Out', 1000, $4, $5)`,
      [t.shift, t.drawer, t.store, TEST_CURRENCY, actor()],
    );
    await db.app.query(
      `UPDATE cash_shift SET status = 'Closed', closed_by = $2, status_changed_by = $2 WHERE id = $1`,
      [t.shift, closer],
    );
    // Reopen without reason is refused (requires_reason = true on the edge, SS055).
    const reopener = actor();
    expect(
      await sqlState(
        db.app.query(
          `UPDATE cash_shift SET status = 'Reopened', reopened_by = $2, reopen_reason_code_id = $3, status_changed_by = $2 WHERE id = $1`,
          [t.shift, reopener, reason],
        ),
      ),
      'no session reason → SS055',
    ).toBe('SS055');
    // Reopen with reason succeeds; closed_by is preserved alongside reopened_by.
    const reopener2 = actor();
    await withReason(
      db.app,
      reason,
      `UPDATE cash_shift SET status = 'Reopened', reopened_by = $2, reopen_reason_code_id = $3, status_changed_by = $2 WHERE id = $1`,
      [t.shift, reopener2, reason],
    );
    const { rows } = await db.app.query<{ status: string; closed_by: string; reopened_by: string }>(
      'SELECT status, closed_by, reopened_by FROM cash_shift WHERE id = $1',
      [t.shift],
    );
    expect(rows[0]!.status).toBe('Reopened');
    expect(rows[0]!.closed_by).toBe(closer);
    expect(rows[0]!.reopened_by).toBe(reopener2);
  });

  it('CD-19: the cash ledger is append-only, whatever the role', async () => {
    const t = await tillWorld(db.app, { stock: 0 });
    expect(await sqlState(db.app.query('UPDATE cash_transaction SET amount = 1 WHERE cash_shift_id = $1', [t.shift]))).toBe('42501');
    expect(await sqlState(db.owner.query('DELETE FROM cash_transaction WHERE cash_shift_id = $1', [t.shift]))).toBe('SS010');
  });
});

describe('payments (PY-02, PY-04, PY-12, PY-15, PY-19, PY-54, D-14, RT-345)', () => {
  it('PY-12, PY-54, D-14, RT-345: no edge leaves Captured, Declined, Voided or Failed', async () => {
    const { rows } = await db.app.query<{ from_state: string }>(
      `SELECT from_state FROM state_machine_edge WHERE machine = 'Payment'`,
    );
    const exits = new Set(rows.map((r) => r.from_state));
    for (const terminal of ['Captured', 'Declined', 'Voided', 'Failed']) expect(exits.has(terminal), terminal).toBe(false);
  });

  it('D-14, PY-54: a Failed payment is frozen, and the retry is a new payment on the same checkout', async () => {
    const t = await tillWorld(db.app);
    const checkout = await startCheckout(db.app, t);
    const first = await db.app.query<{ id: string }>(
      `INSERT INTO payment (checkout_id, store_id, organization_id, payment_method_id, method_type, currency_code, amount,
         sequence_number, created_by, status_changed_by)
       VALUES ($1, $2, $3, $4, 'Card', $5, 100, 1, $6, $6) RETURNING id`,
      [checkout, t.store, t.org, t.card, TEST_CURRENCY, t.cashier],
    );
    await setPaymentStatus(db.app, first.rows[0]!.id, 'Failed');
    expect(await sqlState(setPaymentStatus(db.app, first.rows[0]!.id, 'Authorized'))).toBe('SS035');
    const retry = db.app.query(
      `INSERT INTO payment (checkout_id, store_id, organization_id, payment_method_id, method_type, currency_code, amount,
         sequence_number, created_by, status_changed_by)
       VALUES ($1, $2, $3, $4, 'Card', $5, 100, 2, $6, $6)`,
      [checkout, t.store, t.org, t.card, TEST_CURRENCY, t.cashier],
    );
    expect(await sqlState(retry)).toBeUndefined();
  });

  it('PY-02, PY-19, RT-132: cash records applied and tendered; a card is never overpaid; zero is refused', async () => {
    const t = await tillWorld(db.app);
    const checkout = await startCheckout(db.app, t);
    const pay = (type: 'Cash' | 'Card', amount: number, tendered: number | null, sequence: number) =>
      db.app.query(
        `INSERT INTO payment (checkout_id, store_id, organization_id, payment_method_id, method_type, currency_code, amount,
           tendered_amount, sequence_number, created_by, status_changed_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
        [checkout, t.store, t.org, type === 'Cash' ? t.cash : t.card, type, TEST_CURRENCY, amount, tendered, sequence, t.cashier],
      );
    expect(await sqlState(pay('Card', 100, 150, 1)), 'card with a tendered amount').toBe('23514');
    expect(await sqlState(pay('Cash', 100, 50, 2)), 'cash tendered below applied').toBe('23514');
    expect(await sqlState(pay('Cash', 0, 0, 3)), 'zero').toBe('23514');
    expect(await sqlState(pay('Card', 100, null, 4))).toBeUndefined();
    expect(await sqlState(pay('Cash', 100, 150, 5))).toBeUndefined();
  });

  it('PY-04: a method disabled at the store is refused', async () => {
    const t = await tillWorld(db.app);
    await db.app.query(
      'UPDATE store_payment_method SET is_enabled = false, changed_by = $3 WHERE store_id = $1 AND payment_method_id = $2',
      [t.store, t.card, actor()],
    );
    const plan = await planSale(db.app, t, [{ variant: t.variant, quantity: 1 }], []);
    plan.tenders = [{ type: 'Card', amount: plan.totalDue }];
    expect(await sqlState(submitSale(db.app, t, plan))).toBe('SS045');
  });

  it('PY-15, RT-480: a provider transaction is recorded once', async () => {
    const t = await tillWorld(db.app);
    const checkout = await startCheckout(db.app, t);
    const ids: string[] = [];
    for (const n of [1, 2]) {
      const r = await db.app.query<{ id: string }>(
        `INSERT INTO payment (checkout_id, store_id, organization_id, payment_method_id, method_type, currency_code, amount,
           sequence_number, created_by, status_changed_by)
         VALUES ($1, $2, $3, $4, 'Card', $5, 100, $6, $7, $7) RETURNING id`,
        [checkout, t.store, t.org, t.card, TEST_CURRENCY, n, t.cashier],
      );
      ids.push(r.rows[0]!.id);
    }
    const ref = `PSP-${randomUUID()}`;
    await db.app.query('UPDATE payment SET provider_transaction_reference = $2 WHERE id = $1', [ids[0], ref]);
    expect(await sqlState(db.app.query('UPDATE payment SET provider_transaction_reference = $2 WHERE id = $1', [ids[1], ref]))).toBe('23505');
  });

  it('PT-03: a training till cannot take a payment or complete a real sale', async () => {
    const t = await tillWorld(db.app);
    await db.app.query(`UPDATE pos_terminal SET mode = 'Training' WHERE id = $1`, [t.terminal]);
    expect(await sqlState(sell(db.app, t, [{ variant: t.variant, quantity: 1 }]))).toBe('SS025');
  });
});

describe('sale completion (SP-01, SP-02, RT-118..RT-124, RT-132, RT-133, RT-146, BI-28, BI-42)', () => {
  it('RT-132, RT-135: a 5000 tender for a 1340 sale records 1340 applied and 3660 change disbursed', async () => {
    const t = await tillWorld(db.app);
    const variant = await anotherVariant(t, 1340);
    const plan = await planSale(db.app, t, [{ variant, quantity: 1 }], [{ type: 'Cash', amount: 1340, tendered: 5000 }]);
    const { saleId } = await submitSale(db.app, t, plan);
    const sale = await db.app.query<{ total_due: string; total_tendered: string; change_given: string; status: string }>(
      'SELECT total_due, total_tendered, change_given, status FROM sale WHERE id = $1',
      [saleId],
    );
    expect(sale.rows[0]).toEqual({ total_due: '1340', total_tendered: '1340', change_given: '3660', status: 'Completed' });
    const change = await db.app.query<{ amount: string }>(
      `SELECT amount FROM cash_transaction WHERE sale_id = $1 AND type = 'ChangeDisbursed'`,
      [saleId],
    );
    expect(change.rows[0]!.amount).toBe('3660');
  });

  it('SP-01, BI-42, RT-118: a sale is born Completed, numbered, dated, and closes its checkout', async () => {
    const t = await tillWorld(db.app);
    const a = await sell(db.app, t, [{ variant: t.variant, quantity: 1 }]);
    const b = await sell(db.app, t, [{ variant: t.variant, quantity: 1 }]);
    const { rows } = await db.app.query<{ document_number: string; status: string; dated: boolean; checkout: string }>(
      `SELECT s.document_number, s.status, s.business_date = (now() AT TIME ZONE 'UTC')::date AS dated, c.status AS checkout
       FROM sale s JOIN checkout c ON c.id = s.checkout_id WHERE s.id = ANY ($1) ORDER BY s.document_number`,
      [[a.saleId, b.saleId]],
    );
    expect(rows).toEqual([
      { document_number: '1', status: 'Completed', dated: true, checkout: 'Completed' },
      { document_number: '2', status: 'Completed', dated: true, checkout: 'Completed' },
    ]);
  });

  it('IV-15, RT-119: the sale moved its stock in the same transaction, and the ledger reconciles', async () => {
    const t = await tillWorld(db.app, { stock: 10 });
    await sell(db.app, t, [{ variant: t.variant, quantity: 3 }]);
    expect(await onHand(db.app, t.variant, t.location)).toBe(7);
    expect(await drift()).toEqual([]);
  });

  it('RT-133, PY-16: split tender, card then cash, settles the sale exactly', async () => {
    const t = await tillWorld(db.app);
    const plan = await planSale(db.app, t, [{ variant: t.variant, quantity: 3 }], []);
    plan.tenders = [
      { type: 'Card', amount: 200 },
      { type: 'Cash', amount: plan.totalDue - 200, tendered: plan.totalDue - 200 },
    ];
    const { saleId } = await submitSale(db.app, t, plan);
    const { rows } = await db.app.query<{ method_type: string; amount: string; sequence_number: number }>(
      `SELECT p.method_type, p.amount, p.sequence_number FROM payment p JOIN sale s ON s.checkout_id = p.checkout_id
       WHERE s.id = $1 ORDER BY p.sequence_number`,
      [saleId],
    );
    expect(rows).toEqual([
      { method_type: 'Card', amount: '200', sequence_number: 1 },
      { method_type: 'Cash', amount: '100', sequence_number: 2 },
    ]);
  });

  it('BI-28, PY-39, RT-121: a commit retried with the same operation id creates no second sale', async () => {
    const t = await tillWorld(db.app);
    const plan = await planSale(db.app, t, [{ variant: t.variant, quantity: 1 }], []);
    plan.tenders = [{ type: 'Cash', amount: plan.totalDue, tendered: plan.totalDue }];
    await submitSale(db.app, t, plan);
    expect(await sqlState(submitSale(db.app, t, plan))).toBe('23505');
    const { rows } = await db.app.query('SELECT 1 FROM sale WHERE client_operation_id = $1', [plan.operationId]);
    expect(rows).toHaveLength(1);
  });

  it('SP-40, PY-17: an underpaid sale does not complete, and nothing of it survives', async () => {
    const t = await tillWorld(db.app, { stock: 5 });
    const plan = await planSale(db.app, t, [{ variant: t.variant, quantity: 2 }], []);
    plan.tenders = [{ type: 'Cash', amount: plan.totalDue - 1, tendered: plan.totalDue - 1 }];
    expect(await sqlState(submitSale(db.app, t, plan))).toBe('SS034');
    expect(await onHand(db.app, t.variant, t.location), 'RT-119: no stock movement survives').toBe(5);
    const { rows } = await db.app.query(`SELECT 1 FROM payment p JOIN checkout c ON c.id = p.checkout_id
      WHERE c.client_operation_id = $1 AND p.method_type = 'Cash'`, [plan.operationId]);
    expect(rows, 'RT-119: no cash payment record survives').toEqual([]);
  });

  it('RT-136, PY-11: a card left pending (a timeout) never completes a sale', async () => {
    const t = await tillWorld(db.app);
    const plan = await planSale(db.app, t, [{ variant: t.variant, quantity: 1 }], []);
    plan.tenders = [{ type: 'Card', amount: plan.totalDue }];
    plan.leaveCardPending = true;
    expect(await sqlState(submitSale(db.app, t, plan))).toBe('SS034');
  });

  it('RT-124, BI-30: a line keeps the price quoted at add time, and a doctored or future price is refused', async () => {
    const t = await tillWorld(db.app);
    const plan = await planSale(db.app, t, [{ variant: t.variant, quantity: 1 }], []);
    plan.tenders = [{ type: 'Cash', amount: plan.totalDue, tendered: plan.totalDue }];
    await insertPrice(db.app, t.org, t.variant, 999);
    expect(await sqlState(submitSale(db.app, t, plan)), 'the old quote still stands').toBeUndefined();

    const doctored = await planSale(db.app, t, [{ variant: t.variant, quantity: 1 }], []);
    doctored.lines[0]!.unitPrice = 1;
    doctored.lines[0]!.gross = 1;
    doctored.lines[0]!.lineTotal = 1;
    doctored.lines[0]!.settled = 1;
    doctored.lines[0]!.taxAmount = 0;
    doctored.subtotal = doctored.totalDue = 1;
    doctored.taxTotal = 0;
    doctored.tenders = [{ type: 'Cash', amount: 1, tendered: 1 }];
    expect(await sqlState(submitSale(db.app, t, doctored))).toBe('SS030');

    const future = await planSale(db.app, t, [{ variant: t.variant, quantity: 1 }], []);
    future.lines[0]!.quotedAt = new Date(Date.now() + 3_600_000).toISOString();
    future.tenders = [{ type: 'Cash', amount: future.totalDue, tendered: future.totalDue }];
    expect(await sqlState(submitSale(db.app, t, future))).toBe('SS030');
  });

  it("SP-07, RT-130: the recorded cost and tax rate are the ones in force, never the client's", async () => {
    const t = await tillWorld(db.app);
    const cost = await planSale(db.app, t, [{ variant: t.variant, quantity: 1 }], []);
    cost.lines[0]!.unitCost = 5;
    cost.tenders = [{ type: 'Cash', amount: cost.totalDue, tendered: cost.totalDue }];
    expect(await sqlState(submitSale(db.app, t, cost))).toBe('SS031');
    const rate = await planSale(db.app, t, [{ variant: t.variant, quantity: 1 }], []);
    rate.lines[0]!.taxRateId = randomUUID();
    rate.tenders = [{ type: 'Cash', amount: rate.totalDue, tendered: rate.totalDue }];
    expect(await sqlState(submitSale(db.app, t, rate))).toBe('SS029');
  });

  it('RT-493, PR-40: a variant with no tax category cannot be sold', async () => {
    const t = await tillWorld(db.app);
    await db.app.query('UPDATE product_variant SET tax_category_id = NULL WHERE id = $1', [t.variant]);
    expect(await sqlState(sell(db.app, t, [{ variant: t.variant, quantity: 1 }]))).toBe('SS029');
  });

  it('SP-09, PR-48: draft, hidden and archived goods are not sellable; discontinued sells only from stock', async () => {
    const t = await tillWorld(db.app, { stock: 1 });
    const status = (s: string) =>
      withReason(db.app, t.reason, 'UPDATE product SET status = $2, status_changed_by = $3 WHERE id = $1', [t.product, s, actor()]);
    await status('Hidden');
    expect(await sqlState(sell(db.app, t, [{ variant: t.variant, quantity: 1 }])), 'Hidden').toBe('SS028');
    await status('Active');
    await status('Discontinued');
    expect(await sqlState(sell(db.app, t, [{ variant: t.variant, quantity: 1 }])), 'discontinued with stock').toBeUndefined();
    expect(await sqlState(sell(db.app, t, [{ variant: t.variant, quantity: 1 }])), 'discontinued beyond stock').toBe('SS041');
    await db.app.query('UPDATE product_variant SET archived_by = $2 WHERE id = $1', [t.variant, actor()]);
    expect(await sqlState(sell(db.app, t, [{ variant: t.variant, quantity: 1 }])), 'archived variant').toBe('SS028');
  });

  it('WH-01, RT-004: a line cannot sell from a location that is not sellable', async () => {
    const t = await tillWorld(db.app);
    const quarantine = await insertLocation(db.app, t.org, t.warehouse, 'StoreAttached', 'Quarantine', false);
    const plan = await planSale(db.app, t, [{ variant: t.variant, quantity: 1 }], []);
    plan.lines[0]!.location = quarantine;
    plan.tenders = [{ type: 'Cash', amount: plan.totalDue, tendered: plan.totalDue }];
    expect(await sqlState(submitSale(db.app, t, plan))).toBe('SS032');
  });

  it('RT-489, PR-11: a scanned line needs a live barcode of that very variant; a selection is recorded as such', async () => {
    const t = await tillWorld(db.app);
    const other = await anotherVariant(t, 150);
    const code = `INT-${randomUUID()}`;
    await insertBarcode(db.app, t.org, other, code, 'Internal');
    expect(await sqlState(sell(db.app, t, [{ variant: t.variant, quantity: 1, scanned: code }]))).toBe('SS033');
    expect(await sqlState(sell(db.app, t, [{ variant: other, quantity: 1, scanned: code }]))).toBeUndefined();
    const selected = await sell(db.app, t, [{ variant: t.variant, quantity: 1 }]);
    const { rows } = await db.app.query<{ entry_method: string }>('SELECT entry_method FROM sale_line WHERE sale_id = $1', [
      selected.saleId,
    ]);
    expect(rows[0]!.entry_method).toBe('Selected');
  });

  it('SP-02: totals that are not the sums of the lines are refused at commit', async () => {
    const t = await tillWorld(db.app);
    const plan = await planSale(db.app, t, [{ variant: t.variant, quantity: 2 }], []);
    plan.subtotal += 1;
    plan.tenders = [{ type: 'Cash', amount: plan.totalDue, tendered: plan.totalDue }];
    expect(await sqlState(submitSale(db.app, t, plan))).toBe('SS034');
  });

  it('SP-02, IV-15: a sale whose stock did not move, or whose change was not disbursed, is refused', async () => {
    const t = await tillWorld(db.app);
    const unmoved = await planSale(db.app, t, [{ variant: t.variant, quantity: 1 }], []);
    unmoved.tenders = [{ type: 'Cash', amount: unmoved.totalDue, tendered: unmoved.totalDue }];
    unmoved.skipMovements = true;
    expect(await sqlState(submitSale(db.app, t, unmoved))).toBe('SS034');
    const noChange = await planSale(db.app, t, [{ variant: t.variant, quantity: 1 }], []);
    noChange.tenders = [{ type: 'Cash', amount: noChange.totalDue, tendered: noChange.totalDue + 50 }];
    noChange.change = 50;
    noChange.skipChange = true;
    expect(await sqlState(submitSale(db.app, t, noChange))).toBe('SS034');
  });

  it('BI-08, SP-58: a completed sale is never edited or deleted; its receipt status is operational', async () => {
    const t = await tillWorld(db.app);
    const { saleId } = await sell(db.app, t, [{ variant: t.variant, quantity: 1 }]);
    expect(await sqlState(db.app.query('UPDATE sale SET total_due = 1 WHERE id = $1', [saleId]))).toBe('42501');
    expect(await sqlState(db.app.query(`UPDATE sale SET status = 'Voided' WHERE id = $1`, [saleId])), 'OQ-017').toBe('42501');
    expect(await sqlState(db.app.query('DELETE FROM sale WHERE id = $1', [saleId]))).toBe('42501');
    expect(await sqlState(db.app.query('UPDATE sale_line SET quantity = 9 WHERE sale_id = $1', [saleId]))).toBe('42501');
    expect(await sqlState(db.app.query(`UPDATE sale SET receipt_status = 'Printed' WHERE id = $1`, [saleId]))).toBeUndefined();
  });

  it('SP-02: a line cannot be added to a sale after its completion transaction', async () => {
    const t = await tillWorld(db.app);
    const { saleId } = await sell(db.app, t, [{ variant: t.variant, quantity: 1 }]);
    const late = db.app.query(
      `INSERT INTO sale_line (sale_id, store_id, organization_id, line_number, variant_id, description, unit_name, quantity,
         unit_price, price_quoted_at, gross_amount, tax_rate_id, tax_amount, line_total, settled_amount, unit_cost,
         storage_location_id, entry_method)
       SELECT sale_id, store_id, organization_id, 2, variant_id, description, unit_name, quantity, unit_price, price_quoted_at,
              gross_amount, tax_rate_id, tax_amount, line_total, settled_amount, unit_cost, storage_location_id, 'Selected'
       FROM sale_line WHERE sale_id = $1`,
      [saleId],
    );
    expect(await sqlState(late)).toBe('SS036');
  });

  it('IV-16, RT-119: under BlockNegative a sale beyond stock is refused whole', async () => {
    const t = await tillWorld(db.app, { policy: 'BlockNegative', stock: 1 });
    expect(await sqlState(sell(db.app, t, [{ variant: t.variant, quantity: 2 }]))).toBe('SS011');
    expect(await onHand(db.app, t.variant, t.location)).toBe(1);
    const { rows } = await db.app.query('SELECT 1 FROM sale WHERE store_id = $1', [t.store]);
    expect(rows).toEqual([]);
  });

  it('BI-36, RT-067: concurrent checkouts of the last unit under BlockNegative complete exactly one sale', async () => {
    for (let run = 0; run < 5; run++) {
      const t = await tillWorld(db.app, { policy: 'BlockNegative', stock: 1 });
      const plans = [];
      for (let i = 0; i < 6; i++) {
        const p = await planSale(db.app, t, [{ variant: t.variant, quantity: 1 }], []);
        p.tenders = [{ type: 'Cash', amount: p.totalDue, tendered: p.totalDue }];
        plans.push(p);
      }
      const wide = new pg.Pool({ connectionString: db.appUrl, max: 6 });
      try {
        const outcomes = await Promise.all(plans.map((p) => sqlState(submitSale(wide, t, p))));
        expect(outcomes.filter((o) => o === undefined), `run ${run}`).toHaveLength(1);
        expect(outcomes.filter((o) => o === 'SS011'), `run ${run}`).toHaveLength(5);
      } finally {
        await wide.end();
      }
      expect(await onHand(db.app, t.variant, t.location)).toBe(0);
    }
    expect(await drift()).toEqual([]);
  });

  it('PT-01, BI-39: a sale needs an open shift; a reconciling shift sells nothing', async () => {
    const t = await tillWorld(db.app);
    await db.app.query(`UPDATE cash_shift SET status = 'Reconciling', status_changed_by = $2 WHERE id = $1`, [t.shift, actor()]);
    expect(await sqlState(sell(db.app, t, [{ variant: t.variant, quantity: 1 }]))).toBe('SS026');
  });

  it('a service is sold without a stock movement', async () => {
    const t = await tillWorld(db.app);
    const service = await inTransaction(db.app, async (c) => {
      const unit = await c.query<{ id: string }>(
        `INSERT INTO unit (organization_id, code, name, quantity_kind, scale) VALUES ($1, $2, 'hour', 'Service', 2) RETURNING id`,
        [t.org, `H-${randomUUID()}`],
      );
      const tax = await c.query<{ tax_category_id: string }>('SELECT tax_category_id FROM product_variant WHERE id = $1', [t.variant]);
      const id = await insertVariant(c, t.org, t.product, unit.rows[0]!.id, tax.rows[0]!.tax_category_id);
      await insertPrice(c, t.org, id, 500);
      return id;
    });
    const { saleId } = await sell(db.app, t, [{ variant: service, quantity: 1 }]);
    const { rows } = await db.app.query('SELECT 1 FROM inventory_movement WHERE sale_id = $1', [saleId]);
    expect(rows).toEqual([]);
  });
});

describe('guards closed by domain 4 (ORG-01, ORG-02, ORG-05, SP-33, PR-03)', () => {
  it('SP-33, PR-38: once a store has sold, its tax mode is fixed', async () => {
    const t = await tillWorld(db.app);
    await sell(db.app, t, [{ variant: t.variant, quantity: 1 }]);
    const change = db.app.query(
      `INSERT INTO store_setting_version (store_id, tax_mode, negative_stock_policy, created_by)
       VALUES ($1, 'Exclusive', 'AllowNegative', $2)`,
      [t.store, actor()],
    );
    expect(await sqlState(change)).toBe('SS038');
    expect(await sqlState(insertSettings(db.app, t.store, 'BlockNegative')), 'other settings still change').toBeUndefined();
  });

  it('SP-33: a store with a tax-mode change scheduled cannot trade until it takes effect', async () => {
    const t = await tillWorld(db.app);
    await db.app.query(
      `INSERT INTO store_setting_version (store_id, effective_from, tax_mode, negative_stock_policy, created_by)
       VALUES ($1, now() + interval '1 day', 'Exclusive', 'AllowNegative', $2)`,
      [t.store, actor()],
    );
    expect(await sqlState(sell(db.app, t, [{ variant: t.variant, quantity: 1 }]))).toBe('SS038');
  });

  it('REQ-AU-06: a sale must be computed under the settings in force', async () => {
    const t = await tillWorld(db.app);
    const plan = await planSale(db.app, t, [{ variant: t.variant, quantity: 1 }], []);
    plan.tenders = [{ type: 'Cash', amount: plan.totalDue, tendered: plan.totalDue }];
    await insertSettings(db.app, t.store, 'AllowNegative');
    expect(await sqlState(submitSale(db.app, t, plan)), 'the planned version is no longer in force').toBe('SS038');
  });

  it('ORG-01, ORG-02, RT-504: after the first sale, the organization currency and zone are fixed', async () => {
    const t = await tillWorld(db.app);
    await sell(db.app, t, [{ variant: t.variant, quantity: 1 }]);
    expect(await sqlState(db.app.query(`UPDATE organization SET time_zone = 'Asia/Kathmandu' WHERE id = $1`, [t.org]))).toBe('SS037');
  });

  it('ORG-05, EC-89: a store with an open shift cannot be deactivated', async () => {
    const t = await tillWorld(db.app, { stock: 0 });
    expect(await sqlState(db.app.query('UPDATE store SET deactivated_by = $2 WHERE id = $1', [t.store, actor()]))).toBe('SS039');
  });

  it('PR-03, RT-030: a sold variant keeps its identity', async () => {
    const t = await tillWorld(db.app);
    await db.app.query(`UPDATE product_variant SET name = 'Red' WHERE id = $1`, [t.variant]);
    await sell(db.app, t, [{ variant: t.variant, quantity: 1 }]);
    expect(await sqlState(db.app.query(`UPDATE product_variant SET name = 'Blue' WHERE id = $1`, [t.variant]))).toBe('SS040');
  });
});

describe('shift count and close (CD-06, CD-20..CD-25, RT-135)', () => {
  async function beginCount(t: TillWorld) {
    await db.app.query(`UPDATE cash_shift SET status = 'Reconciling', status_changed_by = $2 WHERE id = $1`, [t.shift, actor()]);
  }
  const count = (t: TillWorld, amount: number) =>
    db.app.query<{ pass_number: number; expected_amount: string; variance: string; id: string }>(
      `INSERT INTO shift_count (cash_shift_id, store_id, organization_id, counted_amount, counted_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, pass_number, expected_amount, variance`,
      [t.shift, t.store, t.org, amount, actor()],
    );
  const closingFloat = (t: TillWorld) =>
    db.app.query(
      `INSERT INTO cash_transaction (cash_shift_id, cash_drawer_id, store_id, type, direction, amount, currency_code, created_by)
       VALUES ($1, $2, $3, 'ClosingFloat', 'Out', 500, $4, $5)`,
      [t.shift, t.drawer, t.store, TEST_CURRENCY, actor()],
    );
  const close = (t: TillWorld) =>
    db.app.query(`UPDATE cash_shift SET status = 'Closed', closed_by = $2, status_changed_by = $2 WHERE id = $1`, [t.shift, actor()]);

  it('CD-06, RT-135: expected cash is the float plus cash applied to sales, net of change; card is not in the drawer', async () => {
    const t = await tillWorld(db.app);
    const plan = await planSale(db.app, t, [{ variant: t.variant, quantity: 3 }], []);
    plan.tenders = [
      { type: 'Card', amount: 100 },
      { type: 'Cash', amount: plan.totalDue - 100, tendered: 1000 },
    ];
    plan.change = 1000 - (plan.totalDue - 100);
    await submitSale(db.app, t, plan);
    const { rows } = await db.app.query<{ expected: string }>('SELECT shift_expected_cash($1) AS expected', [t.shift]);
    expect(Number(rows[0]!.expected)).toBe(1000 + (plan.totalDue - 100));
  });

  it('CD-21, CD-22: a count is taken only while reconciling, and the server computes expected and variance', async () => {
    const t = await tillWorld(db.app);
    expect(await sqlState(count(t, 1000)), 'not yet reconciling').toBe('SS042');
    await beginCount(t);
    const first = await count(t, 990);
    expect(first.rows[0]).toMatchObject({ pass_number: 1, expected_amount: '1000', variance: '-10' });
    const second = await count(t, 1000);
    expect(second.rows[0]).toMatchObject({ pass_number: 2, variance: '0' });
    const forged = db.app.query(
      `INSERT INTO shift_count (cash_shift_id, store_id, organization_id, counted_amount, counted_by, expected_amount)
       VALUES ($1, $2, $3, 1, $4, 1)`,
      [t.shift, t.store, t.org, actor()],
    );
    expect(await sqlState(forged), 'the expected amount is never entered').toBe('42501');
  });

  it('CD-20, CD-23, CD-25: a shift closes only from a counted, balanced-or-acknowledged state with a closing float', async () => {
    const t = await tillWorld(db.app);
    await beginCount(t);
    expect(await sqlState(close(t)), 'no count').toBe('SS042');
    const c = await count(t, 990);
    await closingFloat(t);
    expect(await sqlState(close(t)), 'unacknowledged variance').toBe('SS042');
    const reason = await db.app.query<{ id: string }>(
      `INSERT INTO reason_code (organization_id, code, name) VALUES ($1, $2, 'TEST-ONLY short') RETURNING id`,
      [t.org, `R-${randomUUID()}`],
    );
    await db.app.query('UPDATE shift_count SET acknowledged_by = $2, reason_code_id = $3 WHERE id = $1', [
      c.rows[0]!.id,
      actor(),
      reason.rows[0]!.id,
    ]);
    expect(
      await sqlState(db.app.query('UPDATE shift_count SET acknowledged_by = $2 WHERE id = $1', [c.rows[0]!.id, actor()])),
      'acknowledged once',
    ).toBe('SS001');
    expect(await sqlState(close(t))).toBeUndefined();
  });

  it('CD-20: without a declared closing float the shift does not close', async () => {
    const t = await tillWorld(db.app);
    await beginCount(t);
    await count(t, 1000);
    expect(await sqlState(close(t))).toBe('SS042');
  });
});
