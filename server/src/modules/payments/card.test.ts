import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testApp } from '../../../test/app.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { insertSettings } from '../../../test/fixtures.ts';
import { shopKit, type Json, type Shop } from '../../../test/shop.ts';
import type { GatewayResult } from './gateway.ts';
import { SimulatedGateway } from './simulated-gateway.ts';

/** The simulated gateway, counting what the server asks of it, so a test can prove a card was charged once. */
class Spy extends SimulatedGateway {
  calls: string[] = [];
  override authorize(r: Parameters<SimulatedGateway['authorize']>[0]): Promise<GatewayResult> {
    this.calls.push('authorize');
    return super.authorize(r);
  }
  override capture(r: Parameters<SimulatedGateway['capture']>[0]): Promise<GatewayResult> {
    this.calls.push('capture');
    return super.capture(r);
  }
  override refund(r: Parameters<SimulatedGateway['refund']>[0]): Promise<GatewayResult> {
    this.calls.push('refund');
    return super.refund(r);
  }
  override query(r: Parameters<SimulatedGateway['query']>[0]): Promise<GatewayResult> {
    this.calls.push('query');
    return super.query(r);
  }
}

let db: TestDb;
let app: FastifyInstance;
let kit: ReturnType<typeof shopKit>;
const gateway = new Spy();

beforeAll(async () => {
  db = await createTestDb();
  app = await testApp(db, { gateway });
  kit = shopKit(db, app);
});

afterAll(async () => {
  await app.close();
  await db.drop();
});

beforeEach(() => {
  gateway.calls = [];
});

const call: ReturnType<typeof shopKit>['call'] = (...args) => kit.call(...args);
const shop = () => kit.shop();

const payments = async (storeId: string, operation: string): Promise<Json[]> =>
  (
    await db.app.query(
      `SELECT p.id, p.status, p.method_type, p.amount::int AS amount, p.tendered_amount, p.sequence_number, p.provider_outcome,
              p.provider_raw_code, p.provider_transaction_reference AS reference, k.status AS checkout
       FROM payment p JOIN checkout k ON k.id = p.checkout_id WHERE k.store_id = $1 AND k.client_operation_id = $2
       ORDER BY p.sequence_number`,
      [storeId, operation],
    )
  ).rows;
const salesWith = async (operation: string): Promise<number> =>
  (await db.app.query<{ n: number }>('SELECT count(*)::int AS n FROM sale WHERE client_operation_id = $1', [operation])).rows[0]!.n;

/** A sale of two Oat milk and one Bread (3,000), paid with `body`, under a given operation id. */
async function pay(s: Shop, body: Json, operation = randomUUID(), as = s.clerk) {
  const response = await call('POST', `${s.store}/sales`, as, {
    clientOperationId: operation,
    lines: [
      { quote: await s.quote('012345678905'), quantity: 2 },
      { quote: await s.quote('4006381333931'), quantity: 1 },
    ],
    ...body,
  });
  return { response, operation };
}

describe('a sale paid by card, through the simulated gateway (PY-07, PY-36..PY-39, PY-54, ADR-31 s13)', () => {
  it('PY-38, PY-43, SP-02, RT-119: authorize, capture, then commit; the sale carries the card payment, stock moves, and the token is kept nowhere', async () => {
    const s = await shop();
    const { response, operation } = await pay(s, { card: { token: 'TEST-APPROVE' } });
    expect(response.statusCode, response.body).toBe(201);
    const sale = response.json();
    expect(sale).toMatchObject({ totalDue: 3_000, tendered: 3_000, change: 0, status: 'Completed' });
    expect(sale.payments).toMatchObject([{ methodType: 'Card', amount: 3_000, simulated: true }]);
    expect(gateway.calls).toEqual(['authorize', 'capture']);

    const [payment] = await payments(s.storeId, operation);
    expect(payment).toMatchObject({ status: 'Captured', method_type: 'Card', amount: 3_000, tendered_amount: null, sequence_number: 1, provider_outcome: 'Approved', checkout: 'Completed' });
    expect(payment!.reference).toMatch(/^SIM-/);
    // PY-43, PY-44: the token stands for the card and is stored nowhere: not on the payment, not in the audit trail.
    const everywhere = await db.app.query(
      `SELECT (SELECT count(*)::int FROM audit_event WHERE before::text LIKE '%TEST-APPROVE%' OR after::text LIKE '%TEST-APPROVE%') AS audit,
              (SELECT to_jsonb(p)::text LIKE '%TEST-APPROVE%' FROM payment p WHERE p.id = $1) AS payment`,
      [payment!.id],
    );
    expect(everywhere.rows[0]).toEqual({ audit: 0, payment: false });
    const moved = await db.app.query(`SELECT count(*)::int AS n FROM inventory_movement WHERE sale_id = $1 AND movement_type = 'SALE'`, [sale.saleId]);
    expect(moved.rows[0].n).toBe(2);
    const events = await db.app.query(`SELECT event_type FROM audit_event WHERE entity_id = $1`, [payment!.id]);
    expect(events.rows.map((r: Json) => r.event_type)).toContain('Payment.Capture');
  });

  it('SM-04, BI-28, PY-39: the same operation id again returns the one sale and asks the provider nothing', async () => {
    const s = await shop();
    const { response, operation } = await pay(s, { card: { token: 'TEST-APPROVE' } });
    gateway.calls = [];
    const again = await pay(s, { card: { token: 'TEST-APPROVE' } }, operation);
    expect(again.response.statusCode).toBe(200);
    expect(again.response.json().saleId).toBe(response.json().saleId);
    expect(gateway.calls).toEqual([]);
    expect(await payments(s.storeId, operation)).toHaveLength(1);
  });

  it('PY-16, PY-19, PY-20, SP-39: card and cash settle one sale; the card is the first payment, only cash gives change', async () => {
    const s = await shop();
    const { response, operation } = await pay(s, { card: { token: 'TEST-APPROVE', amount: 1_000 }, cash: { tendered: 2_500 } });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({ totalDue: 3_000, tendered: 3_500, change: 500 });
    const rows = await payments(s.storeId, operation);
    expect(rows.map((r) => [r.sequence_number, r.method_type, r.status, r.amount, r.tendered_amount])).toEqual([
      [1, 'Card', 'Captured', 1_000, null],
      [2, 'Cash', 'Captured', 2_000, '2500'],
    ]);
    const change = await db.app.query(`SELECT amount::int AS amount FROM cash_transaction WHERE sale_id = $1 AND type = 'ChangeDisbursed'`, [response.json().saleId]);
    expect(change.rows).toEqual([{ amount: 500 }]);
  });

  it('SP-40, PY-17, PY-19, UX-17: a tender that does not add up is refused before the card is touched', async () => {
    const s = await shop();
    const refused = async (body: Json, code: string) => {
      const { response, operation } = await pay(s, body);
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error.code).toBe(code);
      expect(await payments(s.storeId, operation), 'nothing was started').toHaveLength(0);
    };
    await refused({ card: { token: 'TEST-APPROVE', amount: 1_000 }, cash: { tendered: 1_500 } }, 'underpaid');
    await refused({ card: { token: 'TEST-APPROVE', amount: 1_000 } }, 'underpaid');
    await refused({ card: { token: 'TEST-APPROVE', amount: 3_001 } }, 'card_overpaid');
    await refused({ card: { token: 'TEST-APPROVE' }, cash: { tendered: 3_000 } }, 'card_amount_needed');
    await refused({ card: { token: 'TEST-APPROVE', amount: 3_000 }, cash: { tendered: 1 } }, 'card_covers_total');
    expect(gateway.calls).toEqual([]);
    expect((await pay(s, {})).response.statusCode, 'neither tender').toBe(400);
  });

  it('PY-04, SS045: a store that does not take cards refuses one by name', async () => {
    const s = await shop();
    const methods = (await call('GET', '/payment-methods', s.owner)).json().items as Json[];
    const cardMethod = methods.find((m) => m.methodType === 'Card')!.id as string;
    expect((await call('PUT', `${s.store}/payment-methods/${cardMethod}`, s.owner, { enabled: false })).statusCode).toBe(200);
    const { response } = await pay(s, { card: { token: 'TEST-APPROVE' } });
    expect(response.json().error.code).toBe('card_not_accepted');
    expect(gateway.calls).toEqual([]);
  });

  it('D-16 Q2, AC-01: capturing needs Payment.Capture, checked before the provider is asked for anything', async () => {
    const s = await shop();
    const noCapture = await s.staff(['Sale.Create', 'Sale.View', 'Shift.Open'], s.till);
    const { response, operation } = await pay(s, { card: { token: 'TEST-APPROVE' } }, randomUUID(), noCapture);
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toMatch(/Payment\.Capture/);
    expect(gateway.calls).toEqual([]);
    expect(await payments(s.storeId, operation)).toHaveLength(0);
  });

  it('PY-14, PY-42, PY-54, SP-43: a decline is recorded, ends that checkout, and is never reopened; a retry is a new payment on a new operation', async () => {
    const s = await shop();
    const { response, operation } = await pay(s, { card: { token: 'TEST-DECLINE' } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('card_declined');
    const [declined] = await payments(s.storeId, operation);
    expect(declined).toMatchObject({ status: 'Declined', provider_outcome: 'Declined', provider_raw_code: 'SIM_DECLINED', checkout: 'Abandoned' });
    expect(await salesWith(operation)).toBe(0);
    const moved = await db.app.query(`SELECT count(*)::int AS n FROM inventory_movement WHERE sale_id IS NOT NULL AND store_id = $1`, [s.storeId]);
    expect(moved.rows[0].n, 'only the first sale moved stock').toBe(2);

    gateway.calls = [];
    const replay = await pay(s, { card: { token: 'TEST-APPROVE' } }, operation);
    expect(replay.response.json().error.code, 'the same operation is not charged again').toBe('card_declined');
    expect(gateway.calls).toEqual([]);
    const retry = await pay(s, { card: { token: 'TEST-APPROVE' } });
    expect(retry.response.statusCode).toBe(201);
    expect(await payments(s.storeId, retry.operation)).toHaveLength(1);
  });

  it('PY-10: a technical failure is a Failed payment, terminal, and is not a decline', async () => {
    const s = await shop();
    const { response, operation } = await pay(s, { card: { token: 'TEST-FAIL' } });
    expect(response.json().error.code).toBe('card_failed');
    expect(await payments(s.storeId, operation)).toMatchObject([{ status: 'Failed', provider_raw_code: 'SIM_FAILED', checkout: 'Abandoned' }]);
  });

  it('PY-43, PY-44: a real card number in the token is declined, never used, and appears nowhere', async () => {
    const s = await shop();
    const { response, operation } = await pay(s, { card: { token: '4111111111111111' } });
    expect(response.json().error.code).toBe('card_declined');
    const [row] = await payments(s.storeId, operation);
    expect(row).toMatchObject({ status: 'Declined', provider_raw_code: 'SIM_ONLY_TEST_TOKENS' });
    expect(response.body).not.toContain('4111111111111111');
    const leaked = await db.app.query(`SELECT count(*)::int AS n FROM audit_event WHERE before::text LIKE '%4111111111111111%' OR after::text LIKE '%4111111111111111%'`);
    expect(leaked.rows[0].n).toBe(0);
  });

  it('PY-11, PY-13, PY-41: a timeout leaves the payment Pending; the same request asks the provider what it holds and does not charge twice', async () => {
    const s = await shop();
    const first = await pay(s, { card: { token: 'TEST-TIMEOUT' } });
    expect(first.response.json().error.code).toBe('card_pending');
    expect(await payments(s.storeId, first.operation)).toMatchObject([{ status: 'Pending', provider_outcome: 'Timeout' }]);
    expect(await salesWith(first.operation)).toBe(0);

    gateway.calls = [];
    const again = await pay(s, { card: { token: 'TEST-TIMEOUT' } }, first.operation);
    expect(again.response.statusCode, again.response.body).toBe(201);
    expect(gateway.calls, 'it asked, it did not authorize again').toEqual(['query', 'capture']);
    expect(await payments(s.storeId, first.operation)).toMatchObject([{ status: 'Captured' }]);
  });

  it('PY-41: a payment the provider does not know is never failed for the silence; it stays Pending and no sale is made', async () => {
    const s = await shop();
    const first = await pay(s, { card: { token: 'TEST-TIMEOUT-LOST' } });
    expect(first.response.json().error.code).toBe('card_pending');
    for (let i = 0; i < 2; i++) {
      const again = await pay(s, { card: { token: 'TEST-TIMEOUT-LOST' } }, first.operation);
      expect(again.response.json().error.code).toBe('card_pending');
    }
    expect(await payments(s.storeId, first.operation)).toMatchObject([{ status: 'Pending', provider_outcome: 'Pending', checkout: 'Open' }]);
    expect(await salesWith(first.operation)).toBe(0);
  });

  it('PY-38, PY-13: a capture that fails leaves the authorization standing, and the same request tries the capture again; nothing is voided for it', async () => {
    const s = await shop();
    const first = await pay(s, { card: { token: 'TEST-CAPTURE-FAIL' } });
    expect(first.response.json().error.code).toBe('card_capture_failed');
    expect(await payments(s.storeId, first.operation)).toMatchObject([{ status: 'Authorized', checkout: 'Open' }]);
    gateway.calls = [];
    const again = await pay(s, { card: { token: 'TEST-CAPTURE-FAIL' } }, first.operation);
    expect(again.response.json().error.code).toBe('card_capture_failed');
    expect(gateway.calls, 'it did not authorize a second time').toEqual(['capture']);
  });

  it('PY-11, architecture s13.3: a capture that times out is asked again under the same reference and is taken once', async () => {
    const s = await shop();
    const first = await pay(s, { card: { token: 'TEST-CAPTURE-TIMEOUT' } });
    expect(first.response.json().error.code).toBe('card_pending');
    expect(await payments(s.storeId, first.operation)).toMatchObject([{ status: 'Authorized', provider_outcome: 'Timeout' }]);
    const again = await pay(s, { card: { token: 'TEST-CAPTURE-TIMEOUT' } }, first.operation);
    expect(again.response.statusCode, again.response.body).toBe(201);
    expect(await payments(s.storeId, first.operation)).toMatchObject([{ status: 'Captured' }]);
  });

  it('PY-37, PY-38, PY-39, PY-40: money taken and the sale not saved is kept on its open checkout, the answer says so, and the same request completes it without a second charge', async () => {
    const s = await shop();
    await insertSettings(db.app, s.storeId, 'BlockNegative');
    const first = await pay(s, { card: { token: 'TEST-APPROVE' } });
    expect(first.response.statusCode).toBe(409);
    expect(first.response.json().error).toMatchObject({ code: 'SS011', cardCaptured: true });
    expect(first.response.json().error.message).toMatch(/card payment was taken/);
    expect(await payments(s.storeId, first.operation)).toMatchObject([{ status: 'Captured', checkout: 'Open' }]);
    expect(await salesWith(first.operation)).toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await insertSettings(db.app, s.storeId, 'AllowNegative');
    gateway.calls = [];
    const again = await pay(s, { card: { token: 'TEST-APPROVE' } }, first.operation);
    expect(again.response.statusCode, again.response.body).toBe(201);
    expect(gateway.calls, 'the card was not charged again').toEqual([]);
    expect(await payments(s.storeId, first.operation)).toMatchObject([{ status: 'Captured', checkout: 'Completed' }]);
  });

  it('PY-37, PY-40: if the cart no longer adds up to what was charged, the sale is not saved and the charge stands for a person', async () => {
    const s = await shop();
    await insertSettings(db.app, s.storeId, 'BlockNegative');
    const first = await pay(s, { card: { token: 'TEST-APPROVE' } });
    expect(first.response.json().error.code).toBe('SS011');
    await insertSettings(db.app, s.storeId, 'AllowNegative');
    // The same operation, but a different cart: one Bread.
    const other = await call('POST', `${s.store}/sales`, s.clerk, {
      clientOperationId: first.operation,
      lines: [{ quote: await s.quote('4006381333931'), quantity: 1 }],
      card: { token: 'TEST-APPROVE' },
    });
    expect(other.statusCode).toBe(409);
    expect(other.json().error).toMatchObject({ code: 'total_changed', cardCaptured: true, charged: 3_000, totalDue: 500 });
    expect(await salesWith(first.operation)).toBe(0);
  });

  it('SM-04, BI-28: two identical card sales at once make one sale and one payment', async () => {
    const s = await shop();
    const operation = randomUUID();
    const lines = [{ quote: await s.quote('4006381333931'), quantity: 1 }];
    const send = () => call('POST', `${s.store}/sales`, s.clerk, { clientOperationId: operation, lines, card: { token: 'TEST-APPROVE' } });
    const results = await Promise.all([send(), send()]);
    expect(results.map((r) => r.statusCode).sort(), results.map((r) => r.body).join('\n')).toEqual([200, 201]);
    expect(await salesWith(operation)).toBe(1);
    expect(await payments(s.storeId, operation)).toHaveLength(1);
  });
});

describe("resuming a card sale that two requests resume at once (PY-39, SM-04)", () => {
  it("PY-11, PY-39: two resends of a payment left Authorized capture it once and make one sale", async () => {
    const s = await shop();
    const first = await pay(s, { card: { token: "TEST-CAPTURE-TIMEOUT" } });
    expect(first.response.json().error.code).toBe("card_pending");
    const send = () => pay(s, { card: { token: "TEST-CAPTURE-TIMEOUT" } }, first.operation);
    const results = await Promise.all([send(), send()]);
    const codes = results.map((r) => r.response.statusCode).sort();
    expect(codes, results.map((r) => r.response.body).join(' | ')).toEqual([200, 201]);
    expect(await salesWith(first.operation)).toBe(1);
    expect(await payments(s.storeId, first.operation)).toMatchObject([{ status: "Captured", checkout: "Completed" }]);
  });
});

/** A card sale of three things, paid by `token`, then its Bread line refunded (500) to the card, approved and ready to pay. */
async function approvedCardRefund(s: Shop, token: string) {
  const sold = await pay(s, { card: { token } });
  expect(sold.response.statusCode, sold.response.body).toBe(201);
  const sale = sold.response.json();
  const bread = sale.lines.find((l: Json) => l.description === 'Bread') as Json;
  // Drafted at the back office: a card refund needs no till (RR-22), and Sale.Refund is held there.
  const drafted = await call('POST', `${s.store}/refunds`, s.manager, {
    clientOperationId: randomUUID(),
    saleId: sale.saleId,
    method: 'OriginalTender',
    paymentId: sale.payments[0].paymentId,
    reasonCodeId: s.reason,
    lines: [{ saleLineId: bread.saleLineId, amount: 500 }],
  });
  expect(drafted.statusCode, drafted.body).toBe(201);
  expect(drafted.json()).toMatchObject({ disbursement: 'Provider', amount: 500 });
  const id = drafted.json().id as string;
  expect((await s.go(s.manager, 'Refund', 'submit', id)).json().state).toBe('PendingApproval');
  expect((await s.go(s.manager2, 'Refund', 'approve', id)).json().state).toBe('Approved');
  return { id, bread, sale };
}
const refundedOf = async (lineId: string): Promise<number> =>
  Number((await db.app.query<{ n: string }>('SELECT refunded_amount AS n FROM sale_line WHERE id = $1', [lineId])).rows[0]!.n);

describe('a refund to a card, through the simulated gateway (PY-25, RR-23, RR-24, SM-40, SM-41)', () => {
  it('PY-25, RR-23, PY-36: the provider is asked to refund the captured payment, outside the transaction; the refund completes and the line holds it', async () => {
    const s = await shop();
    const { id, bread } = await approvedCardRefund(s, 'TEST-APPROVE');
    gateway.calls = [];
    const paid = await call('POST', `${s.store}/refunds/${id}/pay`, s.clerk);
    expect(paid.statusCode, paid.body).toBe(200);
    expect(paid.json()).toMatchObject({ status: 'Completed', disbursement: 'Provider', simulated: true, providerOutcome: 'Approved' });
    expect(gateway.calls).toEqual(['refund']);
    expect(await refundedOf(bread.saleLineId)).toBe(500);
    const drawer = await db.app.query(`SELECT count(*)::int AS n FROM cash_transaction WHERE refund_id = $1`, [id]);
    expect(drawer.rows[0].n, 'a card refund never touches the drawer').toBe(0);
    const row = await db.app.query(`SELECT provider_transaction_reference AS ref FROM refund WHERE id = $1`, [id]);
    expect(row.rows[0].ref).toMatch(/^SIM-RF-/);
    // Paying it again returns it unchanged and asks nothing (SM-04).
    gateway.calls = [];
    const again = await call('POST', `${s.store}/refunds/${id}/pay`, s.clerk);
    expect(again.statusCode).toBe(200);
    expect(gateway.calls).toEqual([]);
    const events = await db.app.query(`SELECT event_type FROM audit_event WHERE entity_id = $1`, [id]);
    expect(events.rows.map((r: Json) => r.event_type)).toContain('Payment.Refund');
  });

  it('PY-36, D-16: a card refund is paid only at its own route, under Refund.Pay; the transition endpoint refuses it', async () => {
    const s = await shop();
    const { id, bread } = await approvedCardRefund(s, 'TEST-APPROVE');
    const viaTransition = await s.go(s.clerk, 'Refund', 'submit to provider', id);
    expect(viaTransition.json().error.code).toBe('use_pay_route');
    const issuer = await s.staff(['Sale.Refund']);
    const denied = await call('POST', `${s.store}/refunds/${id}/pay`, issuer);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.message).toMatch(/Refund\.Pay/);
    expect((await call('POST', `${s.store}/refunds/${id}/retry`, s.manager2)).statusCode, 'retry is Sale.Refund').toBe(403);
    expect(await refundedOf(bread.saleLineId)).toBe(0);
    expect(gateway.calls.filter((c) => c === 'refund')).toEqual([]);
    // Another store's refund, and a drawer refund, are not paid here.
    const other = await shop();
    expect((await call('POST', `${other.store}/refunds/${id}/pay`, other.clerk)).statusCode).toBe(404);
  });

  it('PY-25, SM-41, RR-24: a refund the provider declines fails, keeps its hold, and can only be retried', async () => {
    const s = await shop();
    const { id, bread } = await approvedCardRefund(s, 'TEST-REFUND-DECLINE');
    const failed = await call('POST', `${s.store}/refunds/${id}/pay`, s.clerk);
    expect(failed.statusCode).toBe(409);
    expect(failed.json().error).toMatchObject({ code: 'refund_failed', state: 'Failed' });
    expect((await db.app.query(`SELECT status, provider_raw_code FROM refund WHERE id = $1`, [id])).rows[0]).toEqual({ status: 'Failed', provider_raw_code: 'SIM_REFUND_DECLINED' });
    expect(await refundedOf(bread.saleLineId), 'the money stays held through the failure').toBe(500);
    // Held, so the same money cannot be refunded twice meanwhile (RR-24).
    const second = await call('POST', `${s.store}/refunds`, s.manager, {
      clientOperationId: randomUUID(), saleId: (await db.app.query<{ sale_id: string }>(`SELECT sale_id FROM refund WHERE id = $1`, [id])).rows[0]!.sale_id,
      method: 'Cash', reasonCodeId: s.reason, lines: [{ saleLineId: bread.saleLineId, amount: 1 }],
    });
    expect(second.json().error.code, 'a cash refund needs a till').toBe('not_at_a_till');
    // Retried under Sale.Refund, it asks the provider again, and this one still declines.
    gateway.calls = [];
    const retried = await call('POST', `${s.store}/refunds/${id}/retry`, s.manager);
    expect(retried.json().error.code).toBe('refund_failed');
    expect(gateway.calls).toEqual(['refund']);
    expect(await refundedOf(bread.saleLineId)).toBe(500);
    // A retry is only of a failed refund; a paid-and-approved one is paid, not retried.
    const fresh = await approvedCardRefund(s, 'TEST-APPROVE');
    const wrong = await call('POST', `${s.store}/refunds/${fresh.id}/retry`, s.manager);
    expect(wrong.json().error.code).toBe('illegal_transition');
  });

  it('PY-11, PY-41, SM-41: a refund whose answer times out stays Processing, is resolved by asking the provider, and is refunded once; until then it can be cancelled with a reason', async () => {
    const s = await shop();
    const { id, bread } = await approvedCardRefund(s, 'TEST-REFUND-TIMEOUT');
    const first = await call('POST', `${s.store}/refunds/${id}/pay`, s.clerk);
    expect(first.json().error).toMatchObject({ code: 'refund_pending', state: 'Processing' });
    expect(await refundedOf(bread.saleLineId)).toBe(500);
    gateway.calls = [];
    const again = await call('POST', `${s.store}/refunds/${id}/pay`, s.clerk);
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json().status).toBe('Completed');
    expect(gateway.calls, 'it asked the provider and did not refund twice').toEqual(['query']);

    // A second card refund of its own that is left pending can be cancelled, which releases the hold (SM-40).
    const pending = await approvedCardRefund(s, 'TEST-REFUND-TIMEOUT');
    await call('POST', `${s.store}/refunds/${pending.id}/pay`, s.clerk);
    expect((await s.go(s.manager, 'Refund', 'cancel', pending.id)).json().error.code, 'a reason is required').toBe('SS055');
    expect((await s.go(s.manager, 'Refund', 'cancel', pending.id, { reasonCodeId: s.reason })).json().state).toBe('Cancelled');
    expect(await refundedOf(pending.bread.saleLineId)).toBe(0);
  });

  it('RR-22, PY-25: a cash tender is refunded from the drawer, and a card refund is not', async () => {
    const s = await shop();
    const cashRefund = await call('POST', `${s.store}/refunds`, s.clerk, {
      clientOperationId: randomUUID(), saleId: s.sale.saleId, method: 'OriginalTender', paymentId: s.sale.payments[0].paymentId, reasonCodeId: s.reason,
      lines: [{ saleLineId: s.bread.saleLineId, amount: 500 }],
    });
    expect(cashRefund.json().disbursement).toBe('Drawer');
    expect((await call('POST', `${s.store}/refunds/${cashRefund.json().id}/pay`, s.clerk)).json().error.code).toBe('not_a_card_refund');
  });
});

describe('who may do what with the gateway (PY-08, PY-45)', () => {
  it('PY-08: nothing outside the gateway files and main.ts names the simulated implementation', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = join(import.meta.dirname, '..', '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name.endsWith('.ts')) files.push(path);
      }
    };
    walk(root);
    const offenders = files
      .filter((f) => !/\.test\.ts$/.test(f) && !f.endsWith('simulated-gateway.ts') && !f.endsWith('main.ts'))
      .filter((f) => /simulated-gateway/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
    expect(files.length).toBeGreaterThan(20);
  });

  it('ADR-31 s13: the gateway says it is simulated, and a reference it issues is marked', async () => {
    const sim = new SimulatedGateway();
    expect(sim.simulated).toBe(true);
    const id = randomUUID();
    const first = await sim.authorize({ merchantReference: id, token: 'TEST-APPROVE', amount: 100, currencyCode: 'XTS' });
    expect(first.providerReference).toMatch(/^SIM-/);
    // Asking again under the same reference is the same answer, not a second charge.
    expect(await sim.authorize({ merchantReference: id, token: 'TEST-APPROVE', amount: 100, currencyCode: 'XTS' })).toEqual(first);
    expect((await sim.authorize({ merchantReference: randomUUID(), token: 'TEST-NOPE', amount: 1, currencyCode: 'XTS' })).rawCode).toBe('SIM_UNKNOWN_TEST_TOKEN');
  });
});

const voidIt = (s: Shop, paymentId: string, as: Record<string, string>) => call('POST', `${s.store}/payments/${paymentId}/void`, as, {});
const paymentIdOf = async (s: Shop, operation: string): Promise<string> => (await payments(s.storeId, operation))[0]!.id as string;

describe('voiding a card payment that is not settled (PY-13, PY-36, PY-54, D-16 Q3)', () => {
  it('PY-11, PY-13: a payment left Pending that the provider holds is voided at the provider, abandons its cart, and the same sale cannot go on', async () => {
    const s = await shop();
    const first = await pay(s, { card: { token: 'TEST-TIMEOUT' } });
    expect(first.response.json().error.code).toBe('card_pending');
    const id = await paymentIdOf(s, first.operation);
    const voider = await s.staff(['Payment.Void']);
    gateway.calls = [];
    const voided = await voidIt(s, id, voider);
    expect(voided.statusCode, voided.body).toBe(200);
    expect(voided.json()).toEqual({ paymentId: id, status: 'Voided', providerHeld: true, simulated: true });
    expect(gateway.calls, 'it asked what the provider held, then voided it').toEqual(['query']);
    expect(await payments(s.storeId, first.operation)).toMatchObject([{ status: 'Voided', checkout: 'Abandoned', provider_raw_code: 'SIM_VOIDED' }]);
    const again = await pay(s, { card: { token: 'TEST-TIMEOUT' } }, first.operation);
    expect(again.response.json().error.code).toBe('card_voided');
    expect(await salesWith(first.operation)).toBe(0);
    const events = await db.app.query(`SELECT event_type FROM audit_event WHERE entity_id = $1`, [id]);
    expect(events.rows.map((r: Json) => r.event_type)).toContain('Payment.StateChange');
  });

  it('PY-41, PY-13: a payment the provider never saw is voided here, by a person, and the answer says the provider held nothing', async () => {
    const s = await shop();
    const first = await pay(s, { card: { token: 'TEST-TIMEOUT-LOST' } });
    const id = await paymentIdOf(s, first.operation);
    const voided = await voidIt(s, id, await s.staff(['Payment.Void']));
    expect(voided.json()).toMatchObject({ status: 'Voided', providerHeld: false });
    expect(await payments(s.storeId, first.operation)).toMatchObject([{ status: 'Voided', provider_raw_code: 'NOT_HELD_BY_PROVIDER', checkout: 'Abandoned' }]);
  });

  it('PY-13: an authorization never captured is voided at the provider, and voiding it again changes and asks nothing', async () => {
    const s = await shop();
    const first = await pay(s, { card: { token: 'TEST-CAPTURE-FAIL' } });
    const id = await paymentIdOf(s, first.operation);
    expect(await payments(s.storeId, first.operation)).toMatchObject([{ status: 'Authorized' }]);
    const voider = await s.staff(['Payment.Void']);
    gateway.calls = [];
    expect((await voidIt(s, id, voider)).json()).toMatchObject({ status: 'Voided', providerHeld: true });
    expect(await payments(s.storeId, first.operation)).toMatchObject([{ status: 'Voided', checkout: 'Abandoned' }]);
    gateway.calls = [];
    const repeat = await voidIt(s, id, voider);
    expect(repeat.statusCode).toBe(200);
    expect(gateway.calls).toEqual([]);
  });

  it('PY-11, PY-41: a void the provider does not confirm leaves the payment as it was; one it did carry out is found, and done once', async () => {
    const s = await shop();
    const voider = await s.staff(['Payment.Void']);
    const refusing = await pay(s, { card: { token: 'TEST-VOID-FAIL' } });
    expect(refusing.response.json().error.code).toBe('card_capture_failed');
    const id = await paymentIdOf(s, refusing.operation);
    const failed = await voidIt(s, id, voider);
    expect(failed.statusCode).toBe(409);
    expect(failed.json().error.code).toBe('void_failed');
    expect(await payments(s.storeId, refusing.operation), 'unchanged, and the cart still open').toMatchObject([{ status: 'Authorized', checkout: 'Open' }]);

    const lost = await pay(s, { card: { token: 'TEST-VOID-TIMEOUT' } });
    const lostId = await paymentIdOf(s, lost.operation);
    const first = await voidIt(s, lostId, voider);
    expect(first.json().error.code).toBe('void_pending');
    expect(await payments(s.storeId, lost.operation)).toMatchObject([{ status: 'Authorized' }]);
    const again = await voidIt(s, lostId, voider);
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json().status).toBe('Voided');
    expect(await payments(s.storeId, lost.operation)).toMatchObject([{ status: 'Voided', checkout: 'Abandoned' }]);
  });

  it('PY-12, PY-13, PY-54: a captured, declined or cash payment is not voided; a void needs Payment.Void, in the store', async () => {
    const s = await shop();
    const voider = await s.staff(['Payment.Void']);
    const settled = await pay(s, { card: { token: 'TEST-APPROVE' } });
    const captured = await paymentIdOf(s, settled.operation);
    const refused = await voidIt(s, captured, voider);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('cannot_void');
    expect(refused.json().error.message).toMatch(/refunded, not voided/);
    const declined = await pay(s, { card: { token: 'TEST-DECLINE' } });
    expect((await voidIt(s, await paymentIdOf(s, declined.operation), voider)).json().error.code).toBe('cannot_void');
    const cashPayment = s.sale.payments[0].paymentId as string;
    expect((await voidIt(s, cashPayment, voider)).json().error.code).toBe('not_a_card_payment');

    const stuck = await pay(s, { card: { token: 'TEST-TIMEOUT' } });
    const id = await paymentIdOf(s, stuck.operation);
    expect((await voidIt(s, id, s.clerk)).statusCode, 'Payment.Capture does not void').toBe(403);
    const viewer = await s.staff(['Payment.View']);
    expect((await voidIt(s, id, viewer)).statusCode, 'Payment.View does not void').toBe(403);
    const other = await shop();
    expect((await voidIt(other, id, await other.staff(['Payment.Void']))).statusCode, "another store's payment").toBe(404);
    expect(await payments(s.storeId, stuck.operation)).toMatchObject([{ status: 'Pending' }]);
  });
});

describe('the card payments that need a person (PY-37, PY-40, PY-41)', () => {
  const attention = (s: Shop, query: string, as: Record<string, string>) => call('GET', `${s.store}/payments/attention?${query}`, as);

  it('PY-40: pending, authorized-and-never-captured, and captured-with-no-sale are listed, with what a person needs; settled and over ones are not', async () => {
    const s = await shop();
    const viewer = await s.staff(['Payment.View']);
    const pending = await pay(s, { card: { token: 'TEST-TIMEOUT' } });
    const authorized = await pay(s, { card: { token: 'TEST-CAPTURE-FAIL' } });
    await insertSettings(db.app, s.storeId, 'BlockNegative');
    const orphan = await pay(s, { card: { token: 'TEST-APPROVE' } });
    expect(orphan.response.json().error.code).toBe('SS011');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await insertSettings(db.app, s.storeId, 'AllowNegative');
    // Over or settled: a sale, a decline, a failure, a void.
    await pay(s, { card: { token: 'TEST-APPROVE' } });
    await pay(s, { card: { token: 'TEST-DECLINE' } });
    await pay(s, { card: { token: 'TEST-FAIL' } });
    const voided = await pay(s, { card: { token: 'TEST-TIMEOUT' } });
    await voidIt(s, await paymentIdOf(s, voided.operation), await s.staff(['Payment.Void']));

    const found = await attention(s, 'olderThanMinutes=0', viewer);
    expect(found.statusCode, found.body).toBe(200);
    expect(found.json().summary).toEqual({ PendingTooLong: 1, AuthorizedNotCaptured: 1, CapturedNoSale: 1 });
    const byKind = Object.fromEntries(found.json().items.map((i: Json) => [i.kind, i]));
    expect(byKind.PendingTooLong).toMatchObject({ paymentId: await paymentIdOf(s, pending.operation), status: 'Pending', amount: 3_000, currencyCode: 'XTS', providerOutcome: 'Timeout', simulated: null, operationId: pending.operation, storeId: s.storeId });
    expect(byKind.AuthorizedNotCaptured).toMatchObject({ status: 'Authorized', operationId: authorized.operation, simulated: true });
    expect(byKind.CapturedNoSale).toMatchObject({ status: 'Captured', operationId: orphan.operation, simulated: true });
    expect(JSON.stringify(found.json())).not.toMatch(/TEST-/);
  });

  it('PY-40: how long is too long is the caller’s, measured from when the payment entered its state', async () => {
    const s = await shop();
    const viewer = await s.staff(['Payment.View']);
    const first = await pay(s, { card: { token: 'TEST-TIMEOUT' } });
    expect((await attention(s, 'olderThanMinutes=60', viewer)).json().items).toEqual([]);
    await db.owner.query(`UPDATE payment SET status_changed_at = now() - interval '90 minutes' WHERE id = $1`, [await paymentIdOf(s, first.operation)]);
    const old = await attention(s, 'olderThanMinutes=60', viewer);
    expect(old.json().items).toMatchObject([{ kind: 'PendingTooLong', ageMinutes: 90 }]);
    expect((await attention(s, 'olderThanMinutes=120', viewer)).json().items).toEqual([]);
    expect((await attention(s, '', viewer)).statusCode, 'the window is required, never defaulted').toBe(400);
    expect((await attention(s, 'olderThanMinutes=-1', viewer)).statusCode).toBe(400);
  });

  it('PY-40, MS-02, AC-01: it is read under Payment.View, in the store, a page at a time, and changes nothing', async () => {
    const s = await shop();
    const viewer = await s.staff(['Payment.View']);
    for (let i = 0; i < 3; i++) await pay(s, { card: { token: 'TEST-TIMEOUT' } });
    const before = await db.app.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'Pending')::int AS pending FROM payment WHERE store_id = $1`, [s.storeId]);
    const page = await attention(s, 'olderThanMinutes=0&limit=2', viewer);
    expect(page.json().items).toHaveLength(2);
    expect(page.json().summary.PendingTooLong, 'the summary counts all, not the page').toBe(3);
    expect(page.json().next).not.toBeNull();
    const rest = await attention(s, `olderThanMinutes=0&limit=2&after=${page.json().next}`, viewer);
    expect(rest.json().items).toHaveLength(1);
    expect(rest.json().next).toBeNull();
    const ids = [...page.json().items, ...rest.json().items].map((i: Json) => i.paymentId);
    expect(new Set(ids).size).toBe(3);
    expect((await attention(s, 'olderThanMinutes=0', s.clerk)).statusCode, 'Sale.Create does not read payments').toBe(403);
    expect((await attention(s, 'olderThanMinutes=0', await s.staff(['Payment.Void']))).statusCode, 'Payment.Void does not read').toBe(403);
    const other = await shop();
    expect((await attention(other, 'olderThanMinutes=0', await other.staff(['Payment.View']))).json().summary, "another store's payments are not here").toEqual({ PendingTooLong: 0, AuthorizedNotCaptured: 0, CapturedNoSale: 0 });
    const after = await db.app.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'Pending')::int AS pending FROM payment WHERE store_id = $1`, [s.storeId]);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});

describe('npm run payments:check (PY-40)', () => {
  it('PY-40: lists what needs a person and exits non-zero, says so when nothing does, and will not guess a window', async () => {
    const { spawnSync } = await import('node:child_process');
    const { join } = await import('node:path');
    const url = new URL(db.appUrl);
    url.searchParams.delete('options');
    const run = (...args: string[]) =>
      spawnSync(process.execPath, ['src/cli/payments-check.ts', ...args], {
        cwd: join(import.meta.dirname, '..', '..', '..'),
        env: { ...process.env, DATABASE_URL: url.toString() },
        encoding: 'utf8',
      });
    const s = await shop();
    const stuck = await pay(s, { card: { token: 'TEST-TIMEOUT' } });
    const found = run('--older-than', '0', '--store', s.storeId);
    expect(found.status, found.stderr).toBe(1);
    expect(found.stdout).toContain(`PendingTooLong: payment ${await paymentIdOf(s, stuck.operation)}`);
    expect(found.stdout).toContain('Nothing was changed.');
    const none = run('--older-than', '100000', '--store', s.storeId);
    expect(none.status).toBe(0);
    expect(none.stdout).toContain('No card payment needs a person.');
    expect(run().status, 'no window given').not.toBe(0);
    expect(run().stderr).toContain('Say how long a payment may wait');
  });
});
