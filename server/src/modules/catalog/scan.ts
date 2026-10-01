import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { AppError } from '../../http/errors.ts';
import type { QuoteSigner } from '../sales/quotes.ts';

export interface ScannedItem {
  variantId: string;
  productId: string;
  description: string;
  barcode: string;
  unit: { code: string; quantityKind: string; scale: number };
  price: { amount: number; currencyCode: string; minorUnitExponent: number };
  /** The server's quote time: the sale must carry it, and the price in force then is checked again at save (`RT-124`). */
  quotedAt: Date;
  /** The signed quote the sale carries for this line (D4 §3). */
  quote: string;
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
  currency_code: string;
  minor_unit_exponent: number;
  quoted_at: Date;
  /** The same instant to the microsecond, as the database writes it, so the sale checks the price at that exact time. */
  quoted_at_exact: string;
}

/**
 * The till's scan, one statement: an exact match on the live barcode's lookup key (`PR-08`, `PR-12`, `UX-48`), and the
 * price by `resolve_price()`, the one resolution rule the sale line is checked against too (D4 §3; `PR-30`, `RT-040`).
 * It reads no stock and takes no lock: a shortfall surfaces at completion (`UX-25`; ADR-31 §8).
 */
export async function scan(
  pool: pg.Pool,
  organizationId: string,
  storeId: string,
  code: string,
): Promise<Omit<ScannedItem, 'quote'> & { quotedAtExact: string }> {
  const { rows } = await pool.query<Row>(
    `SELECT v.id AS variant_id, p.id AS product_id, p.name AS product_name, v.name AS variant_name, p.status,
            b.value AS barcode, u.code AS unit_code, u.quantity_kind, u.scale, v.tax_category_id,
            resolve_price(s.id, v.id, now()) AS amount, s.currency_code, c.minor_unit_exponent, now() AS quoted_at,
            to_json(now()) #>> '{}' AS quoted_at_exact
     FROM product_barcode b
     JOIN product_variant v ON v.id = b.variant_id AND v.archived_at IS NULL
     JOIN product p ON p.id = v.product_id
     JOIN unit u ON u.id = v.base_unit_id
     JOIN store s ON s.id = $2
     JOIN currency c ON c.code = s.currency_code
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
  if (row.amount === null) {
    throw new AppError(409, 'no_price', `${description} has no price in force here, so it cannot be sold yet.`);
  }
  return {
    variantId: row.variant_id,
    productId: row.product_id,
    description,
    barcode: row.barcode,
    unit: { code: row.unit_code, quantityKind: row.quantity_kind, scale: row.scale },
    price: { amount: row.amount, currencyCode: row.currency_code, minorUnitExponent: row.minor_unit_exponent },
    quotedAt: row.quoted_at,
    quotedAtExact: row.quoted_at_exact,
  };
}

const Scan = z.object({ storeId: z.uuid(), code: z.string().trim().min(1).max(200) });

/**
 * `GET /stores/:storeId/scan/:code`. Scanning is how a sale is rung up (`UX-09`), so it needs `Sale.Create` in the store.
 * The code is trimmed, because a scanner may send a trailing return; inside, a code is matched exactly (`PR-12`). The
 * answer carries a signed quote of the price, which the sale must bring back (D4 §3).
 */
export async function scanRoutes(app: FastifyInstance, options: { pool: pg.Pool; quotes: QuoteSigner }): Promise<void> {
  app.get('/stores/:storeId/scan/:code', { config: { access: { kind: 'permission', key: 'Sale.Create', scope: 'store' } } }, async (request) => {
    const { code } = Scan.parse(request.params);
    const { quotedAtExact, ...item } = await scan(options.pool, request.principal!.organizationId, request.storeId!, code);
    const quote = options.quotes.sign({
      storeId: request.storeId!,
      variantId: item.variantId,
      unitPrice: item.price.amount,
      currencyCode: item.price.currencyCode,
      quotedAt: quotedAtExact,
      barcode: item.barcode,
    });
    return { ...item, quote };
  });
}
