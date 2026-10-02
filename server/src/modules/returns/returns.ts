import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction, type Queryable } from '../../db/pool.ts';
import { AppError } from '../../http/errors.ts';
import { auditContext, type Access } from '../../http/gate.ts';
import type { MachineBinding } from '../../http/transitions.ts';
import { STORE_LOCATIONS } from '../inventory/stock.ts';

/**
 * One write per request, and a repeat of one is answered with the document it made (`RR-15`, `RR-16`, `SM-04`). There is
 * no read route yet: no catalogue key is named for reading a return (OQ-035), so a document is returned by the writes
 * that make or change it, to someone who holds that write's key.
 */
const inStore = (key: string): { config: { access: Access } } => ({ config: { access: { kind: 'permission', key, scope: 'store' } } });

const quantity = z.string().regex(/^\d{1,14}(\.\d{1,4})?$/);
const NewReturn = z.object({ clientOperationId: z.uuid(), saleId: z.uuid() });
const NewLine = z.object({
  clientOperationId: z.uuid(),
  saleLineId: z.uuid(),
  quantity,
  // RR-17, RR-18: there is no default. The screen pre-fills the store's, and the person confirms it.
  disposition: z.enum(['Sellable', 'Quarantine', 'Damaged', 'Expired']),
  locationId: z.uuid(),
});
const LateApproval = z.object({ reasonCodeId: z.uuid() });
const Doc = z.object({ storeId: z.uuid(), id: z.uuid() });
const DocLine = z.object({ storeId: z.uuid(), id: z.uuid(), lineId: z.uuid() });

/** One `SALE_RETURN` per line, into the line's dispositioned location, in the order every writer locks balances (`IV-24`). */
async function postMovements(c: Queryable, returnId: string, by: string, correlationId: string): Promise<void> {
  const head = await c.query<{ store_id: string; organization_id: string }>('SELECT store_id, organization_id FROM customer_return WHERE id = $1', [returnId]);
  const { store_id: store, organization_id: org } = head.rows[0]!;
  const tx = await c.query<{ id: string }>('INSERT INTO inventory_transaction (store_id, created_by, correlation_id) VALUES ($1, $2, $3) RETURNING id', [store, by, correlationId]);
  await c.query(
    `INSERT INTO inventory_movement (inventory_transaction_id, store_id, organization_id, variant_id, storage_location_id,
                                     movement_type, direction, quantity, customer_return_id, customer_return_line_id, disposition)
     SELECT $1, $2, $3, variant_id, storage_location_id, 'SALE_RETURN', 'In', quantity, customer_return_id, id, disposition
     FROM customer_return_line WHERE customer_return_id = $4 ORDER BY variant_id, storage_location_id, id`,
    [tx.rows[0]!.id, store, org, returnId],
  );
}

/**
 * The CustomerReturn machine (§22.7). Posting is where stock moves and the sold line's counter takes the quantity, in the
 * owner's trigger (`RR-14`, `RR-17`); cancelling needs a reason and moves nothing (`SM-42`). Both are `Return.Create`
 * (D-16). `Posted → Settled → Closed` has no edge: its keys are open (OQ-023).
 */
export const returnMachine: MachineBinding = {
  machine: 'CustomerReturn',
  noun: 'return',
  table: 'customer_return',
  stateColumn: 'status',
  actorColumn: 'status_changed_by',
  storeColumn: 'store_id',
  actorColumnsFor: (to) => (to === 'Posted' ? ['posted_by'] : []),
  reasonColumnFor: (to) => (to === 'Cancelled' ? 'cancel_reason_code_id' : null),
  before: async (c, id, _from, to) => {
    if (to !== 'Posted') return;
    const lines = await c.query('SELECT 1 FROM customer_return_line WHERE customer_return_id = $1 LIMIT 1', [id]);
    if (lines.rows.length === 0) throw new AppError(409, 'empty_return', 'A return needs at least one line before it can be posted.');
  },
  after: async (c, id, _from, to, principal, correlationId) => {
    if (to === 'Posted') await postMovements(c, id, principal.employeeId, correlationId);
  },
};

async function readReturn(db: Queryable, id: string) {
  const head = await db.query(
    `SELECT id, document_number AS "documentNumber", sale_id AS "saleId", status, business_date::text AS "businessDate",
            created_by AS "createdBy", posted_by AS "postedBy", posted_at AS "postedAt",
            late_approved_by AS "lateApprovedBy", late_reason_code_id AS "lateReasonCodeId",
            cancel_reason_code_id AS "cancelReasonCodeId", status_changed_at AS "statusChangedAt"
     FROM customer_return WHERE id = $1`,
    [id],
  );
  const lines = await db.query(
    `SELECT id, sale_line_id AS "saleLineId", variant_id AS "variantId", quantity::text AS quantity, disposition,
            storage_location_id AS "locationId"
     FROM customer_return_line WHERE customer_return_id = $1 ORDER BY id`,
    [id],
  );
  return { ...head.rows[0], lines: lines.rows };
}

async function returnOf(db: Queryable, storeId: string | null, id: string): Promise<{ sale_id: string }> {
  const found = await db.query<{ sale_id: string }>('SELECT sale_id FROM customer_return WHERE id = $1 AND store_id = $2', [id, storeId]);
  if (found.rows.length === 0) throw new AppError(404, 'not_found', 'There is no such return in this store.');
  return found.rows[0]!;
}

/** Returns: goods back against exactly one sale of the store (`RR-01`, `RR-08`, `RR-13`). */
export async function returnRoutes(app: FastifyInstance, options: { pool: pg.Pool }): Promise<void> {
  const { pool } = options;

  /** A draft return against a sale of this store. A repeat of the operation id returns the return already opened (`RR-15`). */
  app.post('/stores/:storeId/returns', inStore('Return.Create'), async (request, reply) => {
    const body = NewReturn.parse(request.body);
    const principal = request.principal!;
    const existing = async () =>
      (await pool.query<{ id: string }>('SELECT id FROM customer_return WHERE store_id = $1 AND client_operation_id = $2', [request.storeId, body.clientOperationId])).rows[0];
    const before = await existing();
    if (before !== undefined) return reply.status(200).send(await readReturn(pool, before.id));
    try {
      const id = await withTransaction(pool, auditContext(request, { clientOperationId: body.clientOperationId }), async (c) => {
        // MS-04: a sale of another store, or another organization, does not exist as far as this caller can tell.
        const sale = await c.query('SELECT 1 FROM sale WHERE id = $1 AND store_id = $2', [body.saleId, request.storeId]);
        if (sale.rows.length === 0) throw new AppError(404, 'not_found', 'There is no such sale in this store.');
        const { rows } = await c.query<{ id: string }>(
          `INSERT INTO customer_return (store_id, organization_id, sale_id, client_operation_id, created_by, status_changed_by, correlation_id)
           VALUES ($1, $2, $3, $4, $5, $5, $6) RETURNING id`,
          [request.storeId, principal.organizationId, body.saleId, body.clientOperationId, principal.employeeId, request.id],
        );
        return rows[0]!.id;
      });
      return reply.status(201).send(await readReturn(pool, id));
    } catch (error) {
      const raced = (error as { constraint?: string }).constraint === 'uq_customer_return_operation' ? await existing() : undefined;
      if (raced !== undefined) return reply.status(200).send(await readReturn(pool, raced.id));
      throw error;
    }
  });

  /**
   * One returned quantity of one sold line, with its disposition and the location that disposition sends it to. The
   * variant comes from the sold line, never from the request (`BI-16`). The database bounds the quantity as it is built
   * (`RR-14`, §12.1) and checks the disposition against the location (`RR-19`).
   */
  app.post('/stores/:storeId/returns/:id/lines', inStore('Return.Create'), async (request, reply) => {
    const { id } = Doc.parse(request.params);
    const body = NewLine.parse(request.body);
    const principal = request.principal!;
    const existing = async () =>
      (await pool.query('SELECT 1 FROM customer_return_line WHERE store_id = $1 AND client_operation_id = $2', [request.storeId, body.clientOperationId])).rows[0];
    if ((await existing()) !== undefined) {
      await returnOf(pool, request.storeId, id);
      return reply.status(200).send(await readReturn(pool, id));
    }
    await withTransaction(pool, auditContext(request, { clientOperationId: body.clientOperationId }), async (c) => {
      const { sale_id: saleId } = await returnOf(c, request.storeId, id);
      const line = await c.query<{ variant_id: string }>('SELECT variant_id FROM sale_line WHERE id = $1 AND sale_id = $2', [body.saleLineId, saleId]);
      if (line.rows.length === 0) throw new AppError(404, 'not_found', 'That line is not on this return’s sale.');
      // MS-16, D-03: goods come back to a location of this store.
      const here = await c.query(`SELECT 1 WHERE $2::uuid IN (${STORE_LOCATIONS})`, [request.storeId, body.locationId]);
      if (here.rows.length === 0) throw new AppError(422, 'invalid_location', "That location is not one of this store's.");
      await c.query(
        `INSERT INTO customer_return_line (customer_return_id, store_id, organization_id, sale_id, sale_line_id, variant_id, quantity,
                                           disposition, storage_location_id, client_operation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, request.storeId, principal.organizationId, saleId, body.saleLineId, line.rows[0]!.variant_id, body.quantity, body.disposition, body.locationId, body.clientOperationId],
      );
    });
    return reply.status(201).send(await readReturn(pool, id));
  });

  /** Removes a line from a draft: the one delete the schema grants. The database refuses it once the return has left Draft (`SS018`). */
  app.delete('/stores/:storeId/returns/:id/lines/:lineId', inStore('Return.Create'), async (request) => {
    const { id, lineId } = DocLine.parse(request.params);
    await withTransaction(pool, auditContext(request), async (c) => {
      await returnOf(c, request.storeId, id);
      const removed = await c.query('DELETE FROM customer_return_line WHERE id = $1 AND customer_return_id = $2', [lineId, id]);
      if (removed.rowCount === 0) throw new AppError(404, 'not_found', 'There is no such line on this return.');
    });
    return readReturn(pool, id);
  });

  /**
   * A late return needs `Return.Approve` and a reason (`RR-11`). The approver does it in their own session while the return
   * is a draft, and the database requires them to be neither whoever opened the return nor whoever posts it (`AP-08`,
   * `BI-26`). Where the approval is given from is not specified, and neither is whether it may be given before the window
   * has closed: recorded in OQ-035.
   */
  app.post('/stores/:storeId/returns/:id/late-approval', inStore('Return.Approve'), async (request) => {
    const { id } = Doc.parse(request.params);
    const body = LateApproval.parse(request.body);
    await withTransaction(pool, auditContext(request, { reasonCodeId: body.reasonCodeId }), async (c) => {
      await returnOf(c, request.storeId, id);
      const done = await c.query(
        `UPDATE customer_return SET late_approved_by = $3, late_reason_code_id = $4 WHERE id = $1 AND store_id = $2 AND status = 'Draft'`,
        [id, request.storeId, request.principal!.employeeId, body.reasonCodeId],
      );
      if (done.rowCount === 0) throw new AppError(409, 'not_a_draft', 'Only a return that has not been posted can be approved late.');
    });
    return readReturn(pool, id);
  });
}
