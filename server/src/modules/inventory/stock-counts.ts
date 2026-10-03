import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction, type Queryable } from '../../db/pool.ts';
import { AppError } from '../../http/errors.ts';
import { auditContext, type Access } from '../../http/gate.ts';
import type { MachineBinding } from '../../http/transitions.ts';
import { STORE_LOCATIONS } from './stock.ts';

const inStore = (key: string): { config: { access: Access } } => ({ config: { access: { kind: 'permission', key, scope: 'store' } } });

const CREATE = inStore('Inventory.Count.Create');

const Doc = z.object({ storeId: z.uuid(), id: z.uuid() });
const DocLine = z.object({ storeId: z.uuid(), id: z.uuid(), lineId: z.uuid() });
const NewCount = z.object({ scope: z.enum(['Location', 'MultiLocation']), note: z.string().trim().min(1).max(500).optional() });
const NewLine = z.object({ variantId: z.uuid(), locationId: z.uuid() });
const EnterCount = z.object({ countedQuantity: z.string().regex(/^\d{1,14}(\.\d{1,4})?$/), reasonCodeId: z.uuid().optional() });
const Listing = z.object({ status: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });

async function assertOpen(db: Queryable, id: string, storeId: string): Promise<void> {
  const { rows } = await db.query('SELECT 1 FROM stock_count WHERE id = $1 AND store_id = $2 AND status = $3', [id, storeId, 'Open']);
  if (rows.length === 0) throw new AppError(404, 'not_found', 'There is no open count with this id in this store.');
}

async function readCount(db: Queryable, id: string) {
  const head = await db.query(
    `SELECT id, document_number AS "documentNumber", scope, status, note,
            created_by AS "createdBy", snapshot_at AS "snapshotAt", status_changed_at AS "statusChangedAt"
     FROM stock_count WHERE id = $1`,
    [id],
  );
  const lines = await db.query(
    `SELECT l.id, l.variant_id AS "variantId", p.name AS product, v.name AS variant,
            l.storage_location_id AS "locationId", sl.name AS location,
            l.expected_quantity::text AS "expectedQuantity",
            l.counted_quantity::text AS "countedQuantity",
            l.reason_code_id AS "reasonCodeId",
            l.movement_type AS "movementType",
            l.direction,
            EXISTS(
              SELECT 1 FROM inventory_movement m
              WHERE m.variant_id = l.variant_id AND m.storage_location_id = l.storage_location_id
                AND m.created_at > l.created_at AND m.movement_type NOT LIKE 'COUNT%'
            ) AS "movedSinceSnapshot"
     FROM stock_count_line l
       JOIN product_variant v ON v.id = l.variant_id
       JOIN product p ON p.id = v.product_id
       JOIN storage_location sl ON sl.id = l.storage_location_id
     WHERE l.stock_count_id = $1
     ORDER BY l.created_at, l.id`,
    [id],
  );
  return { ...head.rows[0], lines: lines.rows };
}

/** Writes COUNT_VARIANCE_IN / COUNT_VARIANCE_OUT for every variance line (IV-28, SM-81). */
async function postCountMovements(c: Queryable, countId: string, by: string, correlationId: string): Promise<void> {
  const head = await c.query<{ store_id: string; organization_id: string }>(
    'SELECT store_id, organization_id FROM stock_count WHERE id = $1',
    [countId],
  );
  const { store_id: store, organization_id: org } = head.rows[0]!;

  // Verify all lines have counted_quantity set (IV-28 precondition — enforced here, not in before, because the
  // state machine enforce trigger runs before after, and this needs the full lines check atomically with posting).
  const missing = await c.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM stock_count_line WHERE stock_count_id = $1 AND counted_quantity IS NULL',
    [countId],
  );
  if (Number(missing.rows[0]!.n) > 0)
    throw new AppError(422, 'uncounted_lines', 'Every line must have a counted quantity before posting.');

  const variance = await c.query<{ id: string; variant_id: string; storage_location_id: string; movement_type: string; direction: string; quantity: string }>(
    `SELECT id, variant_id, storage_location_id, movement_type, direction,
            abs(counted_quantity - expected_quantity)::text AS quantity
     FROM stock_count_line
     WHERE stock_count_id = $1 AND counted_quantity <> expected_quantity
     ORDER BY variant_id, storage_location_id, id`,
    [countId],
  );
  if (variance.rows.length === 0) return; // zero-variance count: nothing to write

  const tx = await c.query<{ id: string }>(
    'INSERT INTO inventory_transaction (store_id, created_by, correlation_id) VALUES ($1, $2, $3) RETURNING id',
    [store, by, correlationId],
  );
  const txId = tx.rows[0]!.id;

  for (const line of variance.rows) {
    await c.query(
      `INSERT INTO inventory_movement (inventory_transaction_id, store_id, organization_id, variant_id, storage_location_id,
                                       movement_type, direction, quantity, stock_count_id, stock_count_line_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [txId, store, org, line.variant_id, line.storage_location_id, line.movement_type, line.direction, line.quantity, countId, line.id],
    );
  }
}

/** Writes COUNT_VARIANCE_REVERSAL for each posted movement, compensating, never editing (SM-82, IV-30). */
async function reverseCountMovements(c: Queryable, countId: string, by: string, correlationId: string): Promise<void> {
  const head = await c.query<{ store_id: string; organization_id: string }>(
    'SELECT store_id, organization_id FROM stock_count WHERE id = $1',
    [countId],
  );
  const { store_id: store, organization_id: org } = head.rows[0]!;
  const tx = await c.query<{ id: string }>(
    'INSERT INTO inventory_transaction (store_id, created_by, correlation_id) VALUES ($1, $2, $3) RETURNING id',
    [store, by, correlationId],
  );
  await c.query(
    `INSERT INTO inventory_movement (inventory_transaction_id, store_id, organization_id, variant_id, storage_location_id,
                                     movement_type, direction, quantity, stock_count_id, stock_count_line_id)
     SELECT $1, $2, $3, variant_id, storage_location_id,
            'COUNT_VARIANCE_REVERSAL', CASE direction WHEN 'In' THEN 'Out' ELSE 'In' END,
            quantity, stock_count_id, stock_count_line_id
     FROM inventory_movement
     WHERE stock_count_id = $4 AND movement_type NOT LIKE 'COUNT_VARIANCE_REVERSAL%'
     ORDER BY variant_id, storage_location_id, id`,
    [tx.rows[0]!.id, store, org, countId],
  );
}

/**
 * The StockCount machine (state-machines §22.17, IV-25..IV-30, SM-81..SM-84, RT-071, D-09).
 * Posting writes COUNT_VARIANCE_IN/OUT movements in the same transaction; reversal writes
 * COUNT_VARIANCE_REVERSAL. The precondition (all lines counted, variance lines have reason codes) is
 * checked in the `before` callback so the transition is refused with a clean 422 before the edge fires.
 */
export const stockCountMachine: MachineBinding = {
  machine: 'StockCount',
  noun: 'stock count',
  table: 'stock_count',
  stateColumn: 'status',
  actorColumn: 'status_changed_by',
  storeColumn: 'store_id',
  actorColumnsFor: (to) =>
    to === 'Posted' ? ['posted_by'] : to === 'Cancelled' ? ['cancelled_by'] : [],
  before: async (c, id, _from, to) => {
    if (to !== 'Posted') return;
    const problems = await c.query<{ n: string; kind: string }>(
      `SELECT count(*)::text AS n, 'uncounted' AS kind FROM stock_count_line WHERE stock_count_id = $1 AND counted_quantity IS NULL
       UNION ALL
       SELECT count(*)::text, 'missing_reason' FROM stock_count_line
       WHERE stock_count_id = $1 AND counted_quantity IS NOT NULL AND counted_quantity <> expected_quantity AND reason_code_id IS NULL`,
      [id],
    );
    const uncounted = Number(problems.rows.find((r) => r.kind === 'uncounted')?.n ?? 0);
    const noReason = Number(problems.rows.find((r) => r.kind === 'missing_reason')?.n ?? 0);
    if (uncounted > 0) throw new AppError(422, 'uncounted_lines', `${uncounted} line(s) have no counted quantity.`);
    if (noReason > 0) throw new AppError(422, 'missing_reason', `${noReason} variance line(s) have no reason code (IV-28).`);
  },
  after: async (c, id, _from, to, principal, correlationId) => {
    if (to === 'Posted') await postCountMovements(c, id, principal.employeeId, correlationId);
    if (to === 'Reversed') await reverseCountMovements(c, id, principal.employeeId, correlationId);
  },
};

/**
 * Stock Count routes (IV-25..IV-30, SM-81..SM-84, RT-071, D-09).
 * Creating, viewing and entering lines. Transitions (post/cancel/reverse) are via POST /api/v1/transitions.
 */
export async function stockCountRoutes(app: FastifyInstance, options: { pool: pg.Pool }): Promise<void> {
  const { pool } = options;

  app.get('/stores/:storeId/stock-counts', CREATE, async (request) => {
    const { status, limit } = Listing.parse(request.query);
    const { rows } = await pool.query(
      `SELECT id, document_number AS "documentNumber", scope, status, snapshot_at AS "snapshotAt",
              status_changed_at AS "statusChangedAt",
              (SELECT count(*)::int FROM stock_count_line l WHERE l.stock_count_id = sc.id) AS lines
       FROM stock_count sc
       WHERE store_id = $1 AND ($2::text IS NULL OR status = $2)
       ORDER BY document_number DESC LIMIT $3`,
      [request.storeId, status ?? null, limit],
    );
    return { items: rows };
  });

  app.get('/stores/:storeId/stock-counts/:id', CREATE, async (request) => {
    const { id } = Doc.parse(request.params);
    const { rows } = await pool.query('SELECT 1 FROM stock_count WHERE id = $1 AND store_id = $2', [id, request.storeId]);
    if (rows.length === 0) throw new AppError(404, 'not_found', 'There is no such count in this store.');
    return readCount(pool, id);
  });

  /** Create an Open count; snapshot frozen at creation (IV-26). */
  app.post('/stores/:storeId/stock-counts', CREATE, async (request, reply) => {
    const body = NewCount.parse(request.body);
    const principal = request.principal!;
    const id = await withTransaction(pool, auditContext(request), async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO stock_count (store_id, organization_id, scope, note, created_by, status_changed_by)
         VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
        [request.storeId, principal.organizationId, body.scope, body.note ?? null, principal.employeeId],
      );
      return rows[0]!.id;
    });
    return reply.status(201).send(await readCount(pool, id));
  });

  /**
   * Add a line: expected_quantity is the current ledger balance, frozen now (IV-26).
   * Duplicate (variant, location) is refused by the unique constraint.
   * Movements that arrive after this point are flagged when the count is read (IV-27, SM-83).
   */
  app.post('/stores/:storeId/stock-counts/:id/lines', CREATE, async (request, reply) => {
    const { id } = Doc.parse(request.params);
    const body = NewLine.parse(request.body);
    const principal = request.principal!;
    await withTransaction(pool, auditContext(request), async (c) => {
      await assertOpen(c, id, request.storeId);
      const here = await c.query(`SELECT 1 WHERE $2::uuid IN (${STORE_LOCATIONS})`, [request.storeId, body.locationId]);
      if (here.rows.length === 0) throw new AppError(422, 'invalid_location', "That location is not one of this store's.");
      const balance = await c.query<{ on_hand: string }>(
        `SELECT coalesce((SELECT on_hand FROM stock_balance WHERE variant_id = $1 AND storage_location_id = $2), 0)::text AS on_hand`,
        [body.variantId, body.locationId],
      );
      await c.query(
        `INSERT INTO stock_count_line (stock_count_id, store_id, organization_id, variant_id, storage_location_id, expected_quantity)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, request.storeId, principal.organizationId, body.variantId, body.locationId, balance.rows[0]!.on_hand],
      );
    });
    return reply.status(201).send(await readCount(pool, id));
  });

  /**
   * Enter the counted quantity for one line (IV-29: never negative).
   * A variance line gets its reason code here too (IV-28).
   */
  app.put('/stores/:storeId/stock-counts/:id/lines/:lineId', CREATE, async (request, reply) => {
    const { id, lineId } = DocLine.parse(request.params);
    const body = EnterCount.parse(request.body);
    await withTransaction(pool, auditContext(request), async (c) => {
      await assertOpen(c, id, request.storeId);
      const line = await c.query<{ expected_quantity: string }>(
        'SELECT expected_quantity FROM stock_count_line WHERE id = $1 AND stock_count_id = $2',
        [lineId, id],
      );
      if (line.rows.length === 0) throw new AppError(404, 'not_found', 'There is no such line on this count.');
      const expected = line.rows[0]!.expected_quantity;
      const counted = body.countedQuantity;
      const isVariance = await c.query<{ is_variance: boolean }>(
        'SELECT ($1::numeric <> $2::numeric) AS is_variance',
        [counted, expected],
      );
      if (isVariance.rows[0]!.is_variance && !body.reasonCodeId)
        throw new AppError(422, 'missing_reason', 'A reason code is required for a variance line (IV-28).');

      // movement_type and direction derived from the variance direction
      const movementType = await c.query<{ movement_type: string; direction: string }>(
        `SELECT CASE WHEN $1::numeric > $2::numeric THEN 'COUNT_VARIANCE_IN' ELSE 'COUNT_VARIANCE_OUT' END AS movement_type,
                CASE WHEN $1::numeric > $2::numeric THEN 'In' ELSE 'Out' END AS direction`,
        [counted, expected],
      );
      const mt = isVariance.rows[0]!.is_variance ? movementType.rows[0]!.movement_type : null;
      const dir = isVariance.rows[0]!.is_variance ? movementType.rows[0]!.direction : null;
      await c.query(
        `UPDATE stock_count_line SET counted_quantity = $1, reason_code_id = $2, movement_type = $3, direction = $4
         WHERE id = $5`,
        [counted, body.reasonCodeId ?? null, mt, dir, lineId],
      );
    });
    return reply.status(200).send(await readCount(pool, id));
  });
}
