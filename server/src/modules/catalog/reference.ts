import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction } from '../../db/pool.ts';
import { AppError } from '../../http/errors.ts';
import { auditContext, type Access } from '../../http/gate.ts';

// The catalogue belongs to the organization (organization-model §8.1), so its keys are held organization-wide (OQ-025
// item 6). Tax.* covers tax categories and rates (actors-and-roles §2.1); Product.* covers the other catalogue entries.
const access = (key: string): { config: { access: Access } } => ({ config: { access: { kind: 'permission', key, scope: 'organization' } } });

const text = z.string().trim().min(1).max(200);
const Id = z.object({ id: z.uuid() });
const NewUnit = z.object({
  code: text,
  name: text,
  pluralName: text.nullable().optional(),
  quantityKind: z.enum(['Countable', 'Measurable', 'Service']),
  scale: z.number().int().min(0).max(4),
});
const NewTaxCategory = z.object({ code: text, name: text });
// A rate is a decimal string, never a float (ADR-04's reasoning applied to percentages; numeric(9,4)).
const NewRate = z.object({
  jurisdiction: text,
  ratePercent: z.string().regex(/^\d{1,5}(\.\d{1,4})?$/),
  effectiveFrom: z.iso.datetime({ offset: true }).optional(),
});
const NewCategory = z.object({ name: text, parentId: z.uuid().nullable(), sortOrder: z.number().int() });
const ChangedCategory = z.object({ name: text.optional(), parentId: z.uuid().nullable().optional(), sortOrder: z.number().int().optional() });
const NewBrand = z.object({ name: text });
const ChangedUnit = NewUnit.partial();
const ChangedTaxCategory = NewTaxCategory.partial();

// The columns each kind of row may change (D2 §4's update grants), by request field.
const UNIT_COLUMNS = { code: 'code', name: 'name', pluralName: 'plural_name', quantityKind: 'quantity_kind', scale: 'scale' };
const TAX_CATEGORY_COLUMNS = { code: 'code', name: 'name' };
const BRAND_COLUMNS = { name: 'name' };

const notFound = (what: string) => new AppError(404, 'not_found', `There is no such ${what}.`);

/** Units, tax categories and rates, categories and brands (product-domain §3, §4, §9; D2 §3). */
export async function catalogReferenceRoutes(app: FastifyInstance, options: { pool: pg.Pool }): Promise<void> {
  const { pool } = options;
  const org = (request: { principal: { organizationId: string } | null }) => request.principal!.organizationId;
  const me = (request: { principal: { employeeId: string } | null }) => request.principal!.employeeId;

  /**
   * Writes the fields sent, and only those, to one row of the caller's organization (D2 §4). Another organization's row
   * is not found (architecture §24.3). The database keeps each rule a change could break: a unit's kind once used
   * (`SS021`), a countable unit's decimal places, and every code's and name's uniqueness.
   */
  const change = async (request: FastifyRequest, table: string, what: string, columns: Record<string, string>, body: Record<string, unknown>) => {
    const { id } = Id.parse(request.params);
    const fields = Object.keys(columns).filter((field) => body[field] !== undefined);
    if (fields.length === 0) throw new AppError(400, 'invalid_request', 'The request changes nothing.');
    const sets = fields.map((field, i) => `${columns[field]} = $${i + 3}`).join(', ');
    const updated = await withTransaction(pool, auditContext(request), (c) =>
      c.query(`UPDATE ${table} SET ${sets} WHERE id = $1 AND organization_id = $2`, [id, org(request), ...fields.map((field) => body[field])]),
    );
    if (updated.rowCount === 0) throw notFound(what);
    return { id };
  };

  app.get('/units', access('Product.View'), async (request) => {
    const { rows } = await pool.query(
      `SELECT id, code, name, plural_name AS "pluralName", quantity_kind AS "quantityKind", scale
       FROM unit WHERE organization_id = $1 ORDER BY code`,
      [org(request)],
    );
    return { items: rows };
  });

  /** `PR-14`, `PR-15`: a unit with its kind and decimal places; a countable unit has none (overview §3.2). */
  app.post('/units', access('Product.Create'), async (request, reply) => {
    const body = NewUnit.parse(request.body);
    const { rows } = await withTransaction(pool, auditContext(request), (c) =>
      c.query<{ id: string }>(
        `INSERT INTO unit (organization_id, code, name, plural_name, quantity_kind, scale) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [org(request), body.code, body.name, body.pluralName ?? null, body.quantityKind, body.scale],
      ),
    );
    return reply.status(201).send({ id: rows[0]!.id });
  });

  /** Changes a unit's code, names, kind or decimal places (`PR-14`, `PR-15`). A used unit's kind is frozen (`RT-491`). */
  app.patch('/units/:id', access('Product.Edit'), async (request) => change(request, 'unit', 'unit', UNIT_COLUMNS, ChangedUnit.parse(request.body)));

  /** Tax categories with each jurisdiction's rate in force (`PR-37`, `RT-047`). */
  app.get('/tax-categories', access('Tax.View'), async (request) => {
    const { rows } = await pool.query(
      `SELECT c.id, c.code, c.name,
              coalesce((SELECT json_agg(json_build_object('jurisdiction', r.jurisdiction, 'ratePercent', r.rate_percent::text,
                                                          'effectiveFrom', r.effective_from) ORDER BY r.jurisdiction)
                        FROM (SELECT DISTINCT ON (jurisdiction) jurisdiction, rate_percent, effective_from FROM tax_rate
                              WHERE tax_category_id = c.id AND effective_from <= now()
                              ORDER BY jurisdiction, effective_from DESC) r), '[]') AS "ratesInForce"
       FROM tax_category c WHERE c.organization_id = $1 ORDER BY c.code`,
      [org(request)],
    );
    return { items: rows };
  });

  app.post('/tax-categories', access('Tax.Edit'), async (request, reply) => {
    const body = NewTaxCategory.parse(request.body);
    const { rows } = await withTransaction(pool, auditContext(request), (c) =>
      c.query<{ id: string }>('INSERT INTO tax_category (organization_id, code, name) VALUES ($1, $2, $3) RETURNING id', [
        org(request),
        body.code,
        body.name,
      ]),
    );
    return reply.status(201).send({ id: rows[0]!.id });
  });

  /** Changes a tax category's code or name. Its rates are never edited: a change of rate is a new version (`RT-047`). */
  app.patch('/tax-categories/:id', access('Tax.Edit'), async (request) =>
    change(request, 'tax_category', 'tax category', TAX_CATEGORY_COLUMNS, ChangedTaxCategory.parse(request.body)),
  );

  /**
   * A new rate version, now or later (`RT-047`: a change is a new version, never an edit; `PR-40`: zero is exempt). No
   * rate is supplied by the system: rates are jurisdictional facts (`D-12`, `GAP-044`).
   */
  app.post('/tax-categories/:id/rates', access('Tax.Edit'), async (request, reply) => {
    const { id } = Id.parse(request.params);
    const body = NewRate.parse(request.body);
    const { rows } = await withTransaction(pool, auditContext(request), (c) =>
      c.query<{ id: string }>(
        `INSERT INTO tax_rate (organization_id, tax_category_id, jurisdiction, rate_percent, effective_from, created_by)
         SELECT organization_id, id, $3, $4::numeric, coalesce($5::timestamptz, now()), $6
         FROM tax_category WHERE id = $1 AND organization_id = $2 RETURNING id`,
        [id, org(request), body.jurisdiction, body.ratePercent, body.effectiveFrom ?? null, me(request)],
      ),
    );
    if (rows.length === 0) throw notFound('tax category');
    return reply.status(201).send({ id: rows[0]!.id });
  });

  app.get('/categories', access('Product.View'), async (request) => {
    const { rows } = await pool.query(
      `SELECT id, parent_id AS "parentId", name, sort_order AS "sortOrder", archived_at AS "archivedAt"
       FROM category WHERE organization_id = $1 ORDER BY parent_id NULLS FIRST, sort_order, name`,
      [org(request)],
    );
    return { items: rows };
  });

  /** `PR-04`..`PR-06`, `RT-026`, `RT-488`: a single-parent tree with an explicit order; a cycle is refused (`SS006`). */
  app.post('/categories', access('Product.Create'), async (request, reply) => {
    const body = NewCategory.parse(request.body);
    const { rows } = await withTransaction(pool, auditContext(request), (c) =>
      c.query<{ id: string }>(
        'INSERT INTO category (organization_id, parent_id, name, sort_order) VALUES ($1, $2, $3, $4) RETURNING id',
        [org(request), body.parentId, body.name, body.sortOrder],
      ),
    );
    return reply.status(201).send({ id: rows[0]!.id });
  });

  app.patch('/categories/:id', access('Product.Edit'), async (request) => {
    const { id } = Id.parse(request.params);
    const body = ChangedCategory.parse(request.body);
    const updated = await withTransaction(pool, auditContext(request), (c) =>
      c.query(
        `UPDATE category SET name = coalesce($3, name), sort_order = coalesce($4, sort_order),
                             parent_id = CASE WHEN $5 THEN $6::uuid ELSE parent_id END
         WHERE id = $1 AND organization_id = $2`,
        [id, org(request), body.name ?? null, body.sortOrder ?? null, body.parentId !== undefined, body.parentId ?? null],
      ),
    );
    if (updated.rowCount === 0) throw notFound('category');
    return { id };
  });

  /** Archived once, never deleted (`PR-05`, `RT-027`). Archiving an archived category changes nothing (`SM-04`). */
  app.post('/categories/:id/archive', access('Product.Edit'), async (request) => {
    const { id } = Id.parse(request.params);
    const changed = await withTransaction(pool, auditContext(request), async (c) => {
      const found = await c.query<{ archived: boolean }>(
        'SELECT archived_at IS NOT NULL AS archived FROM category WHERE id = $1 AND organization_id = $2 FOR UPDATE',
        [id, org(request)],
      );
      if (found.rows.length === 0) throw notFound('category');
      if (found.rows[0]!.archived) return false;
      await c.query('UPDATE category SET archived_by = $2 WHERE id = $1', [id, me(request)]);
      return true;
    });
    return { id, archived: true, changed };
  });

  app.get('/brands', access('Product.View'), async (request) => {
    const { rows } = await pool.query('SELECT id, name FROM brand WHERE organization_id = $1 ORDER BY lower(name)', [org(request)]);
    return { items: rows };
  });

  /** A brand is optional, and unique by name whatever its case (product-domain §3). */
  app.post('/brands', access('Product.Create'), async (request, reply) => {
    const body = NewBrand.parse(request.body);
    const { rows } = await withTransaction(pool, auditContext(request), (c) =>
      c.query<{ id: string }>('INSERT INTO brand (organization_id, name) VALUES ($1, $2) RETURNING id', [org(request), body.name]),
    );
    return reply.status(201).send({ id: rows[0]!.id });
  });

  /** Renames a brand. It stays unique by name whatever the case (product-domain §3). */
  app.patch('/brands/:id', access('Product.Edit'), async (request) => change(request, 'brand', 'brand', BRAND_COLUMNS, NewBrand.parse(request.body)));
}
