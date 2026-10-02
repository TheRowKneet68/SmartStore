import type { Queryable } from '../../db/pool.ts';

/**
 * The card payments that need a person (`PY-40`, `PY-37`, `PY-41`). The reconciliation job of the specification queries the
 * provider, compares settlement files, and "reports, never auto-adjusts"; escalating what has waited "more than a configured
 * window" to a person is this report. It changes nothing.
 *
 * | Kind | What it is | What a person does |
 * |---|---|---|
 * | `PendingTooLong` | The provider has not said yes or no (`PY-11`, `PY-41`) | Send the sale again to ask, or void it |
 * | `AuthorizedNotCaptured` | Funds reserved and never taken | Send the sale again to capture, or void it |
 * | `CapturedNoSale` | Money taken, and the checkout never became a sale (`PY-37`) | Send the sale again to finish it; otherwise the owner's decision (OQ-036 item 2) |
 *
 * Only a payment on an open checkout is listed: a declined, failed or voided one is over, and a captured one with a sale is
 * settled. How long is "too long" is a number the specification calls configured and does not give, so the caller supplies it
 * (OQ-037). It is measured from when the payment entered its present state.
 */
export type AttentionKind = 'PendingTooLong' | 'AuthorizedNotCaptured' | 'CapturedNoSale';

export interface AttentionItem {
  paymentId: string;
  kind: AttentionKind;
  status: string;
  amount: number;
  currencyCode: string;
  ageMinutes: number;
  /** What the provider last said. `Timeout` and `Pending` are the unsettled ones. */
  providerOutcome: string | null;
  /** True when the gateway that took it moves no money (ADR-31 §13 item 4). Null while the provider has given no reference. */
  simulated: boolean | null;
  checkoutId: string;
  /** The cart's operation id: sending the same sale again resumes the payment (`PY-39`). */
  operationId: string;
  storeId: string;
  terminalId: string;
  shiftId: string;
  createdBy: string;
  since: Date;
}

export interface Attention {
  summary: Record<AttentionKind, number>;
  items: AttentionItem[];
}

const NEEDS_A_PERSON = `
  p.method_type = 'Card' AND k.status = 'Open'
  AND now() - p.status_changed_at >= make_interval(mins => $2::int)
  AND ($1::uuid IS NULL OR p.store_id = $1)
  AND (p.status IN ('Pending', 'Authorized')
       OR (p.status = 'Captured' AND NOT EXISTS (SELECT 1 FROM sale s WHERE s.checkout_id = k.id)))`;

export async function paymentsNeedingAttention(
  db: Queryable,
  options: { storeId: string | null; olderThanMinutes: number; limit: number; offset: number },
): Promise<Attention> {
  const items = await db.query<AttentionItem>(
    `SELECT p.id AS "paymentId",
            CASE p.status WHEN 'Pending' THEN 'PendingTooLong' WHEN 'Authorized' THEN 'AuthorizedNotCaptured' ELSE 'CapturedNoSale' END AS kind,
            p.status, p.amount, p.currency_code AS "currencyCode",
            floor(extract(epoch FROM now() - p.status_changed_at) / 60)::int AS "ageMinutes",
            p.provider_outcome AS "providerOutcome",
            p.provider_transaction_reference LIKE 'SIM-%' AS simulated,
            k.id AS "checkoutId", k.client_operation_id AS "operationId", p.store_id AS "storeId",
            k.pos_terminal_id AS "terminalId", k.cash_shift_id AS "shiftId", p.created_by AS "createdBy",
            p.status_changed_at AS since
     FROM payment p JOIN checkout k ON k.id = p.checkout_id
     WHERE ${NEEDS_A_PERSON}
     ORDER BY p.status_changed_at, p.id LIMIT $3 OFFSET $4`,
    [options.storeId, options.olderThanMinutes, options.limit, options.offset],
  );
  const counts = await db.query<{ kind: AttentionKind; n: number }>(
    `SELECT CASE p.status WHEN 'Pending' THEN 'PendingTooLong' WHEN 'Authorized' THEN 'AuthorizedNotCaptured' ELSE 'CapturedNoSale' END AS kind,
            count(*)::int AS n
     FROM payment p JOIN checkout k ON k.id = p.checkout_id WHERE ${NEEDS_A_PERSON} GROUP BY 1`,
    [options.storeId, options.olderThanMinutes],
  );
  const summary: Attention['summary'] = { PendingTooLong: 0, AuthorizedNotCaptured: 0, CapturedNoSale: 0 };
  for (const row of counts.rows) summary[row.kind] = row.n;
  return { summary, items: items.rows };
}
