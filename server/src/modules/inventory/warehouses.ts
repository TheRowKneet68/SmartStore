import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction } from '../../db/pool.ts';
import { AppError } from '../../http/errors.ts';
import { auditContext } from '../../http/gate.ts';
import { paged, pageOf } from '../../http/paging.ts';

const CONFIG = { config: { access: { kind: 'permission', key: 'Config.Organization', scope: 'organization' } } } as const;

const text = z.string().trim().min(1).max(200);
const Id = z.object({ id: z.uuid() });

const NewWarehouse = z.object({
  kind: z.enum(['StoreAttached', 'Central']),
  code: text,
  name: text,
  address: text.optional(),
  storeId: z.uuid().optional(),
});

const LOCATION_TYPES = ['Default', 'Receiving', 'Quarantine', 'Damaged', 'ReturnsPending', 'Transit', 'ExpiredHold'] as const;
const NewLocation = z.object({
  code: text,
  name: text,
  locationType: z.enum(LOCATION_TYPES),
  isSellable: z.boolean(),
});

/**
 * Warehouses and storage locations (RT-003, MS-15, MS-17, RT-057, WH-01, WH-03, WH-04).
 * Maintained under `Config.Organization` (actors-and-roles §2.12).
 * A warehouse must have a Default location in the same transaction (MS-17).
 * A StoreAttached warehouse names its store; Central names none (RT-003, MS-15).
 */
export async function warehouseRoutes(app: FastifyInstance, options: { pool: pg.Pool }): Promise<void> {
  const { pool } = options;

  app.get('/warehouses', CONFIG, async (request) => {
    const page = pageOf(request.query);
    const { rows } = await pool.query(
      `SELECT id, kind, code, name, address, store_id AS "storeId", created_at AS "createdAt"
       FROM warehouse
       WHERE organization_id = $1
       ORDER BY code, id
       LIMIT $2 OFFSET $3`,
      [request.principal!.organizationId, page.limit, page.offset],
    );
    return paged(rows, page);
  });

  app.post('/warehouses', CONFIG, async (request, reply) => {
    const body = NewWarehouse.parse(request.body);
    if (body.kind === 'StoreAttached' && body.storeId === undefined)
      throw new AppError(422, 'validation_error', 'A store-attached warehouse must name its store.');
    if (body.kind === 'Central' && body.storeId !== undefined)
      throw new AppError(422, 'validation_error', 'A central warehouse must not name a store.');

    const result = await withTransaction(pool, auditContext(request), async (client) => {
      const orgId = request.principal!.organizationId;
      const w = await client.query<{ id: string }>(
        `INSERT INTO warehouse (organization_id, store_id, kind, code, name, address)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [orgId, body.storeId ?? null, body.kind, body.code, body.name, body.address ?? null],
      );
      const warehouseId = w.rows[0]!.id;
      // MS-17: every warehouse gets a Default location in the same transaction.
      const l = await client.query<{ id: string }>(
        `INSERT INTO storage_location (organization_id, warehouse_id, warehouse_kind, code, name, location_type, is_sellable)
         VALUES ($1, $2, $3, 'DEFAULT', 'Default', 'Default', $4) RETURNING id`,
        [orgId, warehouseId, body.kind, body.kind === 'StoreAttached'],
      );
      return { id: warehouseId, defaultLocationId: l.rows[0]!.id };
    });
    return reply.status(201).send(result);
  });

  app.get('/warehouses/:id/storage-locations', CONFIG, async (request) => {
    const { id } = Id.parse(request.params);
    const page = pageOf(request.query);
    const orgId = request.principal!.organizationId;
    const { rows } = await pool.query(
      `SELECT l.id, l.code, l.name, l.location_type AS "locationType", l.is_sellable AS "isSellable", l.created_at AS "createdAt"
       FROM storage_location l
       JOIN warehouse w ON w.id = l.warehouse_id
       WHERE l.warehouse_id = $1 AND l.organization_id = $2
       ORDER BY l.location_type, l.code, l.id
       LIMIT $3 OFFSET $4`,
      [id, orgId, page.limit, page.offset],
    );
    if (rows.length === 0) {
      const wh = await pool.query('SELECT id FROM warehouse WHERE id = $1 AND organization_id = $2', [id, orgId]);
      if (wh.rows.length === 0) throw new AppError(404, 'not_found', 'There is no such warehouse.');
    }
    return paged(rows, page);
  });

  app.post('/warehouses/:id/storage-locations', CONFIG, async (request, reply) => {
    const { id } = Id.parse(request.params);
    const body = NewLocation.parse(request.body);
    const orgId = request.principal!.organizationId;

    const result = await withTransaction(pool, auditContext(request), async (client) => {
      const wh = await client.query<{ kind: string }>(
        'SELECT kind FROM warehouse WHERE id = $1 AND organization_id = $2 FOR SHARE',
        [id, orgId],
      );
      if (wh.rows.length === 0) throw new AppError(404, 'not_found', 'There is no such warehouse.');
      const warehouseKind = wh.rows[0]!.kind;

      const l = await client.query<{ id: string }>(
        `INSERT INTO storage_location (organization_id, warehouse_id, warehouse_kind, code, name, location_type, is_sellable)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [orgId, id, warehouseKind, body.code, body.name, body.locationType, body.isSellable],
      );
      return { id: l.rows[0]!.id };
    });
    return reply.status(201).send(result);
  });
}
