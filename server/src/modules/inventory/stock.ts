import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import type { Access } from '../../http/gate.ts';
import { MAX_PAGE, paged, pageOf } from '../../http/paging.ts';

const inStore = (key: string): { config: { access: Access } } => ({ config: { access: { kind: 'permission', key, scope: 'store' } } });
const Filters = z.object({ variantId: z.uuid().optional(), locationId: z.uuid().optional() });
/**
 * The ledger pages by its own order, newest first: `after` is the `next` of the page before, as on every list.
 * ponytail: `before` is the same cursor under the name this route had first, kept for the screens written against
 * it; drop it once they read `next`.
 */
const LedgerPage = Filters.extend({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE).default(100),
  after: z.coerce.number().int().optional(),
  before: z.coerce.number().int().optional(),
});

/** The store's locations: those of its own warehouses, and central ones attributed to it (`MS-16`, `MS-17`, `D-03`). */
export const STORE_LOCATIONS = `
  SELECT l.id FROM storage_location l JOIN warehouse w ON w.id = l.warehouse_id WHERE w.store_id = $1
  UNION SELECT storage_location_id FROM storage_location_attribution WHERE store_id = $1`;

/**
 * What a store holds (`IV-01`, `IV-02`, `MS-02`): balances at its locations only, never another store's, and the
 * ledger behind them (`IV-06`). Stock is read, never set: balances change only by documents (`IV-14`).
 */
export async function stockRoutes(app: FastifyInstance, options: { pool: pg.Pool }): Promise<void> {
  const { pool } = options;

  app.get('/stores/:storeId/locations', inStore('Inventory.View'), async (request) => {
    const page = pageOf(request.query);
    const { rows } = await pool.query(
      `SELECT l.id, l.code, l.name, l.location_type AS "locationType", l.is_sellable AS "isSellable",
              w.code AS "warehouseCode", w.name AS "warehouseName"
       FROM storage_location l JOIN warehouse w ON w.id = l.warehouse_id
       WHERE l.id IN (${STORE_LOCATIONS}) ORDER BY w.code, l.code, l.id LIMIT $2 OFFSET $3`,
      [request.storeId, page.limit, page.offset],
    );
    return paged(rows, page);
  });

  /** On-hand quantities at the store's locations, negative ones included and never clamped (`IV-17`, `RT-484`). */
  app.get('/stores/:storeId/stock', inStore('Inventory.View'), async (request) => {
    const filters = Filters.parse(request.query);
    const page = pageOf(request.query);
    const { rows } = await pool.query(
      `SELECT b.variant_id AS "variantId", p.name AS product, v.name AS variant, b.storage_location_id AS "locationId",
              l.code AS location, b.on_hand::text AS "onHand", b.movement_count AS "movementCount", b.last_movement_at AS "lastMovementAt"
       FROM stock_balance b JOIN product_variant v ON v.id = b.variant_id JOIN product p ON p.id = v.product_id
       JOIN storage_location l ON l.id = b.storage_location_id
       WHERE b.storage_location_id IN (${STORE_LOCATIONS})
         AND ($2::uuid IS NULL OR b.variant_id = $2) AND ($3::uuid IS NULL OR b.storage_location_id = $3)
       ORDER BY p.name, v.name NULLS FIRST, l.code, b.variant_id, b.storage_location_id LIMIT $4 OFFSET $5`,
      [request.storeId, filters.variantId ?? null, filters.locationId ?? null, page.limit, page.offset],
    );
    return paged(rows, page);
  });

  /**
   * The movement ledger of the store, newest first, a page at a time (§18.5): `Inventory.Ledger.View`, separate from
   * `Inventory.View` because it shows who moved what (actors-and-roles §2.2).
   */
  app.get('/stores/:storeId/movements', inStore('Inventory.Ledger.View'), async (request) => {
    const page = LedgerPage.parse(request.query);
    const cursor = page.after ?? page.before ?? null;
    const { rows } = await pool.query<{ seq: number }>(
      `SELECT m.seq, m.id, m.movement_type AS "movementType", m.direction, m.quantity::text AS quantity,
              m.resulting_balance::text AS "resultingBalance", m.variant_id AS "variantId", m.storage_location_id AS "locationId",
              m.created_at AS "createdAt", t.created_by AS "createdBy", t.business_date::text AS "businessDate",
              m.sale_id AS "saleId", m.stock_adjustment_id AS "stockAdjustmentId", m.customer_return_id AS "customerReturnId",
              m.reverses_movement_id AS "reversesMovementId"
       FROM inventory_movement m JOIN inventory_transaction t ON t.id = m.inventory_transaction_id
       WHERE m.store_id = $1 AND ($2::uuid IS NULL OR m.variant_id = $2) AND ($3::uuid IS NULL OR m.storage_location_id = $3)
         AND ($4::bigint IS NULL OR m.seq < $4)
       ORDER BY m.seq DESC LIMIT $5`,
      [request.storeId, page.variantId ?? null, page.locationId ?? null, cursor, page.limit],
    );
    const last = rows.length === page.limit ? rows.at(-1)!.seq : null;
    return { items: rows, next: last === null ? null : String(last), before: last };
  });
}
