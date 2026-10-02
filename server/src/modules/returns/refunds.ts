import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction, type Queryable } from '../../db/pool.ts';
import { AppError } from '../../http/errors.ts';
import { auditContext, type Access } from '../../http/gate.ts';
import type { MachineBinding } from '../../http/transitions.ts';
import { tillOf } from '../sales/till.ts';

const inStore = (key: string): { config: { access: Access } } => ({ config: { access: { kind: 'permission', key, scope: 'store' } } });

/**
 * A refund is money going back for one sale, optionally linked to one return of it (`RR-01`). Its lines are the allocation
 * to sold lines, each with the tax the line's own proportion gives (`RR-06`, `RR-42`, `RR-43`). The amount per line is the
 * caller's: how much a partial return makes refundable is not specified (OQ-023 item 2), so the bound is the line's settled
 * amount, as the database holds it.
 */
const NewRefund = z
  .object({
    clientOperationId: z.uuid(),
    saleId: z.uuid(),
    returnId: z.uuid().optional(),
    method: z.enum(['OriginalTender', 'Cash']),
    // The captured payment an `OriginalTender` refund goes back to (`RR-22`, `PY-25`).
    paymentId: z.uuid().optional(),
    // RR-35: a refund with no return is goodwill and needs a reason. The database refuses one without.
    reasonCodeId: z.uuid().optional(),
    lines: z
      .array(z.object({ saleLineId: z.uuid(), amount: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }))
      .min(1)
      .max(500),
  })
  .refine((refund) => (refund.method === 'OriginalTender') === (refund.paymentId !== undefined), {
    message: 'An original-tender refund names its payment, and a cash refund does not.',
    path: ['paymentId'],
  })
  .refine((refund) => new Set(refund.lines.map((line) => line.saleLineId)).size === refund.lines.length, {
    message: 'A refund has one amount per sold line.',
    path: ['lines'],
  });

/**
 * Cash leaves the drawer as one `RefundFromDrawer` row in the refund's own shift, and the refund completes in the same
 * transaction: they are one event (`PY-27`, `RT-156`), and the database checks at commit that neither is without the other
 * (`SS053`).
 */
async function payOutFromDrawer(c: Queryable, refundId: string, by: string): Promise<void> {
  await c.query(
    `INSERT INTO cash_transaction (cash_shift_id, cash_drawer_id, store_id, type, direction, amount, currency_code, created_by, refund_id)
     SELECT cash_shift_id, cash_drawer_id, store_id, 'RefundFromDrawer', 'Out', amount, currency_code, $2, id FROM refund WHERE id = $1`,
    [refundId, by],
  );
  await c.query(`UPDATE refund SET status = 'Completed', status_changed_by = $2 WHERE id = $1`, [refundId, by]);
}

/**
 * The Refund machine (§22.7). Every refund is approved by a second person (`BI-26`, OQ-023 item 1). Submitting and approving
 * stamp who did it, and the lines are fixed from submission (`AP-03`). Entering `Processing` takes the hold on the sold
 * lines (`RR-24`), in the owner's trigger. A drawer refund is paid out in the same transaction. A card refund goes to the
 * payment provider, which is not built, so it refuses here; nothing about it is assumed.
 */
export const refundMachine: MachineBinding = {
  machine: 'Refund',
  noun: 'refund',
  table: 'refund',
  stateColumn: 'status',
  actorColumn: 'status_changed_by',
  storeColumn: 'store_id',
  actorColumnsFor: (to) => (to === 'PendingApproval' ? ['submitted_by'] : to === 'Approved' ? ['approved_by'] : []),
  reasonColumnFor: (to) => (to === 'Cancelled' ? 'cancel_reason_code_id' : null),
  before: async (c, id, _from, to) => {
    if (to !== 'Processing') return;
    const refund = await c.query<{ disbursement: string }>('SELECT disbursement FROM refund WHERE id = $1', [id]);
    if (refund.rows[0]!.disbursement === 'Provider') {
      throw new AppError(409, 'provider_not_available', 'A refund to a card is paid through the payment gateway, which is not available yet.');
    }
  },
  after: async (c, id, _from, to, principal) => {
    if (to === 'Processing') await payOutFromDrawer(c, id, principal.employeeId);
  },
};

async function readRefund(db: Queryable, id: string) {
  const head = await db.query(
    `SELECT id, document_number AS "documentNumber", sale_id AS "saleId", customer_return_id AS "returnId", status, method,
            disbursement, payment_id AS "paymentId", amount, tax_amount AS "taxAmount", currency_code AS "currencyCode",
            reason_code_id AS "reasonCodeId", cancel_reason_code_id AS "cancelReasonCodeId", created_by AS "createdBy",
            submitted_by AS "submittedBy", approved_by AS "approvedBy", status_changed_at AS "statusChangedAt"
     FROM refund WHERE id = $1`,
    [id],
  );
  const lines = await db.query(
    `SELECT id, sale_line_id AS "saleLineId", amount, tax_amount AS "taxAmount" FROM refund_line WHERE refund_id = $1 ORDER BY sale_line_id`,
    [id],
  );
  return { ...head.rows[0], lines: lines.rows };
}

interface Allocation {
  id: string;
  left: number;
  tax: number;
}

export async function refundRoutes(app: FastifyInstance, options: { pool: pg.Pool }): Promise<void> {
  const { pool } = options;

  /**
   * A draft refund (`Sale.Refund`, "issue a refund"). The server derives how it is paid: a cash tender and a cash refund go
   * through this till's drawer and open shift, a card tender goes to the provider (`PY-25`, `PY-27`). A repeat of the
   * operation id returns the refund already drafted (`SM-04`).
   */
  app.post('/stores/:storeId/refunds', inStore('Sale.Refund'), async (request, reply) => {
    const body = NewRefund.parse(request.body);
    const principal = request.principal!;
    const existing = async () =>
      (await pool.query<{ id: string }>('SELECT id FROM refund WHERE store_id = $1 AND client_operation_id = $2', [request.storeId, body.clientOperationId])).rows[0];
    const before = await existing();
    if (before !== undefined) return reply.status(200).send(await readRefund(pool, before.id));
    try {
      const id = await withTransaction(pool, auditContext(request, { clientOperationId: body.clientOperationId }), async (c) => {
        const sale = await c.query<{ currency_code: string }>('SELECT currency_code FROM sale WHERE id = $1 AND store_id = $2', [body.saleId, request.storeId]);
        if (sale.rows.length === 0) throw new AppError(404, 'not_found', 'There is no such sale in this store.');

        let till: { terminalId: string; drawerId: string; shiftId: string } | null = null;
        const tender =
          body.paymentId === undefined
            ? undefined
            : (
                await c.query<{ method_type: string }>(
                  `SELECT p.method_type FROM payment p JOIN sale s ON s.checkout_id = p.checkout_id
                   WHERE p.id = $1 AND s.id = $2 AND p.status = 'Captured'`,
                  [body.paymentId, body.saleId],
                )
              ).rows[0];
        // A tender that is not a captured payment of this sale is refused by the database (SS050), whichever way it is paid.
        if (body.method === 'Cash' || tender?.method_type === 'Cash') {
          const at = await tillOf(c, request);
          const shift = await c.query<{ id: string }>(`SELECT id FROM cash_shift WHERE cash_drawer_id = $1 AND status = 'Open'`, [at.drawerId]);
          if (shift.rows.length === 0) throw new AppError(409, 'no_open_shift', 'Open a shift at this till first.');
          till = { terminalId: at.terminalId, drawerId: at.drawerId, shiftId: shift.rows[0]!.id };
        }

        // RR-06, RR-42: the tax is the line's stored tax in proportion to everything refunded of it, rounded once and
        // cumulatively, so partial refunds add up to exactly the tax charged. The same figure the hold checks (SS052).
        const planned = await c.query<Allocation>(
          `SELECT l.id, l.settled_amount - l.refunded_amount AS "left",
                  round(l.tax_amount::numeric * (l.refunded_amount + a.amount) / NULLIF(l.settled_amount, 0))::bigint - l.refunded_tax_amount AS tax
           FROM unnest($1::uuid[], $2::bigint[]) AS a(id, amount) JOIN sale_line l ON l.id = a.id AND l.sale_id = $3`,
          [body.lines.map((line) => line.saleLineId), body.lines.map((line) => line.amount), body.saleId],
        );
        const byId = new Map(planned.rows.map((row) => [row.id, row]));
        if (byId.size !== body.lines.length) throw new AppError(404, 'not_found', 'A line of this refund is not on this sale.');
        // RR-03: a draft is bounded as it is built. The atomic bound is the hold, taken when the refund is paid.
        for (const line of body.lines) {
          const left = byId.get(line.saleLineId)!.left;
          if (line.amount > left) throw new AppError(409, 'SS049', 'That is more than is still refundable on that line.', { remaining: String(left) });
        }
        const tax = body.lines.reduce((sum, line) => sum + byId.get(line.saleLineId)!.tax, 0);
        const amount = body.lines.reduce((sum, line) => sum + line.amount, 0);

        const { rows } = await c.query<{ id: string }>(
          `INSERT INTO refund (store_id, organization_id, sale_id, customer_return_id, client_operation_id, method, payment_id,
                               pos_terminal_id, cash_drawer_id, cash_shift_id, amount, tax_amount, currency_code, reason_code_id,
                               created_by, status_changed_by, correlation_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15, $16) RETURNING id`,
          [
            request.storeId, principal.organizationId, body.saleId, body.returnId ?? null, body.clientOperationId, body.method,
            body.paymentId ?? null, till?.terminalId ?? null, till?.drawerId ?? null, till?.shiftId ?? null, amount, tax,
            sale.rows[0]!.currency_code, body.reasonCodeId ?? null, principal.employeeId, request.id,
          ],
        );
        const refundId = rows[0]!.id;
        await c.query(
          `INSERT INTO refund_line (refund_id, store_id, sale_id, sale_line_id, amount, tax_amount)
           SELECT $1, $2, $3, a.id, a.amount, a.tax FROM unnest($4::uuid[], $5::bigint[], $6::bigint[]) AS a(id, amount, tax)`,
          [refundId, request.storeId, body.saleId, body.lines.map((l) => l.saleLineId), body.lines.map((l) => l.amount), body.lines.map((l) => byId.get(l.saleLineId)!.tax)],
        );
        return refundId;
      });
      return reply.status(201).send(await readRefund(pool, id));
    } catch (error) {
      const raced = (error as { constraint?: string }).constraint === 'uq_refund_operation' ? await existing() : undefined;
      if (raced !== undefined) return reply.status(200).send(await readRefund(pool, raced.id));
      throw error;
    }
  });
}
