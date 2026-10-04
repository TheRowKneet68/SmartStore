import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction, type Queryable } from '../../db/pool.ts';
import { AppError } from '../../http/errors.ts';
import { auditContext, type Access } from '../../http/gate.ts';
import { pageOf, paged } from '../../http/paging.ts';
import type { MachineBinding } from '../../http/transitions.ts';

/**
 * CustomerAccount state machine (§22.8, SM-45).
 * CreditBlocked → Active exit is OPEN DECISION (SM-45c): registered in the DB, refused for everyone.
 */
export const customerMachine: MachineBinding = {
  machine: 'CustomerAccount',
  noun: 'customer',
  table: 'customer',
  stateColumn: 'status',
  actorColumn: 'status_changed_by',
  storeColumn: null,
};

const org = (key: string): { config: { access: Access } } => ({ config: { access: { kind: 'permission', key, scope: 'organization' } } });

const text = z.string().trim().min(1).max(200);
const phone = z.string().trim().max(30).nullable().optional();
const email = z.string().trim().max(200).toLowerCase().nullable().optional();

const NewCustomer = z.object({
  displayName: text,
  phone: phone,
  email: email,
  marketingConsent: z.enum(['NotAsked', 'Yes', 'No']).default('NotAsked'),
  force: z.boolean().default(false),
});

const EditCustomer = z.object({
  displayName: text.optional(),
  phone: phone,
  email: email,
  marketingConsent: z.enum(['NotAsked', 'Yes', 'No']).optional(),
  force: z.boolean().default(false),
});

const CustomerId = z.object({ customerId: z.uuid() });
const Search = z.object({ q: z.string().trim().min(1).max(200).optional(), after: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });

/** CU-37: masking applied server-side for non-editors (returns masked phone and email). */
function maskContact(phone: string | null, email: string | null, canSeeFullContact: boolean) {
  if (canSeeFullContact) return { phone, email };
  return {
    phone: phone ? phone.slice(0, 3) + '****' + phone.slice(-2) : null,
    email: email ? email.replace(/(.{2}).*(@.*)/, '$1****$2') : null,
  };
}

async function findCustomer(db: Queryable, customerId: string, organizationId: string) {
  const { rows } = await db.query(
    `SELECT id, organization_id AS "organizationId", is_walk_in AS "isWalkIn",
            display_name AS "displayName", status, phone, email,
            marketing_consent AS "marketingConsent", marketing_consent_at AS "marketingConsentAt",
            status_changed_at AS "statusChangedAt", status_changed_by AS "statusChangedBy",
            created_by AS "createdBy", created_at AS "createdAt"
     FROM customer WHERE id = $1 AND organization_id = $2`,
    [customerId, organizationId],
  );
  if (rows.length === 0) throw new AppError(404, 'not_found', 'There is no customer with this id in this organization.');
  return rows[0] as { id: string; organizationId: string; isWalkIn: boolean; displayName: string; status: string; phone: string | null; email: string | null; marketingConsent: string; marketingConsentAt: string | null; statusChangedAt: string; statusChangedBy: string | null; createdBy: string | null; createdAt: string };
}

/**
 * CU-05: Warn if a phone or email would duplicate an existing customer (not a hard block).
 * Returns the existing customer's name, or null if no conflict.
 */
async function checkDuplicate(db: Queryable, organizationId: string, phone: string | null | undefined, email: string | null | undefined, excludeId?: string): Promise<string | null> {
  if (!phone && !email) return null;
  const conditions: string[] = [];
  const params: unknown[] = [organizationId];
  if (phone) { params.push(phone); conditions.push(`phone = $${params.length}`); }
  if (email) { params.push(email); conditions.push(`email = $${params.length}`); }
  let sql = `SELECT display_name FROM customer WHERE organization_id = $1 AND (${conditions.join(' OR ')})`;
  if (excludeId) { params.push(excludeId); sql += ` AND id <> $${params.length}`; }
  sql += ' LIMIT 1';
  const { rows } = await db.query(sql, params);
  return rows[0]?.display_name ?? null;
}

export async function customerRoutes(app: FastifyInstance, options: { pool: pg.Pool }): Promise<void> {
  const { pool } = options;

  // POST /customers — create a named customer (CU-01, CU-05, Customer.Create)
  app.post('/customers', org('Customer.Create'), async (req, reply) => {
    const principal = req.principal!;
    const body = NewCustomer.parse(req.body);

    const customerId = await withTransaction(pool, auditContext(req), async (c) => {
      if (!body.force) {
        const dup = await checkDuplicate(c, principal.organizationId, body.phone ?? null, body.email ?? null);
        if (dup !== null) {
          return reply.status(409).send({
            error: {
              code: 'duplicate_contact',
              message: `A customer named "${dup}" already has this phone or email. Pass "force": true to create anyway.`,
              existingName: dup,
            },
          });
        }
      }

      const consentAt = body.marketingConsent !== 'NotAsked' ? 'now()' : 'NULL';
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO customer
           (organization_id, is_walk_in, display_name, status, phone, email,
            marketing_consent, marketing_consent_at, status_changed_by, created_by)
         VALUES ($1, false, $2, 'Active', $3, $4, $5, ${consentAt}, $6, $6)
         RETURNING id`,
        [principal.organizationId, body.displayName, body.phone ?? null, body.email ?? null, body.marketingConsent, principal.employeeId],
      );
      return rows[0]!.id;
    });

    if (typeof customerId !== 'string') return; // already sent 409
    return reply.status(201).send({ id: customerId });
  });

  // GET /customers — organization-wide search (CU-06)
  app.get('/customers', org('Customer.View'), async (req, reply) => {
    const principal = req.principal!;
    const { q, after, limit } = Search.parse(req.query);
    const page = pageOf({ after, limit });

    let sql = `SELECT id, display_name AS "displayName", status, phone, email,
                      is_walk_in AS "isWalkIn", created_at AS "createdAt"
               FROM customer
               WHERE organization_id = $1 AND NOT is_walk_in`;
    const params: unknown[] = [principal.organizationId];

    if (q) {
      const like = q.toLowerCase() + '%';
      params.push(like);
      sql += ` AND (lower(display_name) LIKE $${params.length}
               OR phone LIKE $${params.length}
               OR lower(email) LIKE $${params.length})`;
    }

    sql += ` ORDER BY lower(display_name), id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(page.limit, page.offset);

    const { rows } = await pool.query(sql, params);
    const canEdit = false; // search view: always masked
    const items = rows.map((r: { id: string; displayName: string; status: string; phone: string | null; email: string | null; isWalkIn: boolean; createdAt: string }) => ({
      id: r.id,
      displayName: r.displayName,
      status: r.status,
      createdAt: r.createdAt,
      ...maskContact(r.phone, r.email, canEdit),
    }));
    return reply.send(paged(items, page));
  });

  // GET /customers/:customerId — customer detail (CU-07: narrow for cashier, CU-37: masking)
  app.get('/customers/:customerId', org('Customer.View'), async (req, reply) => {
    const { customerId } = CustomerId.parse(req.params);
    const principal = req.principal!;
    const c = await findCustomer(pool, customerId, principal.organizationId);
    // CU-07/CU-37: full contact only for Customer.Edit holders
    const canSeeFullContact = await pool.query(
      `SELECT employee_holds_permission($1, NULL, 'Customer.Edit') AS result`,
      [principal.employeeId],
    ).then((r) => r.rows[0]?.result as boolean);

    return reply.send({
      id: c.id,
      isWalkIn: c.isWalkIn,
      displayName: c.displayName,
      status: c.status,
      marketingConsent: c.marketingConsent,
      marketingConsentAt: c.marketingConsentAt,
      statusChangedAt: c.statusChangedAt,
      createdAt: c.createdAt,
      ...maskContact(c.phone, c.email, canSeeFullContact),
    });
  });

  // PATCH /customers/:customerId — edit name, contacts, marketing consent (CU-04, CU-05)
  app.patch('/customers/:customerId', org('Customer.Edit'), async (req, reply) => {
    const { customerId } = CustomerId.parse(req.params);
    const principal = req.principal!;
    const body = EditCustomer.parse(req.body);

    await withTransaction(pool, auditContext(req), async (c) => {
      const existing = await findCustomer(c, customerId, principal.organizationId);
      if (existing.isWalkIn) throw new AppError(422, 'invalid_reference', 'The walk-in customer record cannot be edited through this route.');

      if (!body.force) {
        const dup = await checkDuplicate(c, principal.organizationId, body.phone ?? null, body.email ?? null, customerId);
        if (dup !== null) {
          return reply.status(409).send({
            error: {
              code: 'duplicate_contact',
              message: `A customer named "${dup}" already has this phone or email. Pass "force": true to update anyway.`,
              existingName: dup,
            },
          });
        }
      }

      const updates: string[] = [];
      const params: unknown[] = [customerId, principal.organizationId];
      const set = (col: string, val: unknown) => { params.push(val); updates.push(`${col} = $${params.length}`); };

      if (body.displayName !== undefined) set('display_name', body.displayName);
      if ('phone' in body) set('phone', body.phone ?? null);
      if ('email' in body) set('email', body.email ?? null);
      if (body.marketingConsent !== undefined) {
        set('marketing_consent', body.marketingConsent);
        set('marketing_consent_at', body.marketingConsent !== 'NotAsked' ? new Date() : null);
      }

      if (updates.length === 0) return; // nothing to do
      await c.query(`UPDATE customer SET ${updates.join(', ')} WHERE id = $1 AND organization_id = $2`, params);
    });

    return reply.send({ id: customerId });
  });

  // GET /customers/:customerId/sales — customer's sale history (CU-06, CU-08)
  app.get('/customers/:customerId/sales', org('Customer.View'), async (req, reply) => {
    const { customerId } = CustomerId.parse(req.params);
    const principal = req.principal!;
    // Verify customer exists in org
    await findCustomer(pool, customerId, principal.organizationId);

    const page = pageOf(req.query);
    const { rows } = await pool.query(
      `SELECT s.id, s.document_number AS "documentNumber", s.store_id AS "storeId",
              st.name AS store,
              s.total_due AS "totalDue", s.currency_code AS "currencyCode",
              s.completed_at AS "completedAt", s.status
       FROM sale s
         JOIN store st ON st.id = s.store_id
       WHERE s.customer_id = $1 AND s.organization_id = $2
       ORDER BY s.completed_at DESC, s.id DESC
       LIMIT $3 OFFSET $4`,
      [customerId, principal.organizationId, page.limit, page.offset],
    );
    return reply.send(paged(rows, page));
  });
}
