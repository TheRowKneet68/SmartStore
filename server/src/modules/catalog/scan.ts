import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { AppError } from '../../http/errors.ts';

export interface ScannedItem {
  variantId: string;
  productId: string;
  description: string;
  barcode: string;
  unit: { code: string; quantityKind: string; scale: number };
  price: { amount: number; currencyCode: string; minorUnitExponent: number; source: 'store' | 'organization' };
  /** The server's quote time: the sale must carry it, and the price in force then is checked again at save (`RT-124`). */
  quotedAt: Date;
}

interface Row {
  variant_id: string;
  product_id: string;
  product_name: string;
  variant_name: string | null;
  status: string;
  barcode: string;
  unit_code: string;
  quantity_kind: string;
  scale: number;
  tax_category_id: string | null;
  amount: number | null;
  currency_code: string | null;
  minor_unit_exponent: number | null;
  source: 'store' | 'organization' | null;
  quoted_at: Date;
}

/**
 * The till's scan: one statement. An exact match on the live barcode's lookup key (`PR-08`, `PR-12`, `UX-48`), then
 * the price in force, the store's own if it has one, else the organization default (`PR-30`, `RT-040`). It reads no
 * stock and takes no lock: a shortfall surfaces at completion (`UX-25`; ADR-31 §8). The barcode belongs to the
 * caller's organization; the store is the one the gate authorized.
 */
export async function scan(pool: pg.Pool, organizationId: string, storeId: string, code: string): Promise<ScannedItem> {
  const { rows } = await pool.query<Row>(
    `SELECT v.id AS variant_id, p.id AS product_id, p.name AS product_name, v.name AS variant_name, p.status,
            b.value AS barcode, u.code AS unit_code, u.quantity_kind, u.scale, v.tax_category_id,
            coalesce(sp.amount, op.amount) AS amount, coalesce(sp.currency_code, op.currency_code) AS currency_code,
            c.minor_unit_exponent, CASE WHEN sp.amount IS NOT NULL THEN 'store' WHEN op.amount IS NOT NULL THEN 'organization' END AS source,
            now() AS quoted_at
     FROM product_barcode b
     JOIN product_variant v ON v.id = b.variant_id AND v.archived_at IS NULL
     JOIN product p ON p.id = v.product_id
     JOIN unit u ON u.id = v.base_unit_id
     LEFT JOIN LATERAL (SELECT amount, currency_code FROM store_variant_price
                        WHERE store_id = $2 AND variant_id = v.id AND effective_from <= now()
                        ORDER BY effective_from DESC LIMIT 1) sp ON true
     LEFT JOIN LATERAL (SELECT amount, currency_code FROM variant_price
                        WHERE variant_id = v.id AND effective_from <= now()
                        ORDER BY effective_from DESC LIMIT 1) op ON true
     LEFT JOIN currency c ON c.code = coalesce(sp.currency_code, op.currency_code)
     WHERE b.organization_id = $1 AND b.lookup_key = barcode_lookup_key($3) AND b.archived_at IS NULL`,
    [organizationId, storeId, code],
  );
  const row = rows[0];
  // UX-11: an unknown barcode is its own state, with the cart untouched; the message says what to do next.
  if (row === undefined) {
    throw new AppError(404, 'unknown_barcode', `Nothing has the barcode ${code}. Check it, or find the item by name.`);
  }
  const description = row.variant_name === null ? row.product_name : `${row.product_name} — ${row.variant_name}`;
  // SM-11, RT-031: only Active and Discontinued products are sold; Discontinued sells from held stock.
  if (row.status !== 'Active' && row.status !== 'Discontinued') {
    throw new AppError(409, 'not_for_sale', `${description} is not for sale (it is ${row.status}).`);
  }
  // RT-493: a variant with no tax category is unclassified, and no document line may carry it.
  if (row.tax_category_id === null) {
    throw new AppError(409, 'unclassified', `${description} has no tax category, so it cannot be sold yet.`);
  }
  if (row.amount === null || row.currency_code === null || row.source === null || row.minor_unit_exponent === null) {
    throw new AppError(409, 'no_price', `${description} has no price in force, so it cannot be sold yet.`);
  }
  return {
    variantId: row.variant_id,
    productId: row.product_id,
    description,
    barcode: row.barcode,
    unit: { code: row.unit_code, quantityKind: row.quantity_kind, scale: row.scale },
    price: { amount: row.amount, currencyCode: row.currency_code, minorUnitExponent: row.minor_unit_exponent, source: row.source },
    quotedAt: row.quoted_at,
  };
}

const Scan = z.object({ storeId: z.uuid(), code: z.string().trim().min(1).max(200) });

/**
 * `GET /stores/:storeId/scan/:code`. Scanning is how a sale is rung up (`UX-09`), so it needs `Sale.Create` in the store.
 * The code is trimmed, because a scanner may send a trailing return; inside, a code is matched exactly (`PR-12`).
 */
export async function scanRoutes(app: FastifyInstance, options: { pool: pg.Pool }): Promise<void> {
  app.get('/stores/:storeId/scan/:code', { config: { access: { kind: 'permission', key: 'Sale.Create', scope: 'store' } } }, async (request) => {
    const { code } = Scan.parse(request.params);
    return scan(options.pool, request.principal!.organizationId, request.storeId!, code);
  });
}
