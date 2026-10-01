import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction, type Queryable } from '../../db/pool.ts';
import { AppError } from '../../http/errors.ts';
import { auditContext, requirePermission, type Access } from '../../http/gate.ts';
import type { MachineBinding } from '../../http/transitions.ts';

/** The Product machine (§22.1). Its edges, keys, events and reasons are data; the database checks activation (SM-12). */
export const productMachine: MachineBinding = {
  machine: 'Product',
  noun: 'product',
  table: 'product',
  stateColumn: 'status',
  actorColumn: 'status_changed_by',
  storeColumn: null,
};

const organizationWide = (key: string): { config: { access: Access } } => ({ config: { access: { kind: 'permission', key, scope: 'organization' } } });
const inStore = (key: string): { config: { access: Access } } => ({ config: { access: { kind: 'permission', key, scope: 'store' } } });

const text = z.string().trim().min(1).max(500);
const Id = z.object({ id: z.uuid() });
const StoreVariant = z.object({ storeId: z.uuid(), id: z.uuid() });
// The ten symbologies of product-domain §5.1. A scanner may send trailing whitespace; a code never contains any (PR-12).
const BARCODE_KINDS = ['EAN13', 'EAN8', 'UPC_A', 'UPC_E', 'Code128', 'ITF14', 'GS1-128', 'QR', 'PLU', 'Internal'] as const;
const Barcode = z.object({ value: z.string().trim().min(1).max(200), kind: z.enum(BARCODE_KINDS) });
// Integer minor units (ADR-04). The database refuses zero and negatives for a price, negatives for a cost.
const Money = z.object({ amount: z.number().int().safe(), effectiveFrom: z.iso.datetime({ offset: true }).optional() });
const NewProduct = z.object({ categoryId: z.uuid(), brandId: z.uuid().nullable().optional(), name: text, description: text.nullable().optional() });
const ChangedProduct = z.object({
  categoryId: z.uuid().optional(),
  brandId: z.uuid().nullable().optional(),
  name: text.optional(),
  description: text.nullable().optional(),
});
const NewVariant = z.object({
  name: text.nullable().optional(),
  baseUnitId: z.uuid(),
  taxCategoryId: z.uuid().nullable().optional(),
  price: Money.optional(),
  barcodes: z.array(Barcode).max(20).optional(),
});
const ChangedVariant = z.object({ name: text.nullable().optional(), taxCategoryId: z.uuid().nullable().optional() });
const NewBarcode = Barcode.extend({ isPrimary: z.boolean().optional() });
const Page = z.object({ search: z.string().trim().max(200).optional(), after: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });

const notFound = (what: string) => new AppError(404, 'not_found', `There is no such ${what}.`);
const org = (request: FastifyRequest) => request.principal!.organizationId;
const me = (request: FastifyRequest) => request.principal!.employeeId;

/**
 * Adds a price version, now or later (`PR-32`: prospective; `RT-041`), in the organization's currency (the default,
 * `PR-30`'s last tier) or the store's (an override). A price below the standard cost in force needs approval by a
 * different employee (`PR-33`), which v1 does not build, so it is refused: the fallback of architecture §8.4.
 */
async function addPrice(
  c: Queryable,
  price: { organizationId: string; storeId: string | null; variantId: string; amount: number; effectiveFrom: string | null; by: string },
): Promise<string> {
  const cost = await c.query<{ amount: number | string }>(
    `SELECT s.amount FROM product_variant v
     LEFT JOIN LATERAL (SELECT amount FROM variant_standard_cost WHERE variant_id = v.id AND effective_from <= now()
                        ORDER BY effective_from DESC LIMIT 1) s ON true
     WHERE v.id = $1 AND v.organization_id = $2`,
    [price.variantId, price.organizationId],
  );
  if (cost.rows.length === 0) throw notFound('variant');
  const standard = cost.rows[0]!.amount;
  if (standard !== null && price.amount < Number(standard)) {
    throw new AppError(409, 'below_cost', 'This price is below the standard cost. That needs approval by another employee, which this version does not have.');
  }
  const { rows } =
    price.storeId === null
      ? await c.query<{ id: string }>(
          `INSERT INTO variant_price (organization_id, variant_id, currency_code, amount, effective_from, created_by)
           SELECT o.id, $2, o.currency_code, $3, coalesce($4::timestamptz, now()), $5 FROM organization o WHERE o.id = $1 RETURNING id`,
          [price.organizationId, price.variantId, price.amount, price.effectiveFrom, price.by],
        )
      : await c.query<{ id: string }>(
          `INSERT INTO store_variant_price (store_id, organization_id, variant_id, currency_code, amount, effective_from, created_by)
           SELECT s.id, s.organization_id, $3, s.currency_code, $4, coalesce($5::timestamptz, now()), $6
           FROM store s WHERE s.id = $1 AND s.organization_id = $2 RETURNING id`,
          [price.storeId, price.organizationId, price.variantId, price.amount, price.effectiveFrom, price.by],
        );
  return rows[0]!.id;
}

/** Registers a barcode (`PR-08`..`PR-12`). The first live one is primary; a new primary takes over from the old. */
async function addBarcode(c: Queryable, barcode: { organizationId: string; variantId: string; value: string; kind: string; isPrimary: boolean }): Promise<string> {
  const live = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM product_barcode WHERE variant_id = $1 AND archived_at IS NULL', [barcode.variantId]);
  const primary = barcode.isPrimary || live.rows[0]!.n === 0;
  if (primary) await c.query('UPDATE product_barcode SET is_primary = false WHERE variant_id = $1 AND is_primary', [barcode.variantId]);
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO product_barcode (organization_id, variant_id, value, kind, is_primary) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [barcode.organizationId, barcode.variantId, barcode.value, barcode.kind, primary],
  );
  return rows[0]!.id;
}

const encodeCursor = (name: string, id: string) => Buffer.from(JSON.stringify([name, id])).toString('base64url');
function decodeCursor(cursor: string): [string, string] {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') return [parsed[0], parsed[1]];
  } catch {
    // fall through
  }
  throw new AppError(400, 'invalid_request', 'The page cursor is not valid.');
}

/** Products, variants, barcodes, prices and standard costs (product-domain; D2 §3). Product keys are organization-wide. */
export async function productRoutes(app: FastifyInstance, options: { pool: pg.Pool }): Promise<void> {
  const { pool } = options;

  /** Products by name, a page at a time (§18.5). A name search is a contains match, never mixed with barcodes (`UX-48`). */
  app.get('/products', organizationWide('Product.View'), async (request) => {
    const page = Page.parse(request.query);
    const [afterName, afterId] = page.after === undefined ? [null, null] : decodeCursor(page.after);
    const pattern = page.search === undefined || page.search === '' ? null : `%${page.search.replace(/[\\%_]/g, '\\$&')}%`;
    const { rows } = await pool.query<{ id: string; name: string }>(
      `SELECT id, name, status, category_id AS "categoryId", brand_id AS "brandId" FROM product
       WHERE organization_id = $1 AND ($2::text IS NULL OR name ILIKE $2)
         AND ($3::text IS NULL OR (lower(name), id) > ($3, $4::uuid))
       ORDER BY lower(name), id LIMIT $5`,
      [org(request), pattern, afterName, afterId, page.limit],
    );
    const last = rows.at(-1);
    return { items: rows, next: rows.length === page.limit && last ? encodeCursor(last.name.toLowerCase(), last.id) : null };
  });

  /** A product with its variants and their live barcodes. Prices and costs are read separately (`Price.View`, `PR-36`). */
  app.get('/products/:id', organizationWide('Product.View'), async (request) => {
    const { id } = Id.parse(request.params);
    const product = await pool.query(
      `SELECT id, name, description, status, category_id AS "categoryId", brand_id AS "brandId",
              status_changed_at AS "statusChangedAt"
       FROM product WHERE id = $1 AND organization_id = $2`,
      [id, org(request)],
    );
    if (product.rows.length === 0) throw notFound('product');
    const variants = await pool.query(
      `SELECT v.id, v.name, v.base_unit_id AS "baseUnitId", v.tax_category_id AS "taxCategoryId", v.archived_at AS "archivedAt",
              coalesce((SELECT json_agg(json_build_object('id', b.id, 'value', b.value, 'kind', b.kind, 'isPrimary', b.is_primary)
                                        ORDER BY b.is_primary DESC, b.created_at)
                        FROM product_barcode b WHERE b.variant_id = v.id AND b.archived_at IS NULL), '[]') AS barcodes
       FROM product_variant v WHERE v.product_id = $1 ORDER BY v.created_at`,
      [id],
    );
    return { ...product.rows[0], variants: variants.rows };
  });

  /** A new product, always `Draft` (`PR-02`). §22.1 has no creation row, so creating one is `Product.Create`. */
  app.post('/products', organizationWide('Product.Create'), async (request, reply) => {
    const body = NewProduct.parse(request.body);
    const { rows } = await withTransaction(pool, auditContext(request), (c) =>
      c.query<{ id: string }>(
        `INSERT INTO product (organization_id, category_id, brand_id, name, description, status_changed_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [org(request), body.categoryId, body.brandId ?? null, body.name, body.description ?? null, me(request)],
      ),
    );
    return reply.status(201).send({ id: rows[0]!.id });
  });

  app.patch('/products/:id', organizationWide('Product.Edit'), async (request) => {
    const { id } = Id.parse(request.params);
    const body = ChangedProduct.parse(request.body);
    const updated = await withTransaction(pool, auditContext(request), (c) =>
      c.query(
        `UPDATE product SET category_id = coalesce($3, category_id), name = coalesce($4, name),
                            brand_id = CASE WHEN $5 THEN $6::uuid ELSE brand_id END,
                            description = CASE WHEN $7 THEN $8 ELSE description END
         WHERE id = $1 AND organization_id = $2`,
        [id, org(request), body.categoryId ?? null, body.name ?? null, body.brandId !== undefined, body.brandId ?? null, body.description !== undefined, body.description ?? null],
      ),
    );
    if (updated.rowCount === 0) throw notFound('product');
    return { id };
  });

  /**
   * A variant, with its first price and barcodes in the same transaction. A variant of a released product must have a
   * price by commit (`RT-042`, `SS008`), and one of an archived product is refused (`SS009`). Setting a price also
   * needs `Price.Edit`.
   */
  app.post('/products/:id/variants', organizationWide('Product.Create'), async (request, reply) => {
    const { id } = Id.parse(request.params);
    const body = NewVariant.parse(request.body);
    if (body.price !== undefined) await requirePermission(pool, request, 'Price.Edit', null);
    const variant = await withTransaction(pool, auditContext(request), async (c) => {
      const created = await c.query<{ id: string }>(
        `INSERT INTO product_variant (organization_id, product_id, name, base_unit_id, tax_category_id)
         SELECT organization_id, id, $3, $4, $5 FROM product WHERE id = $1 AND organization_id = $2 RETURNING id`,
        [id, org(request), body.name ?? null, body.baseUnitId, body.taxCategoryId ?? null],
      );
      if (created.rows.length === 0) throw notFound('product');
      const variantId = created.rows[0]!.id;
      if (body.price !== undefined) {
        await addPrice(c, { organizationId: org(request), storeId: null, variantId, amount: body.price.amount, effectiveFrom: body.price.effectiveFrom ?? null, by: me(request) });
      }
      for (const [i, barcode] of (body.barcodes ?? []).entries()) {
        await addBarcode(c, { organizationId: org(request), variantId, value: barcode.value, kind: barcode.kind, isPrimary: i === 0 });
      }
      return variantId;
    });
    return reply.status(201).send({ id: variant });
  });

  /** The descriptive name and the tax category; the product and base unit never change (`PR-15`). */
  app.patch('/variants/:id', organizationWide('Product.Edit'), async (request) => {
    const { id } = Id.parse(request.params);
    const body = ChangedVariant.parse(request.body);
    const updated = await withTransaction(pool, auditContext(request), (c) =>
      c.query(
        `UPDATE product_variant SET name = CASE WHEN $3 THEN $4 ELSE name END,
                                    tax_category_id = CASE WHEN $5 THEN $6::uuid ELSE tax_category_id END
         WHERE id = $1 AND organization_id = $2`,
        [id, org(request), body.name !== undefined, body.name ?? null, body.taxCategoryId !== undefined, body.taxCategoryId ?? null],
      ),
    );
    if (updated.rowCount === 0) throw notFound('variant');
    return { id };
  });

  /** Archived once: it blocks new use and never touches stock or the product (`PR-48`, `RT-495`, `EC-33`). */
  app.post('/variants/:id/archive', organizationWide('Product.Edit'), async (request) => {
    const { id } = Id.parse(request.params);
    const changed = await withTransaction(pool, auditContext(request), async (c) => {
      const found = await c.query<{ archived: boolean }>(
        'SELECT archived_at IS NOT NULL AS archived FROM product_variant WHERE id = $1 AND organization_id = $2 FOR UPDATE',
        [id, org(request)],
      );
      if (found.rows.length === 0) throw notFound('variant');
      if (found.rows[0]!.archived) return false;
      await c.query('UPDATE product_variant SET archived_by = $2 WHERE id = $1', [id, me(request)]);
      return true;
    });
    return { id, archived: true, changed };
  });

  /** A barcode, unique in the organization and never re-pointed (`PR-08`, `PR-09`, `RT-024`, `EC-41`). */
  app.post('/variants/:id/barcodes', organizationWide('Product.Edit'), async (request, reply) => {
    const { id } = Id.parse(request.params);
    const body = NewBarcode.parse(request.body);
    const barcode = await withTransaction(pool, auditContext(request), async (c) => {
      const variant = await c.query('SELECT 1 FROM product_variant WHERE id = $1 AND organization_id = $2 FOR UPDATE', [id, org(request)]);
      if (variant.rows.length === 0) throw notFound('variant');
      return addBarcode(c, { organizationId: org(request), variantId: id, value: body.value, kind: body.kind, isPrimary: body.isPrimary ?? false });
    });
    return reply.status(201).send({ id: barcode });
  });

  /** Makes a barcode its variant's primary (`PR-08`: one live primary). */
  app.post('/barcodes/:id/primary', organizationWide('Product.Edit'), async (request) => {
    const { id } = Id.parse(request.params);
    await withTransaction(pool, auditContext(request), async (c) => {
      const found = await c.query<{ variant_id: string }>(
        'SELECT variant_id FROM product_barcode WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL FOR UPDATE',
        [id, org(request)],
      );
      if (found.rows.length === 0) throw notFound('live barcode');
      await c.query('UPDATE product_barcode SET is_primary = (id = $2) WHERE variant_id = $1 AND archived_at IS NULL', [found.rows[0]!.variant_id, id]);
    });
    return { id, isPrimary: true };
  });

  /** Archives a barcode: it leaves the unique index, so the value can be issued again (`PR-09`, `PR-10`). */
  app.post('/barcodes/:id/archive', organizationWide('Product.Edit'), async (request) => {
    const { id } = Id.parse(request.params);
    const archived = await withTransaction(pool, auditContext(request), (c) =>
      c.query('UPDATE product_barcode SET archived_by = $3, is_primary = false WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL', [
        id,
        org(request),
        me(request),
      ]),
    );
    if (archived.rowCount === 0) throw notFound('live barcode');
    return { id, archived: true };
  });

  /** The organization default price's versions, in force and scheduled (`PR-30`, `PR-32`). */
  app.get('/variants/:id/prices', organizationWide('Price.View'), async (request) => {
    const { id } = Id.parse(request.params);
    const { rows } = await pool.query(
      `SELECT p.id, p.amount, p.currency_code AS "currencyCode", p.effective_from AS "effectiveFrom", p.effective_from <= now() AS started
       FROM variant_price p WHERE p.variant_id = $1 AND p.organization_id = $2 ORDER BY p.effective_from DESC LIMIT 50`,
      [id, org(request)],
    );
    return { items: rows };
  });

  app.post('/variants/:id/prices', organizationWide('Price.Edit'), async (request, reply) => {
    const { id } = Id.parse(request.params);
    const body = Money.parse(request.body);
    const price = await withTransaction(pool, auditContext(request), (c) =>
      addPrice(c, { organizationId: org(request), storeId: null, variantId: id, amount: body.amount, effectiveFrom: body.effectiveFrom ?? null, by: me(request) }),
    );
    return reply.status(201).send({ id: price });
  });

  /** A store's override of the default, in the store's currency (`PR-30`, organization-model §8.2). */
  app.post('/stores/:storeId/variants/:id/prices', inStore('Price.Edit'), async (request, reply) => {
    const { id } = StoreVariant.parse(request.params);
    const body = Money.parse(request.body);
    const price = await withTransaction(pool, auditContext(request), (c) =>
      addPrice(c, { organizationId: org(request), storeId: request.storeId, variantId: id, amount: body.amount, effectiveFrom: body.effectiveFrom ?? null, by: me(request) }),
    );
    return reply.status(201).send({ id: price });
  });

  /**
   * A standard cost version (`PR-35`), for margin and the below-cost check. Setting one needs `Product.Edit` and also
   * `Product.Cost.View`, because cost is visible only with that key (`PR-36`).
   */
  app.post('/variants/:id/costs', organizationWide('Product.Edit'), async (request, reply) => {
    const { id } = Id.parse(request.params);
    const body = Money.parse(request.body);
    await requirePermission(pool, request, 'Product.Cost.View', null);
    const { rows } = await withTransaction(pool, auditContext(request), (c) =>
      c.query<{ id: string }>(
        `INSERT INTO variant_standard_cost (organization_id, variant_id, currency_code, amount, effective_from, created_by)
         SELECT v.organization_id, v.id, o.currency_code, $3, coalesce($4::timestamptz, now()), $5
         FROM product_variant v JOIN organization o ON o.id = v.organization_id WHERE v.id = $1 AND v.organization_id = $2 RETURNING id`,
        [id, org(request), body.amount, body.effectiveFrom ?? null, me(request)],
      ),
    );
    if (rows.length === 0) throw notFound('variant');
    return reply.status(201).send({ id: rows[0]!.id });
  });
}
