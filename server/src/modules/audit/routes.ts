import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import type { Access } from '../../http/gate.ts';
import { paged, pageOf } from '../../http/paging.ts';

// Audit.View is organization-wide (actors-and-roles §2; OQ-024).
const orgWide = (key: string): { config: { access: Access } } => ({ config: { access: { kind: 'permission', key, scope: 'organization' } } });

const Query = z.object({
  eventType: z.string().optional(),
  entityType: z.string().optional(),
  entityId: z.uuid().optional(),
  storeId: z.uuid().optional(),
});

/**
 * Read-only audit log (OQ-024, AU-11, RT-292). `Audit.View` is required. The endpoint returns events
 * newest-first for the caller's organization; optional filters narrow by event type, entity type,
 * entity id, and store. The `before`/`after` diff columns are not included in the list (they are large
 * and available in the chain check query when needed).
 */
export async function auditRoutes(app: FastifyInstance, options: { pool: pg.Pool }): Promise<void> {
  const { pool } = options;

  app.get('/audit-events', orgWide('Audit.View'), async (request) => {
    const q = Query.parse(request.query);
    const page = pageOf(request.query);
    const principal = request.principal!;
    const { rows } = await pool.query(
      `SELECT id, seq::text AS seq, occurred_at AS "occurredAt", event_type AS "eventType",
              entity_type AS "entityType", entity_id AS "entityId",
              actor_id AS "actorId", store_id AS "storeId",
              reason_code_id AS "reasonCodeId", source, correlation_id AS "correlationId"
       FROM audit_event
       WHERE organization_id = $1
         AND ($2::text IS NULL OR event_type = $2)
         AND ($3::text IS NULL OR entity_type = $3)
         AND ($4::uuid IS NULL OR entity_id = $4)
         AND ($5::uuid IS NULL OR store_id = $5)
       ORDER BY seq DESC
       LIMIT $6 OFFSET $7`,
      [principal.organizationId, q.eventType ?? null, q.entityType ?? null, q.entityId ?? null, q.storeId ?? null, page.limit, page.offset],
    );
    return paged(rows, page);
  });
}
