import type { Queryable } from '../../db/pool.ts';
import { AppError } from '../../http/errors.ts';

/**
 * Adds the currency if it is new (`BI-01`; the deployment currency is the owner's configuration, OQ-006). An existing
 * currency's exponent is never changed, because that would reinterpret every stored amount (`ADR-04`).
 */
export async function ensureCurrency(db: Queryable, code: string, minorUnitExponent: number): Promise<void> {
  await db.query('INSERT INTO currency (code, minor_unit_exponent) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING', [
    code,
    minorUnitExponent,
  ]);
  const { rows } = await db.query<{ exponent: number }>('SELECT minor_unit_exponent AS exponent FROM currency WHERE code = $1', [code]);
  if (rows[0]!.exponent !== minorUnitExponent) {
    throw new AppError(409, 'currency_exponent', `${code} is already recorded with ${rows[0]!.exponent} decimal places.`);
  }
}

/** A tenant (organization-model §2; `ORG-01`, `ORG-02`). */
export async function createOrganization(
  db: Queryable,
  organization: { legalName: string; tradingName: string | null; currencyCode: string; timeZone: string },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO organization (legal_name, trading_name, currency_code, time_zone) VALUES ($1, $2, $3, $4) RETURNING id`,
    [organization.legalName, organization.tradingName, organization.currencyCode, organization.timeZone],
  );
  return rows[0]!.id;
}

/** A store (organization-model §3; `RT-001`). */
export async function createStore(
  db: Queryable,
  store: { organizationId: string; code: string; name: string; timeZone: string; currencyCode: string },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO store (organization_id, code, name, time_zone, currency_code) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [store.organizationId, store.code, store.name, store.timeZone, store.currencyCode],
  );
  return rows[0]!.id;
}

/**
 * A store-attached warehouse with its Default location, which every warehouse must have and which is the store's
 * sellable location (organization-model §5; `MS-17`, `RT-057`, `WH-01`). Call inside a transaction: the database
 * checks the Default at commit (`SS002`).
 */
export async function createStoreWarehouse(
  db: Queryable,
  warehouse: { organizationId: string; storeId: string; code: string; name: string },
): Promise<{ warehouseId: string; defaultLocationId: string }> {
  const w = await db.query<{ id: string }>(
    `INSERT INTO warehouse (organization_id, store_id, kind, code, name) VALUES ($1, $2, 'StoreAttached', $3, $4) RETURNING id`,
    [warehouse.organizationId, warehouse.storeId, warehouse.code, warehouse.name],
  );
  const l = await db.query<{ id: string }>(
    `INSERT INTO storage_location (organization_id, warehouse_id, warehouse_kind, code, name, location_type, is_sellable)
     VALUES ($1, $2, 'StoreAttached', 'DEFAULT', 'Default', 'Default', true) RETURNING id`,
    [warehouse.organizationId, w.rows[0]!.id],
  );
  return { warehouseId: w.rows[0]!.id, defaultLocationId: l.rows[0]!.id };
}

/** One immutable version of a store's settings (`REQ-AU-06`): a document that references it has recorded its snapshot. */
export interface StoreSettings {
  id: string;
  storeId: string;
  effectiveFrom: Date;
  taxMode: 'Inclusive' | 'Exclusive';
  negativeStockPolicy: 'AllowNegative' | 'BlockNegative';
  returnWindowDays: number;
  defaultReturnDisposition: 'Sellable' | 'Quarantine';
  createdAt: Date;
  createdBy: string;
}

export type NewStoreSettings = Pick<
  StoreSettings,
  'storeId' | 'taxMode' | 'negativeStockPolicy' | 'returnWindowDays' | 'defaultReturnDisposition' | 'createdBy'
> & { effectiveFrom: Date | null };

const COLUMNS = `id, store_id AS "storeId", effective_from AS "effectiveFrom", tax_mode AS "taxMode",
  negative_stock_policy AS "negativeStockPolicy", return_window_days AS "returnWindowDays",
  default_return_disposition AS "defaultReturnDisposition", created_at AS "createdAt", created_by AS "createdBy"`;

/**
 * The version in force now, by the database's clock (`REQ-AU-06`, `RT-353`): the latest whose effective time has
 * passed. Null means the store cannot trade (`RT-457`). `storeId` must already be authorized by the gate (`MS-02`).
 */
export async function settingsInForce(db: Queryable, storeId: string): Promise<StoreSettings | null> {
  const { rows } = await db.query<StoreSettings>(
    `SELECT ${COLUMNS} FROM store_setting_version
     WHERE store_id = $1 AND effective_from <= now() ORDER BY effective_from DESC LIMIT 1`,
    [storeId],
  );
  return rows[0] ?? null;
}

/** Versions scheduled for later, soonest first (`REQ-AU-06`: prospective changes have an effective time). */
export async function scheduledSettings(db: Queryable, storeId: string): Promise<StoreSettings[]> {
  const { rows } = await db.query<StoreSettings>(
    `SELECT ${COLUMNS} FROM store_setting_version WHERE store_id = $1 AND effective_from > now() ORDER BY effective_from`,
    [storeId],
  );
  return rows;
}

/**
 * A new store's first settings, in force now: its tax mode as the operator states it, negative stock allowed (`CON-07`:
 * the v1 default for stores, supplied by onboarding rather than by a column default; D1 §2), and the return window and
 * default disposition the schema defines (D5).
 */
export async function createInitialSettings(
  db: Queryable,
  settings: { storeId: string; taxMode: StoreSettings['taxMode']; createdBy: string },
): Promise<void> {
  await db.query(
    `INSERT INTO store_setting_version (store_id, tax_mode, negative_stock_policy, created_by)
     VALUES ($1, $2, 'AllowNegative', $3)`,
    [settings.storeId, settings.taxMode, settings.createdBy],
  );
}

/**
 * Adds a version, effective now or at a later time (`REQ-AU-06`, `IV-16`, `SP-33`). A version is never edited, and
 * one dated in the past is refused by the database. So is a tax-mode change once the store has sold (`SS038`).
 */
export async function addSettingsVersion(db: Queryable, version: NewStoreSettings): Promise<StoreSettings> {
  const { rows } = await db.query<StoreSettings>(
    `INSERT INTO store_setting_version
       (store_id, effective_from, tax_mode, negative_stock_policy, return_window_days, default_return_disposition, created_by)
     VALUES ($1, coalesce($2, now()), $3, $4, $5, $6, $7)
     RETURNING ${COLUMNS}`,
    [
      version.storeId,
      version.effectiveFrom,
      version.taxMode,
      version.negativeStockPolicy,
      version.returnWindowDays,
      version.defaultReturnDisposition,
      version.createdBy,
    ],
  );
  return rows[0]!;
}
