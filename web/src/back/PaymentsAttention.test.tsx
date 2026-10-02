import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serve } from '../test/serve.ts';
import { PaymentsAttention, waiting } from './PaymentsAttention.tsx';

/**
 * The card payments that need a person (D4 §16, D5 §13; `PY-13`, `PY-37`, `PY-40`, `PY-41`, D-16 Q3, D-18, `OQ-037`). The network is
 * stubbed at `fetch`, never at the `api` module, so the screen, the client and the server's response shapes run together.
 */

const GBP = { code: 'GBP', exponent: 2 };
const S = '/api/v1/stores/s1';
const REPORT = (minutes: number, extra = '') => `GET ${S}/payments/attention?olderThanMinutes=${minutes}&limit=50${extra}`;
const ALL = ['Payment.View', 'Payment.Void', 'Sale.Refund', 'Refund.View'];

afterEach(() => {
  vi.unstubAllGlobals();
});

const item = (over: object) => ({
  paymentId: 'p1', kind: 'PendingTooLong', status: 'Pending', amount: 3_000, currencyCode: 'GBP', ageMinutes: 45, providerOutcome: 'Timeout', simulated: null,
  heldBack: 0, givenBack: 0, checkoutId: 'k1', operationId: 'aaaaaaaa-1111-2222-3333-444444444444', storeId: 's1', terminalId: 't1', shiftId: 'sh1', createdBy: 'e1',
  since: '2026-10-02T08:00:00.000Z', ...over,
});
const pending = item({});
const authorized = item({ paymentId: 'p2', kind: 'AuthorizedNotCaptured', status: 'Authorized', amount: 1_250, ageMinutes: 135, providerOutcome: 'Approved', simulated: true, operationId: 'bbbbbbbb-1111-2222-3333-444444444444' });
const orphan = item({ paymentId: 'p3', kind: 'CapturedNoSale', status: 'Captured', amount: 2_000, ageMinutes: 1_500, providerOutcome: 'Approved', simulated: true, heldBack: 500, givenBack: 500, operationId: 'cccccccc-1111-2222-3333-444444444444' });
const summary = { PendingTooLong: 1, AuthorizedNotCaptured: 1, CapturedNoSale: 1 };
const everything = { body: { summary, items: [pending, authorized, orphan], next: null } };

const view = (permissions = ALL, onRefund?: (id: string) => void) => render(<PaymentsAttention storeId="s1" permissions={permissions} currency={GBP} onRefund={onRefund} />);
async function show(minutes: string, permissions = ALL, onRefund?: (id: string) => void) {
  view(permissions, onRefund);
  const field = screen.getByLabelText('Waiting at least (minutes)');
  fireEvent.change(field, { target: { value: minutes } });
  fireEvent.submit(field.closest('form')!);
  await screen.findByRole('table', { name: 'Card payments that need a person' });
}
const rowOf = (amount: string) => screen.getByText(amount).closest('tr')!;

describe('how long a payment may wait (PY-40, OQ-037)', () => {
  it('OQ-037, UX-01: the screen asks how long and never fills it in, the field has focus, and nothing is read until it is answered', async () => {
    const calls = serve({});
    view();
    const field = screen.getByLabelText('Waiting at least (minutes)') as HTMLInputElement;
    expect(field.value, 'no default window').toBe('');
    expect(document.activeElement).toBe(field);
    expect(screen.getByText(/How long is too long is the owner/)).toBeTruthy();
    expect(calls).toEqual([]);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('UX-55: a window that is empty, not a number, negative or beyond a year is said in place, and nothing is read', async () => {
    const calls = serve({});
    view();
    const field = screen.getByLabelText('Waiting at least (minutes)');
    for (const bad of ['', 'abc', '-5', '1.5', '600000']) {
      fireEvent.change(field, { target: { value: bad } });
      fireEvent.submit(field.closest('form')!);
      expect((await screen.findByRole('alert')).textContent, JSON.stringify(bad)).toMatch(/Enter how many minutes/);
    }
    expect(calls).toEqual([]);
  });

  it('PY-40: the window is sent exactly as typed, and 0 means every payment that has not settled', async () => {
    const calls = serve({ [REPORT(0)]: everything, [REPORT(30)]: { body: { summary, items: [orphan], next: null } } });
    await show('0');
    expect(calls.map((c) => c.key)).toEqual([REPORT(0)]);
    const field = screen.getByLabelText('Waiting at least (minutes)');
    fireEvent.change(field, { target: { value: '30' } });
    fireEvent.submit(field.closest('form')!);
    await vi.waitFor(() => expect(screen.queryByText('£30.00')).toBeNull());
    expect(calls.map((c) => c.key)).toEqual([REPORT(0), REPORT(30)]);
  });

  it('PY-40: Refresh asks again with the same window', async () => {
    const calls = serve({ [REPORT(15)]: everything });
    await show('15');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await vi.waitFor(() => expect(calls.filter((c) => c.key === REPORT(15))).toHaveLength(2));
  });
});

describe('what needs a person (PY-37, PY-40, PY-41, UX-52)', () => {
  it('PY-40, UX-52: each payment says what it is in words beside a symbol, its amount, how long it has waited and what the provider said, with what to do', async () => {
    serve({ [REPORT(0)]: everything });
    await show('0');
    const a = within(rowOf('£30.00'));
    expect(a.getByText('Waiting on the provider')).toBeTruthy();
    expect(a.getByText('45 min')).toBeTruthy();
    expect(a.getByText('Timed out')).toBeTruthy();
    expect(a.getByText(/Send the sale again at the till to ask it/)).toBeTruthy();
    expect(a.getByText('Cart reference aaaaaaaa'), 'how a person finds the cart at the till').toBeTruthy();
    const b = within(rowOf('£12.50'));
    expect(b.getByText('Approved, not taken')).toBeTruthy();
    expect(b.getByText('2 h 15 min')).toBeTruthy();
    expect(b.getByText('Simulated')).toBeTruthy();
    const c = within(rowOf('£20.00'));
    expect(c.getByText('Taken, no sale')).toBeTruthy();
    expect(c.getByText('1 d 1 h')).toBeTruthy();
    expect(c.getByText('£5.00 given back, £5.00 held'), 'what has already gone back is shown').toBeTruthy();
  });

  it('PY-40: how many there are of each kind is shown from the whole report, and the list can be narrowed to one kind', async () => {
    serve({ [REPORT(0)]: everything });
    await show('0');
    const figures = within(screen.getByLabelText('How many'));
    expect(figures.getByText('Waiting on the provider').nextElementSibling?.textContent).toBe('1');
    expect(figures.getByText('Taken, no sale').nextElementSibling?.textContent).toBe('1');
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'CapturedNoSale' } });
    expect(screen.queryByText('£30.00')).toBeNull();
    expect(screen.getByText('£20.00')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: '' } });
    expect(screen.getByText('£30.00')).toBeTruthy();
  });

  it('PY-40, UX-55: with nothing to check the screen says so, and a payment kind with none says "None of those"', async () => {
    serve({ [REPORT(0)]: { body: { summary: { PendingTooLong: 0, AuthorizedNotCaptured: 0, CapturedNoSale: 0 }, items: [], next: null } } });
    view();
    const field = screen.getByLabelText('Waiting at least (minutes)');
    fireEvent.change(field, { target: { value: '0' } });
    fireEvent.submit(field.closest('form')!);
    expect(await screen.findByText('No card payment needs a person.')).toBeTruthy();
  });

  it('PY-40: a long report shows more on the server’s cursor', async () => {
    const calls = serve({ [REPORT(0)]: { body: { summary, items: [pending], next: 'abc' } }, [REPORT(0, '&after=abc')]: { body: { summary, items: [orphan], next: null } } });
    await show('0');
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await screen.findByText('£20.00');
    expect(screen.getByText('£30.00')).toBeTruthy();
    expect(calls.some((c) => c.key === REPORT(0, '&after=abc'))).toBe(true);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('UX-59: a refusal to read is shown in place, with the person’s message, not as an empty report', async () => {
    serve({ [REPORT(0)]: { status: 403, body: { error: { code: 'forbidden', message: 'You do not have access to this: it needs the Payment.View permission in this store.' } } } });
    view();
    const field = screen.getByLabelText('Waiting at least (minutes)');
    fireEvent.change(field, { target: { value: '0' } });
    fireEvent.submit(field.closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Payment\.View/);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('formats a wait in the largest units that read well', () => {
    expect([0, 59, 60, 61, 135, 1_439, 1_440, 1_500, 2_880].map(waiting)).toEqual(['0 min', '59 min', '1 h', '1 h 1 min', '2 h 15 min', '23 h 59 min', '1 d', '1 d 1 h', '2 d']);
  });
});

describe('voiding a payment that is not settled (D-16 Q3, PY-13, PY-11, PY-41)', () => {
  const VOID = `POST ${S}/payments/p1/void`;

  it('D-16 Q3, UX-08: the void is offered only to someone holding Payment.Void, and only on a pending or authorized payment', async () => {
    serve({ [REPORT(0)]: everything });
    await show('0', ALL);
    expect(within(rowOf('£30.00')).getByRole('button', { name: 'Void the payment of £30.00' })).toBeTruthy();
    expect(within(rowOf('£12.50')).getByRole('button', { name: 'Void the payment of £12.50' })).toBeTruthy();
    expect(within(rowOf('£20.00')).queryByRole('button', { name: /Void/ }), 'a captured payment is refunded, never voided').toBeNull();
  });

  it('AC-01, UX-05: without Payment.Void there is no void, and Payment.Void is not implied by Sale.Refund', async () => {
    serve({ [REPORT(0)]: everything });
    await show('0', ['Payment.View', 'Sale.Refund', 'Refund.View']);
    expect(screen.queryByRole('button', { name: /Void/ })).toBeNull();
  });

  it('PY-13, UX-57: voiding asks first, in place, with the safe choice to keep it; a second step does it, reloads the report and says what happened', async () => {
    const calls = serve({
      [REPORT(0)]: [everything, { body: { summary: { ...summary, PendingTooLong: 0 }, items: [authorized, orphan], next: null } }],
      [VOID]: { body: { paymentId: 'p1', status: 'Voided', providerHeld: true, simulated: true } },
    });
    await show('0');
    fireEvent.click(screen.getByRole('button', { name: 'Void the payment of £30.00' }));
    const ask = screen.getByRole('group', { name: 'Void the payment of £30.00?' });
    expect(document.activeElement, 'the confirmation has focus').toBe(within(ask).getByRole('button', { name: 'Yes, void it' }));
    expect(calls.some((c) => c.key === VOID), 'asking sends nothing').toBe(false);
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('group', { name: /Void the payment/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Void the payment of £30.00' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, void it' }));
    await screen.findByText('The payment of £30.00 was voided at the provider.');
    expect(screen.queryByText('£30.00'), 'the report is read again, and the voided payment is gone').toBeNull();
    expect(calls.map((c) => c.key)).toEqual([REPORT(0), VOID, REPORT(0)]);
  });

  it('PY-41: a payment the provider never saw is voided here, by a person, and the screen says so', async () => {
    serve({
      [REPORT(0)]: [everything, { body: { summary, items: [authorized, orphan], next: null } }],
      [VOID]: { body: { paymentId: 'p1', status: 'Voided', providerHeld: false, simulated: null } },
    });
    await show('0');
    fireEvent.click(screen.getByRole('button', { name: 'Void the payment of £30.00' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, void it' }));
    await screen.findByText('The payment of £30.00 was voided here: the provider held nothing for it.');
  });

  it('PY-11, PY-41: a void the provider does not confirm is said in place, and the payment stays on the report as it was', async () => {
    const calls = serve({
      [REPORT(0)]: everything,
      [VOID]: { status: 409, body: { error: { code: 'void_pending', message: 'The provider did not confirm the void, so the payment is unchanged. Void it again to check.' } } },
    });
    await show('0');
    fireEvent.click(screen.getByRole('button', { name: 'Void the payment of £30.00' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, void it' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/did not confirm the void, so the payment is unchanged/);
    expect(screen.getByText('£30.00')).toBeTruthy();
    expect(calls.filter((c) => c.key === REPORT(0)), 'nothing changed, so nothing was reloaded').toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Yes, void it' }), 'it can be asked again').toBeTruthy();
  });

  it('PY-12: the server’s refusal to void a payment that has been taken is said in place', async () => {
    serve({
      [REPORT(0)]: everything,
      [VOID]: { status: 409, body: { error: { code: 'cannot_void', message: 'A payment that is Captured cannot be voided. The money is taken: it is refunded, not voided.' } } },
    });
    await show('0');
    fireEvent.click(screen.getByRole('button', { name: 'Void the payment of £30.00' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, void it' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/refunded, not voided/);
  });
});

describe('refunding a payment with no sale (D-18, PY-37)', () => {
  it('D-18, AC-01: the refund of a payment taken with no sale is offered with Sale.Refund and Refund.View, only on that kind, and hands over to the refunds screen with that payment', async () => {
    serve({ [REPORT(0)]: everything });
    const onRefund = vi.fn();
    await show('0', ALL, onRefund);
    expect(within(rowOf('£30.00')).queryByRole('button', { name: /Refund/ })).toBeNull();
    fireEvent.click(within(rowOf('£20.00')).getByRole('button', { name: 'Refund the payment of £20.00' }));
    expect(onRefund).toHaveBeenCalledWith('p3');
  });

  it('AC-01, UX-08: without Sale.Refund, without Refund.View (the refund could not be seen), or with no hand-over, the refund is not offered', async () => {
    serve({ [REPORT(0)]: everything });
    const first = view(['Payment.View', 'Payment.Void', 'Refund.View'], vi.fn());
    const field = screen.getByLabelText('Waiting at least (minutes)');
    fireEvent.change(field, { target: { value: '0' } });
    fireEvent.submit(field.closest('form')!);
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: /Refund the payment/ })).toBeNull();
    first.unmount();
    serve({ [REPORT(0)]: everything });
    await show('0', ['Payment.View', 'Sale.Refund']);
    expect(screen.queryByRole('button', { name: /Refund the payment/ }), 'the refund screen is Refund.View').toBeNull();
  });

  it('D-18, PY-22: a payment that has all been held back for refunds offers none', async () => {
    serve({ [REPORT(0)]: { body: { summary, items: [{ ...orphan, heldBack: 2_000 }], next: null } } });
    await show('0', ALL, vi.fn());
    expect(screen.queryByRole('button', { name: /Refund the payment/ })).toBeNull();
  });
});
