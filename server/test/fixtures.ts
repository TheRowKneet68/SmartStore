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
