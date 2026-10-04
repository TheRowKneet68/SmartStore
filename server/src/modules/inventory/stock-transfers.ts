import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction, type Queryable } from '../../db/pool.ts';
import { AppError } from '../../http/errors.ts';
import { auditContext, type Access } from '../../http/gate.ts';
import type { MachineBinding } from '../../http/transitions.ts';

const inStore = (key: string): { config: { access: Access } } => ({ config: { access: { kind: 'permission', key, scope: 'store' } } });

const CREATE   = inStore('Inventory.Transfer.Create');
const DISPATCH = inStore('Inventory.Transfer.Dispatch');
const RECEIVE  = inStore('Inventory.Transfer.Receive');

const Doc     = z.object({ storeId: z.uuid(), id: z.uuid() });
const DocLine = z.object({ storeId: z.uuid(), id: z.uuid(), lineId: z.uuid() });
const Listing = z.object({ status: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });

const NewTransfer = z.object({
  fromLocationId:    z.uuid(),
  toLocationId:      z.uuid(),
  transitLocationId: z.uuid(),
  note:              z.string().trim().min(1).max(500).optional(),
});
const NewLine = z.object({ variantId: z.uuid(), quantity: z.string().regex(/^\d{1,14}(\.\d{1,4})?$/) });

async function assertDraft(db: Queryable, id: string, storeId: string): Promise<void> {
  const { rows } = await db.query(
    'SELECT 1 FROM stock_transfer WHERE id = $1 AND store_id = $2 AND status = $3',
    [id, storeId, 'Draft'],
  );
  if (rows.length === 0) throw new AppError(404, 'not_found', 'There is no draft transfer with this id in this store.');
}

async function readTransfer(db: Queryable, id: string) {
  const head = await db.query(
    `SELECT t.id, t.document_number AS "documentNumber", t.status, t.note,
            t.from_location_id AS "fromLocationId",   fl.name AS "fromLocation",
            t.to_location_id   AS "toLocationId",     tl.name AS "toLocation",
            t.transit_location_id AS "transitLocationId", xl.name AS "transitLocation",
            t.created_by AS "createdBy", t.created_at AS "createdAt",
            t.submitted_by AS "submittedBy", t.submitted_at AS "submittedAt",
            t.approved_by  AS "approvedBy",  t.approved_at  AS "approvedAt",
            t.dispatched_by AS "dispatchedBy", t.dispatched_at AS "dispatchedAt",
            t.received_by  AS "receivedBy",   t.received_at  AS "receivedAt",
            t.status_changed_at AS "statusChangedAt"
     FROM stock_transfer t
       JOIN storage_location fl ON fl.id = t.from_location_id
       JOIN storage_location tl ON tl.id = t.to_location_id
       JOIN storage_location xl ON xl.id = t.transit_location_id
     WHERE t.id = $1`,
    [id],
  );
  const lines = await db.query(
    `SELECT l.id, l.variant_id AS "variantId", p.name AS product, v.name AS variant,
            l.quantity::text AS quantity, l.received_quantity::text AS "receivedQuantity"
     FROM stock_transfer_line l
       JOIN product_variant v ON v.id = l.variant_id
       JOIN product p ON p.id = v.product_id
     WHERE l.stock_transfer_id = $1
     ORDER BY l.created_at, l.id`,
    [id],
  );
  return { ...head.rows[0], lines: lines.rows };
}

/** Writes TRANSFER_OUT from source + TRANSFER_IN to transit for every line (IV-39, IV-40). */
async function dispatchMovements(c: Queryable, transferId: string, by: string, correlationId: string): Promise<void> {
  const head = await c.query<{ store_id: string; organization_id: string; from_location_id: string; transit_location_id: string }>(
    'SELECT store_id, organization_id, from_location_id, transit_location_id FROM stock_transfer WHERE id = $1',
    [transferId],
  );
  const { store_id: store, organization_id: org, from_location_id: fromLoc, transit_location_id: transitLoc } = head.rows[0]!;
  const tx = await c.query<{ id: string }>(
    'INSERT INTO inventory_transaction (store_id, created_by, correlation_id) VALUES ($1, $2, $3) RETURNING id',
    [store, by, correlationId],
  );
  const txId = tx.rows[0]!.id;
  const lines = await c.query<{ id: string; variant_id: string; quantity: string }>(
    'SELECT id, variant_id, quantity::text FROM stock_transfer_line WHERE stock_transfer_id = $1 ORDER BY variant_id, id',
    [transferId],
  );
  for (const line of lines.rows) {
    // TRANSFER_OUT from source location
    await c.query(
      `INSERT INTO inventory_movement (inventory_transaction_id, store_id, organization_id, variant_id, storage_location_id,
                                       movement_type, direction, quantity, stock_transfer_id, stock_transfer_line_id)
       VALUES ($1,$2,$3,$4,$5,'TRANSFER_OUT','Out',$6,$7,$8)`,
      [txId, store, org, line.variant_id, fromLoc, line.quantity, transferId, line.id],
    );
    // TRANSFER_IN to transit location
    await c.query(
      `INSERT INTO inventory_movement (inventory_transaction_id, store_id, organization_id, variant_id, storage_location_id,
                                       movement_type, direction, quantity, stock_transfer_id, stock_transfer_line_id)
       VALUES ($1,$2,$3,$4,$5,'TRANSFER_IN','In',$6,$7,$8)`,
      [txId, store, org, line.variant_id, transitLoc, line.quantity, transferId, line.id],
    );
  }
}

/** Writes TRANSFER_OUT from transit + TRANSFER_IN to destination for every line (IV-39, IV-41). */
async function receiveMovements(c: Queryable, transferId: string, by: string, correlationId: string): Promise<void> {
  const head = await c.query<{ store_id: string; organization_id: string; to_location_id: string; transit_location_id: string }>(
    'SELECT store_id, organization_id, to_location_id, transit_location_id FROM stock_transfer WHERE id = $1',
    [transferId],
  );
  const { store_id: store, organization_id: org, to_location_id: toLoc, transit_location_id: transitLoc } = head.rows[0]!;
  const tx = await c.query<{ id: string }>(
    'INSERT INTO inventory_transaction (store_id, created_by, correlation_id) VALUES ($1, $2, $3) RETURNING id',
    [store, by, correlationId],
  );
  const txId = tx.rows[0]!.id;
  const lines = await c.query<{ id: string; variant_id: string; quantity: string }>(
    'SELECT id, variant_id, quantity::text FROM stock_transfer_line WHERE stock_transfer_id = $1 ORDER BY variant_id, id',
    [transferId],
  );
  for (const line of lines.rows) {
    // TRANSFER_OUT from transit
    await c.query(
      `INSERT INTO inventory_movement (inventory_transaction_id, store_id, organization_id, variant_id, storage_location_id,
                                       movement_type, direction, quantity, stock_transfer_id, stock_transfer_line_id)
       VALUES ($1,$2,$3,$4,$5,'TRANSFER_OUT','Out',$6,$7,$8)`,
      [txId, store, org, line.variant_id, transitLoc, line.quantity, transferId, line.id],
    );
    // TRANSFER_IN to destination
    await c.query(
      `INSERT INTO inventory_movement (inventory_transaction_id, store_id, organization_id, variant_id, storage_location_id,
                                       movement_type, direction, quantity, stock_transfer_id, stock_transfer_line_id)
       VALUES ($1,$2,$3,$4,$5,'TRANSFER_IN','In',$6,$7,$8)`,
      [txId, store, org, line.variant_id, toLoc, line.quantity, transferId, line.id],
    );
  }
  // Stamp received_quantity on each line (IV-41)
  await c.query(
    `UPDATE stock_transfer_line SET received_quantity = quantity WHERE stock_transfer_id = $1`,
    [transferId],
  );
}

/**
 * The StockTransfer machine (SM-77, IV-39..IV-45, RT-078..RT-080, OQ-039).
 * Dispatch writes TRANSFER_OUT/TRANSFER_IN pairs from source→transit in one transaction.
 * Receive writes the same pair transit→destination.
 * RT-080 separation of duties: the before hook on receive_all refuses if the receiver is the dispatcher.
 */
export const stockTransferMachine: MachineBinding = {
  machine: 'StockTransfer',
  noun: 'stock transfer',
  table: 'stock_transfer',
  stateColumn: 'status',
  actorColumn: 'status_changed_by',
  storeColumn: 'store_id',
  actorColumnsFor: (to) => {
    if (to === 'PendingApproval') return ['submitted_by'];
    if (to === 'Approved') return ['approved_by'];
    if (to === 'InTransit') return ['dispatched_by'];
    if (to === 'Received') return ['received_by'];
    return [];
  },
  before: async (c, id, _from, to, principal) => {
    if (to !== 'Received') return;
    const { rows } = await c.query<{ dispatched_by: string | null }>(
      'SELECT dispatched_by FROM stock_transfer WHERE id = $1',
      [id],
    );
    const dispatchedBy = rows[0]?.dispatched_by;
    if (dispatchedBy && dispatchedBy === principal.employeeId)
      throw new AppError(422, 'sep_of_duties', 'The receiver must be a different person than the dispatcher (RT-080).');
    const lineCount = await c.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM stock_transfer_line WHERE stock_transfer_id = $1',
      [id],
    );
    if (Number(lineCount.rows[0]!.n) === 0)
      throw new AppError(422, 'no_lines', 'A transfer must have at least one line before it can be received.');
  },
  after: async (c, id, _from, to, principal, correlationId) => {
    if (to === 'InTransit') await dispatchMovements(c, id, principal.employeeId, correlationId);
    if (to === 'Received') await receiveMovements(c, id, principal.employeeId, correlationId);
  },
};

/**
 * Stock Transfer routes (IV-39..IV-45, RT-078..RT-080, SM-77).
 * State transitions (submit/approve/dispatch/receive_all/cancel/reject) are via POST /api/v1/transitions.
 */
export async function stockTransferRoutes(app: FastifyInstance, options: { pool: pg.Pool }): Promise<void> {
  const { pool } = options;

  app.get('/stores/:storeId/stock-transfers', CREATE, async (request) => {
    const { status, limit } = Listing.parse(request.query);
    const { rows } = await pool.query(
      `SELECT t.id, t.document_number AS "documentNumber", t.status,
              t.from_location_id AS "fromLocationId", fl.name AS "fromLocation",
              t.to_location_id AS "toLocationId", tl.name AS "toLocation",
              t.status_changed_at AS "statusChangedAt",
              (SELECT count(*)::int FROM stock_transfer_line l WHERE l.stock_transfer_id = t.id) AS lines
       FROM stock_transfer t
         JOIN storage_location fl ON fl.id = t.from_location_id
         JOIN storage_location tl ON tl.id = t.to_location_id
       WHERE t.store_id = $1 AND ($2::text IS NULL OR t.status = $2)
       ORDER BY t.document_number DESC LIMIT $3`,
      [request.storeId, status ?? null, limit],
    );
    return { items: rows };
  });

  app.get('/stores/:storeId/stock-transfers/:id', CREATE, async (request) => {
    const { id } = Doc.parse(request.params);
    const { rows } = await pool.query('SELECT 1 FROM stock_transfer WHERE id = $1 AND store_id = $2', [id, request.storeId]);
    if (rows.length === 0) throw new AppError(404, 'not_found', 'There is no such transfer in this store.');
    return readTransfer(pool, id);
  });

  /** Create a Draft transfer; validates that the transit location has location_type = 'Transit' (IV-39). */
  app.post('/stores/:storeId/stock-transfers', CREATE, async (request, reply) => {
    const body = NewTransfer.parse(request.body);
    const principal = request.principal!;

    const id = await withTransaction(pool, auditContext(request), async (c) => {
      const transit = await c.query<{ location_type: string }>(
        'SELECT location_type FROM storage_location WHERE id = $1',
        [body.transitLocationId],
      );
      if (transit.rows.length === 0 || transit.rows[0]!.location_type !== 'Transit')
        throw new AppError(422, 'invalid_transit', 'The transit location must exist and have location_type = Transit (IV-39).');

      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO stock_transfer (store_id, organization_id, from_location_id, to_location_id, transit_location_id,
                                     note, created_by, status_changed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,
        [request.storeId, principal.organizationId, body.fromLocationId, body.toLocationId, body.transitLocationId,
         body.note ?? null, principal.employeeId],
      );
      return rows[0]!.id;
    });
    return reply.status(201).send(await readTransfer(pool, id));
  });

  /** Add a variant line to a Draft transfer (IV-39). Duplicate variant is refused by the unique constraint. */
  app.post('/stores/:storeId/stock-transfers/:id/lines', CREATE, async (request, reply) => {
    const { id } = Doc.parse(request.params);
    const body = NewLine.parse(request.body);
    const principal = request.principal!;
    await withTransaction(pool, auditContext(request), async (c) => {
      await assertDraft(c, id, request.storeId);
      await c.query(
        `INSERT INTO stock_transfer_line (stock_transfer_id, store_id, organization_id, variant_id, quantity)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, request.storeId, principal.organizationId, body.variantId, body.quantity],
      );
    });
    return reply.status(201).send(await readTransfer(pool, id));
  });

  /** Remove a line from a Draft transfer (IV-39). */
  app.delete('/stores/:storeId/stock-transfers/:id/lines/:lineId', CREATE, async (request, reply) => {
    const { id, lineId } = DocLine.parse(request.params);
    await withTransaction(pool, auditContext(request), async (c) => {
      await assertDraft(c, id, request.storeId);
      const { rowCount } = await c.query(
        'DELETE FROM stock_transfer_line WHERE id = $1 AND stock_transfer_id = $2',
        [lineId, id],
      );
      if (!rowCount) throw new AppError(404, 'not_found', 'There is no such line on this transfer.');
    });
    return reply.status(200).send(await readTransfer(pool, id));
  });
}
