import type { Queryable } from '../../db/pool.ts';

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
