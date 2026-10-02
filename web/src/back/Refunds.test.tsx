import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serve } from '../test/serve.ts';
import { Refunds } from './Refunds.tsx';

/**
 * The refunds screen (D5 §10 to §14; `RR-01`, `RR-03`, `RR-22`, `RR-35`, `PY-22`, `PY-25`, `PY-27`, `SM-40`, `SM-41`, D-17, D-18, D-19).
 * The network is stubbed at `fetch`, never at the `api` module, so the screen, the client and the server's response shapes run
 * together.
 */

const GBP = { code: 'GBP', exponent: 2 };
const S = '/api/v1/stores/s1';
const LIST = `GET ${S}/refunds?limit=50`;
const DETAIL = `GET ${S}/refunds/f1`;
const SALE = `GET ${S}/sales/sa1`;
const REASONS = 'GET /api/v1/reason-codes';
const TRANSITIONS = 'POST /api/v1/transitions';

const ALL = ['Refund.View', 'Sale.Refund', 'Sale.Refund.Large.Approve', 'Refund.Pay', 'Sale.View', 'Return.View', 'Payment.View'];

afterEach(() => {
  vi.unstubAllGlobals();
});

const row = (over: object = {}) => ({
  id: 'f1',
  documentNumber: 3,
  saleDocumentNumber: 42,
  returnId: null,
  paymentId: 'pc',
  status: 'Draft',
  method: 'OriginalTender',
  disbursement: 'Drawer',
  amount: 1_250,
  currencyCode: 'GBP',
  simulated: false,
  createdAt: '2026-10-02T08:00:00.000Z',
  ...over,
});
const doc = (over: object = {}) => ({
  id: 'f1',
  documentNumber: 3,
  saleId: 'sa1',
  returnId: null,
  paymentId: 'pc',
  status: 'Draft',
  method: 'OriginalTender',
  disbursement: 'Drawer',
  amount: 1_250,
  taxAmount: 114,
  currencyCode: 'GBP',
  providerOutcome: null,
  simulated: false,
  lines: [{ id: 'fl1', saleLineId: 'l1', amount: 1_250, taxAmount: 114 }],
  ...over,
});
const sale = {
  saleId: 'sa1',
  documentNumber: 42,
  status: 'Completed',
  payments: [
    { paymentId: 'pc', methodType: 'Cash', amount: 3_000, simulated: false },
    { paymentId: 'pk', methodType: 'Card', amount: 3_000, simulated: true },
  ],
  lines: [
    { saleLineId: 'l1', lineNumber: 1, description: 'Oat milk', quantity: '2.0000', returnedQuantity: '1.0000', settledAmount: 2_500, refundedAmount: 500 },
    { saleLineId: 'l2', lineNumber: 2, description: 'Bread', quantity: '1.0000', returnedQuantity: '0.0000', settledAmount: 500, refundedAmount: 500 },
  ],
};
const reasons = { items: [{ id: 'why1', code: 'WHY', name: 'Goodwill' }] };
const detailRoutes = (d: object = doc()) => ({ [DETAIL]: { body: d }, [SALE]: { body: sale }, [REASONS]: { body: reasons } });

const view = (permissions = ALL, atTill = false) => render(<Refunds storeId="s1" permissions={permissions} currency={GBP} atTill={atTill} />);
async function openFirst(permissions = ALL, atTill = false) {
  view(permissions, atTill);
  fireEvent.click(await screen.findByRole('button', { name: 'Open refund 3' }));
  await screen.findByRole('heading', { name: /Refund 3/ });
}

describe('the list of refunds (D-17, D-18, UX-52)', () => {
  it('UX-52, D-18: refunds are listed with what they are for, their status in words, how they are paid and the amount in the store currency; one with no sale says so', async () => {
    serve({
      [LIST]: {
        body: {
          items: [row({}), row({ id: 'f2', documentNumber: 4, saleDocumentNumber: null, status: 'Completed', disbursement: 'Provider', simulated: true, amount: 3_000 })],
          next: null,
        },
      },
    });
    view();
    const cash = (await screen.findByText('3')).closest('tr')!;
    expect(within(cash).getByText('Sale 42')).toBeTruthy();
    expect(within(cash).getByText('Draft')).toBeTruthy();
    expect(within(cash).getByText('Cash from the drawer')).toBeTruthy();
    expect(within(cash).getByText('£12.50')).toBeTruthy();
    const orphan = screen.getByText('4').closest('tr')!;
    expect(within(orphan).getByText('A card payment, no sale')).toBeTruthy();
    expect(within(orphan).getByText('Paid')).toBeTruthy();
    expect(within(orphan).getByText('To the card')).toBeTruthy();
    expect(within(orphan).getByText('Simulated'), 'a simulated payment says so').toBeTruthy();
  });

  it('D-17: refunds are filtered by status, and a long list shows more on the server’s cursor', async () => {
    const calls = serve({
      [LIST]: { body: { items: [row({})], next: 3 } },
      [`${LIST}&after=3`]: { body: { items: [row({ id: 'f0', documentNumber: 2, saleDocumentNumber: 40 })], next: null } },
      [`${LIST}&status=Failed`]: { body: { items: [], next: null } },
    });
    view();
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    await screen.findByText('Sale 40');
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'Failed' } });
    await screen.findByText('No refunds to show.');
    expect(calls.some((c) => c.key === `${LIST}&status=Failed`)).toBe(true);
  });

  it('AC-01, UX-05: drafting is offered only with Sale.Refund, and the refund of a payment with no sale only with Payment.View too', async () => {
    serve({ [LIST]: { body: { items: [], next: null } } });
    const first = view(['Refund.View']);
    await screen.findByText('No refunds to show.');
    expect(screen.queryByRole('button', { name: 'Refund a sale' })).toBeNull();
    first.unmount();
    const second = view(['Refund.View', 'Sale.Refund']);
    expect(await screen.findByRole('button', { name: 'Refund a sale' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /no sale/ })).toBeNull();
    second.unmount();
    view(['Refund.View', 'Sale.Refund', 'Payment.View']);
    expect(await screen.findByRole('button', { name: 'Refund a card payment with no sale' })).toBeTruthy();
  });
});

describe('refunding a sale (RR-01, RR-03, RR-22, RR-35, PY-27)', () => {
  const FIND = `GET ${S}/sales?limit=1&after=43`;
  const POST = `POST ${S}/refunds`;
  async function chooseSale(permissions = ALL, atTill = true, extra: Record<string, unknown> = {}) {
    const calls = serve({
      [LIST]: { body: { items: [], next: null } },
      [FIND]: { body: { items: [{ saleId: 'sa1', documentNumber: 42 }], next: null } },
      [SALE]: { body: sale },
      [`GET ${S}/returns?saleId=sa1&status=Posted`]: { body: { items: [{ id: 'r1', documentNumber: 7 }], next: null } },
      [`GET ${S}/returns/r1`]: { body: { id: 'r1', lines: [{ saleLineId: 'l1', quantity: '1.0000' }] } },
      [REASONS]: { body: reasons },
      [POST]: { status: 201, body: doc() },
      [DETAIL]: { body: doc() },
      ...extra,
    });
    view(permissions, atTill);
    fireEvent.click(await screen.findByRole('button', { name: 'Refund a sale' }));
    const field = await screen.findByLabelText('Sale number');
    expect(document.activeElement, 'the first field has focus (UX-01)').toBe(field);
    fireEvent.change(field, { target: { value: '42' } });
    fireEvent.submit(field.closest('form')!);
    await screen.findByRole('heading', { name: 'Refund sale 42' });
    return calls;
  }

  it('RR-03, PY-22: each item shows the most it can still be refunded, an item with nothing left is not offered, and choosing one fills in that most for the person to reduce', async () => {
    await chooseSale();
    expect(screen.queryByLabelText('Refund Bread'), 'bread has been refunded in full').toBeNull();
    const amount = screen.getByLabelText('Amount to refund for Oat milk') as HTMLInputElement;
    expect(amount.disabled).toBe(true);
    expect(within(screen.getByLabelText('Refund Oat milk').closest('tr')!).getByText('£20.00')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Refund Oat milk'));
    expect(amount.disabled).toBe(false);
    expect(amount.value, 'the most, which the person may only reduce').toBe('20.00');
    fireEvent.click(screen.getByLabelText('Refund Oat milk'));
    expect(amount.value).toBe('');
  });

  it('RR-03: more than is left is refused in place naming what is left, an amount that is not money is refused, and nothing is sent', async () => {
    const calls = await chooseSale();
    fireEvent.click(screen.getByLabelText('Refund Oat milk'));
    const amount = screen.getByLabelText('Amount to refund for Oat milk');
    fireEvent.change(screen.getByLabelText('Where the money goes'), { target: { value: 'pk' } });
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: 'why1' } });
    fireEvent.change(amount, { target: { value: '20.01' } });
    fireEvent.submit(amount.closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toBe('Only £20.00 of Oat milk can still be refunded.');
    fireEvent.change(amount, { target: { value: '1.234' } });
    fireEvent.submit(amount.closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toMatch(/at most 2 decimal places/);
    expect(calls.some((c) => c.key === POST)).toBe(false);
  });

  it('RR-35, UX-55: with no return a reason is required, and where the money goes must be chosen', async () => {
    const calls = await chooseSale();
    fireEvent.click(screen.getByLabelText('Refund Oat milk'));
    const form = screen.getByLabelText('Amount to refund for Oat milk').closest('form')!;
    fireEvent.submit(form);
    expect((await screen.findByRole('alert')).textContent).toBe('Choose where the money goes.');
    fireEvent.change(screen.getByLabelText('Where the money goes'), { target: { value: 'pk' } });
    fireEvent.submit(form);
    expect((await screen.findByRole('alert')).textContent).toBe('A refund with no return needs a reason. Choose one.');
    fireEvent.change(screen.getByLabelText('Reason (required)'), { target: { value: 'why1' } });
    fireEvent.submit(form);
    await screen.findByRole('heading', { name: /Refund 3/ });
    expect(calls.find((c) => c.key === POST)!.body).toMatchObject({
      saleId: 'sa1',
      method: 'OriginalTender',
      paymentId: 'pk',
      reasonCodeId: 'why1',
      lines: [{ saleLineId: 'l1', amount: 2_000 }],
    });
    expect((calls.find((c) => c.key === POST)!.body as { clientOperationId: string }).clientOperationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('PY-27, D-17: a cash refund is drafted at a till, so away from a till the cash choices are shown and explained and cannot be chosen', async () => {
    await chooseSale(ALL, false);
    const choices = screen.getByLabelText('Where the money goes') as HTMLSelectElement;
    const byText = (text: RegExp) => [...choices.options].find((o) => text.test(o.textContent ?? ''))!;
    expect(byText(/cash payment of £30.00/).disabled).toBe(true);
    expect(byText(/Cash from the drawer/).disabled).toBe(true);
    expect(byText(/card payment of £30.00 \(simulated\)/).disabled, 'a card refund needs no till').toBe(false);
    expect(screen.getByText(/drafted and paid at that till/)).toBeTruthy();
  });

  it('PY-27, RR-22: at a till, cash is chosen as the cash tender or as cash with no tender, and is sent as the server expects', async () => {
    const calls = await chooseSale(ALL, true);
    fireEvent.click(screen.getByLabelText('Refund Oat milk'));
    fireEvent.change(screen.getByLabelText('Where the money goes'), { target: { value: 'cash' } });
    fireEvent.change(screen.getByLabelText('Reason (required)'), { target: { value: 'why1' } });
    fireEvent.submit(screen.getByLabelText('Amount to refund for Oat milk').closest('form')!);
    await screen.findByRole('heading', { name: /Refund 3/ });
    const body = calls.find((c) => c.key === POST)!.body as Record<string, unknown>;
    expect(body.method).toBe('Cash');
    expect(body, 'a cash refund names no tender').not.toHaveProperty('paymentId');
  });

  it('RR-01, SS051: for a posted return only the lines that return took back are offered, shown with what came back, and the reason becomes optional', async () => {
    const calls = await chooseSale(ALL, true, { [DETAIL]: { body: doc({ returnId: 'r1' }) } });
    fireEvent.change(screen.getByLabelText('For a return'), { target: { value: 'r1' } });
    await screen.findByText(/Returned 1 of 2/);
    expect(screen.queryByLabelText('Refund Bread')).toBeNull();
    expect(screen.getByLabelText(/^Reason$/), 'optional with a return').toBeTruthy();
    fireEvent.click(screen.getByLabelText('Refund Oat milk'));
    fireEvent.change(screen.getByLabelText('Where the money goes'), { target: { value: 'pk' } });
    fireEvent.submit(screen.getByLabelText('Amount to refund for Oat milk').closest('form')!);
    await screen.findByRole('heading', { name: /Refund 3/ });
    expect(calls.find((c) => c.key === POST)!.body).toMatchObject({ returnId: 'r1' });
    expect(calls.find((c) => c.key === POST)!.body).not.toHaveProperty('reasonCodeId');
  });

  it('RR-01: a refund started from a posted return opens on that return’s sale, with the return chosen', async () => {
    const calls = serve({
      [`GET ${S}/returns/r1`]: { body: { id: 'r1', saleId: 'sa1', lines: [{ saleLineId: 'l1', quantity: '1.0000' }] } },
      [SALE]: { body: sale },
      [`GET ${S}/returns?saleId=sa1&status=Posted`]: { body: { items: [{ id: 'r1', documentNumber: 7 }], next: null } },
      [REASONS]: { body: reasons },
    });
    render(<Refunds storeId="s1" permissions={ALL} currency={GBP} startFromReturn="r1" />);
    await screen.findByRole('heading', { name: 'Refund sale 42' });
    expect((screen.getByLabelText('For a return') as HTMLSelectElement).value).toBe('r1');
    await screen.findByText(/Returned 1 of 2/);
    expect(calls.some((c) => c.key === `GET ${S}/returns/r1`)).toBe(true);
  });

  it('UX-55: a sale number that is not a sale is said in place, and the form for the sale does not appear', async () => {
    serve({ [LIST]: { body: { items: [], next: null } }, [`GET ${S}/sales?limit=1&after=100`]: { body: { items: [{ saleId: 'x', documentNumber: 90 }], next: null } } });
    view();
    fireEvent.click(await screen.findByRole('button', { name: 'Refund a sale' }));
    const field = await screen.findByLabelText('Sale number');
    fireEvent.change(field, { target: { value: '99' } });
    fireEvent.submit(field.closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toMatch(/no sale numbered 99/);
    expect(screen.queryByText(/Refund sale/)).toBeNull();
  });

  it('SS049: a refusal that names what is left is shown as the amount to reduce to', async () => {
    await chooseSale(ALL, true, { [POST]: { status: 409, body: { error: { code: 'SS049', message: 'That is more than is still refundable on that line.', remaining: '1500' } } } });
    fireEvent.click(screen.getByLabelText('Refund Oat milk'));
    fireEvent.change(screen.getByLabelText('Where the money goes'), { target: { value: 'pk' } });
    fireEvent.change(screen.getByLabelText('Reason (required)'), { target: { value: 'why1' } });
    fireEvent.submit(screen.getByLabelText('Amount to refund for Oat milk').closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toBe('Only £15.00 of that line can still be refunded. Reduce the amount.');
  });
});

describe('refunding a card payment with no sale (D-18, PY-37, PY-22)', () => {
  const ATTENTION = `GET ${S}/payments/attention?olderThanMinutes=0&limit=200`;
  const orphan = { paymentId: 'pk1', kind: 'CapturedNoSale', amount: 3_000, currencyCode: 'GBP', ageMinutes: 12, simulated: true, heldBack: 1_000, givenBack: 0 };
  async function chooseOrphan(extra: Record<string, unknown> = {}) {
    const calls = serve({
      [LIST]: { body: { items: [], next: null } },
      [ATTENTION]: { body: { summary: {}, items: [orphan, { ...orphan, paymentId: 'x', kind: 'PendingTooLong' }], next: null } },
      [REASONS]: { body: reasons },
      [`POST ${S}/refunds`]: { status: 201, body: doc({ saleId: null, lines: [], taxAmount: 0, disbursement: 'Provider' }) },
      [DETAIL]: { body: doc({ saleId: null, lines: [], taxAmount: 0, disbursement: 'Provider' }) },
      ...extra,
    });
    view();
    fireEvent.click(await screen.findByRole('button', { name: 'Refund a card payment with no sale' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Refund the payment of £30.00' }));
    return calls;
  }

  it('PY-37, PY-40: only payments taken with no sale are listed, with what each can still give back; the others are not here', async () => {
    serve({
      [LIST]: { body: { items: [], next: null } },
      [ATTENTION]: { body: { summary: {}, items: [orphan, { ...orphan, paymentId: 'x', kind: 'PendingTooLong' }], next: null } },
      [REASONS]: { body: reasons },
    });
    view();
    fireEvent.click(await screen.findByRole('button', { name: 'Refund a card payment with no sale' }));
    const rows = await screen.findAllByRole('button', { name: /^Refund the payment of/ });
    expect(rows).toHaveLength(1);
    const cells = within(rows[0]!.closest('tr')!);
    expect(cells.getByText('£30.00')).toBeTruthy();
    expect(cells.getByText('£20.00'), '3,000 less the 1,000 held back').toBeTruthy();
    expect(cells.getByText('Simulated')).toBeTruthy();
  });

  it('D-18, PY-22: the amount starts at the most the payment can still give back, can only be reduced, and a reason is required', async () => {
    const calls = await chooseOrphan();
    const amount = (await screen.findByLabelText('Amount to give back (GBP)')) as HTMLInputElement;
    expect(amount.value).toBe('20.00');
    expect(document.activeElement).toBe(amount);
    fireEvent.change(amount, { target: { value: '20.01' } });
    fireEvent.submit(amount.closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toBe('Only £20.00 of that payment can still be given back.');
    fireEvent.change(amount, { target: { value: '15.00' } });
    fireEvent.submit(amount.closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toMatch(/needs a reason/);
    fireEvent.change(screen.getByLabelText('Reason (required)'), { target: { value: 'why1' } });
    fireEvent.submit(amount.closest('form')!);
    await screen.findByRole('heading', { name: /Refund 3 of a card payment with no sale/ });
    // Strictly the shape the server takes: no sale, no lines, no return (D-18).
    expect(calls.find((c) => c.key === `POST ${S}/refunds`)!.body).toEqual({
      clientOperationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      method: 'OriginalTender',
      paymentId: 'pk1',
      amount: 1_500,
      reasonCodeId: 'why1',
    });
  });

  it('D-18: arriving from the report of payments to check, the payment is already chosen, with the most it can give back, and the person only reduces it', async () => {
    serve({
      [ATTENTION]: { body: { summary: {}, items: [orphan, { ...orphan, paymentId: 'pk2', amount: 900, heldBack: 0 }], next: null } },
      [REASONS]: { body: reasons },
    });
    render(<Refunds storeId="s1" permissions={ALL} currency={GBP} startFromPayment="pk1" />);
    const amount = (await screen.findByLabelText('Amount to give back (GBP)')) as HTMLInputElement;
    expect(amount.value, '3,000 less the 1,000 held back').toBe('20.00');
    expect(screen.getByText(/Payment of £30.00/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Refund the payment of/ }), 'no list to choose from').toBeNull();
  });

  it('D-18: a payment that is no longer waiting without a sale is said in place, and the list to choose from is shown instead', async () => {
    serve({ [ATTENTION]: { body: { summary: {}, items: [orphan], next: null } }, [REASONS]: { body: reasons } });
    render(<Refunds storeId="s1" permissions={ALL} currency={GBP} startFromPayment="gone" />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/not waiting without a sale any more/);
    expect(screen.getByRole('button', { name: 'Refund the payment of £30.00' })).toBeTruthy();
  });

  it('SS058: a refusal that names what is left is shown in money', async () => {
    await chooseOrphan({ [`POST ${S}/refunds`]: { status: 409, body: { error: { code: 'SS058', message: 'That is more than is still left to give back to that payment.', remaining: '1200' } } } });
    const amount = await screen.findByLabelText('Amount to give back (GBP)');
    fireEvent.change(screen.getByLabelText('Reason (required)'), { target: { value: 'why1' } });
    fireEvent.submit(amount.closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toBe('Only £12.00 of that payment can still be given back.');
  });

  it('UX-55: with no payment waiting, or no permission to see them, the screen says so', async () => {
    serve({ [LIST]: { body: { items: [], next: null } }, [ATTENTION]: { body: { summary: {}, items: [], next: null } }, [REASONS]: { body: reasons } });
    view();
    fireEvent.click(await screen.findByRole('button', { name: 'Refund a card payment with no sale' }));
    expect(await screen.findByText('No card payment is waiting without a sale.')).toBeTruthy();
  });
});

describe('one refund: approve, pay, withdraw and cancel (BI-26, D-16, D-17, D-19, SM-40, SM-41)', () => {
  it('D-17, SM-42: a draft is sent for approval, or withdrawn with a chosen reason, by Sale.Refund; its lines show what it pays back', async () => {
    const calls = serve({
      [LIST]: { body: { items: [row({})], next: null } },
      [DETAIL]: [{ body: doc() }, { body: doc({ status: 'PendingApproval' }) }],
      [SALE]: { body: sale },
      [REASONS]: { body: reasons },
      [TRANSITIONS]: { body: { subject: 'f1', state: 'PendingApproval', changed: true } },
    });
    view();
    fireEvent.click(await screen.findByRole('button', { name: 'Open refund 3' }));
    const line = (await screen.findByText('1. Oat milk')).closest('tr')!;
    expect(within(line).getByText('£12.50')).toBeTruthy();
    expect(within(line).getByText('£1.14')).toBeTruthy();
    const withdraw = screen.getByRole('form', { name: 'Withdraw this draft' });
    fireEvent.submit(withdraw);
    expect((await within(withdraw).findByRole('alert')).textContent).toBe('Choose a reason first.');
    fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }));
    await screen.findByText('Refund 3 sent for approval.');
    expect(calls.find((c) => c.key === TRANSITIONS)!.body).toEqual({ machine: 'Refund', event: 'submit', subject: 'f1' });
    expect(screen.getByText('Waiting for approval')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send for approval' })).toBeNull();
  });

  it('D-17: withdrawing sends the reason with the cancel event', async () => {
    const calls = serve({
      [LIST]: { body: { items: [row({})], next: null } },
      [DETAIL]: [{ body: doc() }, { body: doc({ status: 'Cancelled' }) }],
      [SALE]: { body: sale },
      [REASONS]: { body: reasons },
      [TRANSITIONS]: { body: { subject: 'f1', state: 'Cancelled', changed: true } },
    });
    view();
    fireEvent.click(await screen.findByRole('button', { name: 'Open refund 3' }));
    const form = await screen.findByRole('form', { name: 'Withdraw this draft' });
    fireEvent.change(within(form).getByLabelText('Reason'), { target: { value: 'why1' } });
    fireEvent.submit(form);
    await screen.findByText('Refund 3 withdrawn.');
    expect(calls.find((c) => c.key === TRANSITIONS)!.body).toEqual({ machine: 'Refund', event: 'cancel', subject: 'f1', reasonCodeId: 'why1' });
    expect(screen.queryByRole('form', { name: /Withdraw|Cancel/ }), 'cancelled is final').toBeNull();
  });

  it('BI-26, AP-08: approving is Sale.Refund.Large.Approve; without it the screen says someone else must', async () => {
    const calls = serve({
      [LIST]: { body: { items: [row({ status: 'PendingApproval' })], next: null } },
      [DETAIL]: [{ body: doc({ status: 'PendingApproval' }) }, { body: doc({ status: 'Approved' }) }],
      [SALE]: { body: sale },
      [REASONS]: { body: reasons },
      [TRANSITIONS]: { body: { subject: 'f1', state: 'Approved', changed: true } },
    });
    const first = view(['Refund.View', 'Sale.Refund', 'Sale.View']);
    fireEvent.click(await screen.findByRole('button', { name: 'Open refund 3' }));
    await screen.findByRole('heading', { name: /Refund 3/ });
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.getByText(/Someone other than the person who sent it must approve/)).toBeTruthy();
    first.unmount();
    vi.unstubAllGlobals();
    const again = serve({
      [LIST]: { body: { items: [row({ status: 'PendingApproval' })], next: null } },
      [DETAIL]: [{ body: doc({ status: 'PendingApproval' }) }, { body: doc({ status: 'Approved' }) }],
      [SALE]: { body: sale },
      [REASONS]: { body: reasons },
      [TRANSITIONS]: { body: { subject: 'f1', state: 'Approved', changed: true } },
    });
    view();
    fireEvent.click(await screen.findByRole('button', { name: 'Open refund 3' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await screen.findByText('Refund 3 approved.');
    expect(again.find((c) => c.key === TRANSITIONS)!.body).toEqual({ machine: 'Refund', event: 'approve', subject: 'f1' });
    expect(calls.some((c) => c.key === TRANSITIONS), 'the first screen sent nothing').toBe(false);
  });

  it('BI-26: the server’s refusal of an approver who is the submitter is shown in place', async () => {
    serve({
      [LIST]: { body: { items: [row({ status: 'PendingApproval' })], next: null } },
      ...detailRoutes(doc({ status: 'PendingApproval' })),
      [TRANSITIONS]: { status: 422, body: { error: { code: 'invalid_value', message: 'The approver must be someone other than the person who drafted or submitted the refund.' } } },
    });
    view();
    fireEvent.click(await screen.findByRole('button', { name: 'Open refund 3' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/someone other than the person who drafted or submitted/);
  });

  it('PY-27, D-16, D-17: a cash refund is paid on the transition endpoint under Refund.Pay, at its till; away from a till it cannot be', async () => {
    const calls = serve({
      [LIST]: { body: { items: [row({ status: 'Approved' })], next: null } },
      [DETAIL]: [{ body: doc({ status: 'Approved' }) }, { body: doc({ status: 'Completed' }) }],
      [SALE]: { body: sale },
      [REASONS]: { body: reasons },
      [TRANSITIONS]: { body: { subject: 'f1', state: 'Completed', changed: true } },
    });
    const away = view(ALL, false);
    fireEvent.click(await screen.findByRole('button', { name: 'Open refund 3' }));
    const away_pay = (await screen.findByRole('button', { name: 'Pay the refund' })) as HTMLButtonElement;
    expect(away_pay.disabled).toBe(true);
    expect(screen.getByText('A cash refund is paid at the till it was drafted at.')).toBeTruthy();
    away.unmount();
    vi.unstubAllGlobals();
    const at = serve({
      [LIST]: { body: { items: [row({ status: 'Approved' })], next: null } },
      [DETAIL]: [{ body: doc({ status: 'Approved' }) }, { body: doc({ status: 'Completed' }) }],
      [SALE]: { body: sale },
      [REASONS]: { body: reasons },
      [TRANSITIONS]: { body: { subject: 'f1', state: 'Completed', changed: true } },
    });
    view(ALL, true);
    fireEvent.click(await screen.findByRole('button', { name: 'Open refund 3' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Pay the refund' }));
    await screen.findByText('Refund 3 paid.');
    expect(at.find((c) => c.key === TRANSITIONS)!.body).toEqual({ machine: 'Refund', event: 'submit to provider', subject: 'f1' });
    expect(calls.some((c) => c.key === TRANSITIONS), 'away from a till nothing was sent').toBe(false);
  });

  it('PY-25, PY-36, D-16: a card refund is paid at its own route, not the transition endpoint, and needs no till', async () => {
    const calls = serve({
      [LIST]: { body: { items: [row({ status: 'Approved', disbursement: 'Provider' })], next: null } },
      [DETAIL]: [{ body: doc({ status: 'Approved', disbursement: 'Provider' }) }, { body: doc({ status: 'Completed', disbursement: 'Provider', simulated: true }) }],
      [SALE]: { body: sale },
      [REASONS]: { body: reasons },
      [`POST ${S}/refunds/f1/pay`]: { body: doc({ status: 'Completed' }) },
    });
    view(ALL, false);
    fireEvent.click(await screen.findByRole('button', { name: 'Open refund 3' }));
    const pay = (await screen.findByRole('button', { name: 'Pay the refund' })) as HTMLButtonElement;
    expect(pay.disabled).toBe(false);
    fireEvent.click(pay);
    await screen.findByText('Refund 3 paid.');
    expect(calls.some((c) => c.key === TRANSITIONS)).toBe(false);
    // The simulated gateway is said so, wherever its money is shown (ADR-31 s13).
    expect(screen.getByText('Simulated card gateway: no real money moved.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pay the refund' })).toBeNull();
  });

  it('SM-41, PY-11: a card refund the provider fails is shown as Failed, held, with retry and cancel; the refusal is said and the refund reloaded', async () => {
    serve({
      [LIST]: { body: { items: [row({ status: 'Approved', disbursement: 'Provider' })], next: null } },
      [DETAIL]: [{ body: doc({ status: 'Approved', disbursement: 'Provider' }) }, { body: doc({ status: 'Failed', disbursement: 'Provider' }) }],
      [SALE]: { body: sale },
      [REASONS]: { body: reasons },
      [`POST ${S}/refunds/f1/pay`]: { status: 409, body: { error: { code: 'refund_failed', message: 'The card refund failed. The money is still held for it: retry it, or cancel it with a reason.', state: 'Failed' } } },
    });
    view();
    fireEvent.click(await screen.findByRole('button', { name: 'Open refund 3' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Pay the refund' }));
    expect((await screen.findAllByRole('alert'))[0]!.textContent).toMatch(/The card refund failed/);
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByRole('form', { name: 'Cancel this refund' })).toBeTruthy();
    expect(screen.getByText('Cancelling releases the money held for it.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pay the refund' })).toBeNull();
  });

  it('D-19, SM-41: a failed refund is retried at its route under Sale.Refund, or cancelled with a reason, which releases the hold', async () => {
    const calls = serve({
      [LIST]: { body: { items: [row({ status: 'Failed', disbursement: 'Provider' })], next: null } },
      [DETAIL]: [{ body: doc({ status: 'Failed', disbursement: 'Provider' }) }, { body: doc({ status: 'Cancelled', disbursement: 'Provider' }) }],
      [SALE]: { body: sale },
      [REASONS]: { body: reasons },
      [TRANSITIONS]: { body: { subject: 'f1', state: 'Cancelled', changed: true } },
      [`POST ${S}/refunds/f1/retry`]: { body: doc({ status: 'Completed' }) },
    });
    view();
    fireEvent.click(await screen.findByRole('button', { name: 'Open refund 3' }));
    const form = await screen.findByRole('form', { name: 'Cancel this refund' });
    fireEvent.submit(form);
    expect((await within(form).findByRole('alert')).textContent).toBe('Choose a reason first.');
    fireEvent.change(within(form).getByLabelText('Reason'), { target: { value: 'why1' } });
    fireEvent.submit(form);
    await screen.findByText('Refund 3 cancelled.');
    expect(calls.find((c) => c.key === TRANSITIONS)!.body).toEqual({ machine: 'Refund', event: 'cancel', subject: 'f1', reasonCodeId: 'why1' });
    expect(calls.some((c) => c.key.endsWith('/retry'))).toBe(false);
  });

  it('D-19: Retry goes to its own route', async () => {
    const calls = serve({
      [LIST]: { body: { items: [row({ status: 'Failed', disbursement: 'Provider' })], next: null } },
      [DETAIL]: [{ body: doc({ status: 'Failed', disbursement: 'Provider' }) }, { body: doc({ status: 'Completed', disbursement: 'Provider' }) }],
      [SALE]: { body: sale },
      [REASONS]: { body: reasons },
      [`POST ${S}/refunds/f1/retry`]: { body: doc({ status: 'Completed' }) },
    });
    view();
    fireEvent.click(await screen.findByRole('button', { name: 'Open refund 3' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await screen.findByText('Refund 3 retried.');
    expect(calls.some((c) => c.key === `POST ${S}/refunds/f1/retry`)).toBe(true);
  });

  it('PY-11, SM-41: a card refund the provider has not confirmed says not to refund it again, and offers to ask the provider by paying again, or to cancel', async () => {
    const calls = serve({
      [LIST]: { body: { items: [row({ status: 'Processing', disbursement: 'Provider' })], next: null } },
      [DETAIL]: { body: doc({ status: 'Processing', disbursement: 'Provider' }) },
      [SALE]: { body: sale },
      [REASONS]: { body: reasons },
      [`POST ${S}/refunds/f1/pay`]: { status: 409, body: { error: { code: 'refund_pending', message: 'The card refund is not confirmed yet. Do not refund it again: pay it again to check.', state: 'Processing' } } },
    });
    view();
    fireEvent.click(await screen.findByRole('button', { name: 'Open refund 3' }));
    expect((await screen.findByText(/has not confirmed this refund/)).textContent).toMatch(/Do not refund it again/);
    fireEvent.click(screen.getByRole('button', { name: 'Pay again to check with the provider' }));
    expect((await screen.findAllByRole('alert'))[0]!.textContent).toMatch(/not confirmed yet/);
    expect(calls.some((c) => c.key === `POST ${S}/refunds/f1/pay`)).toBe(true);
    expect(screen.getByRole('form', { name: 'Cancel this refund' })).toBeTruthy();
  });

  it('AC-01, UX-05, UX-08: each act is offered only with its own key, and a paid or cancelled refund offers none', async () => {
    serve({ [LIST]: { body: { items: [row({ status: 'Approved' })], next: null } }, ...detailRoutes(doc({ status: 'Approved' })) });
    const viewOnly = view(['Refund.View', 'Sale.View']);
    fireEvent.click(await screen.findByRole('button', { name: 'Open refund 3' }));
    await screen.findByRole('heading', { name: /Refund 3/ });
    expect(screen.queryByRole('button', { name: 'Pay the refund' })).toBeNull();
    expect(screen.queryByRole('form', { name: 'Cancel this refund' })).toBeNull();
    viewOnly.unmount();
    serve({ [LIST]: { body: { items: [row({ status: 'Approved' })], next: null } }, ...detailRoutes(doc({ status: 'Approved' })) });
    const payer = view(['Refund.View', 'Refund.Pay', 'Sale.View'], true);
    fireEvent.click(await screen.findByRole('button', { name: 'Open refund 3' }));
    expect(await screen.findByRole('button', { name: 'Pay the refund' })).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Cancel this refund' }), 'cancelling is Sale.Refund, not Refund.Pay').toBeNull();
    payer.unmount();
    serve({ [LIST]: { body: { items: [row({ status: 'Completed' })], next: null } }, ...detailRoutes(doc({ status: 'Completed' })) });
    view();
    fireEvent.click(await screen.findByRole('button', { name: 'Open refund 3' }));
    await screen.findByRole('heading', { name: /Refund 3/ });
    expect(screen.queryByRole('button', { name: /Pay|Approve|Retry|Send/ })).toBeNull();
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('D-18: a refund with no sale says so in its title and shows no lines', async () => {
    serve({
      [LIST]: { body: { items: [row({ saleDocumentNumber: null, disbursement: 'Provider' })], next: null } },
      [DETAIL]: { body: doc({ saleId: null, lines: [], taxAmount: 0, disbursement: 'Provider', amount: 3_000 }) },
      [REASONS]: { body: reasons },
    });
    view();
    fireEvent.click(await screen.findByRole('button', { name: 'Open refund 3' }));
    expect(await screen.findByRole('heading', { name: 'Refund 3 of a card payment with no sale' })).toBeTruthy();
    expect(screen.getByText('£30.00')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('Of which tax')).toBeNull();
  });
});
