import { randomUUID } from 'node:crypto';
import type pg from 'pg';

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
