import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction } from '../../db/pool.ts';
import { AppError } from '../../http/errors.ts';
import { auditContext } from '../../http/gate.ts';
import { paged, pageOf } from '../../http/paging.ts';

const text = z.string().trim().min(1).max(200);
const NewMethod = z.object({ code: text, name: text, methodType: z.enum(['Cash', 'Card']) });
const StoreMethod = z.object({ storeId: z.uuid(), methodId: z.uuid() });
const Enablement = z.object({ enabled: z.boolean() });

/**
 * Payment methods (`PY-03`: typed; v1 types are Cash and Card) and their enablement per store (`PY-05`), all under
 * `Payment.Method.Configure` (actors-and-roles §2.11). A disabled method is refused at the till (`SS045`).
 */
export async function paymentMethodRoutes(app: FastifyInstance, options: { pool: pg.Pool }): Promise<void> {
  const { pool } = options;

  app.get('/payment-methods', { config: { access: { kind: 'permission', key: 'Payment.Method.Configure', scope: 'organization' } } }, async (request) => {
    const page = pageOf(request.query);
    const { rows } = await pool.query(
      `SELECT id, code, name, method_type AS "methodType" FROM payment_method WHERE organization_id = $1 ORDER BY code, id LIMIT $2 OFFSET $3`,
      [request.principal!.organizationId, page.limit, page.offset],
    );
    return paged(rows, page);
  });

  app.post('/payment-methods', { config: { access: { kind: 'permission', key: 'Payment.Method.Configure', scope: 'organization' } } }, async (request, reply) => {
    const body = NewMethod.parse(request.body);
    const { rows } = await withTransaction(pool, auditContext(request), (c) =>
      c.query<{ id: string }>(
        'INSERT INTO payment_method (organization_id, code, name, method_type) VALUES ($1, $2, $3, $4) RETURNING id',
        [request.principal!.organizationId, body.code, body.name, body.methodType],
      ),
    );
    return reply.status(201).send({ id: rows[0]!.id });
  });

  /** Turns a method on or off at one store, from now on (`PY-05`). */
  app.put('/stores/:storeId/payment-methods/:methodId', { config: { access: { kind: 'permission', key: 'Payment.Method.Configure', scope: 'store' } } }, async (request) => {
    const { methodId } = StoreMethod.parse(request.params);
    const body = Enablement.parse(request.body);
    const principal = request.principal!;
    const saved = await withTransaction(pool, auditContext(request), (c) =>
      c.query(
        `INSERT INTO store_payment_method (store_id, payment_method_id, is_enabled, changed_by)
         SELECT $1, id, $3, $4 FROM payment_method WHERE id = $2 AND organization_id = $5
         ON CONFLICT (store_id, payment_method_id) DO UPDATE SET is_enabled = EXCLUDED.is_enabled, changed_by = EXCLUDED.changed_by`,
        [request.storeId, methodId, body.enabled, principal.employeeId, principal.organizationId],
      ),
    );
    if (saved.rowCount === 0) throw new AppError(404, 'not_found', 'There is no such payment method.');
    return { storeId: request.storeId, methodId, enabled: body.enabled };
  });
}
