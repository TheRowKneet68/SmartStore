import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction, type Queryable } from '../../db/pool.ts';
import { AppError } from '../../http/errors.ts';
import { auditContext, type Access } from '../../http/gate.ts';
import { MAX_PAGE } from '../../http/paging.ts';
import type { MachineBinding } from '../../http/transitions.ts';
import type { PaymentGateway } from '../payments/gateway.ts';
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
 * The refund of a payment that never became a sale (owner decision D-18, OQ-036 item 2): money taken for nothing, given back
 * to the card it came from (`PY-37`). It names the captured card payment and the amount, and a reason (it is goodwill in the
 * sense of `RR-35`). It has no sale, no return, no lines and no tax. It is bounded by what the payment took less what has been
 * held back to it, as a line is bounded by its settled amount (`PY-22`).
 */
const NewPaymentRefund = z.object({
  clientOperationId: z.uuid(),
  method: z.literal('OriginalTender'),
  paymentId: z.uuid(),
  amount: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  reasonCodeId: z.uuid(),
  // Strict: a return, a sale or lines would be silently dropped otherwise, and this refund has none of them.
}).strict();

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
 * payment provider, which is never called inside a transaction (`PY-36`), so it is paid and retried by its own routes
 * below, and refuses here.
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
  before: async (c, id, _from, to, principal) => {
    if (to !== 'Processing') return;
    const refund = await c.query<{ disbursement: string; terminal: string | null }>(
      'SELECT disbursement, pos_terminal_id AS terminal FROM refund WHERE id = $1',
      [id],
    );
    // D-17 item 4: cash goes out of one drawer, so the person who pays it is signed in at that till.
    if (refund.rows[0]!.disbursement === 'Drawer' && principal.terminalId !== refund.rows[0]!.terminal) {
      throw new AppError(409, 'not_at_refund_till', "This refund is paid out of a till's drawer. Sign in at the till it was drafted at to pay it.");
    }
    if (refund.rows[0]!.disbursement === 'Provider') {
      throw new AppError(409, 'use_pay_route', 'A refund to a card is paid at /refunds/:id/pay and retried at /refunds/:id/retry, where the provider is asked outside the transaction.');
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
            provider_outcome AS "providerOutcome", coalesce(provider_transaction_reference LIKE 'SIM-%', false) AS simulated,
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

type PayMode = 'pay' | 'retry';

/**
 * Pays a refund to the card it came from (`PY-25`, `RR-23`): the provider's own round trip, outside any transaction
 * (`PY-36`). In three steps, each committed:
 * 1. `Approved → Processing` (or `Failed → Processing` on a retry): the hold on the sold lines is taken here, in the
 *    owner's trigger, and stays through failure and retry (`RR-24`, `SM-40`, `SM-41`);
 * 2. the provider is asked to refund the captured payment, under the refund's own id as the merchant reference, so asking
 *    again is the same request and never a second refund (architecture §13.3);
 * 3. its answer is recorded: `Approved` completes the refund; a decline or a technical failure fails it, held and retryable;
 *    a timeout, or an error, leaves it `Processing` for the same request to resolve by asking the provider (`PY-11`,
 *    `PY-41`): it is never failed for the silence.
 * Paying again a refund that is `Processing` resumes it, and one that is `Completed` returns it unchanged (`SM-04`).
 */
async function payByProvider(
  pool: pg.Pool,
  request: FastifyRequest,
  gateway: PaymentGateway,
  refundId: string,
  mode: PayMode,
  lockTimeoutMs: number,
) {
  const first = await withTransaction(
    pool,
    auditContext(request),
    async (c) => {
      const found = await c.query<{
        status: string;
        disbursement: string;
        amount: number;
        currencyCode: string;
        providerOutcome: string | null;
        capturedReference: string | null;
        saleId: string | null;
        checkoutId: string | null;
      }>(
        `SELECT r.status, r.disbursement, r.amount, r.sale_id AS "saleId", p.checkout_id AS "checkoutId", r.currency_code AS "currencyCode", r.provider_outcome AS "providerOutcome",
                p.provider_transaction_reference AS "capturedReference"
         FROM refund r LEFT JOIN payment p ON p.id = r.payment_id WHERE r.id = $1 AND r.store_id = $2 FOR UPDATE OF r`,
        [refundId, request.storeId],
      );
      const refund = found.rows[0];
      if (refund === undefined) throw new AppError(404, 'not_found', 'There is no such refund in this store.');
      if (refund.disbursement !== 'Provider') throw new AppError(409, 'not_a_card_refund', 'This refund is paid from the drawer, not to a card.');
      const from = mode === 'pay' ? 'Approved' : 'Failed';
      if (refund.status === from) {
        await c.query(`UPDATE refund SET status = 'Processing', status_changed_by = $2 WHERE id = $1`, [refundId, request.principal!.employeeId]);
        // D-18: the money of a payment with no sale is going back, so its cart is given up and cannot be sold on.
        if (refund.saleId === null && refund.checkoutId !== null) {
          await c.query(`UPDATE checkout SET status = 'Abandoned' WHERE id = $1 AND status = 'Open'`, [refund.checkoutId]);
        }
      } else if (refund.status !== 'Processing' && refund.status !== 'Completed') {
        throw new AppError(409, 'illegal_transition', `This refund is ${refund.status}, so it cannot be ${mode === 'pay' ? 'paid' : 'retried'}.`);
      }
      return { ...refund, status: refund.status === from ? 'Processing' : refund.status };
    },
    { lockTimeoutMs },
  );
  if (first.status === 'Completed') return readRefund(pool, refundId);
  if (first.capturedReference === null) {
    throw new AppError(409, 'no_provider_reference', 'The card payment this refund goes back to has no provider reference, so the provider cannot be asked.');
  }

  const settled = first.providerOutcome === 'Timeout' || first.providerOutcome === 'Pending';
  const result = settled
    ? await gateway.query({ merchantReference: refundId })
    : await gateway.refund({ merchantReference: refundId, capturedReference: first.capturedReference, amount: first.amount, currencyCode: first.currencyCode });

  await withTransaction(pool, auditContext(request), async (c) => {
    const now = await c.query<{ status: string }>('SELECT status FROM refund WHERE id = $1 FOR UPDATE', [refundId]);
    if (now.rows[0]?.status !== 'Processing') return;
    // A first answer of Declined, Failed or Errored fails the refund. A provider that does not know a refund it was
    // already asked about has not answered, so the refund stays Processing (PY-41).
    const to =
      result.outcome === 'Approved' ? 'Completed' : !settled && ['Declined', 'Failed', 'Errored'].includes(result.outcome) ? 'Failed' : null;
    const outcome = settled && result.outcome === 'Failed' ? 'Pending' : result.outcome;
    await c.query(
      `UPDATE refund SET status = coalesce($2, status), status_changed_by = $3, provider_outcome = $4, provider_raw_code = $5,
                         provider_transaction_reference = coalesce($6, provider_transaction_reference)
       WHERE id = $1`,
      [refundId, to, request.principal!.employeeId, outcome, result.rawCode, result.providerReference],
    );
  });

  const refund = await readRefund(pool, refundId);
  if (refund.status === 'Failed') {
    throw new AppError(409, 'refund_failed', 'The card refund failed. The money is still held for it: retry it, or cancel it with a reason.', { state: 'Failed' });
  }
  if (refund.status === 'Processing') {
    throw new AppError(409, 'refund_pending', 'The card refund is not confirmed yet. Do not refund it again: pay it again to check.', { state: 'Processing' });
  }
  return refund;
}

interface Allocation {
  id: string;
  left: number;
  tax: number;
}

export async function refundRoutes(app: FastifyInstance, options: { pool: pg.Pool; gateway: PaymentGateway; lockTimeoutMs: number }): Promise<void> {
  const { pool, gateway } = options;

  /**
   * A draft refund (`Sale.Refund`, "issue a refund"). The server derives how it is paid: a cash tender and a cash refund go
   * through this till's drawer and open shift, a card tender goes to the provider (`PY-25`, `PY-27`). A repeat of the
   * operation id returns the refund already drafted (`SM-04`).
   */
  app.post('/stores/:storeId/refunds', inStore('Sale.Refund'), async (request, reply) => {
    if ((request.body as { saleId?: unknown } | null)?.saleId === undefined) return draftPaymentRefund(request, reply);
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

  const Ref = z.object({ storeId: z.uuid(), id: z.uuid() });
  const Listing = z.object({
    status: z.enum(['Draft', 'PendingApproval', 'Approved', 'Processing', 'Completed', 'Failed', 'Cancelled']).optional(),
    saleId: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE).default(50),
    after: z.coerce.number().int().min(1).optional(),
  });

  /** The store's refunds, newest first, a page at a time, by status or by sale (`Refund.View`, D-17). */
  app.get('/stores/:storeId/refunds', inStore('Refund.View'), async (request) => {
    const q = Listing.parse(request.query);
    const { rows } = await pool.query<{ documentNumber: number }>(
      `SELECT r.id, r.document_number AS "documentNumber", r.sale_id AS "saleId", s.document_number AS "saleDocumentNumber",
              r.customer_return_id AS "returnId", r.payment_id AS "paymentId", r.status, r.method, r.disbursement, r.amount, r.currency_code AS "currencyCode",
              coalesce(r.provider_transaction_reference LIKE 'SIM-%', false) AS simulated, r.created_at AS "createdAt"
       FROM refund r LEFT JOIN sale s ON s.id = r.sale_id
       WHERE r.store_id = $1 AND ($2::text IS NULL OR r.status = $2) AND ($3::uuid IS NULL OR r.sale_id = $3)
         AND ($4::bigint IS NULL OR r.document_number < $4)
       ORDER BY r.document_number DESC LIMIT $5`,
      [request.storeId, q.status ?? null, q.saleId ?? null, q.after ?? null, q.limit],
    );
    return { items: rows, next: rows.length === q.limit ? rows[rows.length - 1]!.documentNumber : null };
  });

  app.get('/stores/:storeId/refunds/:id', inStore('Refund.View'), async (request) => {
    const { id } = Ref.parse(request.params);
    const found = await pool.query('SELECT 1 FROM refund WHERE id = $1 AND store_id = $2', [id, request.storeId]);
    if (found.rows.length === 0) throw new AppError(404, 'not_found', 'There is no such refund in this store.');
    return readRefund(pool, id);
  });
  /** Pays an approved refund to the card it came from (`Refund.Pay`, D-16), or resumes one in flight. */
  app.post('/stores/:storeId/refunds/:id/pay', inStore('Refund.Pay'), async (request) => {
    const { id } = Ref.parse(request.params);
    return payByProvider(pool, request, gateway, id, 'pay', options.lockTimeoutMs);
  });
  /** Retries a failed card refund (`Sale.Refund`, D-16): the hold is still on, so no more can be refunded meanwhile (`SM-41`). */
  app.post('/stores/:storeId/refunds/:id/retry', inStore('Sale.Refund'), async (request) => {
    const { id } = Ref.parse(request.params);
    return payByProvider(pool, request, gateway, id, 'retry', options.lockTimeoutMs);
  });

  /**
   * A draft refund of a captured card payment that has no sale (D-18). The same refund machine follows: submitted by
   * `Sale.Refund`, approved by someone else under `Sale.Refund.Large.Approve`, paid under `Refund.Pay` at its own route. The
   * payment must be captured, of this store, with no sale; the database refuses anything else (`SS050`, `SS059`), and the
   * amount is checked here against what is left as it is drafted. The atomic bound is the hold, taken when it is paid.
   */
  async function draftPaymentRefund(request: FastifyRequest, reply: FastifyReply) {
    const body = NewPaymentRefund.parse(request.body);
    const principal = request.principal!;
    const existing = async () =>
      (await pool.query<{ id: string }>('SELECT id FROM refund WHERE store_id = $1 AND client_operation_id = $2', [request.storeId, body.clientOperationId])).rows[0];
    const before = await existing();
    if (before !== undefined) return reply.status(200).send(await readRefund(pool, before.id));
    try {
      const id = await withTransaction(pool, auditContext(request, { clientOperationId: body.clientOperationId }), async (c) => {
        const found = await c.query<{ amount: number; refunded: number; currency: string }>(
          'SELECT amount, refunded_amount AS refunded, currency_code AS currency FROM payment WHERE id = $1 AND store_id = $2',
          [body.paymentId, request.storeId],
        );
        const payment = found.rows[0];
        if (payment === undefined) throw new AppError(404, 'not_found', 'There is no such payment in this store.');
        const left = payment.amount - payment.refunded;
        if (body.amount > left) throw new AppError(409, 'SS058', 'That is more than is still left to give back to that payment.', { remaining: String(left) });
        const { rows } = await c.query<{ id: string }>(
          `INSERT INTO refund (store_id, organization_id, sale_id, customer_return_id, client_operation_id, method, payment_id, amount,
                               tax_amount, currency_code, reason_code_id, created_by, status_changed_by, correlation_id)
           VALUES ($1, $2, NULL, NULL, $3, 'OriginalTender', $4, $5, 0, $6, $7, $8, $8, $9) RETURNING id`,
          [request.storeId, principal.organizationId, body.clientOperationId, body.paymentId, body.amount, payment.currency, body.reasonCodeId, principal.employeeId, request.id],
        );
        return rows[0]!.id;
      });
      return reply.status(201).send(await readRefund(pool, id));
    } catch (error) {
      const raced = (error as { constraint?: string }).constraint === 'uq_refund_operation' ? await existing() : undefined;
      if (raced !== undefined) return reply.status(200).send(await readRefund(pool, raced.id));
      throw error;
    }
  }
}
