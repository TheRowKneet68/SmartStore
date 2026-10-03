import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, inTransaction, sqlState, type TestDb } from './db.ts';
import {
  actor,
  adjust,
  approveAdjustment,
  draftAdjustment,
  ensureTestCurrency,
  insertLocation,
  insertOrganization,
  insertProduct,
  insertCategory,
  insertPrice,
  insertSettings,
  insertStore,
  insertUnit,
  insertVariant,
  insertWarehouse,
  onHand,
  postAdjustment,
  reverseAdjustment,
  stockWorld,
  type StockWorld,
} from './fixtures.ts';

/** Domain 3 — Inventory ledger. Design: docs/database/D3-INVENTORY-LEDGER.md */

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
  await ensureTestCurrency(db.owner);
});
afterAll(async () => {
  await db.drop();
});

const drift = async () => (await db.app.query('SELECT * FROM inventory_ledger_drift()')).rows;

/** A world with `quantity` units already on hand, loaded as an opening balance. */
async function stocked(quantity: number, policy: 'AllowNegative' | 'BlockNegative' = 'AllowNegative'): Promise<StockWorld> {
  const w = await stockWorld(db.app, policy);
  if (quantity > 0) {
    await adjust(db.app, w, [{ variant: w.variant, location: w.location, type: 'OPENING_BALANCE', quantity }], 'OpeningBalance');
  }
  return w;
}

describe('movement types (RT-058, IV-11, IV-12, IV-13, BI-12)', () => {
  it("RT-058, BI-12: the closed enumeration carries each type's direction and class", async () => {
    const { rows } = await db.app.query<{ code: string; direction: string; stock_class: string | null }>(
      'SELECT code, direction, stock_class FROM inventory_movement_type ORDER BY code, direction',
    );
    const find = (code: string, direction: string) => rows.find((r) => r.code === code && r.direction === direction);
    expect(find('SALE', 'Out')?.stock_class).toBe('Destroys');
    expect(find('OPENING_BALANCE', 'In')?.stock_class).toBe('Creates');
    expect(find('TRANSFER_IN', 'In')?.stock_class).toBe('Conserves');
    expect(find('REVERSAL', 'In')?.stock_class).toBeNull();
    expect(find('REVERSAL', 'Out')?.stock_class).toBeNull();
    expect(rows).toHaveLength(18); // 17 + COUNT_VARIANCE_REVERSAL (SM-82, state-machines §22.17)
    expect(rows.some((r) => /SET|RESERVATION/.test(r.code)), 'IV-11, IV-13: no set-stock or reservation type').toBe(false);
  });

  it('RT-058, BI-05: an unlisted type, or a type in the wrong direction, cannot be written', async () => {
    const w = await stockWorld(db.app);
    const a = await draftAdjustment(db.app, w, []);
    const line = (type: string, direction: string) =>
      db.app.query(
        `INSERT INTO stock_adjustment_line (stock_adjustment_id, adjustment_kind, store_id, organization_id, variant_id,
           storage_location_id, movement_type, direction, quantity)
         VALUES ($1, 'Adjustment', $2, $3, $4, $5, $6, $7, 1)`,
        [a.id, w.store, w.org, w.variant, w.location, type, direction],
      );
    expect(await sqlState(line('SET_STOCK', 'In')), 'refused by the closed list of adjustment types').toBe('23514');
    expect(await sqlState(line('ADJUSTMENT_IN', 'Out')), 'refused by the (type, direction) enumeration key').toBe('23503');
    expect(await sqlState(line('ADJUSTMENT_IN', 'In'))).toBeUndefined();
  });

  it('ADR-21: the application cannot extend the enumeration', async () => {
    const add = db.app.query(`INSERT INTO inventory_movement_type (code, direction, stock_class) VALUES ('SET', 'In', 'Creates')`);
    expect(await sqlState(add)).toBe('42501');
  });
});

describe('stock adjustment document (IV-32..IV-35, RT-074, RT-075, RT-486, BI-26, BI-27, BI-42)', () => {
  it('BI-42, RT-486: an adjustment is created Draft with the next document number of its store', async () => {
    const w = await stockWorld(db.app);
    const first = await draftAdjustment(db.app, w, []);
    const second = await draftAdjustment(db.app, w, []);
    const { rows } = await db.app.query<{ id: string; status: string; document_number: string }>(
      'SELECT id, status, document_number FROM stock_adjustment WHERE id = ANY ($1) ORDER BY document_number',
      [[first.id, second.id]],
    );
    expect(rows.map((r) => [r.id, r.status, Number(r.document_number)])).toEqual([
      [first.id, 'Draft', 1],
      [second.id, 'Draft', 2],
    ]);
  });

  it('IV-33, RT-074: a reason code is always required, and an archived one is refused', async () => {
    const w = await stockWorld(db.app);
    const noReason = db.app.query(
      `INSERT INTO stock_adjustment (store_id, organization_id, kind, created_by, status_changed_by)
       VALUES ($1, $2, 'Adjustment', $3, $3)`,
      [w.store, w.org, actor()],
    );
    expect(await sqlState(noReason)).toBe('23502');
    await db.app.query('UPDATE reason_code SET archived_by = $2 WHERE id = $1', [w.reason, actor()]);
    expect(await sqlState(draftAdjustment(db.app, w, []))).toBe('SS024');
  });

  it('IV-32, BI-08: lines change only while the adjustment is a draft; a draft line may be deleted', async () => {
    const w = await stockWorld(db.app);
    const a = await draftAdjustment(db.app, w, [{ variant: w.variant, location: w.location, type: 'FOUND', quantity: 2 }]);
    expect(await sqlState(db.app.query('DELETE FROM stock_adjustment_line WHERE id = $1', [a.lineIds[0]]))).toBeUndefined();
    const b = await draftAdjustment(db.app, w, [{ variant: w.variant, location: w.location, type: 'FOUND', quantity: 2 }]);
    await approveAdjustment(db.app, b.id);
    expect(await sqlState(db.app.query('DELETE FROM stock_adjustment_line WHERE id = $1', [b.lineIds[0]]))).toBe('SS018');
    const late = db.app.query(
      `INSERT INTO stock_adjustment_line (stock_adjustment_id, adjustment_kind, store_id, organization_id, variant_id,
         storage_location_id, movement_type, direction, quantity)
       VALUES ($1, 'Adjustment', $2, $3, $4, $5, 'FOUND', 'In', 1)`,
      [b.id, w.store, w.org, w.variant, w.location],
    );
    expect(await sqlState(late)).toBe('SS018');
  });

  it('BI-26, RT-075: the submitter cannot approve their own adjustment', async () => {
    const w = await stockWorld(db.app);
    const a = await draftAdjustment(db.app, w, []);
    const who = actor();
    await db.app.query(
      `UPDATE stock_adjustment SET status = 'PendingApproval', submitted_by = $2, status_changed_by = $2 WHERE id = $1`,
      [a.id, who],
    );
    const self = db.app.query(
      `UPDATE stock_adjustment SET status = 'Approved', approved_by = $2, status_changed_by = $2 WHERE id = $1`,
      [a.id, who],
    );
    expect(await sqlState(self)).toBe('23514');
  });

  it('SM-03: a submission must say who submitted, and who approved cannot be rewritten', async () => {
    const w = await stockWorld(db.app);
    const a = await draftAdjustment(db.app, w, []);
    const anonymous = db.app.query(`UPDATE stock_adjustment SET status = 'PendingApproval', status_changed_by = $2 WHERE id = $1`, [
      a.id,
      actor(),
    ]);
    expect(await sqlState(anonymous)).toBe('23514');
    await approveAdjustment(db.app, a.id);
    expect(await sqlState(db.app.query('UPDATE stock_adjustment SET approved_by = $2 WHERE id = $1', [a.id, actor()]))).toBe(
      'SS001',
    );
  });

  it('IV-32, OQ-013: there is no path to Posted that skips approval', async () => {
    const w = await stockWorld(db.app);
    const a = await draftAdjustment(db.app, w, []);
    const skip = (status: string) =>
      db.app.query('UPDATE stock_adjustment SET status = $2, status_changed_by = $3 WHERE id = $1', [a.id, status, actor()]);
    expect(await sqlState(skip('Posted'))).toBe('SS004');
    expect(await sqlState(skip('Approved'))).toBe('SS004');
  });

  it('BI-27, RT-486: a draft or approved adjustment moves no stock; posting moves it once', async () => {
    const w = await stockWorld(db.app);
    const a = await draftAdjustment(db.app, w, [{ variant: w.variant, location: w.location, type: 'FOUND', quantity: 5 }]);
    await approveAdjustment(db.app, a.id);
    expect(await onHand(db.app, w.variant, w.location)).toBeUndefined();
    const early = inTransaction(db.app, async (c) => {
      const tx = await c.query<{ id: string }>('INSERT INTO inventory_transaction (store_id, created_by) VALUES ($1, $2) RETURNING id', [
        w.store,
        actor(),
      ]);
      await c.query(
        `INSERT INTO inventory_movement (inventory_transaction_id, store_id, organization_id, variant_id, storage_location_id,
           movement_type, direction, quantity, stock_adjustment_id, stock_adjustment_line_id)
         VALUES ($1, $2, $3, $4, $5, 'FOUND', 'In', 5, $6, $7)`,
        [tx.rows[0]!.id, w.store, w.org, w.variant, w.location, a.id, a.lineIds[0]],
      );
    });
    expect(await sqlState(early), 'an approved adjustment is not yet posted').toBe('SS016');
    await postAdjustment(db.app, a);
    expect(await onHand(db.app, w.variant, w.location)).toBe(5);
  });

  it('RT-486, BI-04: posting without its movements, or with the wrong quantity, fails at commit', async () => {
    const w = await stockWorld(db.app);
    const a = await draftAdjustment(db.app, w, [{ variant: w.variant, location: w.location, type: 'FOUND', quantity: 5 }]);
    await approveAdjustment(db.app, a.id);
    const bare = inTransaction(db.app, (c) =>
      c.query(`UPDATE stock_adjustment SET status = 'Posted', status_changed_by = $2 WHERE id = $1`, [a.id, actor()]),
    );
    expect(await sqlState(bare)).toBe('SS022');
    const short = inTransaction(db.app, async (c) => {
      await c.query(`UPDATE stock_adjustment SET status = 'Posted', status_changed_by = $2 WHERE id = $1`, [a.id, actor()]);
      const tx = await c.query<{ id: string }>('INSERT INTO inventory_transaction (store_id, created_by) VALUES ($1, $2) RETURNING id', [
        w.store,
        actor(),
      ]);
      await c.query(
        `INSERT INTO inventory_movement (inventory_transaction_id, store_id, organization_id, variant_id, storage_location_id,
           movement_type, direction, quantity, stock_adjustment_id, stock_adjustment_line_id)
         VALUES ($1, $2, $3, $4, $5, 'FOUND', 'In', 4, $6, $7)`,
        [tx.rows[0]!.id, w.store, w.org, w.variant, w.location, a.id, a.lineIds[0]],
      );
    });
    expect(await sqlState(short)).toBe('SS022');
    expect(await onHand(db.app, w.variant, w.location), 'nothing survived either attempt').toBeUndefined();
  });

  it('BI-28, RT-486: an adjustment line is applied at most once', async () => {
    const w = await stockWorld(db.app);
    const a = await adjust(db.app, w, [{ variant: w.variant, location: w.location, type: 'FOUND', quantity: 3 }]);
    const again = inTransaction(db.app, async (c) => {
      const tx = await c.query<{ id: string }>('INSERT INTO inventory_transaction (store_id, created_by) VALUES ($1, $2) RETURNING id', [
        w.store,
        actor(),
      ]);
      await c.query(
        `INSERT INTO inventory_movement (inventory_transaction_id, store_id, organization_id, variant_id, storage_location_id,
           movement_type, direction, quantity, stock_adjustment_id, stock_adjustment_line_id)
         VALUES ($1, $2, $3, $4, $5, 'FOUND', 'In', 3, $6, $7)`,
        [tx.rows[0]!.id, w.store, w.org, w.variant, w.location, a.id, a.lineIds[0]],
      );
    });
    expect(await sqlState(again)).toBe('23505');
    expect(await onHand(db.app, w.variant, w.location)).toBe(3);
  });

  it('IV-32, RT-062: a posted adjustment is reversed by compensating movements, never edited', async () => {
    const w = await stockWorld(db.app);
    const a = await adjust(db.app, w, [{ variant: w.variant, location: w.location, type: 'FOUND', quantity: 4 }]);
    await reverseAdjustment(db.app, a);
    expect(await onHand(db.app, w.variant, w.location)).toBe(0);
    const { rows } = await db.app.query<{ movement_type: string; direction: string }>(
      'SELECT movement_type, direction FROM inventory_movement WHERE stock_adjustment_id = $1 ORDER BY seq',
      [a.id],
    );
    expect(rows).toEqual([
      { movement_type: 'FOUND', direction: 'In' },
      { movement_type: 'REVERSAL', direction: 'Out' },
    ]);
    const posted = await adjust(db.app, w, [{ variant: w.variant, location: w.location, type: 'FOUND', quantity: 1 }]);
    const unreversed = inTransaction(db.app, (c) =>
      c.query(`UPDATE stock_adjustment SET status = 'Reversed', status_changed_by = $2 WHERE id = $1`, [posted.id, actor()]),
    );
    expect(await sqlState(unreversed), 'reversed without compensating movements').toBe('SS022');
  });

  it('IV-32: a draft can be cancelled, and Cancelled is terminal', async () => {
    const w = await stockWorld(db.app);
    const a = await draftAdjustment(db.app, w, []);
    const set = (status: string) =>
      db.app.query('UPDATE stock_adjustment SET status = $2, status_changed_by = $3 WHERE id = $1', [a.id, status, actor()]);
    expect(await sqlState(set('Cancelled'))).toBeUndefined();
    expect(await sqlState(set('Draft'))).toBe('SS004');
  });

  it('IV-34, UX-36, UX-37: a line is positive, and a counted line keeps both quantities consistently', async () => {
    const w = await stockWorld(db.app);
    const a = await draftAdjustment(db.app, w, []);
    const line = (type: string, direction: string, quantity: number, counted: number | null, system: number | null) =>
      db.app.query(
        `INSERT INTO stock_adjustment_line (stock_adjustment_id, adjustment_kind, store_id, organization_id, variant_id,
           storage_location_id, movement_type, direction, quantity, counted_quantity, system_quantity)
         VALUES ($1, 'Adjustment', $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [a.id, w.store, w.org, w.variant, w.location, type, direction, quantity, counted, system],
      );
    expect(await sqlState(line('ADJUSTMENT_IN', 'In', 0, null, null))).toBe('23514');
    expect(await sqlState(line('ADJUSTMENT_OUT', 'Out', 3, 47, 50)), 'counted 47 of 50: out 3').toBeUndefined();
    expect(await sqlState(line('ADJUSTMENT_IN', 'In', 3, 47, 50)), 'wrong direction').toBe('23514');
    expect(await sqlState(line('ADJUSTMENT_OUT', 'Out', 2, 47, 50)), 'wrong difference').toBe('23514');
    expect(await sqlState(line('ADJUSTMENT_OUT', 'Out', 3, -1, 2)), 'IV-29: a count is never negative').toBe('23514');
  });

  it('IV-13: an opening balance writes only OPENING_BALANCE, and an adjustment never does', async () => {
    const w = await stockWorld(db.app);
    const opening = draftAdjustment(db.app, w, [{ variant: w.variant, location: w.location, type: 'FOUND', quantity: 1 }], 'OpeningBalance');
    expect(await sqlState(opening)).toBe('23514');
    const adjustment = draftAdjustment(db.app, w, [{ variant: w.variant, location: w.location, type: 'OPENING_BALANCE', quantity: 1 }]);
    expect(await sqlState(adjustment)).toBe('23514');
  });
});

describe('the ledger (BI-02, BI-03, BI-15, IV-05..IV-09, RT-056, RT-059..RT-062)', () => {
  it('BI-02, RT-056: the application can read a balance and never write one', async () => {
    const w = await stocked(10);
    const where = [w.variant, w.location];
    expect(await sqlState(db.app.query('UPDATE stock_balance SET on_hand = 99 WHERE variant_id = $1 AND storage_location_id = $2', where)))
      .toBe('42501');
    expect(await sqlState(db.app.query('DELETE FROM stock_balance WHERE variant_id = $1 AND storage_location_id = $2', where))).toBe(
      '42501',
    );
    const insert = db.app.query(
      `INSERT INTO stock_balance (organization_id, variant_id, storage_location_id, on_hand, movement_count, last_movement_at)
       VALUES ($1, $2, $3, 1, 1, now())`,
      [w.org, w.variant, w.location],
    );
    expect(await sqlState(insert)).toBe('42501');
  });

  it('IV-06, IV-21: each movement records the balance it produced and its gapless place in the history', async () => {
    const w = await stocked(10);
    await adjust(db.app, w, [{ variant: w.variant, location: w.location, type: 'LOSS', quantity: 3 }]);
    await adjust(db.app, w, [{ variant: w.variant, location: w.location, type: 'FOUND', quantity: 1 }]);
    const { rows } = await db.app.query<{ resulting_balance: string; balance_sequence: string }>(
      `SELECT resulting_balance, balance_sequence FROM inventory_movement
       WHERE variant_id = $1 AND storage_location_id = $2 ORDER BY balance_sequence`,
      [w.variant, w.location],
    );
    expect(rows.map((r) => [Number(r.balance_sequence), Number(r.resulting_balance)])).toEqual([
      [1, 10],
      [2, 7],
      [3, 8],
    ]);
  });

  it('RT-061, BI-04: a failure after the balance is written leaves no movement and no balance change', async () => {
    const w = await stocked(10);
    const a = await draftAdjustment(db.app, w, [{ variant: w.variant, location: w.location, type: 'LOSS', quantity: 4 }]);
    await approveAdjustment(db.app, a.id);
    const failing = inTransaction(db.app, async (c) => {
      await c.query(`UPDATE stock_adjustment SET status = 'Posted', status_changed_by = $2 WHERE id = $1`, [a.id, actor()]);
      // The trigger applies the balance first; the foreign key on the transaction then fails at end of statement.
      await c.query(
        `INSERT INTO inventory_movement (inventory_transaction_id, store_id, organization_id, variant_id, storage_location_id,
           movement_type, direction, quantity, stock_adjustment_id, stock_adjustment_line_id)
         VALUES ($1, $2, $3, $4, $5, 'LOSS', 'Out', 4, $6, $7)`,
        [randomUUID(), w.store, w.org, w.variant, w.location, a.id, a.lineIds[0]],
      );
    });
    expect(await sqlState(failing)).toBe('23503');
    expect(await onHand(db.app, w.variant, w.location)).toBe(10);
    expect(await drift()).toEqual([]);
  });

  it('RT-059, BI-15: a movement is never updated, deleted or truncated, whatever the role', async () => {
    const w = await stocked(10);
    const { rows } = await db.app.query<{ id: string }>('SELECT id FROM inventory_movement WHERE variant_id = $1', [w.variant]);
    const id = rows[0]!.id;
    expect(await sqlState(db.app.query('UPDATE inventory_movement SET quantity = 1 WHERE id = $1', [id]))).toBe('42501');
    expect(await sqlState(db.app.query('DELETE FROM inventory_movement WHERE id = $1', [id]))).toBe('42501');
    expect(await sqlState(db.owner.query('UPDATE inventory_movement SET quantity = 1 WHERE id = $1', [id]))).toBe('SS010');
    expect(await sqlState(db.owner.query('DELETE FROM inventory_movement WHERE id = $1', [id]))).toBe('SS010');
    expect(await sqlState(db.owner.query('TRUNCATE inventory_movement CASCADE'))).toBe('SS010');
    expect(await sqlState(db.owner.query('DELETE FROM inventory_transaction'))).toBe('SS010');
  });

  it('RT-060, BI-03: every movement names its transaction and one document line', async () => {
    const w = await stocked(0);
    const tx = await db.app.query<{ id: string }>('INSERT INTO inventory_transaction (store_id, created_by) VALUES ($1, $2) RETURNING id', [
      w.store,
      actor(),
    ]);
    const orphan = db.app.query(
      `INSERT INTO inventory_movement (inventory_transaction_id, store_id, organization_id, variant_id, storage_location_id,
         movement_type, direction, quantity)
       VALUES ($1, $2, $3, $4, $5, 'FOUND', 'In', 1)`,
      [tx.rows[0]!.id, w.store, w.org, w.variant, w.location],
    );
    expect(await sqlState(orphan)).toBe('23514');
    const { rows } = await db.app.query<{ n: string }>(
      `SELECT count(*) AS n FROM inventory_movement m
       WHERE NOT EXISTS (SELECT 1 FROM inventory_transaction t WHERE t.id = m.inventory_transaction_id)
          OR m.stock_adjustment_line_id IS NULL`,
    );
    expect(Number(rows[0]!.n), 'BI-03 verification: zero orphans').toBe(0);
  });

  it('RT-062, IV-12: a reversal is a linked opposite movement, and a movement is reversed at most once', async () => {
    const w = await stocked(0);
    const a = await adjust(db.app, w, [{ variant: w.variant, location: w.location, type: 'FOUND', quantity: 2 }]);
    await reverseAdjustment(db.app, a);
    const { rows } = await db.app.query<{ id: string; reverses_movement_id: string | null; quantity: string }>(
      'SELECT id, reverses_movement_id, quantity FROM inventory_movement WHERE stock_adjustment_id = $1 ORDER BY seq',
      [a.id],
    );
    expect(rows[1]!.reverses_movement_id).toBe(rows[0]!.id);
    expect(rows[0]!.quantity, 'the original is unchanged').toBe('2.0000');
    const twice = inTransaction(db.app, async (c) => {
      const tx = await c.query<{ id: string }>('INSERT INTO inventory_transaction (store_id, created_by) VALUES ($1, $2) RETURNING id', [
        w.store,
        actor(),
      ]);
      await c.query(
        `INSERT INTO inventory_movement (inventory_transaction_id, store_id, organization_id, variant_id, storage_location_id,
           movement_type, direction, quantity, reverses_movement_id, stock_adjustment_id, stock_adjustment_line_id)
         VALUES ($1, $2, $3, $4, $5, 'REVERSAL', 'Out', 2, $6, $7, $8)`,
        [tx.rows[0]!.id, w.store, w.org, w.variant, w.location, rows[0]!.id, a.id, a.lineIds[0]],
      );
    });
    expect(await sqlState(twice)).toBe('23505');
  });

  it('BI-15, IV-12: a reversal that does not mirror its movement is refused', async () => {
    const w = await stocked(0);
    const a = await adjust(db.app, w, [{ variant: w.variant, location: w.location, type: 'FOUND', quantity: 2 }]);
    const { rows } = await db.app.query<{ id: string }>('SELECT id FROM inventory_movement WHERE stock_adjustment_id = $1', [a.id]);
    const wrong = inTransaction(db.app, async (c) => {
      await c.query(`UPDATE stock_adjustment SET status = 'Reversed', status_changed_by = $2 WHERE id = $1`, [a.id, actor()]);
      const tx = await c.query<{ id: string }>('INSERT INTO inventory_transaction (store_id, created_by) VALUES ($1, $2) RETURNING id', [
        w.store,
        actor(),
      ]);
      await c.query(
        `INSERT INTO inventory_movement (inventory_transaction_id, store_id, organization_id, variant_id, storage_location_id,
           movement_type, direction, quantity, reverses_movement_id, stock_adjustment_id, stock_adjustment_line_id)
         VALUES ($1, $2, $3, $4, $5, 'REVERSAL', 'In', 2, $6, $7, $8)`,
        [tx.rows[0]!.id, w.store, w.org, w.variant, w.location, rows[0]!.id, a.id, a.lineIds[0]],
      );
    });
    expect(await sqlState(wrong), 'same direction as the original').toBe('SS015');
  });
});

describe('negative stock (IV-16, IV-17, IV-20, BI-36, RT-064, RT-067, RT-483, RT-484, WH-02)', () => {
  const out = (w: StockWorld, quantity: number) => adjust(db.app, w, [{ variant: w.variant, location: w.location, type: 'LOSS', quantity }]);

  it('IV-17, RT-484: under AllowNegative the negative is written in full, never clamped', async () => {
    const w = await stocked(2, 'AllowNegative');
    expect(await sqlState(out(w, 5))).toBeUndefined();
    expect(await onHand(db.app, w.variant, w.location)).toBe(-3);
    expect(await drift()).toEqual([]);
  });

  it('IV-16, RT-483: under BlockNegative the movement is refused where the balance is written, and nothing changes', async () => {
    const w = await stocked(2, 'BlockNegative');
    expect(await sqlState(out(w, 5))).toBe('SS011');
    expect(await onHand(db.app, w.variant, w.location)).toBe(2);
    expect(await sqlState(out(w, 2)), 'exactly to zero is allowed').toBeUndefined();
  });

  it('IV-16, REQ-AU-06: the policy is the one in force when the stock moves', async () => {
    const w = await stocked(1, 'BlockNegative');
    expect(await sqlState(out(w, 3))).toBe('SS011');
    await insertSettings(db.app, w.store, 'AllowNegative');
    expect(await sqlState(out(w, 3))).toBeUndefined();
  });

  it('WH-02: a central-warehouse location never goes negative, whatever the store allows', async () => {
    const w = await stocked(0, 'AllowNegative');
    const central = await insertWarehouse(db.app, w.org, null);
    await db.app.query(
      `INSERT INTO storage_location_attribution (storage_location_id, location_warehouse_kind, organization_id, store_id, created_by)
       VALUES ($1, 'Central', $2, $3, $4)`,
      [central.defaultLocationId, w.org, w.store, actor()],
    );
    const loss = adjust(db.app, w, [{ variant: w.variant, location: central.defaultLocationId, type: 'LOSS', quantity: 1 }]);
    expect(await sqlState(loss)).toBe('SS011');
  });

  it('RT-457: a store with no settings in force moves no stock', async () => {
    const w = await stockWorld(db.app);
    const bare = await insertStore(db.app, w.org);
    const { warehouseId, defaultLocationId } = await insertWarehouse(db.app, w.org, bare);
    expect(warehouseId).toBeTruthy();
    const attempt = adjust(db.app, { org: w.org, store: bare, reason: w.reason }, [
      { variant: w.variant, location: defaultLocationId, type: 'FOUND', quantity: 1 },
    ]);
    expect(await sqlState(attempt)).toBe('SS017');
  });

  it('IV-20, RT-068: negatives are reported per location, and the organization total may net to zero', async () => {
    const w = await stocked(0, 'AllowNegative');
    const second = await insertLocation(db.app, w.org, w.warehouse, 'StoreAttached', 'Receiving', false);
    await adjust(db.app, w, [
      { variant: w.variant, location: w.location, type: 'LOSS', quantity: 3 },
      { variant: w.variant, location: second, type: 'FOUND', quantity: 3 },
    ]);
    const { rows } = await db.app.query<{ storage_location_id: string; on_hand: string }>(
      'SELECT storage_location_id, on_hand FROM stock_balance WHERE variant_id = $1 AND on_hand < 0',
      [w.variant],
    );
    expect(rows).toEqual([{ storage_location_id: w.location, on_hand: '-3.0000' }]);
    const total = await db.app.query<{ sum: string }>('SELECT sum(on_hand) AS sum FROM stock_balance WHERE variant_id = $1', [w.variant]);
    expect(Number(total.rows[0]!.sum)).toBe(0);
  });

  /** Posts `n` approved one-unit losses at once, each on its own connection, and counts the outcomes. */
  async function raceForLastUnit(policy: 'AllowNegative' | 'BlockNegative', n: number) {
    const w = await stocked(1, policy);
    const adjustments = [];
    for (let i = 0; i < n; i++) {
      const a = await draftAdjustment(db.app, w, [{ variant: w.variant, location: w.location, type: 'LOSS', quantity: 1 }]);
      await approveAdjustment(db.app, a.id);
      adjustments.push(a);
    }
    const wide = new pg.Pool({ connectionString: db.appUrl, max: n });
    try {
      const outcomes = await Promise.all(adjustments.map((a) => sqlState(postAdjustment(wide, a))));
      return { w, succeeded: outcomes.filter((o) => o === undefined).length, refused: outcomes.filter((o) => o === 'SS011').length };
    } finally {
      await wide.end();
    }
  }

  it('BI-36, RT-067: under BlockNegative, concurrent sales of the last unit resolve to exactly one success, every time', async () => {
    for (let run = 0; run < 15; run++) {
      const { w, succeeded, refused } = await raceForLastUnit('BlockNegative', 8);
      expect([succeeded, refused], `run ${run}`).toEqual([1, 7]);
      expect(await onHand(db.app, w.variant, w.location)).toBe(0);
    }
    expect(await drift()).toEqual([]);
  });

  it('BI-36: under AllowNegative, all succeed and the negative is recorded, and the ledger still reconciles', async () => {
    const { w, succeeded } = await raceForLastUnit('AllowNegative', 8);
    expect(succeeded).toBe(8);
    expect(await onHand(db.app, w.variant, w.location)).toBe(-7);
    expect(await drift()).toEqual([]);
  });
});

describe('ledger invariants carried from domains 1 and 2 (MS-16, D-03, PR-14, PR-22, ORG-05)', () => {
  it('MS-16, D-03: a store moves stock only at its own locations, or at central locations attributed to it', async () => {
    const w = await stocked(0);
    const otherStore = await insertStore(db.app, w.org);
    await insertSettings(db.app, otherStore, 'AllowNegative');
    const theirs = await insertWarehouse(db.app, w.org, otherStore);
    const foreign = adjust(db.app, w, [{ variant: w.variant, location: theirs.defaultLocationId, type: 'FOUND', quantity: 1 }]);
    expect(await sqlState(foreign)).toBe('SS014');
    const central = await insertWarehouse(db.app, w.org, null);
    const unattributed = adjust(db.app, w, [{ variant: w.variant, location: central.defaultLocationId, type: 'FOUND', quantity: 1 }]);
    expect(await sqlState(unattributed)).toBe('SS014');
    await db.app.query(
      `INSERT INTO storage_location_attribution (storage_location_id, location_warehouse_kind, organization_id, store_id, created_by)
       VALUES ($1, 'Central', $2, $3, $4)`,
      [central.defaultLocationId, w.org, w.store, actor()],
    );
    const attributed = adjust(db.app, w, [{ variant: w.variant, location: central.defaultLocationId, type: 'FOUND', quantity: 1 }]);
    expect(await sqlState(attributed)).toBeUndefined();
  });

  it('organization-model s5: a Transit location is reached only by transfers', async () => {
    const w = await stocked(0);
    const transit = await insertLocation(db.app, w.org, w.warehouse, 'StoreAttached', 'Transit', false);
    const found = adjust(db.app, w, [{ variant: w.variant, location: transit, type: 'FOUND', quantity: 1 }]);
    expect(await sqlState(found)).toBe('SS023');
  });

  it("product-domain s6.1, PR-22: a service is never stocked, and a quantity respects its unit's scale", async () => {
    const w = await stocked(0);
    const product = await insertProduct(db.app, w.org, await insertCategory(db.app, w.org));
    const service = await insertVariant(db.app, w.org, product, await insertUnit(db.app, w.org, 'Service', 2));
    await insertPrice(db.app, w.org, service);
    expect(await sqlState(adjust(db.app, w, [{ variant: service, location: w.location, type: 'FOUND', quantity: 1 }]))).toBe('SS012');
    expect(await sqlState(adjust(db.app, w, [{ variant: w.variant, location: w.location, type: 'FOUND', quantity: 1.5 }])), 'countable')
      .toBe('SS013');
    const kg = await insertVariant(db.app, w.org, product, await insertUnit(db.app, w.org, 'Measurable', 3));
    await insertPrice(db.app, w.org, kg);
    expect(await sqlState(adjust(db.app, w, [{ variant: kg, location: w.location, type: 'FOUND', quantity: '1.2345' }]))).toBe('SS013');
    expect(await sqlState(adjust(db.app, w, [{ variant: kg, location: w.location, type: 'FOUND', quantity: '1.234' }]))).toBeUndefined();
  });

  it('ORG-05, RT-445, EC-39: a store holding stock cannot be deactivated; once empty it can, and then moves nothing', async () => {
    const w = await stocked(3);
    const deactivate = () => db.app.query('UPDATE store SET deactivated_by = $2 WHERE id = $1', [w.store, actor()]);
    expect(await sqlState(deactivate())).toBe('SS019');
    await adjust(db.app, w, [{ variant: w.variant, location: w.location, type: 'LOSS', quantity: 3 }]);
    expect(await sqlState(deactivate())).toBeUndefined();
    expect(await sqlState(adjust(db.app, w, [{ variant: w.variant, location: w.location, type: 'FOUND', quantity: 1 }]))).toBe('SS020');
  });

  it("PR-14, RT-491: a unit's quantity kind is frozen once a movement uses it", async () => {
    const w = await stocked(0);
    const change = () => db.app.query(`UPDATE unit SET quantity_kind = 'Measurable', scale = 3 WHERE id = $1`, [w.unit]);
    expect(await sqlState(change()), 'unused: still settable').toBeUndefined();
    await db.app.query(`UPDATE unit SET quantity_kind = 'Countable', scale = 0 WHERE id = $1`, [w.unit]);
    await adjust(db.app, w, [{ variant: w.variant, location: w.location, type: 'FOUND', quantity: 1 }]);
    expect(await sqlState(change())).toBe('SS021');
  });
});

describe('reconciliation (IV-09, BI-02, ADR-22)', () => {
  it('IV-09: after a mixed workload, rebuilding every balance from the ledger reproduces it exactly', async () => {
    const w = await stocked(20);
    const second = await insertLocation(db.app, w.org, w.warehouse, 'StoreAttached', 'Quarantine', false);
    await adjust(db.app, w, [
      { variant: w.variant, location: w.location, type: 'DAMAGE', quantity: 2 },
      { variant: w.variant, location: second, type: 'FOUND', quantity: 2 },
    ]);
    const a = await adjust(db.app, w, [{ variant: w.variant, location: w.location, type: 'EXPIRY', quantity: 1 }]);
    await reverseAdjustment(db.app, a);
    expect(await drift()).toEqual([]);
  });

  it('ADR-22, IV-09: a corrupted balance is reported and not repaired', async () => {
    const w = await stocked(5);
    await db.owner.query('UPDATE stock_balance SET on_hand = 6 WHERE variant_id = $1 AND storage_location_id = $2', [w.variant, w.location]);
    try {
      const report = await drift();
      expect(report).toContainEqual(
        expect.objectContaining({ variant_id: w.variant, problem: 'balance differs from the sum of its movements' }),
      );
      expect(await onHand(db.app, w.variant, w.location), 'the check never repairs').toBe(6);
    } finally {
      await db.owner.query('UPDATE stock_balance SET on_hand = 5 WHERE variant_id = $1 AND storage_location_id = $2', [w.variant, w.location]);
    }
  });

  it('IV-06: a rewritten resulting balance breaks the chain, and the check finds it', async () => {
    const w = await stocked(5);
    await db.owner.query('ALTER TABLE inventory_movement DISABLE TRIGGER tg_inventory_movement_immutable');
    try {
      await db.owner.query('UPDATE inventory_movement SET resulting_balance = 4 WHERE variant_id = $1', [w.variant]);
      const report = await drift();
      expect(report.some((r) => r.variant_id === w.variant && String(r.problem).startsWith('resulting balance breaks the chain'))).toBe(true);
      await db.owner.query('UPDATE inventory_movement SET resulting_balance = 5 WHERE variant_id = $1', [w.variant]);
    } finally {
      await db.owner.query('ALTER TABLE inventory_movement ENABLE TRIGGER tg_inventory_movement_immutable');
    }
    expect(await drift()).toEqual([]);
  });
});

describe('concurrency suite (IV-21..IV-24, inventory-domain s7)', () => {
  it('many workers posting multi-line adjustments over one item set: no deadlock escapes and the ledger reconciles', async () => {
    const w = await stocked(0, 'AllowNegative');
    const extra: string[] = [];
    for (let i = 0; i < 4; i++) extra.push(await insertLocation(db.app, w.org, w.warehouse, 'StoreAttached', 'Receiving', false));
    const locations = [w.location, ...extra];
    const workers = 6;
    const perWorker = 12;
    const plans: Array<Awaited<ReturnType<typeof draftAdjustment>>> = [];
    let expectedTotal = 0;
    for (let i = 0; i < workers * perWorker; i++) {
      // Each adjustment touches a random subset of locations in a random order; posting sorts them (IV-24).
      const picked = locations.filter(() => Math.random() < 0.6);
      const lines = (picked.length ? picked : [w.location]).map((location, j) => {
        const inbound = (i + j) % 3 !== 0;
        expectedTotal += inbound ? 2 : -1;
        return { variant: w.variant, location, type: inbound ? 'FOUND' : 'LOSS', quantity: inbound ? 2 : 1 };
      });
      const a = await draftAdjustment(db.app, w, lines.sort(() => Math.random() - 0.5));
      await approveAdjustment(db.app, a.id);
      plans.push(a);
    }
    const wide = new pg.Pool({ connectionString: db.appUrl, max: workers });
    try {
      const outcomes = await Promise.all(
        Array.from({ length: workers }, async (_, k) => {
          const mine = plans.slice(k * perWorker, (k + 1) * perWorker);
          const states = [];
          for (const a of mine) states.push(await sqlState(postAdjustment(wide, a)));
          return states;
        }),
      );
      expect(outcomes.flat().filter((o) => o !== undefined), 'no failure, and no deadlock (40P01) in particular').toEqual([]);
    } finally {
      await wide.end();
    }
    const total = await db.app.query<{ sum: string }>('SELECT sum(on_hand) AS sum FROM stock_balance WHERE variant_id = $1', [w.variant]);
    expect(Number(total.rows[0]!.sum)).toBe(expectedTotal);
    expect(await drift()).toEqual([]);
  });
});

describe('tenancy (RT-001, BI-14)', () => {
  it("BI-14: an adjustment line cannot name another organization's variant or location", async () => {
    const w = await stockWorld(db.app);
    const other = await stockWorld(db.app);
    const foreignVariant = draftAdjustment(db.app, w, [{ variant: other.variant, location: w.location, type: 'FOUND', quantity: 1 }]);
    expect(await sqlState(foreignVariant)).toBe('23503');
    const foreignLocation = draftAdjustment(db.app, w, [{ variant: w.variant, location: other.location, type: 'FOUND', quantity: 1 }]);
    expect(await sqlState(foreignLocation)).toBe('23503');
    expect(await insertOrganization(db.app)).toBeTruthy();
  });
});
