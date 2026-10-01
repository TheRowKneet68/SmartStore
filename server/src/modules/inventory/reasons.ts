import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction } from '../../db/pool.ts';
import { AppError } from '../../http/errors.ts';
import { auditContext } from '../../http/gate.ts';
import { paged, pageOf } from '../../http/paging.ts';

const text = z.string().trim().min(1).max(200);
const NewReason = z.object({ code: text, name: text });
const Id = z.object({ id: z.uuid() });
const CONFIG = { config: { access: { kind: 'permission', key: 'Config.Organization', scope: 'organization' } } } as const;

/**
 * The organization's reason codes (overview §3.8; `BI-25`, `IV-33`). None is seeded: the list is the organization's own,
 * maintained under `Config.Organization` ("reason codes", actors-and-roles §2.12). An archived code takes no new
 * document (`SS024`) and is never deleted.
 */
export async function reasonRoutes(app: FastifyInstance, options: { pool: pg.Pool }): Promise<void> {
  const { pool } = options;

  /**
   * The live list, for any signed-in employee of the organization: every reasoned action (an adjustment, a leave, a
   * product change) picks from it, and it carries no business data (D3 §9).
   */
  app.get('/reason-codes', { config: { access: { kind: 'session' } } }, async (request) => {
    const page = pageOf(request.query);
    const { rows } = await pool.query(
      'SELECT id, code, name FROM reason_code WHERE organization_id = $1 AND archived_at IS NULL ORDER BY code, id LIMIT $2 OFFSET $3',
      [request.principal!.organizationId, page.limit, page.offset],
    );
    return paged(rows, page);
  });

  app.post('/reason-codes', CONFIG, async (request, reply) => {
    const body = NewReason.parse(request.body);
    const { rows } = await withTransaction(pool, auditContext(request), (c) =>
      c.query<{ id: string }>('INSERT INTO reason_code (organization_id, code, name) VALUES ($1, $2, $3) RETURNING id', [
        request.principal!.organizationId,
        body.code,
        body.name,
      ]),
    );
    return reply.status(201).send({ id: rows[0]!.id });
  });

  /** Archived once; archiving it again changes nothing (`SM-04`). */
  app.post('/reason-codes/:id/archive', CONFIG, async (request) => {
    const { id } = Id.parse(request.params);
    const principal = request.principal!;
    const changed = await withTransaction(pool, auditContext(request), async (c) => {
      const found = await c.query<{ archived: boolean }>(
        'SELECT archived_at IS NOT NULL AS archived FROM reason_code WHERE id = $1 AND organization_id = $2 FOR UPDATE',
        [id, principal.organizationId],
      );
      if (found.rows.length === 0) throw new AppError(404, 'not_found', 'There is no such reason code.');
      if (found.rows[0]!.archived) return false;
      await c.query('UPDATE reason_code SET archived_by = $2 WHERE id = $1', [id, principal.employeeId]);
      return true;
    });
    return { id, archived: true, changed };
  });
}
