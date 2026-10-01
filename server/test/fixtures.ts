import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { OnboardingInput } from '../src/onboarding.ts';
import { inTransaction, STAFF_SIZE, staffId } from './db.ts';

/**
 * Test data builders. Everything here is TEST-ONLY.
 *
 * XTS is the ISO 4217 code reserved for testing. Its exponent here is a fixture value, not a claim about XTS; no real
 * currency or exponent is asserted anywhere in the schema (OQ-006).
 */
export const TEST_CURRENCY = 'XTS';
export const TEST_TIME_ZONE = 'UTC';

type Db = pg.Pool | pg.PoolClient;

let staffUsed = 0;
/**
 * An employee of record to name as who did something: the next of the TEST-ONLY staff seeded in the template (db.ts),
 * so consecutive calls are different people, as separation of duties needs.
 */
export const actor = (): string => staffId(1 + (staffUsed++ % (STAFF_SIZE - 1)));

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

// ---------------------------------------------------------------- access (domain 7)

/** TEST-ONLY onboarding answers. XTS is ISO 4217's testing code, seeded in the template with 2 decimal places. */
export const onboardingAnswers = (exponent = 2): OnboardingInput =>
  OnboardingInput.parse({
    organization: { legalName: `TEST-ONLY ${randomUUID()}`, tradingName: null, currencyCode: TEST_CURRENCY, minorUnitExponent: exponent, timeZone: TEST_TIME_ZONE },
    store: { code: 'S1', name: 'Main street', taxMode: 'Inclusive' },
    warehouse: { code: 'W1', name: 'Back room' },
    owner: { employeeNumber: 'E1', firstName: 'Olive', lastName: 'Owner', username: `owner-${randomUUID()}`, password: 'TEST-ONLY pass' },
  });

/**
 * A new employee of `organizationId` holding `keys` through one role, assigned in `assignedStore` (null:
 * organization-wide), with access to `accessStores`. AC-01, EM-13 and MS-11 decide what that grants
 * (employee_holds_permission()).
 */
export async function employeeWithAccess(
  db: Db,
  organizationId: string,
  keys: string[],
  options: { assignedStore: string | null; accessStores: string[] },
): Promise<string> {
  const person = await db.query<{ id: string }>(
    `INSERT INTO employee (organization_id, employee_number, first_name, last_name, status_changed_by)
     VALUES ($1, $2, 'Test', 'Employee', $3) RETURNING id`,
    [organizationId, `E-${randomUUID()}`, actor()],
  );
  const employeeId = person.rows[0]!.id;
  const role = await db.query<{ id: string }>(`INSERT INTO role (organization_id, name) VALUES ($1, $2) RETURNING id`, [
    organizationId,
    `Role ${randomUUID()}`,
  ]);
  for (const key of keys) {
    await db.query(`INSERT INTO role_permission (role_id, organization_id, permission_key, granted_by) VALUES ($1, $2, $3, $4)`, [
      role.rows[0]!.id,
      organizationId,
      key,
      actor(),
    ]);
  }
  await db.query(
    `INSERT INTO employee_role_assignment (employee_id, role_id, organization_id, store_id, assigned_by) VALUES ($1, $2, $3, $4, $5)`,
    [employeeId, role.rows[0]!.id, organizationId, options.assignedStore, actor()],
  );
  for (const store of options.accessStores) {
    await db.query(`INSERT INTO employee_store_access (employee_id, store_id, organization_id, granted_by) VALUES ($1, $2, $3, $4)`, [
      employeeId,
      store,
      organizationId,
      actor(),
    ]);
  }
  return employeeId;
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

/**
 * Runs one statement in its own transaction with `reason` as the audit context's reason code: how the application
 * supplies the reason a transition's contract requires when the document has no reason column of its own (s22; D6).
 */
export async function withReason(pool: pg.Pool, reason: string, sql: string, params: unknown[]): Promise<void> {
  await inTransaction(pool, async (c) => {
    await c.query(`SELECT set_config('smartstore.reason_code_id', $1, true)`, [reason]);
    await c.query(sql, params);
  });
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

// ---------------------------------------------------------------- the till (domain 4)

/** A TEST-ONLY tax rate; no real jurisdiction's rate is asserted anywhere (D-12, GAP-044). */
export async function insertTaxRate(db: Db, organizationId: string, taxCategoryId: string, percent = '10.0000'): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO tax_rate (organization_id, tax_category_id, jurisdiction, rate_percent, created_by)
     VALUES ($1, $2, 'TEST-ONLY', $3, $4) RETURNING id`,
    [organizationId, taxCategoryId, percent, actor()],
  );
  return rows[0]!.id;
}

export interface TillWorld extends StockWorld {
  customer: string;
  terminal: string;
  drawer: string;
  shift: string;
  cashier: string;
  cash: string;
  card: string;
  product: string;
}

export async function openShift(pool: pg.Pool, t: Pick<TillWorld, 'store' | 'terminal' | 'drawer'>, float = 1000): Promise<{ shift: string; cashier: string }> {
  const cashier = actor();
  const shift = await inTransaction(pool, async (c) => {
    const s = await c.query<{ id: string }>(
      `INSERT INTO cash_shift (store_id, pos_terminal_id, cash_drawer_id, opened_by, status_changed_by)
       VALUES ($1, $2, $3, $4, $4) RETURNING id`,
      [t.store, t.terminal, t.drawer, cashier],
    );
    await c.query(
      `INSERT INTO cash_transaction (cash_shift_id, cash_drawer_id, store_id, type, direction, amount, currency_code, created_by)
       VALUES ($1, $2, $3, 'OpeningFloat', 'In', $4, $5, $6)`,
      [s.rows[0]!.id, t.drawer, t.store, float, TEST_CURRENCY, cashier],
    );
    return s.rows[0]!.id;
  });
  return { shift, cashier };
}

/** A store ready to trade: stock on hand, a walk-in, Cash and Card enabled, an active till with a drawer and an open shift. */
export async function tillWorld(pool: pg.Pool, options: { policy?: Policy; stock?: number } = {}): Promise<TillWorld> {
  const w = await stockWorld(pool, options.policy ?? 'AllowNegative');
  const v = await pool.query<{ product_id: string; tax_category_id: string }>(
    'SELECT product_id, tax_category_id FROM product_variant WHERE id = $1',
    [w.variant],
  );
  await insertTaxRate(pool, w.org, v.rows[0]!.tax_category_id);
  if ((options.stock ?? 10) > 0) {
    await adjust(pool, w, [{ variant: w.variant, location: w.location, type: 'OPENING_BALANCE', quantity: options.stock ?? 10 }], 'OpeningBalance');
  }
  const customer = await pool.query<{ id: string }>(
    `INSERT INTO customer (organization_id, is_walk_in, display_name) VALUES ($1, true, 'Walk-in') RETURNING id`,
    [w.org],
  );
  const method = async (code: string, type: string) => {
    const m = await pool.query<{ id: string }>(
      `INSERT INTO payment_method (organization_id, code, name, method_type) VALUES ($1, $2, $2, $3) RETURNING id`,
      [w.org, code, type],
    );
    await pool.query(
      `INSERT INTO store_payment_method (store_id, payment_method_id, is_enabled, changed_by) VALUES ($1, $2, true, $3)`,
      [w.store, m.rows[0]!.id, actor()],
    );
    return m.rows[0]!.id;
  };
  const cash = await method('CASH', 'Cash');
  const card = await method('CARD', 'Card');
  const terminal = await pool.query<{ id: string }>(
    `INSERT INTO pos_terminal (store_id, organization_id, code, label, sell_from_location_id, status_changed_by)
     VALUES ($1, $2, $3, 'Till 1', $4, $5) RETURNING id`,
    [w.store, w.org, `T-${randomUUID()}`, w.location, actor()],
  );
  await pool.query(`UPDATE pos_terminal SET status = 'Active', status_changed_by = $2 WHERE id = $1`, [terminal.rows[0]!.id, actor()]);
  const drawer = await pool.query<{ id: string }>(
    `INSERT INTO cash_drawer (store_id, pos_terminal_id, label, currency_code) VALUES ($1, $2, 'Drawer 1', $3) RETURNING id`,
    [w.store, terminal.rows[0]!.id, TEST_CURRENCY],
  );
  const t = { store: w.store, terminal: terminal.rows[0]!.id, drawer: drawer.rows[0]!.id };
  const { shift, cashier } = await openShift(pool, t);
  return { ...w, ...t, customer: customer.rows[0]!.id, shift, cashier, cash, card, product: v.rows[0]!.product_id };
}

export interface LineRequest {
  variant: string;
  quantity: number;
  scanned?: string;
}

export interface TenderInput {
  type: 'Cash' | 'Card';
  amount: number;
  tendered?: number;
}

export interface PlannedLine {
  variant: string;
  quantity: number;
  unitPrice: number;
  quotedAt: string;
  taxRateId: string;
  taxAmount: number;
  gross: number;
  lineTotal: number;
  settled: number;
  unitCost: number | null;
  location: string;
  scanned: string | null;
  description: string;
  unitName: string;
  stocked: boolean;
}

export interface SalePlan {
  operationId: string;
  lines: PlannedLine[];
  tenders: TenderInput[];
  settingsVersion: string;
  taxMode: string;
  subtotal: number;
  taxTotal: number;
  totalDue: number;
  change: number;
  /** Leave card payments Pending (a timeout) instead of capturing them. */
  leaveCardPending?: boolean;
  /** Card attempts declined before the tenders that settle the sale (PY-42: every attempt is its own row). */
  declinedCardAttempts?: number;
  skipMovements?: boolean;
  skipChange?: boolean;
}

/**
 * Plans a sale the way the server will: the price in force when quoted, the rate and standard cost in force, and
 * totals in the store's tax mode (inclusive tax is extracted from the gross, PR-39). Tests may tamper with the plan
 * before submitting it, to prove the database refuses the tampering.
 */
export async function planSale(pool: pg.Pool, t: TillWorld, requests: LineRequest[], tenders: TenderInput[]): Promise<SalePlan> {
  const settings = await pool.query<{ id: string; tax_mode: string }>(
    `SELECT id, tax_mode FROM store_setting_version WHERE store_id = $1 AND effective_from <= now()
     ORDER BY effective_from DESC LIMIT 1`,
    [t.store],
  );
  const lines: PlannedLine[] = [];
  for (const r of requests) {
    const q = await pool.query<{
      at: Date; price: string; rate_id: string; rate: string; cost: string | null; kind: string; description: string; unit_name: string;
    }>(
      `SELECT now() AS at, resolve_price($1, v.id, now()) AS price, r.id AS rate_id, r.rate_percent AS rate,
              (SELECT amount FROM variant_standard_cost c WHERE c.variant_id = v.id AND c.effective_from <= now()
               ORDER BY c.effective_from DESC LIMIT 1) AS cost,
              u.quantity_kind AS kind, p.name AS description, u.name AS unit_name
       FROM product_variant v JOIN product p ON p.id = v.product_id JOIN unit u ON u.id = v.base_unit_id
       LEFT JOIN LATERAL (SELECT id, rate_percent FROM tax_rate WHERE tax_category_id = v.tax_category_id
                          AND effective_from <= now() ORDER BY effective_from DESC LIMIT 1) r ON true
       WHERE v.id = $2`,
      [t.store, r.variant],
    );
    const row = q.rows[0]!;
    const unitPrice = Number(row.price);
    const gross = Math.round(r.quantity * unitPrice);
    const rate = Number(row.rate ?? 0);
    const inclusive = settings.rows[0]!.tax_mode === 'Inclusive';
    const taxAmount = inclusive ? gross - Math.round(gross / (1 + rate / 100)) : Math.round((gross * rate) / 100);
    const lineTotal = inclusive ? gross : gross + taxAmount;
    lines.push({
      variant: r.variant,
      quantity: r.quantity,
      unitPrice,
      quotedAt: row.at.toISOString(),
      taxRateId: row.rate_id,
      taxAmount,
      gross,
      lineTotal,
      settled: lineTotal,
      unitCost: row.cost === null ? null : Number(row.cost),
      location: t.location,
      scanned: r.scanned ?? null,
      description: row.description,
      unitName: row.unit_name,
      stocked: row.kind !== 'Service',
    });
  }
  const subtotal = lines.reduce((s, l) => s + l.gross, 0);
  const taxTotal = lines.reduce((s, l) => s + l.taxAmount, 0);
  const totalDue = lines.reduce((s, l) => s + l.lineTotal, 0);
  const change = tenders.filter((x) => x.type === 'Cash').reduce((s, x) => s + ((x.tendered ?? x.amount) - x.amount), 0);
  return {
    operationId: randomUUID(),
    lines,
    tenders,
    settingsVersion: settings.rows[0]!.id,
    taxMode: settings.rows[0]!.tax_mode,
    subtotal,
    taxTotal,
    totalDue,
    change,
  };
}

async function insertPayment(db: Db, t: TillWorld, checkout: string, sequence: number, tender: TenderInput): Promise<string> {
  const p = await db.query<{ id: string }>(
    `INSERT INTO payment (checkout_id, store_id, organization_id, payment_method_id, method_type, currency_code, amount,
       tendered_amount, sequence_number, created_by, status_changed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) RETURNING id`,
    [checkout, t.store, t.org, tender.type === 'Cash' ? t.cash : t.card, tender.type, TEST_CURRENCY, tender.amount,
      tender.type === 'Cash' ? (tender.tendered ?? tender.amount) : null, sequence, t.cashier],
  );
  return p.rows[0]!.id;
}

export async function setPaymentStatus(db: Db, payment: string, status: string): Promise<void> {
  await db.query('UPDATE payment SET status = $2, status_changed_by = $3 WHERE id = $1', [payment, status, actor()]);
}

export async function startCheckout(db: Db, t: TillWorld, operationId: string = randomUUID()): Promise<string> {
  const c = await db.query<{ id: string }>(
    `INSERT INTO checkout (store_id, pos_terminal_id, cash_drawer_id, cash_shift_id, client_operation_id, currency_code, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [t.store, t.terminal, t.drawer, t.shift, operationId, TEST_CURRENCY, t.cashier],
  );
  return c.rows[0]!.id;
}

/**
 * Runs the completion order of PY-38: card tenders are authorised and captured first, each in its own transaction as
 * a provider round trip would be; then one transaction writes the cash tenders, the sale, its lines, its movements
 * and its change.
 */
export async function submitSale(pool: pg.Pool, t: TillWorld, plan: SalePlan): Promise<{ saleId: string; checkoutId: string }> {
  const checkoutId = await startCheckout(pool, t, plan.operationId);
  let sequence = 0;
  for (let i = 0; i < (plan.declinedCardAttempts ?? 0); i++) {
    const id = await insertPayment(pool, t, checkoutId, ++sequence, { type: 'Card', amount: plan.totalDue });
    await setPaymentStatus(pool, id, 'Declined');
  }
  for (const tender of plan.tenders.filter((x) => x.type === 'Card')) {
    const id = await insertPayment(pool, t, checkoutId, ++sequence, tender);
    if (!plan.leaveCardPending) {
      await setPaymentStatus(pool, id, 'Authorized');
      await setPaymentStatus(pool, id, 'Captured');
    }
  }
  const saleId = await inTransaction(pool, async (c) => {
    for (const tender of plan.tenders.filter((x) => x.type === 'Cash')) {
      const id = await insertPayment(c, t, checkoutId, ++sequence, tender);
      await setPaymentStatus(c, id, 'Authorized');
      await setPaymentStatus(c, id, 'Captured');
    }
    const s = await c.query<{ id: string }>(
      `INSERT INTO sale (store_id, organization_id, checkout_id, pos_terminal_id, cash_drawer_id, cash_shift_id,
         client_operation_id, employee_id, customer_id, store_setting_version_id, tax_mode, currency_code, subtotal,
         tax_total, total_due, total_tendered, change_given)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15, $16) RETURNING id`,
      [t.store, t.org, checkoutId, t.terminal, t.drawer, t.shift, plan.operationId, t.cashier, t.customer,
        plan.settingsVersion, plan.taxMode, TEST_CURRENCY, plan.subtotal, plan.taxTotal, plan.totalDue, plan.change],
    );
    const sale = s.rows[0]!.id;
    const lineIds: string[] = [];
    for (const [i, l] of plan.lines.entries()) {
      const r = await c.query<{ id: string }>(
        `INSERT INTO sale_line (sale_id, store_id, organization_id, line_number, variant_id, description, unit_name,
           quantity, unit_price, price_quoted_at, gross_amount, tax_rate_id, tax_amount, line_total, settled_amount,
           unit_cost, storage_location_id, entry_method, scanned_barcode)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING id`,
        [sale, t.store, t.org, i + 1, l.variant, l.description, l.unitName, l.quantity, l.unitPrice, l.quotedAt, l.gross,
          l.taxRateId, l.taxAmount, l.lineTotal, l.settled, l.unitCost, l.location, l.scanned ? 'Scanned' : 'Selected', l.scanned],
      );
      lineIds.push(r.rows[0]!.id);
    }
    if (!plan.skipMovements) {
      const tx = await c.query<{ id: string }>(
        'INSERT INTO inventory_transaction (store_id, created_by) VALUES ($1, $2) RETURNING id',
        [t.store, t.cashier],
      );
      const stocked = plan.lines
        .map((l, i) => ({ l, id: lineIds[i]! }))
        .filter((x) => x.l.stocked)
        .sort((a, b) => (a.l.variant + a.l.location).localeCompare(b.l.variant + b.l.location));
      for (const { l, id } of stocked) {
        await c.query(
          `INSERT INTO inventory_movement (inventory_transaction_id, store_id, organization_id, variant_id,
             storage_location_id, movement_type, direction, quantity, sale_id, sale_line_id)
           VALUES ($1, $2, $3, $4, $5, 'SALE', 'Out', $6, $7, $8)`,
          [tx.rows[0]!.id, t.store, t.org, l.variant, l.location, l.quantity, sale, id],
        );
      }
    }
    if (plan.change > 0 && !plan.skipChange) {
      await c.query(
        `INSERT INTO cash_transaction (cash_shift_id, cash_drawer_id, store_id, type, direction, amount, currency_code,
           created_by, sale_id)
         VALUES ($1, $2, $3, 'ChangeDisbursed', 'Out', $4, $5, $6, $7)`,
        [t.shift, t.drawer, t.store, plan.change, TEST_CURRENCY, t.cashier, sale],
      );
    }
    return sale;
  });
  return { saleId, checkoutId };
}

/** Plan and submit, paying the exact total in one tender (cash by default). */
export async function sell(
  pool: pg.Pool,
  t: TillWorld,
  requests: LineRequest[],
  tender: 'Cash' | 'Card' = 'Cash',
): Promise<{ saleId: string; checkoutId: string }> {
  const plan = await planSale(pool, t, requests, []);
  plan.tenders = [{ type: tender, amount: plan.totalDue, tendered: tender === 'Cash' ? plan.totalDue : undefined }];
  return submitSale(pool, t, plan);
}

// ---------------------------------------------------------------- returns and refunds (domain 5)

export interface SoldLine {
  id: string;
  variant: string;
  quantity: number;
  settled: number;
  tax: number;
}

export async function soldLines(db: Db, saleId: string): Promise<SoldLine[]> {
  const { rows } = await db.query<{ id: string; variant_id: string; quantity: string; settled_amount: string; tax_amount: string }>(
    'SELECT id, variant_id, quantity, settled_amount, tax_amount FROM sale_line WHERE sale_id = $1 ORDER BY line_number',
    [saleId],
  );
  return rows.map((r) => ({
    id: r.id,
    variant: r.variant_id,
    quantity: Number(r.quantity),
    settled: Number(r.settled_amount),
    tax: Number(r.tax_amount),
  }));
}

/** The captured tender of a single-tender sale. */
export async function capturedPayment(db: Db, saleId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT p.id FROM payment p JOIN sale s ON s.checkout_id = p.checkout_id WHERE s.id = $1 AND p.status = 'Captured'`,
    [saleId],
  );
  return rows[0]!.id;
}

export type Disposition = 'Sellable' | 'Quarantine' | 'Damaged' | 'Expired';

export interface ReturnLineInput {
  line: SoldLine;
  quantity: number;
  /** Sellable when omitted. */
  disposition?: Disposition;
  /** The till's sellable location when omitted. */
  location?: string;
}

export interface CustomerReturn {
  id: string;
  store: string;
  org: string;
  sale: string;
  createdBy: string;
}

export async function draftReturn(
  db: Db,
  t: TillWorld,
  saleId: string,
  lines: ReturnLineInput[],
  operationId: string = randomUUID(),
): Promise<CustomerReturn> {
  const createdBy = actor();
  const r = await db.query<{ id: string }>(
    `INSERT INTO customer_return (store_id, organization_id, sale_id, client_operation_id, created_by, status_changed_by)
     VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
    [t.store, t.org, saleId, operationId, createdBy],
  );
  const ret = { id: r.rows[0]!.id, store: t.store, org: t.org, sale: saleId, createdBy };
  for (const l of lines) await addReturnLine(db, t, ret, l);
  return ret;
}

export async function addReturnLine(
  db: Db,
  t: TillWorld,
  r: CustomerReturn,
  l: ReturnLineInput,
  operationId: string = randomUUID(),
): Promise<string> {
  const x = await db.query<{ id: string }>(
    `INSERT INTO customer_return_line (customer_return_id, store_id, organization_id, sale_id, sale_line_id, variant_id,
       quantity, disposition, storage_location_id, client_operation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [r.id, t.store, t.org, r.sale, l.line.id, l.line.variant, l.quantity, l.disposition ?? 'Sellable', l.location ?? t.location,
      operationId],
  );
  return x.rows[0]!.id;
}

/** The posting transaction: status Posted, one inventory transaction, one SALE_RETURN movement per line, sorted. */
export async function postReturn(pool: pg.Pool, r: CustomerReturn, options: { skipMovements?: boolean; poster?: string } = {}): Promise<void> {
  await inTransaction(pool, async (c) => {
    const poster = options.poster ?? actor();
    await c.query(`UPDATE customer_return SET status = 'Posted', posted_by = $2, status_changed_by = $2 WHERE id = $1`, [r.id, poster]);
    if (options.skipMovements) return;
    const tx = await c.query<{ id: string }>(
      'INSERT INTO inventory_transaction (store_id, created_by) VALUES ($1, $2) RETURNING id',
      [r.store, poster],
    );
    const lines = await c.query<{ id: string; variant_id: string; storage_location_id: string; quantity: string; disposition: string }>(
      `SELECT id, variant_id, storage_location_id, quantity, disposition FROM customer_return_line
       WHERE customer_return_id = $1 ORDER BY variant_id, storage_location_id, id`,
      [r.id],
    );
    for (const l of lines.rows) {
      await c.query(
        `INSERT INTO inventory_movement (inventory_transaction_id, store_id, organization_id, variant_id, storage_location_id,
           movement_type, direction, quantity, customer_return_id, customer_return_line_id, disposition)
         VALUES ($1, $2, $3, $4, $5, 'SALE_RETURN', 'In', $6, $7, $8, $9)`,
        [tx.rows[0]!.id, r.store, r.org, l.variant_id, l.storage_location_id, l.quantity, r.id, l.id, l.disposition],
      );
    }
  });
}

/** Draft and post a return in one call: the whole legitimate path. */
export async function returnGoods(pool: pg.Pool, t: TillWorld, saleId: string, lines: ReturnLineInput[]): Promise<CustomerReturn> {
  const r = await draftReturn(pool, t, saleId, lines);
  await postReturn(pool, r);
  return r;
}

/**
 * RR-06, RR-42: the tax on refunding `amount` of a line after `before` was refunded: the line's stored tax in proportion
 * to the cumulative refunded amount, rounded half away from zero, less the tax already refunded.
 */
export function refundTax(line: SoldLine, amount: number, before = { amount: 0, tax: 0 }): number {
  return Math.round((line.tax * (before.amount + amount)) / line.settled) - before.tax;
}

export interface RefundInput {
  lines: { line: SoldLine; amount: number; tax?: number }[];
  method?: 'OriginalTender' | 'Cash';
  payment?: string;
  returnId?: string;
  reason?: string;
  /** Name the till's drawer and shift (a drawer refund). True unless a card refund goes to the provider. */
  till?: boolean;
  operationId?: string;
  /** Override the header totals, to prove they must equal the lines. */
  amount?: number;
}

export async function draftRefund(db: Db, t: TillWorld, saleId: string, input: RefundInput): Promise<{ id: string; createdBy: string }> {
  const createdBy = actor();
  const lines = input.lines.map((l) => ({ ...l, tax: l.tax ?? refundTax(l.line, l.amount) }));
  const till = input.till === false ? [null, null, null] : [t.terminal, t.drawer, t.shift];
  const r = await db.query<{ id: string }>(
    `INSERT INTO refund (store_id, organization_id, sale_id, customer_return_id, client_operation_id, method, payment_id,
       pos_terminal_id, cash_drawer_id, cash_shift_id, amount, tax_amount, currency_code, reason_code_id, created_by,
       status_changed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15) RETURNING id`,
    [t.store, t.org, saleId, input.returnId ?? null, input.operationId ?? randomUUID(), input.method ?? 'Cash',
      input.payment ?? null, ...till, input.amount ?? lines.reduce((s, l) => s + l.amount, 0),
      lines.reduce((s, l) => s + l.tax, 0), TEST_CURRENCY, input.reason ?? null, createdBy],
  );
  for (const l of lines) {
    await db.query(
      'INSERT INTO refund_line (refund_id, store_id, sale_id, sale_line_id, amount, tax_amount) VALUES ($1, $2, $3, $4, $5, $6)',
      [r.rows[0]!.id, t.store, saleId, l.line.id, l.amount, l.tax],
    );
  }
  return { id: r.rows[0]!.id, createdBy };
}

/** Submit by one employee and approve by another (BI-26), as state-machines s22.7 requires. */
export async function approveRefund(db: Db, id: string): Promise<void> {
  const submitter = actor();
  await db.query(`UPDATE refund SET status = 'PendingApproval', submitted_by = $2, status_changed_by = $2 WHERE id = $1`, [id, submitter]);
  const approver = actor();
  await db.query(`UPDATE refund SET status = 'Approved', approved_by = $2, status_changed_by = $2 WHERE id = $1`, [id, approver]);
}

/** Moves a refund along one edge; `cancelReason` is recorded with a cancellation (s22.7). */
export async function setRefundStatus(db: Db, id: string, status: string, cancelReason: string | null = null): Promise<void> {
  await db.query(
    `UPDATE refund SET status = $2, status_changed_by = $3, cancel_reason_code_id = coalesce($4, cancel_reason_code_id)
     WHERE id = $1`,
    [id, status, actor(), cancelReason],
  );
}

/** A drawer refund's payout transaction: hold, pay out of the drawer, complete, as one event (PY-27). */
export async function payOutRefund(
  pool: pg.Pool,
  id: string,
  options: { skipPayout?: boolean; payout?: number; skipComplete?: boolean } = {},
): Promise<void> {
  await inTransaction(pool, async (c) => {
    await setRefundStatus(c, id, 'Processing');
    const { rows } = await c.query<{ amount: string; cash_shift_id: string; cash_drawer_id: string; store_id: string }>(
      'SELECT amount, cash_shift_id, cash_drawer_id, store_id FROM refund WHERE id = $1',
      [id],
    );
    const r = rows[0]!;
    if (!options.skipPayout) {
      await c.query(
        `INSERT INTO cash_transaction (cash_shift_id, cash_drawer_id, store_id, type, direction, amount, currency_code,
           created_by, refund_id)
         VALUES ($1, $2, $3, 'RefundFromDrawer', 'Out', $4, $5, $6, $7)`,
        [r.cash_shift_id, r.cash_drawer_id, r.store_id, options.payout ?? Number(r.amount), TEST_CURRENCY, actor(), id],
      );
    }
    if (!options.skipComplete) await setRefundStatus(c, id, 'Completed');
  });
}

/** Draft, approve and pay out a drawer refund: the whole legitimate path. */
export async function cashRefund(pool: pg.Pool, t: TillWorld, saleId: string, input: RefundInput): Promise<string> {
  const { id } = await draftRefund(pool, t, saleId, input);
  await approveRefund(pool, id);
  await payOutRefund(pool, id);
  return id;
}
