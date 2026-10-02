import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import { withTransaction } from '../../db/pool.ts';
import { AppError } from '../../http/errors.ts';
import { auditContext } from '../../http/gate.ts';
import type { GatewayResult, PaymentGateway } from './gateway.ts';

/**
 * A card tender of a sale, driven through the provider one step at a time (`PY-36`, `PY-38`, architecture §13.2):
 *
 *   `Pending` (committed) → provider authorizes → `Authorized` (committed) → provider captures → `Captured` (committed)
 *
 * The provider is called between transactions, never inside one (`CON-05`). Each result is recorded in a transaction of
 * its own, so a crash between a call and its record leaves a `Pending` or `Authorized` payment that the same request
 * resumes, and the provider's merchant reference (the payment's id) makes the repeated call the same call and not a second
 * charge (§13.3).
 *
 * A step is recorded only if the payment is still where the step left it, so two requests resuming one payment cannot
 * both record it. What the payment's state may be is the database's (`PY-12`, `PY-54`, `D-14`): `Declined`, `Failed`,
 * `Voided` and `Captured` have no edge out.
 */
export interface CardPayment {
  id: string;
  checkoutId: string;
  status: string;
  amount: number;
  currencyCode: string;
  providerReference: string | null;
  /** What the provider last said, `Timeout` or `Pending` meaning it has not been settled (`PY-11`). */
  providerOutcome: string | null;
}

export type CardResult = { kind: 'captured' } | { kind: 'refused'; error: AppError };

export const PAYMENT_COLUMNS = `p.id, p.checkout_id AS "checkoutId", p.status, p.amount, p.currency_code AS "currencyCode",
  p.provider_transaction_reference AS "providerReference", p.provider_outcome AS "providerOutcome"`;

const refusals = {
  declined: () => new AppError(409, 'card_declined', 'The card was declined. Try another card or another way to pay. The cart is kept.'),
  failed: () => new AppError(409, 'card_failed', 'The card could not be charged because of a technical failure. Nothing was taken. The cart is kept.'),
  pending: () =>
    new AppError(
      409,
      'card_pending',
      'The card payment is not confirmed yet. Do not charge the card again: send this same sale again to check it.',
    ),
  captureFailed: () =>
    new AppError(
      409,
      'card_capture_failed',
      'The card was approved but the money could not be taken yet. Send this same sale again to try again. The cart is kept.',
    ),
};

/** Records a step. It changes the payment only while it is still in `from`; otherwise another request already did. */
async function record(
  pool: pg.Pool,
  request: FastifyRequest,
  payment: CardPayment,
  from: string,
  to: string | null,
  result: GatewayResult,
  options: { abandonCheckout?: boolean } = {},
): Promise<void> {
  await withTransaction(pool, auditContext(request), async (c) => {
    const now = await c.query<{ status: string }>('SELECT status FROM payment WHERE id = $1 FOR UPDATE', [payment.id]);
    if (now.rows[0]?.status !== from) return;
    // `provider_transaction_reference` is the provider's: kept once given, never blanked by a later answer without one.
    // A step that does not move the payment leaves its status out of the statement: naming it asks for an edge that is not there.
    await c.query(
      `UPDATE payment SET status = coalesce($2, status), status_changed_by = $3, provider_outcome = $4, provider_raw_code = $5,
                          provider_transaction_reference = coalesce($6, provider_transaction_reference)
       WHERE id = $1`,
      [payment.id, to, request.principal!.employeeId, result.outcome, result.rawCode, result.providerReference],
    );
    if (options.abandonCheckout === true) await c.query(`UPDATE checkout SET status = 'Abandoned' WHERE id = $1 AND status = 'Open'`, [payment.checkoutId]);
  });
}

async function reload(pool: pg.Pool, paymentId: string): Promise<CardPayment> {
  const { rows } = await pool.query<CardPayment>(`SELECT ${PAYMENT_COLUMNS} FROM payment p WHERE p.id = $1`, [paymentId]);
  return rows[0]!;
}

/**
 * Takes a card payment as far as the provider will take it now. `captured` means the money is taken and the sale may
 * commit (`PY-37`). Anything else is a refusal to answer with: the cart survives (`SP-43`), and what happened is on the
 * payment's record (`PY-42`). Capturing is `Payment.Capture` (D-16), checked here before the provider is asked.
 */
export async function advanceCardPayment(
  pool: pg.Pool,
  request: FastifyRequest,
  gateway: PaymentGateway,
  start: CardPayment,
  token: string,
): Promise<CardResult> {
  let payment = start;
  for (let step = 0; step < 4; step++) {
    switch (payment.status) {
      case 'Captured':
        return { kind: 'captured' };
      case 'Declined':
        return { kind: 'refused', error: refusals.declined() };
      case 'Failed':
      case 'Voided':
        return { kind: 'refused', error: refusals.failed() };
      case 'Pending': {
        // A first attempt asks the provider. A payment the provider has already answered with a timeout (or never
        // settled) is asked what it holds instead, and is never failed for the silence (`PY-11`, `PY-41`).
        const settled = payment.providerOutcome === 'Timeout' || payment.providerOutcome === 'Pending';
        const result = settled
          ? await gateway.query({ merchantReference: payment.id })
          : await gateway.authorize({ merchantReference: payment.id, token, amount: payment.amount, currencyCode: payment.currencyCode });
        if (result.outcome === 'Approved') {
          await record(pool, request, payment, 'Pending', 'Authorized', result);
        } else if (result.outcome === 'Declined') {
          await record(pool, request, payment, 'Pending', 'Declined', result, { abandonCheckout: true });
        } else if (result.outcome === 'Failed' && !settled) {
          await record(pool, request, payment, 'Pending', 'Failed', result, { abandonCheckout: true });
        } else {
          // Timeout, Pending, Errored, or a provider that does not know the payment yet: it stays Pending.
          await record(pool, request, payment, 'Pending', null, settled && result.outcome === 'Failed' ? { ...result, outcome: 'Pending' } : result);
          return { kind: 'refused', error: refusals.pending() };
        }
        break;
      }
      case 'Authorized': {
        const result = await gateway.capture({
          merchantReference: payment.id,
          providerReference: payment.providerReference!,
          amount: payment.amount,
          currencyCode: payment.currencyCode,
        });
        if (result.outcome === 'Approved') {
          await record(pool, request, payment, 'Authorized', 'Captured', result);
        } else {
          // The authorization stands and the same request tries again. Nothing is voided automatically (`PY-13`).
          await record(pool, request, payment, 'Authorized', null, result);
          return { kind: 'refused', error: result.outcome === 'Timeout' || result.outcome === 'Errored' ? refusals.pending() : refusals.captureFailed() };
        }
        break;
      }
      default:
        return { kind: 'refused', error: refusals.failed() };
    }
    payment = await reload(pool, payment.id);
  }
  return { kind: 'refused', error: refusals.pending() };
}
