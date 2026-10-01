import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction, type Queryable } from '../../db/pool.ts';
import { AppError } from '../../http/errors.ts';
import { auditContext, type Access } from '../../http/gate.ts';
import type { MachineBinding } from '../../http/transitions.ts';
import { STORE_LOCATIONS } from './stock.ts';

type Kind = 'Adjustment' | 'OpeningBalance';

/** Writes one movement per line, in (variant, location) order so balances lock alike everywhere (`IV-24`). */
async function postMovements(c: Queryable, adjustmentId: string, by: string, correlationId: string): Promise<void> {
  const head = await c.query<{ store_id: string; organization_id: string }>('SELECT store_id, organization_id FROM stock_adjustment WHERE id = $1', [adjustmentId]);
  const { store_id: store, organization_id: org } = head.rows[0]!;
  const tx = await c.query<{ id: string }>('INSERT INTO inventory_transaction (store_id, created_by, correlation_id) VALUES ($1, $2, $3) RETURNING id', [store, by, correlationId]);
  await c.query(
    `INSERT INTO inventory_movement (inventory_transaction_id, store_id, organization_id, variant_id, storage_location_id,
                                     movement_type, direction, quantity, stock_adjustment_id, stock_adjustment_line_id)
     SELECT $1, $2, $3, variant_id, storage_location_id, movement_type, direction, quantity, stock_adjustment_id, id
     FROM stock_adjustment_line WHERE stock_adjustment_id = $4 ORDER BY variant_id, storage_location_id, id`,
    [tx.rows[0]!.id, store, org, adjustmentId],
  );
}

/** One opposite `REVERSAL` per movement of the adjustment: compensation, never an edit (`IV-12`, `RT-062`). */
async function reverseMovements(c: Queryable, adjustmentId: string, by: string, correlationId: string): Promise<void> {
  const head = await c.query<{ store_id: string; organization_id: string }>('SELECT store_id, organization_id FROM stock_adjustment WHERE id = $1', [adjustmentId]);
  const { store_id: store, organization_id: org } = head.rows[0]!;
  const tx = await c.query<{ id: string }>('INSERT INTO inventory_transaction (store_id, created_by, correlation_id) VALUES ($1, $2, $3) RETURNING id', [store, by, correlationId]);
  await c.query(
    `INSERT INTO inventory_movement (inventory_transaction_id, store_id, organization_id, variant_id, storage_location_id,
                                     movement_type, direction, quantity, reverses_movement_id, stock_adjustment_id,
                                     stock_adjustment_line_id)
     SELECT $1, $2, $3, variant_id, storage_location_id, 'REVERSAL', CASE direction WHEN 'In' THEN 'Out' ELSE 'In' END,
            quantity, id, stock_adjustment_id, stock_adjustment_line_id
     FROM inventory_movement WHERE stock_adjustment_id = $4 AND movement_type <> 'REVERSAL'
     ORDER BY variant_id, storage_location_id, id`,
    [tx.rows[0]!.id, store, org, adjustmentId],
  );
}

/**
 * The StockAdjustment machine (§22.17). Submitting and approving stamp who did it, and the database requires them to be
 * different people (`BI-26`, `IV-35`). Posting writes the movements, and reversing compensates them, in the same
 * transaction; the database checks at commit that exactly those were written (`SS022`). For an opening balance the
 * keys are inventory-domain §5's: `Config.Organization`, approved by `Import.Approve`; a reversal is "reverse any
 * movement", `Inventory.Adjust`.
 */
export const adjustmentMachine: MachineBinding = {
  machine: 'StockAdjustment',
  noun: 'stock adjustment',
  table: 'stock_adjustment',
  stateColumn: 'status',
  actorColumn: 'status_changed_by',
  storeColumn: 'store_id',
  actorColumnsFor: (to) => (to === 'PendingApproval' ? ['submitted_by'] : to === 'Approved' ? ['approved_by'] : []),
  extraColumns: ['kind'],
  keyFor: (subject, event, key) =>
    subject.kind !== 'OpeningBalance' || event === 'reverse' ? key : event === 'approve' ? 'Import.Approve' : 'Config.Organization',
  after: async (c, id, _from, to, principal, correlationId) => {
    if (to === 'Posted') await postMovements(c, id, principal.employeeId, correlationId);
    if (to === 'Reversed') await reverseMovements(c, id, principal.employeeId, correlationId);
  },
};

const NewDocument = z.object({ reasonCodeId: z.uuid(), note: z.string().trim().min(1).max(500).optional() });
const quantity = z.string().regex(/^\d{1,14}(\.\d{1,4})?$/);
// UX-36: a correction is entered as the counted quantity; a write-off or find as what happened.
const AdjustmentLine = z.union([
  z.object({ variantId: z.uuid(), locationId: z.uuid(), countedQuantity: quantity }),
  z.object({
    variantId: z.uuid(),
    locationId: z.uuid(),
    movementType: z.enum(['DAMAGE', 'EXPIRY', 'LOSS', 'FOUND']),
    quantity,
  }),
]);
const OpeningLine = z.object({ variantId: z.uuid(), locationId: z.uuid(), quantity });
const Doc = z.object({ storeId: z.uuid(), id: z.uuid() });
const DocLine = z.object({ storeId: z.uuid(), id: z.uuid(), lineId: z.uuid() });
const Listing = z.object({ status: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });

const DIRECTION: Record<string, 'In' | 'Out'> = { DAMAGE: 'Out', EXPIRY: 'Out', LOSS: 'Out', FOUND: 'In', OPENING_BALANCE: 'In' };

async function documentOf(db: Queryable, request: FastifyRequest, id: string, kind: Kind): Promise<void> {
  const found = await db.query('SELECT 1 FROM stock_adjustment WHERE id = $1 AND store_id = $2 AND kind = $3', [id, request.storeId, kind]);
  if (found.rows.length === 0) throw new AppError(404, 'not_found', 'There is no such document in this store.');
}

async function readDocument(db: Queryable, id: string) {
  const head = await db.query(
    `SELECT a.id, a.kind, a.document_number AS "documentNumber", a.status, a.reason_code_id AS "reasonCodeId", r.name AS reason,
            a.note, a.created_by AS "createdBy", a.submitted_by AS "submittedBy", a.approved_by AS "approvedBy",
            a.status_changed_at AS "statusChangedAt"
     FROM stock_adjustment a JOIN reason_code r ON r.id = a.reason_code_id WHERE a.id = $1`,
    [id],
  );
  const lines = await db.query(
    `SELECT l.id, l.variant_id AS "variantId", p.name AS product, v.name AS variant, l.storage_location_id AS "locationId",
            l.movement_type AS "movementType", l.direction, l.quantity::text AS quantity,
            l.counted_quantity::text AS "countedQuantity", l.system_quantity::text AS "systemQuantity"
     FROM stock_adjustment_line l JOIN product_variant v ON v.id = l.variant_id JOIN product p ON p.id = v.product_id
     WHERE l.stock_adjustment_id = $1 ORDER BY l.created_at, l.id`,
    [id],
  );
  return { ...head.rows[0], lines: lines.rows };
}

/**
 * One family of routes per kind: corrections and write-offs under `Inventory.Adjust`, opening stock under
 * `Config.Organization` (inventory-domain §5). A movement is only ever written by posting a document (`IV-14`): there is
 * no "set stock" route.
 */
function documentRoutes(app: FastifyInstance, pool: pg.Pool, kind: Kind, path: string, key: string): void {
  const access: { config: { access: Access } } = { config: { access: { kind: 'permission', key, scope: 'store' } } };
  const view: { config: { access: Access } } = { config: { access: { kind: 'permission', key: 'Inventory.View', scope: 'store' } } };

  app.get(`/stores/:storeId/${path}`, view, async (request) => {
    const query = Listing.parse(request.query);
    const { rows } = await pool.query(
      `SELECT a.id, a.document_number AS "documentNumber", a.status, r.name AS reason, a.status_changed_at AS "statusChangedAt",
              (SELECT count(*)::int FROM stock_adjustment_line l WHERE l.stock_adjustment_id = a.id) AS lines
       FROM stock_adjustment a JOIN reason_code r ON r.id = a.reason_code_id
       WHERE a.store_id = $1 AND a.kind = $2 AND ($3::text IS NULL OR a.status = $3)
       ORDER BY a.document_number DESC LIMIT $4`,
      [request.storeId, kind, query.status ?? null, query.limit],
    );
    return { items: rows };
  });

  app.get(`/stores/:storeId/${path}/:id`, view, async (request) => {
    const { id } = Doc.parse(request.params);
    await documentOf(pool, request, id, kind);
    return readDocument(pool, id);
  });

  /** A new document, `Draft`, with its server-allocated number and its reason, always (`IV-33`, `BI-42`). */
  app.post(`/stores/:storeId/${path}`, access, async (request, reply) => {
    const body = NewDocument.parse(request.body);
    const principal = request.principal!;
    const id = await withTransaction(pool, auditContext(request), async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO stock_adjustment (store_id, organization_id, kind, reason_code_id, note, created_by, status_changed_by)
         VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
        [request.storeId, principal.organizationId, kind, body.reasonCodeId, body.note ?? null, principal.employeeId],
      );
      return rows[0]!.id;
    });
    return reply.status(201).send(await readDocument(pool, id));
  });

  /**
   * A line, while the document is a draft (`SS018`). A correction is the counted quantity: the server reads the system's
   * quantity beside it and writes the difference as one directional line (`UX-36`, `UX-37`, `IV-34`).
   */
  app.post(`/stores/:storeId/${path}/:id/lines`, access, async (request, reply) => {
    const { id } = Doc.parse(request.params);
    const body = kind === 'OpeningBalance' ? { ...OpeningLine.parse(request.body), movementType: 'OPENING_BALANCE' as const } : AdjustmentLine.parse(request.body);
    const principal = request.principal!;
    await withTransaction(pool, auditContext(request), async (c) => {
      await documentOf(c, request, id, kind);
      // MS-16, D-03: a line moves stock only at a location of this store.
      const here = await c.query(`SELECT 1 WHERE $2::uuid IN (${STORE_LOCATIONS})`, [request.storeId, body.locationId]);
      if (here.rows.length === 0) throw new AppError(422, 'invalid_location', "That location is not one of this store's.");
      let line: { type: string; direction: 'In' | 'Out'; quantity: string; counted: string | null; system: string | null };
      if ('countedQuantity' in body) {
        const system = await c.query<{ on_hand: string }>(
          `SELECT coalesce((SELECT on_hand FROM stock_balance WHERE variant_id = $1 AND storage_location_id = $2), 0)::text AS on_hand`,
          [body.variantId, body.locationId],
        );
        const difference = await c.query<{ quantity: string; up: boolean; same: boolean }>(
          'SELECT abs($1::numeric - $2::numeric)::text AS quantity, $1::numeric > $2::numeric AS up, $1::numeric = $2::numeric AS same',
          [body.countedQuantity, system.rows[0]!.on_hand],
        );
        const d = difference.rows[0]!;
        if (d.same) throw new AppError(422, 'no_difference', 'The count matches the system quantity, so there is nothing to adjust.');
        line = { type: d.up ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT', direction: d.up ? 'In' : 'Out', quantity: d.quantity, counted: body.countedQuantity, system: system.rows[0]!.on_hand };
      } else {
        line = { type: body.movementType, direction: DIRECTION[body.movementType]!, quantity: body.quantity, counted: null, system: null };
      }
      await c.query(
        `INSERT INTO stock_adjustment_line (stock_adjustment_id, adjustment_kind, store_id, organization_id, variant_id,
                                            storage_location_id, movement_type, direction, quantity, counted_quantity, system_quantity)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [id, kind, request.storeId, principal.organizationId, body.variantId, body.locationId, line.type, line.direction, line.quantity, line.counted, line.system],
      );
    });
    return reply.status(201).send(await readDocument(pool, id));
  });

  /** Removes a line from a draft: the one delete the schema grants (overview §3.6). */
  app.delete(`/stores/:storeId/${path}/:id/lines/:lineId`, access, async (request) => {
    const { id, lineId } = DocLine.parse(request.params);
    await withTransaction(pool, auditContext(request), async (c) => {
      await documentOf(c, request, id, kind);
      const removed = await c.query('DELETE FROM stock_adjustment_line WHERE id = $1 AND stock_adjustment_id = $2', [lineId, id]);
      if (removed.rowCount === 0) throw new AppError(404, 'not_found', 'There is no such line on this document.');
    });
    return readDocument(pool, id);
  });
}

export async function adjustmentRoutes(app: FastifyInstance, options: { pool: pg.Pool }): Promise<void> {
  documentRoutes(app, options.pool, 'Adjustment', 'adjustments', 'Inventory.Adjust');
  documentRoutes(app, options.pool, 'OpeningBalance', 'opening-balances', 'Config.Organization');
}
