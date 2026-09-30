import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { inTransaction } from './db.ts';

/**
 * Test data builders. Everything here is TEST-ONLY.
 *
 * XTS is the ISO 4217 code reserved for testing. Its exponent here is a fixture value, not a claim about XTS; no real
 * currency or exponent is asserted anywhere in the schema (OQ-006).
 */
export const TEST_CURRENCY = 'XTS';
export const TEST_TIME_ZONE = 'UTC';

type Db = pg.Pool | pg.PoolClient;

/** Stands in for an employee id until domain 7 adds the employee table and the actor foreign keys. */
export const actor = (): string => randomUUID();

export async function ensureTestCurrency(owner: pg.Pool): Promise<void> {
  await owner.query(
    `INSERT INTO currency (code, minor_unit_exponent) VALUES ($1, 2) ON CONFLICT (code) DO NOTHING`,
    [TEST_CURRENCY],
  );
}

export async function insertOrganization(db: Db, legalName = `Test Org ${randomUUID()}`): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO organization (legal_name, currency_code, time_zone) VALUES ($1, $2, $3) RETURNING id`,
    [legalName, TEST_CURRENCY, TEST_TIME_ZONE],
  );
  return rows[0]!.id;
}

export async function insertStore(db: Db, organizationId: string, code = `S-${randomUUID()}`): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO store (organization_id, code, name, time_zone, currency_code)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [organizationId, code, `Store ${code}`, TEST_TIME_ZONE, TEST_CURRENCY],
  );
  return rows[0]!.id;
}

export interface WarehouseIds {
  warehouseId: string;
  defaultLocationId: string;
}

/**
 * Creates a warehouse and its Default location in one transaction, as the schema requires.
 * `storeId` null makes a central warehouse.
 */
export async function insertWarehouse(pool: pg.Pool, organizationId: string, storeId: string | null): Promise<WarehouseIds> {
  const kind = storeId ? 'StoreAttached' : 'Central';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const w = await client.query<{ id: string }>(
      `INSERT INTO warehouse (organization_id, store_id, kind, code, name) VALUES ($1, $2, $3, $4, 'Warehouse') RETURNING id`,
      [organizationId, storeId, kind, `W-${randomUUID()}`],
    );
    const warehouseId = w.rows[0]!.id;
    const l = await client.query<{ id: string }>(
      `INSERT INTO storage_location (organization_id, warehouse_id, warehouse_kind, code, name, location_type, is_sellable)
       VALUES ($1, $2, $3, 'DEFAULT', 'Default', 'Default', $4) RETURNING id`,
      [organizationId, warehouseId, kind, kind === 'StoreAttached'],
    );
    await client.query('COMMIT');
    return { warehouseId, defaultLocationId: l.rows[0]!.id };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------- catalog (domain 2)

export async function insertUnit(db: Db, organizationId: string, kind = 'Countable', scale = 0): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO unit (organization_id, code, name, quantity_kind, scale) VALUES ($1, $2, 'Unit', $3, $4) RETURNING id`,
    [organizationId, `U-${randomUUID()}`, kind, scale],
  );
  return rows[0]!.id;
}

/** TEST-ONLY tax category; no real rate or category is asserted anywhere (D-12, GAP-044). */
export async function insertTaxCategory(db: Db, organizationId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO tax_category (organization_id, code, name) VALUES ($1, $2, 'TEST-ONLY') RETURNING id`,
    [organizationId, `T-${randomUUID()}`],
  );
  return rows[0]!.id;
}

export async function insertCategory(db: Db, organizationId: string, parentId: string | null = null): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO category (organization_id, parent_id, name, sort_order) VALUES ($1, $2, 'Category', 0) RETURNING id`,
    [organizationId, parentId],
  );
  return rows[0]!.id;
}

export async function insertProduct(db: Db, organizationId: string, categoryId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO product (organization_id, category_id, name, status_changed_by) VALUES ($1, $2, 'Product', $3) RETURNING id`,
    [organizationId, categoryId, actor()],
  );
  return rows[0]!.id;
}

export async function insertVariant(
  db: Db,
  organizationId: string,
  productId: string,
  unitId: string,
  taxCategoryId: string | null = null,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO product_variant (organization_id, product_id, base_unit_id, tax_category_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [organizationId, productId, unitId, taxCategoryId],
  );
  return rows[0]!.id;
}

/** An organization default price in minor units. Omitting `effectiveFrom` makes it take effect now. */
export async function insertPrice(
  db: Db,
  organizationId: string,
  variantId: string,
  amount = 100,
  effectiveFrom?: string,
): Promise<void> {
  if (effectiveFrom) {
    await db.query(
      `INSERT INTO variant_price (organization_id, variant_id, currency_code, amount, effective_from, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [organizationId, variantId, TEST_CURRENCY, amount, effectiveFrom, actor()],
    );
  } else {
    await db.query(
      `INSERT INTO variant_price (organization_id, variant_id, currency_code, amount, created_by) VALUES ($1, $2, $3, $4, $5)`,
      [organizationId, variantId, TEST_CURRENCY, amount, actor()],
    );
  }
}

export async function insertBarcode(
  db: Db,
  organizationId: string,
  variantId: string,
  value: string,
  kind: string,
  isPrimary = true,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO product_barcode (organization_id, variant_id, value, kind, is_primary) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [organizationId, variantId, value, kind, isPrimary],
  );
  return rows[0]!.id;
}

export interface SellableVariant {
  productId: string;
  variantId: string;
  unitId: string;
  taxCategoryId: string;
}

/** A released product with one priced, tax-classified variant, as later domains need. Barcodes are added separately. */
export async function insertSellableVariant(db: Db, organizationId: string, price = 100): Promise<SellableVariant> {
  const unitId = await insertUnit(db, organizationId);
  const taxCategoryId = await insertTaxCategory(db, organizationId);
  const productId = await insertProduct(db, organizationId, await insertCategory(db, organizationId));
  const variantId = await insertVariant(db, organizationId, productId, unitId, taxCategoryId);
  await insertPrice(db, organizationId, variantId, price);
  await db.query(`UPDATE product SET status = 'Active', status_changed_by = $2 WHERE id = $1`, [productId, actor()]);
  return { productId, variantId, unitId, taxCategoryId };
}

export async function insertLocation(
  db: Db,
  organizationId: string,
  warehouseId: string,
  kind: 'StoreAttached' | 'Central',
  locationType: string,
  isSellable: boolean,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO storage_location (organization_id, warehouse_id, warehouse_kind, code, name, location_type, is_sellable)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [organizationId, warehouseId, kind, `L-${randomUUID()}`, locationType, locationType, isSellable],
  );
  return rows[0]!.id;
}

// ---------------------------------------------------------------- inventory (domain 3)

export type Policy = 'AllowNegative' | 'BlockNegative';

/** A settings version taking effect now (or at `effectiveFrom`). */
export async function insertSettings(db: Db, storeId: string, policy: Policy, effectiveFrom?: string): Promise<void> {
  await db.query(
    `INSERT INTO store_setting_version (store_id, effective_from, tax_mode, negative_stock_policy, created_by)
     VALUES ($1, COALESCE($2::timestamptz, now()), 'Inclusive', $3, $4)`,
    [storeId, effectiveFrom ?? null, policy, actor()],
  );
}

export async function insertReasonCode(db: Db, organizationId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO reason_code (organization_id, code, name) VALUES ($1, $2, 'TEST-ONLY reason') RETURNING id`,
    [organizationId, `R-${randomUUID()}`],
  );
  return rows[0]!.id;
}

/** An organization with one store (settings in force), its warehouse and Default location, a variant and a reason. */
export interface StockWorld {
  org: string;
  store: string;
  warehouse: string;
  location: string;
  variant: string;
  unit: string;
  reason: string;
}

export async function stockWorld(pool: pg.Pool, policy: Policy = 'AllowNegative'): Promise<StockWorld> {
  const org = await insertOrganization(pool);
  const store = await insertStore(pool, org);
  await insertSettings(pool, store, policy);
  const { warehouseId, defaultLocationId } = await insertWarehouse(pool, org, store);
  const { variantId, unitId } = await insertSellableVariant(pool, org);
  const reason = await insertReasonCode(pool, org);
  return { org, store, warehouse: warehouseId, location: defaultLocationId, variant: variantId, unit: unitId, reason };
}

const DIRECTION: Record<string, 'In' | 'Out'> = {
  ADJUSTMENT_IN: 'In',
  ADJUSTMENT_OUT: 'Out',
  DAMAGE: 'Out',
  EXPIRY: 'Out',
  LOSS: 'Out',
  FOUND: 'In',
  OPENING_BALANCE: 'In',
};

export interface LineInput {
  variant: string;
  location: string;
  type: string;
  quantity: string | number;
}

export interface Adjustment {
  id: string;
  store: string;
  org: string;
  lineIds: string[];
}

export async function draftAdjustment(
  db: Db,
  w: Pick<StockWorld, 'org' | 'store' | 'reason'>,
  lines: LineInput[],
  kind: 'Adjustment' | 'OpeningBalance' = 'Adjustment',
): Promise<Adjustment> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO stock_adjustment (store_id, organization_id, kind, reason_code_id, created_by, status_changed_by)
     VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
    [w.store, w.org, kind, w.reason, actor()],
  );
  const id = rows[0]!.id;
  const lineIds: string[] = [];
  for (const line of lines) {
    const r = await db.query<{ id: string }>(
      `INSERT INTO stock_adjustment_line
         (stock_adjustment_id, adjustment_kind, store_id, organization_id, variant_id, storage_location_id,
          movement_type, direction, quantity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [id, kind, w.store, w.org, line.variant, line.location, line.type, DIRECTION[line.type], line.quantity],
    );
    lineIds.push(r.rows[0]!.id);
  }
  return { id, store: w.store, org: w.org, lineIds };
}

/** Submit by one employee and approve by another (BI-26), as state-machines s22.17 requires. */
export async function approveAdjustment(db: Db, id: string): Promise<void> {
  const submitter = actor();
  await db.query(
    `UPDATE stock_adjustment SET status = 'PendingApproval', submitted_by = $2, status_changed_by = $2 WHERE id = $1`,
    [id, submitter],
  );
  const approver = actor();
  await db.query(
    `UPDATE stock_adjustment SET status = 'Approved', approved_by = $2, status_changed_by = $2 WHERE id = $1`,
    [id, approver],
  );
}

interface LineRow {
  id: string;
  variant_id: string;
  storage_location_id: string;
  movement_type: string;
  direction: string;
  quantity: string;
}

/** The posting transaction: status Posted, one inventory transaction, one movement per line in sorted order (IV-24). */
export async function postAdjustment(pool: pg.Pool, a: Adjustment): Promise<string[]> {
  return inTransaction(pool, async (c) => {
    await c.query(`UPDATE stock_adjustment SET status = 'Posted', status_changed_by = $2 WHERE id = $1`, [a.id, actor()]);
    const tx = await c.query<{ id: string }>(
      `INSERT INTO inventory_transaction (store_id, created_by) VALUES ($1, $2) RETURNING id`,
      [a.store, actor()],
    );
    const lines = await c.query<LineRow>(
      `SELECT id, variant_id, storage_location_id, movement_type, direction, quantity FROM stock_adjustment_line
       WHERE stock_adjustment_id = $1 ORDER BY variant_id, storage_location_id, id`,
      [a.id],
    );
    const ids: string[] = [];
    for (const l of lines.rows) {
      const m = await c.query<{ id: string }>(
        `INSERT INTO inventory_movement (inventory_transaction_id, store_id, organization_id, variant_id,
           storage_location_id, movement_type, direction, quantity, stock_adjustment_id, stock_adjustment_line_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [tx.rows[0]!.id, a.store, a.org, l.variant_id, l.storage_location_id, l.movement_type, l.direction, l.quantity,
          a.id, l.id],
      );
      ids.push(m.rows[0]!.id);
    }
    return ids;
  });
}

interface MovementRow {
  id: string;
  variant_id: string;
  storage_location_id: string;
  direction: string;
  quantity: string;
  stock_adjustment_line_id: string;
}

/** The reversal transaction: status Reversed and one opposite REVERSAL per movement, in sorted order. */
export async function reverseAdjustment(pool: pg.Pool, a: Adjustment): Promise<void> {
  await inTransaction(pool, async (c) => {
    await c.query(`UPDATE stock_adjustment SET status = 'Reversed', status_changed_by = $2 WHERE id = $1`, [a.id, actor()]);
    const tx = await c.query<{ id: string }>(
      `INSERT INTO inventory_transaction (store_id, created_by) VALUES ($1, $2) RETURNING id`,
      [a.store, actor()],
    );
    const moves = await c.query<MovementRow>(
      `SELECT id, variant_id, storage_location_id, direction, quantity, stock_adjustment_line_id FROM inventory_movement
       WHERE stock_adjustment_id = $1 AND movement_type <> 'REVERSAL' ORDER BY variant_id, storage_location_id, id`,
      [a.id],
    );
    for (const m of moves.rows) {
      await c.query(
        `INSERT INTO inventory_movement (inventory_transaction_id, store_id, organization_id, variant_id,
           storage_location_id, movement_type, direction, quantity, reverses_movement_id, stock_adjustment_id,
           stock_adjustment_line_id)
         VALUES ($1, $2, $3, $4, $5, 'REVERSAL', $6, $7, $8, $9, $10)`,
        [tx.rows[0]!.id, a.store, a.org, m.variant_id, m.storage_location_id, m.direction === 'In' ? 'Out' : 'In',
          m.quantity, m.id, a.id, m.stock_adjustment_line_id],
      );
    }
  });
}

/** Draft, approve and post an adjustment in one call: the whole legitimate path. */
export async function adjust(
  pool: pg.Pool,
  w: Pick<StockWorld, 'org' | 'store' | 'reason'>,
  lines: LineInput[],
  kind: 'Adjustment' | 'OpeningBalance' = 'Adjustment',
): Promise<Adjustment> {
  const a = await draftAdjustment(pool, w, lines, kind);
  await approveAdjustment(pool, a.id);
  await postAdjustment(pool, a);
  return a;
}

export async function onHand(db: Db, variant: string, location: string): Promise<number | undefined> {
  const { rows } = await db.query<{ on_hand: string }>(
    'SELECT on_hand FROM stock_balance WHERE variant_id = $1 AND storage_location_id = $2',
    [variant, location],
  );
  return rows[0] ? Number(rows[0].on_hand) : undefined;
}
