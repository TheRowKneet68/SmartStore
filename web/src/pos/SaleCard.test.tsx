import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serve } from '../test/serve.ts';
import { SaleScreen } from './Sale.tsx';

/**
 * Taking a card at the till, through the simulated gateway (D4 §15; `PY-16`, `PY-19`, `PY-36`, `PY-38`, `PY-39`, `PY-41`,
 * `PY-54`, `SP-43`, ADR-31 §13, D-16 Q2 and Q3). The network is stubbed at `fetch`, never at the `api` module, so the screen, the
 * client and the server's response shapes run together.
 */

const USD = { code: 'USD', exponent: 2 };
const S = '/api/v1/stores/s1';
const SCAN = `GET ${S}/scan/5012345678900`;
const SALES = `POST ${S}/sales`;
const ATTENTION = `GET ${S}/payments/attention?olderThanMinutes=0&limit=200`;
const ITEM = {
  variantId: 'v-1',
  description: 'Oat milk 1 L',
  barcode: '5012345678900',
  price: { amount: 250, currencyCode: 'USD', minorUnitExponent: 2 },
  quote: 'q-1',
};
const SALE = {
  saleId: 'sale-1',
  documentNumber: 1042,
  currencyCode: 'USD',
  totalDue: 250,
  tendered: 250,
  change: 0,
  payments: [{ paymentId: 'p1', methodType: 'Card', amount: 250, simulated: true }],
};
const refusal = (status: number, code: string, message: string, extra: object = {}) => ({ status, body: { error: { code, message, ...extra } } });

const CARD = ['Payment.Capture'];
afterEach(() => {
  vi.unstubAllGlobals();
});

async function scanned(permissions: string[], routes: Record<string, Parameters<typeof serve>[0][string]> = {}) {
  const calls = serve({ [SCAN]: { body: ITEM }, ...routes });
  render(<SaleScreen storeId="s1" currency={USD} permissions={permissions} />);
  const field = screen.getByLabelText('Scan or type a barcode, then Enter') as HTMLInputElement;
  fireEvent.change(field, { target: { value: '5012345678900' } });
  fireEvent.submit(field.closest('form')!);
  await screen.findByText('Oat milk 1 L');
  return calls;
}
const how = (words: string) => fireEvent.click(screen.getByLabelText(words));
const token = () => screen.getByLabelText('Test card token') as HTMLInputElement;
const form = () => screen.getByRole('form', { name: 'Payment' });
const bodies = (calls: { key: string; body: unknown }[]) => calls.filter((c) => c.key === SALES).map((c) => c.body as Record<string, unknown>);

describe('who may take a card, and the warning that the gateway is simulated (D-16 Q2, ADR-31 s13, UX-52)', () => {
  it('D-16 Q2: without Payment.Capture the till takes cash exactly as before, and offers no way to pay by card', async () => {
    await scanned([]);
    expect(screen.queryByText('How is it paid?')).toBeNull();
    expect(screen.queryByLabelText('Test card token')).toBeNull();
    expect(screen.getByLabelText(/Cash given/)).toBeTruthy();
  });

  it('D-16 Q2: with Payment.Capture the till offers cash, card, and card and cash, cash first, and no warning until a card is chosen', async () => {
    await scanned(CARD);
    const choices = within(screen.getByRole('group', { name: 'How is it paid?' }));
    expect(choices.getAllByRole('radio').map((r) => (r as HTMLInputElement).labels?.[0]?.textContent)).toEqual(['Cash', 'Card', 'Card and cash']);
    expect((choices.getByLabelText('Cash') as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('ADR-31 s13, UX-52: choosing a card says in words that the gateway is simulated, and the card token field has focus', async () => {
    await scanned(CARD);
    how('Card');
    const note = screen.getByRole('note');
    expect(note.textContent).toMatch(/SIMULATED card gateway/);
    expect(note.textContent).toMatch(/No real card is read and no money moves/);
    await waitFor(() => expect(document.activeElement).toBe(token()));
    expect(screen.queryByLabelText(/Cash given/), 'a card sale takes no cash').toBeNull();
  });

  it('UX-01: Enter on an empty scan field moves to the first field of the way of paying, the token for a card', async () => {
    await scanned(CARD);
    how('Card');
    (document.getElementById('code') as HTMLInputElement).focus();
    fireEvent.submit(document.getElementById('code')!.closest('form')!);
    expect(document.activeElement).toBe(token());
  });
});

describe('a sale paid by card (PY-38, PY-43)', () => {
  it('PY-38, PY-43, BI-30: the card sale sends the token and no amount, no cash, and nothing the client computed; the outcome says it was a simulated card', async () => {
    const calls = await scanned(CARD, { [SALES]: { status: 201, body: SALE } });
    how('Card');
    fireEvent.change(token(), { target: { value: ' TEST-APPROVE ' } });
    expect(screen.getByRole('button', { name: 'Charge the card and complete the sale' })).toBeTruthy();
    fireEvent.submit(form());
    await screen.findByRole('heading', { name: 'Sale 1042 completed' });
    expect(bodies(calls)[0]).toEqual({ clientOperationId: expect.stringMatching(/^[0-9a-f-]{36}$/), lines: [{ quote: 'q-1', quantity: 1 }], card: { token: 'TEST-APPROVE' } });
    const paid = within(screen.getByRole('list', { name: 'Paid with' }));
    expect(paid.getByText('Card $2.50 (simulated)')).toBeTruthy();
    expect(screen.getByRole('note').textContent, 'the outcome says it again').toMatch(/SIMULATED card gateway/);
    expect(screen.getByText('Change $0.00')).toBeTruthy();
  });

  it('UX-55: a card sale with no token is refused in place and sends nothing', async () => {
    const calls = await scanned(CARD, { [SALES]: { status: 201, body: SALE } });
    how('Card');
    fireEvent.submit(form());
    expect((await screen.findByRole('alert')).textContent).toBe('Type the card token first.');
    expect(bodies(calls)).toEqual([]);
  });

  it('UX-52, PY-19: the payment so far shows the card for all of it and no change', async () => {
    await scanned(CARD);
    how('Card');
    const so_far = within(screen.getByLabelText('Payment so far'));
    expect(so_far.getByText('On the card').nextElementSibling?.textContent).toBe('$2.50');
    expect(so_far.queryByText('Change'), 'a card cannot be handed back').toBeNull();
  });
});

describe('card and cash together (PY-16, PY-19, PY-20)', () => {
  const SPLIT_SALE = { ...SALE, totalDue: 250, tendered: 350, change: 100, payments: [SALE.payments[0]!, { paymentId: 'p2', methodType: 'Cash', amount: 150, simulated: false }] };

  it('PY-16: the card amount, the cash given, what the card leaves and the change are shown as they are typed, and sent as the server takes them', async () => {
    const calls = await scanned(CARD, { [SALES]: { status: 201, body: SPLIT_SALE } });
    how('Card and cash');
    fireEvent.change(screen.getByLabelText('Amount on the card (USD)'), { target: { value: '1.00' } });
    fireEvent.change(token(), { target: { value: 'TEST-APPROVE' } });
    const so_far = within(screen.getByLabelText('Payment so far'));
    expect(so_far.getByText('On the card').nextElementSibling?.textContent).toBe('$1.00');
    expect(so_far.getByText('Cash given').nextElementSibling?.textContent, 'empty means what the card leaves').toBe('$1.50');
    fireEvent.change(screen.getByLabelText(/Cash given/), { target: { value: '2.50' } });
    expect(screen.getByTestId('change-due').textContent).toBe('$1.00');
    fireEvent.submit(form());
    await screen.findByRole('heading', { name: 'Sale 1042 completed' });
    expect(bodies(calls)[0]).toMatchObject({ card: { token: 'TEST-APPROVE', amount: 100 }, cash: { tendered: 250 } });
    const paid = within(screen.getByRole('list', { name: 'Paid with' }));
    expect(paid.getByText('Card $2.50 (simulated)')).toBeTruthy();
    expect(paid.getByText('Cash $1.50')).toBeTruthy();
  });

  it('PY-19, SP-40: a card for the whole total, an amount that is not money, and cash that is short are each refused in place before the card is touched', async () => {
    const calls = await scanned(CARD, { [SALES]: { status: 201, body: SPLIT_SALE } });
    how('Card and cash');
    fireEvent.change(token(), { target: { value: 'TEST-APPROVE' } });
    const amount = screen.getByLabelText('Amount on the card (USD)');
    fireEvent.change(amount, { target: { value: 'abc' } });
    fireEvent.submit(form());
    expect((await screen.findByRole('alert')).textContent).toMatch(/Enter how much goes on the card/);
    fireEvent.change(amount, { target: { value: '2.50' } });
    fireEvent.submit(form());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/already covers the total/));
    fireEvent.change(amount, { target: { value: '1.00' } });
    fireEvent.change(screen.getByLabelText(/Cash given/), { target: { value: '1.00' } });
    fireEvent.submit(form());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The cash given is $0.50 short of what the card leaves. Take more cash.'));
    expect(screen.getByTestId('still-to-pay').textContent).toBe('$0.50');
    expect(bodies(calls)).toEqual([]);
  });
});

describe('when the card does not go through (PY-14, PY-54, SP-43, PY-11, PY-41, PY-39)', () => {
  async function attempt(replies: Parameters<typeof serve>[0][string], permissions = CARD) {
    const calls = await scanned(permissions, { [SALES]: replies });
    how('Card');
    fireEvent.change(token(), { target: { value: 'TEST-X' } });
    fireEvent.submit(form());
    return calls;
  }

  it('PY-14, PY-54, SP-43: a decline is said in place, the cart is kept, and the next attempt is a new payment on a new operation', async () => {
    const calls = await attempt([refusal(409, 'card_declined', 'The card was declined. Try another card or another way to pay. The cart is kept.'), { status: 201, body: { ...SALE, payments: [{ paymentId: 'p2', methodType: 'Cash', amount: 250, simulated: false }] } }]);
    expect((await screen.findByRole('alert')).textContent).toMatch(/The card was declined/);
    expect(screen.getByText('Oat milk 1 L'), 'the cart is kept').toBeTruthy();
    expect((screen.getByLabelText('Test card token') as HTMLInputElement).disabled, 'not locked: another card may be tried').toBe(false);
    how('Cash');
    fireEvent.submit(form());
    await screen.findByRole('heading', { name: 'Sale 1042 completed' });
    const [first, second] = bodies(calls);
    expect(second!.clientOperationId, 'a retry after a decline is a new payment').not.toBe(first!.clientOperationId);
    expect(second).toMatchObject({ cash: { tendered: 250 } });
  });

  it('PY-10, PY-54: a technical failure ends that attempt the same way, and the cart is kept', async () => {
    const calls = await attempt([refusal(409, 'card_failed', 'The card could not be charged because of a technical failure. Nothing was taken. The cart is kept.'), { status: 201, body: SALE }]);
    expect((await screen.findByRole('alert')).textContent).toMatch(/technical failure. Nothing was taken/);
    fireEvent.submit(form());
    await screen.findByRole('heading', { name: 'Sale 1042 completed' });
    expect(bodies(calls)[1]!.clientOperationId).not.toBe(bodies(calls)[0]!.clientOperationId);
  });

  it('PY-11, PY-41, PY-39: a timeout fixes the cart and the tender, says not to charge again, and sends the same sale again with the same operation', async () => {
    const calls = await attempt([refusal(409, 'card_pending', 'The card payment is not confirmed yet. Do not charge the card again: send this same sale again to check it.'), { status: 201, body: SALE }]);
    expect((await screen.findAllByRole('alert'))[0]!.textContent).toMatch(/Do not charge the card again/);
    expect(screen.getByRole('note', { name: 'Card payment waiting' }).textContent).toMatch(/A card payment is waiting/);
    // Fixed: nothing may change under a payment in flight.
    expect((document.getElementById('code') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Quantity of Oat milk 1 L') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Remove Oat milk 1 L' }) as HTMLButtonElement).disabled).toBe(true);
    expect((token() as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole('group', { name: 'How is it paid?' }).hasAttribute('disabled'), 'the way of paying is fixed').toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Check the card payment and finish the sale' }));
    await screen.findByRole('heading', { name: 'Sale 1042 completed' });
    const [first, second] = bodies(calls);
    expect(second, 'the same sale, the same operation, the same token').toEqual(first);
  });

  it('PY-13, PY-38: a capture that did not go through is the same state: the authorization stands and the same sale is sent again', async () => {
    const calls = await attempt([refusal(409, 'card_capture_failed', 'The card was approved but the money could not be taken yet. Send this same sale again to try again. The cart is kept.'), { status: 201, body: SALE }]);
    await screen.findAllByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Check the card payment and finish the sale' }));
    await screen.findByRole('heading', { name: 'Sale 1042 completed' });
    expect(bodies(calls)[1]).toEqual(bodies(calls)[0]);
  });

  it('PY-37, PY-38: money taken and the sale not saved says so, keeps the same operation, and offers to send the sale again; a manager can give the money back', async () => {
    const calls = await attempt([
      refusal(409, 'SS011', 'There is not enough stock for this, and this store does not go below zero. The card payment was taken and is kept: send this same sale again once that is fixed, and the card will not be charged twice.', { cardCaptured: true }),
      { status: 201, body: SALE },
    ]);
    expect((await screen.findAllByRole('alert'))[0]!.textContent).toMatch(/card payment was taken and is kept/);
    expect(screen.getByRole('note', { name: 'Card payment waiting' }).textContent).toMatch(/the card will not be charged twice/);
    expect(screen.getByRole('note', { name: 'Card payment waiting' }).textContent).toMatch(/a manager can give the money back/);
    expect(screen.queryByRole('button', { name: 'Void the card payment' }), 'a captured payment is refunded, never voided').toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Send the sale again' }));
    await screen.findByRole('heading', { name: 'Sale 1042 completed' });
    expect(bodies(calls)[1]!.clientOperationId).toBe(bodies(calls)[0]!.clientOperationId);
  });

  it('PY-37, D-18: a payment that is being refunded cannot be sent again, and the cart is kept for a new payment', async () => {
    const calls = await attempt([refusal(409, 'SS059', 'A payment is refunded without its sale only while it has none, and a sale cannot be made from a payment that is being refunded.'), { status: 201, body: SALE }]);
    expect((await screen.findByRole('alert')).textContent).toMatch(/cannot be made from a payment that is being refunded/);
    expect((token() as HTMLInputElement).disabled).toBe(false);
    fireEvent.submit(form());
    await screen.findByRole('heading', { name: 'Sale 1042 completed' });
    expect(bodies(calls)[1]!.clientOperationId).not.toBe(bodies(calls)[0]!.clientOperationId);
  });

  it('D-16 Q2, PY-04: a store that does not take cards says so in place, and nothing is fixed', async () => {
    await attempt(refusal(409, 'card_not_accepted', 'This store does not take cards.'));
    expect((await screen.findByRole('alert')).textContent).toBe('This store does not take cards.');
    expect((token() as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByRole('note', { name: /waiting/ })).toBeNull();
  });

  it('UX-59, PY-39: a server failure is shown as the system’s, keeps the cart, and a retry is the same operation', async () => {
    const calls = await attempt([refusal(500, 'internal', 'Something went wrong on the server. Nothing was saved; try again.'), { status: 201, body: SALE }]);
    const alert = await screen.findByRole('alert');
    expect(alert.getAttribute('data-kind')).toBe('system');
    expect(alert.textContent).toMatch(/till is still working/);
    fireEvent.submit(form());
    await screen.findByRole('heading', { name: 'Sale 1042 completed' });
    expect(bodies(calls)[1]!.clientOperationId, 'unknown outcome: the same sale, never a second charge').toBe(bodies(calls)[0]!.clientOperationId);
  });
});

describe('voiding a card payment that is not settled (D-16 Q3, PY-13, PY-40)', () => {
  const PENDING = refusal(409, 'card_pending', 'The card payment is not confirmed yet. Do not charge the card again: send this same sale again to check it.');
  async function pending(permissions: string[], extra: Record<string, Parameters<typeof serve>[0][string]> = {}) {
    const calls = await scanned(permissions, { [SALES]: PENDING, ...extra });
    how('Card');
    fireEvent.change(token(), { target: { value: 'TEST-TIMEOUT' } });
    fireEvent.submit(form());
    await screen.findAllByRole('alert');
    return calls;
  }

  it('AC-01, UX-08: the void is offered only to someone holding Payment.Void and Payment.View, and others are told who can', async () => {
    await pending(CARD);
    expect(screen.queryByRole('button', { name: 'Void the card payment' })).toBeNull();
    expect(screen.getByRole('note', { name: 'Card payment waiting' }).textContent).toMatch(/Someone who may void a payment can cancel it/);
  });

  it('PY-13, PY-54: voiding finds this cart’s payment on the report, voids it, keeps the cart, and the next payment is a new one on a new operation', async () => {
    const calls = await pending([...CARD, 'Payment.Void', 'Payment.View'], {
      [ATTENTION]: { body: { summary: {}, items: [{ paymentId: 'other', operationId: 'not-ours' }], next: null } },
    });
    const first = bodies(calls)[0]!;
    // The report names the payment by the cart's operation id.
    vi.unstubAllGlobals();
    const again = serve({
      [ATTENTION]: { body: { summary: {}, items: [{ paymentId: 'other', operationId: 'not-ours' }, { paymentId: 'mine', operationId: first.clientOperationId }], next: null } },
      [`POST ${S}/payments/mine/void`]: { body: { paymentId: 'mine', status: 'Voided', providerHeld: true, simulated: true } },
      [SALES]: { status: 201, body: SALE },
    });
    expect(screen.getByRole('note', { name: 'Card payment waiting' }).textContent).toMatch(/Or void the card payment/);
    fireEvent.click(screen.getByRole('button', { name: 'Void the card payment' }));
    await screen.findByText('The card payment was voided. The cart is kept: take payment again.');
    expect(again.map((c) => c.key)).toEqual([ATTENTION, `POST ${S}/payments/mine/void`]);
    expect(screen.getByText('Oat milk 1 L'), 'the cart is kept').toBeTruthy();
    expect((token() as HTMLInputElement).disabled, 'unlocked for another payment').toBe(false);
    fireEvent.submit(form());
    await screen.findByRole('heading', { name: 'Sale 1042 completed' });
    expect(bodies(again)[0]!.clientOperationId, 'a new payment, on a new operation').not.toBe(first.clientOperationId);
  });

  it('PY-40, UX-55: a payment that is not on the report is said in place, and nothing is voided', async () => {
    await pending([...CARD, 'Payment.Void', 'Payment.View'], { [ATTENTION]: { body: { summary: {}, items: [], next: null } } });
    fireEvent.click(screen.getByRole('button', { name: 'Void the card payment' }));
    expect((await screen.findAllByRole('alert'))[0]!.textContent).toMatch(/not waiting for a person/);
    expect((token() as HTMLInputElement).disabled, 'still fixed: it was not voided').toBe(true);
  });

  it('PY-11, PY-41: a void the provider does not confirm is said in place and the payment stays as it was', async () => {
    const calls = await pending([...CARD, 'Payment.Void', 'Payment.View']);
    const first = bodies(calls)[0]!;
    vi.unstubAllGlobals();
    serve({
      [ATTENTION]: { body: { summary: {}, items: [{ paymentId: 'mine', operationId: first.clientOperationId }], next: null } },
      [`POST ${S}/payments/mine/void`]: refusal(409, 'void_pending', 'The provider did not confirm the void, so the payment is unchanged. Void it again to check.'),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Void the card payment' }));
    expect((await screen.findAllByRole('alert'))[0]!.textContent).toMatch(/did not confirm the void/);
    expect((token() as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Void the card payment' }), 'it can be tried again').toBeTruthy();
  });
});
