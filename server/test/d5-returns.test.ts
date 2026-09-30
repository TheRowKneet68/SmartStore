import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, inTransaction, sqlState, type TestDb } from './db.ts';
import {
  actor,
  addReturnLine,
  approveRefund,
  capturedPayment,
  cashRefund,
  type CustomerReturn,
  type Disposition,
  draftRefund,
  draftReturn,
  ensureTestCurrency,
  insertLocation,
  insertReasonCode,
  onHand,
  payOutRefund,
  planSale,
  postReturn,
  refundTax,
  returnGoods,
  sell,
  setRefundStatus,
  type SoldLine,
  soldLines,
  submitSale,
  TEST_CURRENCY,
  tillWorld,
  type TillWorld,
} from './fixtures.ts';

/** Domain 5 — Returns / Refunds. Design: docs/database/D5-RETURNS-REFUNDS.md */

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
  await ensureTestCurrency(db.owner);
});
afterAll(async () => {
  await db.drop();
});

const ledgerDrift = async () => (await db.app.query('SELECT * FROM inventory_ledger_drift()')).rows;
const counterDrift = async (saleId: string) =>
  (await db.app.query<{ problem: string }>('SELECT * FROM sale_counter_drift() WHERE sale_id = $1', [saleId])).rows;

/** The error a query raised, with its structured detail, or an empty object if it succeeded. */
async function sqlError(run: Promise<unknown>): Promise<{ code?: string; detail?: string }> {
  try {
    await run;
    return {};
  } catch (error) {
    return error as { code?: string; detail?: string };
  }
}

interface Shop extends TillWorld {
  quarantine: string;
  damaged: string;
  expired: string;
}

/** A trading store (10 on hand at its sellable Default location) with a Quarantine, a Damaged and an ExpiredHold location. */
async function shop(): Promise<Shop> {
  const t = await tillWorld(db.app, { stock: 10 });
  const at = (type: string) => insertLocation(db.app, t.org, t.warehouse, 'StoreAttached', type, false);
  return { ...t, quarantine: await at('Quarantine'), damaged: await at('Damaged'), expired: await at('ExpiredHold') };
}

/** One sale of `quantity` units at 100 each, TEST-ONLY 10% inclusive tax: 3 units are 300 with 27 tax. */
async function soldShop(quantity = 3, tender: 'Cash' | 'Card' = 'Cash'): Promise<{ t: Shop; saleId: string; line: SoldLine }> {
  const t = await shop();
  const { saleId } = await sell(db.app, t, [{ variant: t.variant, quantity }], tender);
  const [line] = await soldLines(db.app, saleId);
  return { t, saleId, line: line! };
}

const saleStatus = async (saleId: string) =>
  (await db.app.query<{ status: string }>('SELECT status FROM sale WHERE id = $1', [saleId])).rows[0]!.status;

const counters = async (lineId: string) =>
  (
    await db.app.query<{ returned_quantity: string; refunded_amount: string; refunded_tax_amount: string }>(
      'SELECT returned_quantity, refunded_amount, refunded_tax_amount FROM sale_line WHERE id = $1',
      [lineId],
    )
  ).rows[0]!;

const returnLineIds = async (r: CustomerReturn) =>
  (await db.app.query<{ id: string }>('SELECT id FROM customer_return_line WHERE customer_return_id = $1', [r.id])).rows.map((x) => x.id);

const post = (c: pg.PoolClient, r: CustomerReturn, poster = actor()) =>
  c.query(`UPDATE customer_return SET status = 'Posted', posted_by = $2, status_changed_by = $2 WHERE id = $1`, [r.id, poster]);

/** Inserts one movement for a return line, as a posting would, with the pieces a test wants to get wrong. */
async function returnMovement(
  c: pg.PoolClient,
  t: TillWorld,
  r: CustomerReturn,
  lineId: string,
  m: { type?: string; disposition?: string | null; location?: string } = {},
) {
  const tx = await c.query<{ id: string }>('INSERT INTO inventory_transaction (store_id, created_by) VALUES ($1, $2) RETURNING id', [t.store, actor()]);
  await c.query(
    `INSERT INTO inventory_movement (inventory_transaction_id, store_id, organization_id, variant_id, storage_location_id,
       movement_type, direction, quantity, customer_return_id, customer_return_line_id, disposition)
     VALUES ($1, $2, $3, $4, $5, $6, 'In', 1, $7, $8, $9)`,
    [tx.rows[0]!.id, t.store, t.org, t.variant, m.location ?? t.location, m.type ?? 'SALE_RETURN', r.id, lineId,
      m.disposition === undefined ? 'Sellable' : m.disposition],
  );
}

const submit = (id: string, who = actor()) =>
  db.app.query(`UPDATE refund SET status = 'PendingApproval', submitted_by = $2, status_changed_by = $2 WHERE id = $1`, [id, who]);

async function archivedReason(org: string): Promise<string> {
  const id = await insertReasonCode(db.app, org);
  await db.app.query('UPDATE reason_code SET archived_by = $2 WHERE id = $1', [id, actor()]);
  return id;
}

describe('returns: goods come back against a sold line (RR-08, RR-13, RR-14, RR-17)', () => {
  it('RR-14, RR-17, SP-66, RT-148: a posted return brings the goods back, counts them on its line, and the sale follows its counters', async () => {
    const { t, saleId, line } = await soldShop(3);
    expect(await onHand(db.app, t.variant, t.location)).toBe(7);

    const r = await returnGoods(db.app, t, saleId, [{ line, quantity: 1 }]);
    expect(await onHand(db.app, t.variant, t.location)).toBe(8);
    expect((await counters(line.id)).returned_quantity).toBe('1.0000');
    expect(await saleStatus(saleId)).toBe('PartiallyReturned');
    const { rows } = await db.app.query<{ status: string; business_date: Date | null; document_number: string }>(
      'SELECT status, business_date, document_number FROM customer_return WHERE id = $1',
      [r.id],
    );
    expect(rows[0]!.status).toBe('Posted');
    expect(rows[0]!.business_date).not.toBeNull();
    expect(Number(rows[0]!.document_number)).toBeGreaterThan(0);
    const moves = await db.app.query('SELECT movement_type, disposition FROM inventory_movement WHERE customer_return_id = $1', [r.id]);
    expect(moves.rows).toEqual([{ movement_type: 'SALE_RETURN', disposition: 'Sellable' }]);

    await returnGoods(db.app, t, saleId, [{ line, quantity: 2 }]);
    expect(await onHand(db.app, t.variant, t.location)).toBe(10);
    expect(await saleStatus(saleId)).toBe('Returned');
    expect(await ledgerDrift()).toEqual([]);
    expect(await counterDrift(saleId)).toEqual([]);
  });

  it('SP-66, s22.6: a return of everything at once moves the sale through PartiallyReturned to Returned', async () => {
    const { t, saleId, line } = await soldShop(3);
    await returnGoods(db.app, t, saleId, [{ line, quantity: 3 }]);
    expect(await saleStatus(saleId)).toBe('Returned');
  });

  it('RR-14, RT-148, s12.1: a draft never holds more than is still returnable, and the refusal names the remainder', async () => {
    const { t, saleId, line } = await soldShop(3);
    const r = await draftReturn(db.app, t, saleId, [{ line, quantity: 2 }]);
    const over = await sqlError(addReturnLine(db.app, t, r, { line, quantity: 2 }));
    expect(over.code).toBe('SS046');
    expect(Number(over.detail)).toBe(1);
    expect(await sqlState(addReturnLine(db.app, t, r, { line, quantity: 1, disposition: 'Quarantine', location: t.quarantine }))).toBeUndefined();
  });

  it('RR-14, BI-06: two drafts that each fit cannot both post; posting takes the bound and names the remainder', async () => {
    const { t, saleId, line } = await soldShop(3);
    const a = await draftReturn(db.app, t, saleId, [{ line, quantity: 2 }]);
    const b = await draftReturn(db.app, t, saleId, [{ line, quantity: 2 }]);
    await postReturn(db.app, a);
    const refused = await sqlError(postReturn(db.app, b));
    expect(refused.code).toBe('SS046');
    expect(Number(refused.detail)).toBe(1);
    expect((await counters(line.id)).returned_quantity).toBe('2.0000');
    expect(await onHand(db.app, t.variant, t.location)).toBe(9);
  });

  it('RR-14, RT-148: fifty concurrent returns of one line: exactly the sold quantity comes back', async () => {
    const { t, saleId, line } = await soldShop(5);
    const drafts: CustomerReturn[] = [];
    for (let i = 0; i < 50; i++) drafts.push(await draftReturn(db.app, t, saleId, [{ line, quantity: 1 }]));
    const wide = new pg.Pool({ connectionString: db.appUrl, max: 10 });
    try {
      const outcomes = await Promise.all(drafts.map((r) => sqlState(postReturn(wide, r))));
      expect(outcomes.filter((o) => o === undefined)).toHaveLength(5);
      expect(outcomes.filter((o) => o === 'SS046')).toHaveLength(45);
    } finally {
      await wide.end();
    }
    expect((await counters(line.id)).returned_quantity).toBe('5.0000');
    expect(await onHand(db.app, t.variant, t.location)).toBe(10);
    expect(await saleStatus(saleId)).toBe('Returned');
    expect(await ledgerDrift()).toEqual([]);
    expect(await counterDrift(saleId)).toEqual([]);
  });

  it('RR-15, RR-16, RT-149: a replayed return, or a replayed line, is refused by its operation id', async () => {
    const { t, saleId, line } = await soldShop(3);
    const op = randomUUID();
    const r = await draftReturn(db.app, t, saleId, [], op);
    expect(await sqlState(draftReturn(db.app, t, saleId, [], op))).toBe('23505');
    const lineOp = randomUUID();
    await addReturnLine(db.app, t, r, { line, quantity: 1 }, lineOp);
    expect(await sqlState(addReturnLine(db.app, t, r, { line, quantity: 1 }, lineOp))).toBe('23505');
  });

  it("RR-08, RR-13, BI-16: a return line names a line of the return's own sale, with that line's variant", async () => {
    const { t, saleId, line } = await soldShop(3);
    const other = await sell(db.app, t, [{ variant: t.variant, quantity: 1 }]);
    const [otherLine] = await soldLines(db.app, other.saleId);
    const r = await draftReturn(db.app, t, saleId, []);
    expect(await sqlState(addReturnLine(db.app, t, r, { line: otherLine!, quantity: 1 })), 'another sale').toBe('23503');
    const crossed = db.app.query(
      `INSERT INTO customer_return_line (customer_return_id, store_id, organization_id, sale_id, sale_line_id, variant_id,
         quantity, disposition, storage_location_id, client_operation_id)
       VALUES ($1, $2, $3, $4, $5, $6, 1, 'Sellable', $7, $8)`,
      [r.id, t.store, t.org, other.saleId, otherLine!.id, otherLine!.variant, t.location, randomUUID()],
    );
    expect(await sqlState(crossed), "a line claiming another sale than its return's").toBe('23503');
    expect(await sqlState(addReturnLine(db.app, t, r, { line: { ...line, variant: randomUUID() }, quantity: 1 })), 'another variant').toBe('23503');
  });

  it('RR-12: a discontinued product is still returnable', async () => {
    const { t, saleId, line } = await soldShop(3);
    await db.app.query(`UPDATE product SET status = 'Discontinued', status_changed_by = $2 WHERE id = $1`, [t.product, actor()]);
    expect(await sqlState(returnGoods(db.app, t, saleId, [{ line, quantity: 1 }]))).toBeUndefined();
  });
});

describe('disposition (RR-17, RR-19, BE-36)', () => {
  it('RR-17, BI-17, RT-151: a return line always has one of the four dispositions', async () => {
    const { t, saleId, line } = await soldShop(3);
    const r = await draftReturn(db.app, t, saleId, []);
    const insert = (disposition: string | null) =>
      db.app.query(
        `INSERT INTO customer_return_line (customer_return_id, store_id, organization_id, sale_id, sale_line_id, variant_id,
           quantity, disposition, storage_location_id, client_operation_id)
         VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9)`,
        [r.id, t.store, t.org, saleId, line.id, line.variant, disposition, t.quarantine, randomUUID()],
      );
    expect(await sqlState(insert(null))).toBe('23502');
    expect(await sqlState(insert('Resellable'))).toBe('23514');
  });

  it('RR-19, WH-01, BE-36: each disposition goes to its own kind of location, and only Sellable to a sellable one', async () => {
    const { t, saleId, line } = await soldShop(4);
    const r = await draftReturn(db.app, t, saleId, []);
    const wrong: [Disposition, string][] = [
      ['Sellable', t.quarantine],
      ['Quarantine', t.location],
      ['Damaged', t.quarantine],
      ['Expired', t.damaged],
    ];
    for (const [disposition, location] of wrong) {
      expect(await sqlState(addReturnLine(db.app, t, r, { line, quantity: 1, disposition, location })), disposition).toBe('SS047');
    }
    const right: [Disposition, string][] = [
      ['Sellable', t.location],
      ['Quarantine', t.quarantine],
      ['Damaged', t.damaged],
      ['Expired', t.expired],
    ];
    for (const [disposition, location] of right) await addReturnLine(db.app, t, r, { line, quantity: 1, disposition, location });
    await postReturn(db.app, r);
    expect(await onHand(db.app, t.variant, t.location)).toBe(7);
    for (const location of [t.quarantine, t.damaged, t.expired]) expect(await onHand(db.app, t.variant, location)).toBe(1);
    const { rows } = await db.app.query<{ disposition: string; storage_location_id: string }>(
      'SELECT disposition, storage_location_id FROM inventory_movement WHERE customer_return_id = $1',
      [r.id],
    );
    expect(Object.fromEntries(rows.map((x) => [x.disposition, x.storage_location_id]))).toEqual(Object.fromEntries(right));
  });

  it("BE-36, RT-096: a return movement names its line's disposition, proven by key", async () => {
    const { t, saleId, line } = await soldShop(3);
    const r = await draftReturn(db.app, t, saleId, [{ line, quantity: 1 }]);
    const [lineId] = await returnLineIds(r);
    const posting = (disposition: string | null) =>
      inTransaction(db.app, async (c) => {
        await post(c, r);
        await returnMovement(c, t, r, lineId!, { disposition });
      });
    expect(await sqlState(posting('Damaged')), "a disposition other than the line's").toBe('23503');
    expect(await sqlState(posting(null)), 'no disposition').toBe('23514');
    expect(await sqlState(posting('Sellable'))).toBeUndefined();
  });
});

describe('posting (BI-27, SM-38, SM-43)', () => {
  it('BI-27, IV-14: a return moves stock only as SALE_RETURN, and only once it is posted', async () => {
    const { t, saleId, line } = await soldShop(3);
    const r = await draftReturn(db.app, t, saleId, [{ line, quantity: 1 }]);
    const [lineId] = await returnLineIds(r);
    const draft = inTransaction(db.app, (c) => returnMovement(c, t, r, lineId!));
    expect(await sqlState(draft), 'a draft').toBe('SS016');
    const wrongType = inTransaction(db.app, async (c) => {
      await post(c, r);
      await returnMovement(c, t, r, lineId!, { type: 'FOUND' });
    });
    expect(await sqlState(wrongType), 'not SALE_RETURN').toBe('SS016');
    expect(await onHand(db.app, t.variant, t.location)).toBe(7);
  });

  it('SM-43, RT-153, BI-04: a return posted without its movements, or without lines, fails at commit', async () => {
    const { t, saleId, line } = await soldShop(3);
    const r = await draftReturn(db.app, t, saleId, [{ line, quantity: 1 }]);
    expect(await sqlState(postReturn(db.app, r, { skipMovements: true })), 'no movements').toBe('SS022');
    const empty = await draftReturn(db.app, t, saleId, []);
    expect(await sqlState(postReturn(db.app, empty)), 'no lines').toBe('SS022');
    expect((await counters(line.id)).returned_quantity).toBe('0.0000');
  });

  it('RR-15, BI-07: a return line brings its goods back once', async () => {
    const { t, saleId, line } = await soldShop(3);
    const r = await draftReturn(db.app, t, saleId, [{ line, quantity: 1 }]);
    const [lineId] = await returnLineIds(r);
    const twice = inTransaction(db.app, async (c) => {
      await post(c, r);
      await returnMovement(c, t, r, lineId!);
      await returnMovement(c, t, r, lineId!);
    });
    expect(await sqlState(twice)).toBe('23505');
  });

  it('SM-38, BI-08: a posted return keeps its lines and its record, and is never un-posted', async () => {
    const { t, saleId, line } = await soldShop(3);
    const r = await returnGoods(db.app, t, saleId, [{ line, quantity: 1 }]);
    expect(await sqlState(addReturnLine(db.app, t, r, { line, quantity: 1 })), 'add a line').toBe('SS018');
    expect(await sqlState(db.app.query('DELETE FROM customer_return_line WHERE customer_return_id = $1', [r.id])), 'delete a line').toBe('SS018');
    expect(await sqlState(db.app.query('UPDATE customer_return SET late_approved_by = $2 WHERE id = $1', [r.id, actor()])), 'rewrite who').toBe('SS001');
    for (const status of ['Draft', 'Cancelled', 'Settled', 'Closed']) {
      const move = db.app.query('UPDATE customer_return SET status = $2, status_changed_by = $3 WHERE id = $1', [r.id, status, actor()]);
      expect(await sqlState(move), status).toBe('SS004');
    }
  });

  it('SM-42, BI-25, BI-40: a draft return is cancelled only with a live reason, and moves nothing', async () => {
    const { t, saleId, line } = await soldShop(3);
    const r = await draftReturn(db.app, t, saleId, [{ line, quantity: 1 }]);
    const cancel = (reason: string | null) =>
      db.app.query(`UPDATE customer_return SET status = 'Cancelled', cancel_reason_code_id = $2, status_changed_by = $3 WHERE id = $1`, [
        r.id,
        reason,
        actor(),
      ]);
    expect(await sqlState(cancel(null)), 'no reason').toBe('23514');
    expect(await sqlState(cancel(await archivedReason(t.org))), 'an archived reason').toBe('SS024');
    expect(await sqlState(cancel(t.reason))).toBeUndefined();
    expect((await counters(line.id)).returned_quantity).toBe('0.0000');
    expect(await onHand(db.app, t.variant, t.location)).toBe(7);
    expect(await sqlState(addReturnLine(db.app, t, r, { line, quantity: 1 })), 'a line on a cancelled return').toBe('SS018');
  });
});

describe('the return window (RR-10, RR-11)', () => {
  const age = (saleId: string, days: number) =>
    db.owner.query('UPDATE sale SET business_date = business_date - $2::integer WHERE id = $1', [saleId, days]);

  it('RR-10, RR-11, RT-150: past the window a return needs an approver and a reason, and the refusal names the day the window closed', async () => {
    const { t, saleId, line } = await soldShop(3);
    await age(saleId, 31);
    const closes = (
      await db.app.query<{ d: string }>(`SELECT to_char(business_date + 30, 'YYYY-MM-DD') AS d FROM sale WHERE id = $1`, [saleId])
    ).rows[0]!.d;
    const r = await draftReturn(db.app, t, saleId, [{ line, quantity: 1 }]);
    const late = await sqlError(postReturn(db.app, r));
    expect(late.code).toBe('SS048');
    expect(late.detail).toBe(closes);
    await db.app.query('UPDATE customer_return SET late_approved_by = $2, late_reason_code_id = $3 WHERE id = $1', [r.id, actor(), t.reason]);
    expect(await sqlState(postReturn(db.app, r))).toBeUndefined();
  });

  it('RR-10, OQ-023: the window includes its last day', async () => {
    const { t, saleId, line } = await soldShop(3);
    await age(saleId, 30);
    expect(await sqlState(returnGoods(db.app, t, saleId, [{ line, quantity: 1 }]))).toBeUndefined();
  });

  it('RR-10: the window is the store setting in force', async () => {
    const { t, saleId, line } = await soldShop(3);
    await age(saleId, 10);
    await db.app.query(
      `INSERT INTO store_setting_version (store_id, tax_mode, negative_stock_policy, return_window_days, created_by)
       VALUES ($1, 'Inclusive', 'AllowNegative', 7, $2)`,
      [t.store, actor()],
    );
    const r = await draftReturn(db.app, t, saleId, [{ line, quantity: 1 }]);
    expect(await sqlState(postReturn(db.app, r))).toBe('SS048');
  });

  it('AP-08, BI-26: the late approver is neither the employee who opened the return nor the one who posts it', async () => {
    const { t, saleId, line } = await soldShop(3);
    await age(saleId, 31);
    const r = await draftReturn(db.app, t, saleId, [{ line, quantity: 1 }]);
    const approve = (who: string) =>
      db.app.query('UPDATE customer_return SET late_approved_by = $2, late_reason_code_id = $3 WHERE id = $1', [r.id, who, t.reason]);
    const noReason = db.app.query('UPDATE customer_return SET late_approved_by = $2 WHERE id = $1', [r.id, actor()]);
    expect(await sqlState(noReason), 'an approval without a reason').toBe('23514');
    expect(await sqlState(approve(r.createdBy)), 'the opener').toBe('23514');
    const manager = actor();
    await approve(manager);
    expect(await sqlState(postReturn(db.app, r, { poster: manager })), 'the poster').toBe('23514');
    expect(await sqlState(postReturn(db.app, r))).toBeUndefined();
  });

  it('RR-18: the pre-filled disposition is Sellable or Quarantine, and Quarantine unless set', async () => {
    const t = await shop();
    const { rows } = await db.app.query<{ d: string }>('SELECT default_return_disposition AS d FROM store_setting_version WHERE store_id = $1', [t.store]);
    expect(rows[0]!.d).toBe('Quarantine');
    const insert = (d: string) =>
      db.app.query(
        `INSERT INTO store_setting_version (store_id, tax_mode, negative_stock_policy, default_return_disposition, created_by)
         VALUES ($1, 'Inclusive', 'AllowNegative', $2, $3)`,
        [t.store, d, actor()],
      );
    expect(await sqlState(insert('Damaged'))).toBe('23514');
    expect(await sqlState(insert('Sellable'))).toBeUndefined();
  });
});

describe('refunds (RR-03, RR-22..RR-24, RR-35, PY-21..PY-27)', () => {
  it('PY-27, RT-156, CD-06: a cash refund for a return is held on its line, paid out of the drawer, and reduces the expected cash', async () => {
    const { t, saleId, line } = await soldShop(3);
    const r = await returnGoods(db.app, t, saleId, [{ line, quantity: 1 }]);
    const id = await cashRefund(db.app, t, saleId, { returnId: r.id, lines: [{ line, amount: 100 }] });
    const refund = await db.app.query('SELECT status, disbursement, tax_amount FROM refund WHERE id = $1', [id]);
    expect(refund.rows[0]).toEqual({ status: 'Completed', disbursement: 'Drawer', tax_amount: '9' });
    expect(await counters(line.id)).toEqual({ returned_quantity: '1.0000', refunded_amount: '100', refunded_tax_amount: '9' });
    const cash = await db.app.query(`SELECT amount FROM cash_transaction WHERE refund_id = $1 AND type = 'RefundFromDrawer'`, [id]);
    expect(cash.rows).toEqual([{ amount: '100' }]);
    const expected = await db.app.query<{ e: string }>('SELECT shift_expected_cash($1) AS e', [t.shift]);
    expect(Number(expected.rows[0]!.e)).toBe(1000 + 300 - 100);
    expect(await counterDrift(saleId)).toEqual([]);
  });

  it('RR-03, RR-24, RT-145, EC-02: ten concurrent refunds of the same money: one holds it, the rest are refused naming the remainder', async () => {
    const { t, saleId, line } = await soldShop(1);
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const { id } = await draftRefund(db.app, t, saleId, { reason: t.reason, lines: [{ line, amount: 100 }] });
      await approveRefund(db.app, id);
      ids.push(id);
    }
    const wide = new pg.Pool({ connectionString: db.appUrl, max: 10 });
    try {
      const outcomes = await Promise.all(ids.map((id) => sqlError(payOutRefund(wide, id))));
      expect(outcomes.filter((o) => o.code === undefined)).toHaveLength(1);
      const refused = outcomes.filter((o) => o.code === 'SS049');
      expect(refused).toHaveLength(9);
      expect(refused.every((o) => Number(o.detail) === 0)).toBe(true);
    } finally {
      await wide.end();
    }
    expect((await counters(line.id)).refunded_amount).toBe('100');
    const expected = await db.app.query<{ e: string }>('SELECT shift_expected_cash($1) AS e', [t.shift]);
    expect(Number(expected.rows[0]!.e)).toBe(1000 + 100 - 100);
  });

  it('RR-03, BI-10, PY-22: a line refunds at most what it settled, and a fully refunded sale has nothing left', async () => {
    const t = await shop();
    const { saleId } = await sell(db.app, t, [
      { variant: t.variant, quantity: 1 },
      { variant: t.variant, quantity: 2 },
    ]);
    const [one, two] = (await soldLines(db.app, saleId)) as [SoldLine, SoldLine];
    const over = await draftRefund(db.app, t, saleId, { reason: t.reason, lines: [{ line: one, amount: 150 }] });
    await approveRefund(db.app, over.id);
    const refused = await sqlError(payOutRefund(db.app, over.id));
    expect(refused.code, 'more than the line settled').toBe('SS049');
    expect(Number(refused.detail)).toBe(100);

    await cashRefund(db.app, t, saleId, { reason: t.reason, lines: [{ line: one, amount: 100 }, { line: two, amount: 200 }] });
    for (const line of [one, two]) {
      const { id } = await draftRefund(db.app, t, saleId, { reason: t.reason, lines: [{ line, amount: 1 }] });
      await approveRefund(db.app, id);
      expect((await sqlError(payOutRefund(db.app, id))).code, 'nothing left on the sale').toBe('SS049');
    }
    const { rows } = await db.app.query<{ refunded: string; due: string }>(
      `SELECT sum(l.refunded_amount)::text AS refunded, s.total_due::text AS due FROM sale s JOIN sale_line l ON l.sale_id = s.id
       WHERE s.id = $1 GROUP BY s.total_due`,
      [saleId],
    );
    expect(rows[0]!.refunded).toBe(rows[0]!.due);
  });

  it("RR-06, RR-42, RT-161: refund tax is the line's stored tax in proportion, and partial refunds add up to exactly the tax charged", async () => {
    const { t, saleId, line } = await soldShop(3);
    const wrong = await draftRefund(db.app, t, saleId, { reason: t.reason, lines: [{ line, amount: 50, tax: 4 }] });
    await approveRefund(db.app, wrong.id);
    expect((await sqlError(payOutRefund(db.app, wrong.id))).code).toBe('SS052');

    let before = { amount: 0, tax: 0 };
    for (const amount of [50, 50, 200]) {
      const tax = refundTax(line, amount, before);
      await cashRefund(db.app, t, saleId, { reason: t.reason, lines: [{ line, amount, tax }] });
      before = { amount: before.amount + amount, tax: before.tax + tax };
    }
    expect(before).toEqual({ amount: 300, tax: 27 });
    expect(await counters(line.id)).toMatchObject({ refunded_amount: '300', refunded_tax_amount: '27' });
  });

  it('RR-24, SM-40, SM-41, RT-155: a refund in flight holds its amount through failure and retry, and only cancelling releases it', async () => {
    const { t, saleId, line } = await soldShop(1, 'Card');
    const card = { method: 'OriginalTender' as const, payment: await capturedPayment(db.app, saleId), till: false, reason: t.reason };
    const first = await draftRefund(db.app, t, saleId, { ...card, lines: [{ line, amount: 100 }] });
    await approveRefund(db.app, first.id);
    await setRefundStatus(db.app, first.id, 'Processing');
    const second = await draftRefund(db.app, t, saleId, { ...card, lines: [{ line, amount: 100 }] });
    await approveRefund(db.app, second.id);
    expect(await sqlState(setRefundStatus(db.app, second.id, 'Processing')), 'while the first is in flight').toBe('SS049');

    await setRefundStatus(db.app, first.id, 'Failed');
    expect(await sqlState(setRefundStatus(db.app, second.id, 'Processing')), 'while the first has failed').toBe('SS049');
    await setRefundStatus(db.app, first.id, 'Processing');
    expect((await counters(line.id)).refunded_amount, 'a retry holds once').toBe('100');

    expect(await sqlState(setRefundStatus(db.app, first.id, 'Cancelled')), 'no reason').toBe('23514');
    await setRefundStatus(db.app, first.id, 'Cancelled', t.reason);
    expect((await counters(line.id)).refunded_amount).toBe('0');
    await setRefundStatus(db.app, second.id, 'Processing');
    expect(await counterDrift(saleId)).toEqual([]);
  });

  it('RR-23, PY-25, RT-154: a card refund goes back through the provider, recorded once, and no cash leaves the drawer for it', async () => {
    const { t, saleId, line } = await soldShop(1, 'Card');
    const card = { method: 'OriginalTender' as const, payment: await capturedPayment(db.app, saleId), reason: t.reason };
    expect(await sqlState(draftRefund(db.app, t, saleId, { ...card, lines: [{ line, amount: 100 }] })), 'a card refund with a drawer').toBe('23514');
    const { id } = await draftRefund(db.app, t, saleId, { ...card, till: false, lines: [{ line, amount: 100 }] });
    const disbursement = await db.app.query('SELECT disbursement FROM refund WHERE id = $1', [id]);
    expect(disbursement.rows[0]).toEqual({ disbursement: 'Provider' });
    await approveRefund(db.app, id);

    const payout = inTransaction(db.app, async (c) => {
      await setRefundStatus(c, id, 'Processing');
      await c.query(
        `INSERT INTO cash_transaction (cash_shift_id, cash_drawer_id, store_id, type, direction, amount, currency_code, created_by, refund_id)
         VALUES ($1, $2, $3, 'RefundFromDrawer', 'Out', 100, $4, $5, $6)`,
        [t.shift, t.drawer, t.store, TEST_CURRENCY, actor(), id],
      );
    });
    expect(await sqlState(payout), 'cash for a card refund').toBe('23503');

    const reference = `ref-${randomUUID()}`;
    await setRefundStatus(db.app, id, 'Processing');
    await db.app.query(
      `UPDATE refund SET status = 'Completed', provider_transaction_reference = $2, provider_outcome = 'Approved', status_changed_by = $3
       WHERE id = $1`,
      [id, reference, actor()],
    );
    const other = await draftRefund(db.app, t, saleId, { ...card, till: false, lines: [{ line, amount: 1 }] });
    const duplicate = db.app.query('UPDATE refund SET provider_transaction_reference = $2 WHERE id = $1', [other.id, reference]);
    expect(await sqlState(duplicate), 'the same provider transaction twice').toBe('23505');
  });

  it('RR-22, BI-09: a refund to the original tender goes back to a captured tender of the same sale, and cash to its drawer', async () => {
    const { t, saleId, line } = await soldShop(1);
    const other = await sell(db.app, t, [{ variant: t.variant, quantity: 1 }]);
    const lines = [{ line, amount: 100 }];
    const elsewhere = draftRefund(db.app, t, saleId, { method: 'OriginalTender', payment: await capturedPayment(db.app, other.saleId), reason: t.reason, lines });
    expect(await sqlState(elsewhere), "another sale's tender").toBe('SS050');
    const payment = await capturedPayment(db.app, saleId);
    expect(await sqlState(draftRefund(db.app, t, saleId, { method: 'OriginalTender', payment, till: false, reason: t.reason, lines })), 'cash without its drawer').toBe('23514');
    const { id } = await draftRefund(db.app, t, saleId, { method: 'OriginalTender', payment, reason: t.reason, lines });
    const disbursement = await db.app.query('SELECT disbursement FROM refund WHERE id = $1', [id]);
    expect(disbursement.rows[0]).toEqual({ disbursement: 'Drawer' });
    const plan = await planSale(db.app, t, [{ variant: t.variant, quantity: 1 }], []);
    plan.tenders = [{ type: 'Card', amount: plan.totalDue }];
    plan.declinedCardAttempts = 1;
    const card = await submitSale(db.app, t, plan);
    const declined = await db.app.query<{ id: string }>(
      `SELECT p.id FROM payment p JOIN sale s ON s.checkout_id = p.checkout_id WHERE s.id = $1 AND p.status = 'Declined'`,
      [card.saleId],
    );
    const [cardLine] = await soldLines(db.app, card.saleId);
    const toDeclined = draftRefund(db.app, t, card.saleId, {
      method: 'OriginalTender',
      payment: declined.rows[0]!.id,
      till: false,
      reason: t.reason,
      lines: [{ line: cardLine!, amount: 100 }],
    });
    expect(await sqlState(toDeclined), 'a declined attempt').toBe('SS050');
    const partialTill = db.app.query(
      `INSERT INTO refund (store_id, organization_id, sale_id, client_operation_id, method, cash_drawer_id, cash_shift_id,
         amount, tax_amount, currency_code, reason_code_id, created_by, status_changed_by)
       VALUES ($1, $2, $3, $4, 'Cash', $5, $6, 100, 9, $7, $8, $9, $9)`,
      [t.store, t.org, saleId, randomUUID(), t.drawer, t.shift, TEST_CURRENCY, t.reason, actor()],
    );
    expect(await sqlState(partialTill), 'a shift without its till').toBe('23514');
  });

  it('RR-35, PY-26, RT-157, BI-40: a refund with no return is goodwill: it carries a live reason and moves no stock', async () => {
    const { t, saleId, line } = await soldShop(1);
    const lines = [{ line, amount: 100 }];
    expect(await sqlState(draftRefund(db.app, t, saleId, { lines })), 'no reason').toBe('23514');
    expect(await sqlState(draftRefund(db.app, t, saleId, { reason: await archivedReason(t.org), lines })), 'an archived reason').toBe('SS024');
    await cashRefund(db.app, t, saleId, { reason: t.reason, lines });
    expect(await onHand(db.app, t.variant, t.location)).toBe(9);
  });

  it('BI-26, AP-08: every refund is approved, by someone other than the employee who drafted or submitted it', async () => {
    const { t, saleId, line } = await soldShop(1);
    const { id, createdBy } = await draftRefund(db.app, t, saleId, { reason: t.reason, lines: [{ line, amount: 100 }] });
    expect(await sqlState(setRefundStatus(db.app, id, 'Approved')), 'skip the approval').toBe('SS004');
    expect(await sqlState(setRefundStatus(db.app, id, 'Processing')), 'pay a draft').toBe('SS004');
    const submitter = actor();
    await submit(id, submitter);
    expect(await sqlState(setRefundStatus(db.app, id, 'Processing')), 'pay before approval').toBe('SS004');
    const approve = (who: string) =>
      db.app.query(`UPDATE refund SET status = 'Approved', approved_by = $2, status_changed_by = $2 WHERE id = $1`, [id, who]);
    expect(await sqlState(approve(submitter)), 'the submitter').toBe('23514');
    expect(await sqlState(approve(createdBy)), 'the drafter').toBe('23514');
    expect(await sqlState(approve(actor()))).toBeUndefined();
    for (const column of ['approved_by', 'submitted_by']) {
      const rewrite = db.app.query(`UPDATE refund SET ${column} = $2 WHERE id = $1`, [id, actor()]);
      expect(await sqlState(rewrite), `rewrite ${column}`).toBe('SS001');
    }
  });

  it('RR-43, AP-03: a refund equals its lines, and its lines are fixed once it is submitted', async () => {
    const { t, saleId, line } = await soldShop(3);
    const mismatched = await draftRefund(db.app, t, saleId, { reason: t.reason, amount: 150, lines: [{ line, amount: 100 }] });
    expect(await sqlState(submit(mismatched.id)), 'header is not its lines').toBe('SS053');
    const empty = await draftRefund(db.app, t, saleId, { reason: t.reason, amount: 100, lines: [] });
    expect(await sqlState(submit(empty.id)), 'no lines').toBe('SS053');
    const other = await sell(db.app, t, [{ variant: t.variant, quantity: 1 }]);
    const [otherLine] = await soldLines(db.app, other.saleId);
    const foreign = db.app.query(
      'INSERT INTO refund_line (refund_id, store_id, sale_id, sale_line_id, amount, tax_amount) VALUES ($1, $2, $3, $4, 1, 0)',
      [empty.id, t.store, saleId, otherLine!.id],
    );
    expect(await sqlState(foreign), "a line of another sale").toBe('23503');

    const { id } = await draftRefund(db.app, t, saleId, { reason: t.reason, lines: [{ line, amount: 100 }] });
    await submit(id);
    const add = db.app.query(
      'INSERT INTO refund_line (refund_id, store_id, sale_id, sale_line_id, amount, tax_amount) VALUES ($1, $2, $3, $4, 1, 0)',
      [id, t.store, saleId, line.id],
    );
    expect(await sqlState(add), 'add a line').toBe('SS018');
    expect(await sqlState(db.app.query('DELETE FROM refund_line WHERE refund_id = $1', [id])), 'delete a line').toBe('SS018');
  });

  it("PY-27, BI-04, RT-156: a drawer refund's payout and its completion are one event", async () => {
    const { t, saleId, line } = await soldShop(3);
    const { id } = await draftRefund(db.app, t, saleId, { reason: t.reason, lines: [{ line, amount: 100 }] });
    await approveRefund(db.app, id);
    expect(await sqlState(payOutRefund(db.app, id, { skipPayout: true })), 'completed, nothing paid out').toBe('SS053');
    expect(await sqlState(payOutRefund(db.app, id, { payout: 50 })), 'paid out the wrong amount').toBe('SS053');
    expect(await sqlState(payOutRefund(db.app, id, { skipComplete: true })), 'paid out, never completed').toBe('SS053');
    expect(await sqlState(payOutRefund(db.app, id))).toBeUndefined();
    const again = db.app.query(
      `INSERT INTO cash_transaction (cash_shift_id, cash_drawer_id, store_id, type, direction, amount, currency_code, created_by, refund_id)
       VALUES ($1, $2, $3, 'RefundFromDrawer', 'Out', 100, $4, $5, $6)`,
      [t.shift, t.drawer, t.store, TEST_CURRENCY, actor(), id],
    );
    expect(await sqlState(again), 'paid out twice').toBe('23505');
    const orphan = db.app.query(
      `INSERT INTO cash_transaction (cash_shift_id, cash_drawer_id, store_id, type, direction, amount, currency_code, created_by)
       VALUES ($1, $2, $3, 'RefundFromDrawer', 'Out', 100, $4, $5)`,
      [t.shift, t.drawer, t.store, TEST_CURRENCY, actor()],
    );
    expect(await sqlState(orphan), 'a cash refund with no refund').toBe('23514');
  });

  it('BI-09, RR-23: a completed or cancelled refund is never changed; a correction is a further refund', async () => {
    const { t, saleId, line } = await soldShop(3);
    const done = await cashRefund(db.app, t, saleId, { reason: t.reason, lines: [{ line, amount: 100 }] });
    expect(await sqlState(setRefundStatus(db.app, done, 'Failed')), 'reopen a completed refund').toBe('SS035');
    expect(await sqlState(db.app.query(`UPDATE refund SET provider_raw_code = 'X' WHERE id = $1`, [done])), 'edit one').toBe('SS035');
    const { id } = await draftRefund(db.app, t, saleId, { reason: t.reason, lines: [{ line, amount: 100 }] });
    await approveRefund(db.app, id);
    await setRefundStatus(db.app, id, 'Cancelled', t.reason);
    expect(await sqlState(setRefundStatus(db.app, id, 'Approved')), 'revive a cancelled refund').toBe('SS035');
  });

  it('RR-01, RR-35: a refund for a return pays only for lines that the posted return took back', async () => {
    const t = await shop();
    const { saleId } = await sell(db.app, t, [
      { variant: t.variant, quantity: 1 },
      { variant: t.variant, quantity: 1 },
    ]);
    const [one, two] = (await soldLines(db.app, saleId)) as [SoldLine, SoldLine];
    const r = await draftReturn(db.app, t, saleId, [{ line: one, quantity: 1 }]);
    const early = await draftRefund(db.app, t, saleId, { returnId: r.id, lines: [{ line: one, amount: 100 }] });
    await approveRefund(db.app, early.id);
    expect(await sqlState(payOutRefund(db.app, early.id)), 'the return is not posted').toBe('SS051');
    await postReturn(db.app, r);
    const unreturned = await draftRefund(db.app, t, saleId, { returnId: r.id, lines: [{ line: two, amount: 100 }] });
    await approveRefund(db.app, unreturned.id);
    expect(await sqlState(payOutRefund(db.app, unreturned.id)), 'a line the return did not take back').toBe('SS051');
    expect(await sqlState(payOutRefund(db.app, early.id))).toBeUndefined();
  });

  it('PT-03, CD-10: cash is paid out only at a till in service and not in training, during an open shift', async () => {
    const { t, saleId, line } = await soldShop(3);
    const { id } = await draftRefund(db.app, t, saleId, { reason: t.reason, lines: [{ line, amount: 100 }] });
    await approveRefund(db.app, id);
    await db.app.query(`UPDATE pos_terminal SET mode = 'Training' WHERE id = $1`, [t.terminal]);
    expect(await sqlState(payOutRefund(db.app, id)), 'a training till').toBe('SS025');
    await db.app.query(`UPDATE pos_terminal SET mode = 'Standard' WHERE id = $1`, [t.terminal]);
    await db.app.query(`UPDATE cash_shift SET status = 'Reconciling', status_changed_by = $2 WHERE id = $1`, [t.shift, actor()]);
    expect(await sqlState(payOutRefund(db.app, id)), 'a shift being counted').toBe('SS026');
  });

  it('BI-28, PY-39: a refund request replayed with the same operation id is refused', async () => {
    const { t, saleId, line } = await soldShop(1);
    const request = { operationId: randomUUID(), reason: t.reason, lines: [{ line, amount: 100 }] };
    await draftRefund(db.app, t, saleId, request);
    expect(await sqlState(draftRefund(db.app, t, saleId, request))).toBe('23505');
  });
});

describe('the counters are the truth (SP-66, SM-35a)', () => {
  it('SP-66, SM-35a: the counters and the status rebuild exactly from the documents, and a disagreement is reported, not repaired', async () => {
    const { t, saleId, line } = await soldShop(3);
    const r = await returnGoods(db.app, t, saleId, [{ line, quantity: 1 }]);
    await cashRefund(db.app, t, saleId, { returnId: r.id, lines: [{ line, amount: 100 }] });
    expect(await counterDrift(saleId)).toEqual([]);

    await db.owner.query('UPDATE sale_line SET returned_quantity = 2, refunded_amount = 50, refunded_tax_amount = 5 WHERE id = $1', [line.id]);
    await db.owner.query(`UPDATE sale SET status = 'Returned' WHERE id = $1`, [saleId]);
    const problems = (await counterDrift(saleId)).map((x) => x.problem).sort();
    expect(problems).toEqual(
      [
        'refunded amount differs from the refunds holding it',
        'refunded tax differs from the refunds holding it',
        'returned quantity differs from the posted returns',
        'sale status is Returned but its returns make it PartiallyReturned',
      ].sort(),
    );
    expect((await counters(line.id)).returned_quantity, 'reported, not repaired').toBe('2.0000');
  });

  it('SP-66, BI-08: the application writes neither the line counters nor the sale status', async () => {
    const { saleId, line } = await soldShop(1);
    for (const column of ['returned_quantity', 'refunded_amount', 'refunded_tax_amount']) {
      expect(await sqlState(db.app.query(`UPDATE sale_line SET ${column} = 1 WHERE id = $1`, [line.id])), column).toBe('42501');
    }
    expect(await sqlState(db.app.query(`UPDATE sale SET status = 'Returned' WHERE id = $1`, [saleId]))).toBe('42501');
  });
});
