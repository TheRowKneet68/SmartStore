import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serve } from '../test/serve.ts';
import { Returns } from './Returns.tsx';

/**
 * The returns screen (D5 §10, D-17; `RR-01`, `RR-08`, `RR-10`, `RR-11`, `RR-14`, `RR-17`, `RR-19`, `SM-42`). The network is
 * stubbed at `fetch`, never at the `api` module, so the screen, the client and the server's response shapes run together.
 */

const S = '/api/v1/stores/s1';
const LIST = `GET ${S}/returns?limit=50`;
const DETAIL = `GET ${S}/returns/r1`;
const SALE = `GET ${S}/sales/sa1`;
const LOCATIONS = `GET ${S}/locations`;
const REASONS = 'GET /api/v1/reason-codes';

const ALL = ['Return.View', 'Return.Create', 'Return.Approve', 'Sale.View', 'Inventory.View'];

afterEach(() => {
  vi.unstubAllGlobals();
});

const row = (over: object) => ({ id: 'r1', documentNumber: 7, saleId: 'sa1', saleDocumentNumber: 42, status: 'Draft', businessDate: '2026-10-02', createdAt: '2026-10-02T08:00:00.000Z', lines: 0, ...over });
const doc = (over: object = {}) => ({ id: 'r1', documentNumber: 7, saleId: 'sa1', status: 'Draft', businessDate: null, lateApprovedBy: null, lateReasonCodeId: null, cancelReasonCodeId: null, lines: [], ...over });
const sale = {
  saleId: 'sa1',
  documentNumber: 42,
  status: 'Completed',
  lines: [
    { saleLineId: 'l1', lineNumber: 1, description: 'Oat milk', quantity: '2.0000', returnedQuantity: '0.0000' },
    { saleLineId: 'l2', lineNumber: 2, description: 'Bread', quantity: '1.0000', returnedQuantity: '1.0000' },
  ],
};
const locations = {
  items: [
    { id: 'loc1', code: 'SHELF', name: 'Shelf', locationType: 'Default', isSellable: true, warehouseName: 'Back room' },
    { id: 'loc2', code: 'Q', name: 'Quarantine bay', locationType: 'Quarantine', isSellable: false, warehouseName: 'Back room' },
    { id: 'loc3', code: 'D', name: 'Damaged bay', locationType: 'Damaged', isSellable: false, warehouseName: 'Back room' },
  ],
};
const reasons = { items: [{ id: 'why1', code: 'WHY', name: 'Customer changed their mind' }] };
const detailRoutes = (d: object = doc()) => ({
  [DETAIL]: { body: d },
  [SALE]: { body: sale },
  [LOCATIONS]: { body: locations },
  [REASONS]: { body: reasons },
});

/** Opens return r1 from a list that holds it. */
async function openFirst(permissions = ALL) {
  render(<Returns storeId="s1" permissions={permissions} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open return 7' }));
  await screen.findByRole('heading', { name: /Return 7 of sale 42/ });
}

describe('the list of returns (D-17, RR-01, UX-52)', () => {
  it('D-17, UX-52: the store’s returns are listed with their sale, their status in words and their lines, and filtered by status', async () => {
    const calls = serve({
      [LIST]: { body: { items: [row({}), row({ id: 'r2', documentNumber: 6, saleDocumentNumber: 40, status: 'Posted', lines: 2 })], next: null } },
      [`${LIST}&status=Posted`]: { body: { items: [row({ id: 'r2', documentNumber: 6, status: 'Posted', lines: 2 })], next: null } },
    });
    render(<Returns storeId="s1" permissions={ALL} />);
    const posted = (await screen.findByText('6')).closest('tr')!;
    expect(within(posted).getByText('Posted')).toBeTruthy();
    expect(within((await screen.findByText('7')).closest('tr')!).getByText('Draft')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'Posted' } });
    await screen.findByText('6');
    expect(screen.queryByText('7')).toBeNull();
    expect(calls.some((c) => c.key === `${LIST}&status=Posted`)).toBe(true);
  });

  it('D-17: a long list shows more with the cursor the server gave', async () => {
    const calls = serve({
      [LIST]: { body: { items: [row({})], next: 7 } },
      [`${LIST}&after=7`]: { body: { items: [row({ id: 'r0', documentNumber: 6, saleDocumentNumber: 39 })], next: null } },
    });
    render(<Returns storeId="s1" permissions={ALL} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    await screen.findByText('39');
    expect(screen.getByText('42')).toBeTruthy();
    expect(calls.some((c) => c.key === `${LIST}&after=7`)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('AC-01, UX-05: the form to take goods back is offered only to someone who may create a return', async () => {
    serve({ [LIST]: { body: { items: [], next: null } } });
    const { unmount } = render(<Returns storeId="s1" permissions={['Return.View']} />);
    await screen.findByText('No returns to show.');
    expect(screen.queryByRole('button', { name: 'Open a return' })).toBeNull();
    unmount();
    render(<Returns storeId="s1" permissions={['Return.View', 'Return.Create']} />);
    expect(await screen.findByRole('button', { name: 'Open a return' })).toBeTruthy();
  });

  it('RR-08, UX-01: a return is opened against a sale by its number, from the scan-style field that already has focus, and its draft opens', async () => {
    const calls = serve({
      [LIST]: { body: { items: [], next: null } },
      [`GET ${S}/sales?limit=1&after=43`]: { body: { items: [{ saleId: 'sa1', documentNumber: 42 }], next: null } },
      [`POST ${S}/returns`]: { status: 201, body: doc() },
      ...detailRoutes(),
    });
    render(<Returns storeId="s1" permissions={ALL} />);
    const field = await screen.findByLabelText('Sale number');
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: '42' } });
    fireEvent.submit(field.closest('form')!);
    await screen.findByRole('heading', { name: /Return 7 of sale 42/ });
    const post = calls.find((c) => c.key === `POST ${S}/returns`)!;
    expect(post.body).toMatchObject({ saleId: 'sa1' });
    expect((post.body as { clientOperationId: string }).clientOperationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('UX-55, UX-57: a number that is not a sale, or is not a number, is said in place with what to do, and opens nothing', async () => {
    const calls = serve({
      [LIST]: { body: { items: [], next: null } },
      [`GET ${S}/sales?limit=1&after=100`]: { body: { items: [{ saleId: 'x', documentNumber: 90 }], next: null } },
    });
    render(<Returns storeId="s1" permissions={ALL} />);
    const field = await screen.findByLabelText('Sale number');
    fireEvent.change(field, { target: { value: 'abc' } });
    fireEvent.submit(field.closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Enter the number of the sale/);
    fireEvent.change(field, { target: { value: '99' } });
    fireEvent.submit(field.closest('form')!);
    expect((await screen.findByText(/no sale numbered 99/)).textContent).toMatch(/Check the number on the receipt/);
    expect(calls.some((c) => c.key.startsWith('POST'))).toBe(false);
  });
});

describe('one return: its goods and where they go (RR-14, RR-17, RR-19, RR-18)', () => {
  it('RR-08: each line says which sold item it is, its quantity without needless decimals, its state and its place', async () => {
    serve({
      [LIST]: { body: { items: [row({ lines: 1 })], next: null } },
      ...detailRoutes(doc({ lines: [{ id: 'ln1', saleLineId: 'l1', variantId: 'v1', quantity: '1.0000', disposition: 'Quarantine', locationId: 'loc2' }] })),
    });
    await openFirst();
    const line = (await screen.findByText('1. Oat milk')).closest('tr')!;
    expect(within(line).getByText('1')).toBeTruthy();
    expect(within(line).getByText('Quarantine')).toBeTruthy();
    expect(within(line).getByText('Back room · Quarantine bay')).toBeTruthy();
  });

  it('RR-17, RR-18, RR-19: there is no default state; the places offered are those that state goes to; and the line is sent as chosen', async () => {
    const calls = serve({
      [LIST]: { body: { items: [row({})], next: null } },
      ...detailRoutes(),
      [`POST ${S}/returns/r1/lines`]: { status: 201, body: doc() },
    });
    await openFirst();
    const place = screen.getByLabelText('Goes to') as HTMLSelectElement;
    expect((screen.getByLabelText('State of the goods') as HTMLSelectElement).value, 'nothing is chosen for the person').toBe('');
    expect(place.textContent).toMatch(/Choose the state first/);
    fireEvent.change(screen.getByLabelText('State of the goods'), { target: { value: 'Damaged' } });
    expect([...place.options].map((o) => o.textContent)).toEqual(['Choose a location…', 'Back room · Damaged bay']);
    fireEvent.change(screen.getByLabelText('State of the goods'), { target: { value: 'Sellable' } });
    expect([...place.options].map((o) => o.textContent)).toEqual(['Choose a location…', 'Back room · Shelf']);
    expect(place.value, 'a changed state clears the place').toBe('');

    fireEvent.change(screen.getByLabelText('Item'), { target: { value: 'l1' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '1' } });
    fireEvent.change(place, { target: { value: 'loc1' } });
    fireEvent.submit(place.closest('form')!);
    await screen.findByText('Line added.');
    expect(calls.find((c) => c.key === `POST ${S}/returns/r1/lines`)!.body).toMatchObject({ saleLineId: 'l1', quantity: '1', disposition: 'Sellable', locationId: 'loc1' });
  });

  it('UX-55: an incomplete line is said in place, and sends nothing', async () => {
    const calls = serve({ [LIST]: { body: { items: [row({})], next: null } }, ...detailRoutes() });
    await openFirst();
    fireEvent.submit(screen.getByLabelText('Quantity').closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Choose the item, the quantity/);
    expect(calls.some((c) => c.key.startsWith('POST'))).toBe(false);
  });

  it('RR-14: what is left to return is shown beside each item, an item with none left cannot be chosen, and a refusal names what remains', async () => {
    serve({
      [LIST]: { body: { items: [row({})], next: null } },
      ...detailRoutes(),
      [`POST ${S}/returns/r1/lines`]: { status: 409, body: { error: { code: 'SS046', message: 'That is more than is still returnable on that line.', remaining: '2.0000' } } },
    });
    await openFirst();
    const item = screen.getByLabelText('Item') as HTMLSelectElement;
    const options = [...item.options];
    expect(options.map((o) => o.textContent)).toEqual(['Choose the item…', '1. Oat milk (up to 2)', '2. Bread (up to 0)']);
    expect(options[2]!.disabled, 'bread has all come back already').toBe(true);
    fireEvent.change(item, { target: { value: 'l1' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('State of the goods'), { target: { value: 'Sellable' } });
    fireEvent.change(screen.getByLabelText('Goes to'), { target: { value: 'loc1' } });
    fireEvent.submit(item.closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toBe('Only 2 of that item can still be returned.');
  });

  it('RR-14: what the draft already holds is taken off what is left', async () => {
    serve({
      [LIST]: { body: { items: [row({ lines: 1 })], next: null } },
      ...detailRoutes(doc({ lines: [{ id: 'ln1', saleLineId: 'l1', variantId: 'v1', quantity: '1.0000', disposition: 'Sellable', locationId: 'loc1' }] })),
    });
    await openFirst();
    expect([...(screen.getByLabelText('Item') as HTMLSelectElement).options][1]!.textContent).toBe('1. Oat milk (up to 1)');
  });

  it('RR-16: a line on a draft is removed by someone who may create a return', async () => {
    const calls = serve({
      [LIST]: { body: { items: [row({ lines: 1 })], next: null } },
      ...detailRoutes(doc({ lines: [{ id: 'ln1', saleLineId: 'l1', variantId: 'v1', quantity: '1.0000', disposition: 'Sellable', locationId: 'loc1' }] })),
      [`DELETE ${S}/returns/r1/lines/ln1`]: { body: doc() },
    });
    await openFirst();
    fireEvent.click(screen.getByRole('button', { name: 'Remove 1. Oat milk' }));
    await screen.findByText('Line removed.');
    expect(calls.some((c) => c.key === `DELETE ${S}/returns/r1/lines/ln1`)).toBe(true);
  });
});

describe('posting, the window, the late approval and cancelling (RR-10, RR-11, AP-08, SM-42)', () => {
  const oneLine = doc({ lines: [{ id: 'ln1', saleLineId: 'l1', variantId: 'v1', quantity: '1.0000', disposition: 'Sellable', locationId: 'loc1' }] });

  it('SM-38, D-16: posting is the transition endpoint’s own event, and its outcome is spoken', async () => {
    const calls = serve({
      [LIST]: { body: { items: [row({ lines: 1 })], next: null } },
      [DETAIL]: [{ body: oneLine }, { body: { ...oneLine, status: 'Posted' } }],
      [SALE]: { body: sale },
      [LOCATIONS]: { body: locations },
      [REASONS]: { body: reasons },
      'POST /api/v1/transitions': { body: { subject: 'r1', state: 'Posted', changed: true } },
    });
    await openFirst();
    fireEvent.click(screen.getByRole('button', { name: 'Post the return' }));
    await screen.findByText('Return 7 posted. The goods are back in stock.');
    expect(calls.find((c) => c.key === 'POST /api/v1/transitions')!.body).toEqual({ machine: 'CustomerReturn', event: 'post', subject: 'r1' });
    // Posted is final: nothing to add, post or cancel.
    expect(screen.queryByRole('button', { name: 'Post the return' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel the return' })).toBeNull();
    expect(screen.queryByLabelText('Item')).toBeNull();
  });

  it('RR-14: an empty draft cannot be posted', async () => {
    serve({ [LIST]: { body: { items: [row({})], next: null } }, ...detailRoutes() });
    await openFirst();
    expect((screen.getByRole('button', { name: 'Post the return' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('RR-10, RR-11, UX-55: past the window the screen names the day it closed and who must approve, and the return stays a draft', async () => {
    serve({
      [LIST]: { body: { items: [row({ lines: 1 })], next: null } },
      ...detailRoutes(oneLine),
      'POST /api/v1/transitions': { status: 409, body: { error: { code: 'SS048', message: 'The return window for this sale has closed.', windowClosedOn: '2026-09-01' } } },
    });
    await openFirst();
    fireEvent.click(screen.getByRole('button', { name: 'Post the return' }));
    const notice = await screen.findByText(/past the return window/);
    expect(notice.textContent).toMatch(/closed on .*2026/);
    expect(notice.textContent).toMatch(/late-approval permission/);
    expect(screen.getByText('Draft')).toBeTruthy();
  });

  it('RR-11, AP-08, D-16: the late approval is offered only to someone holding Return.Approve, takes a chosen reason, and goes to its own route', async () => {
    const calls = serve({
      [LIST]: { body: { items: [row({ lines: 1 })], next: null } },
      ...detailRoutes(oneLine),
      [`POST ${S}/returns/r1/late-approval`]: { body: { ...oneLine, lateApprovedBy: 'e2' } },
    });
    await openFirst();
    const form = screen.getByRole('form', { name: 'Approve this return late' });
    fireEvent.submit(form);
    expect((await within(form).findByRole('alert')).textContent).toBe('Choose a reason first.');
    expect(calls.some((c) => c.key.endsWith('late-approval'))).toBe(false);
    fireEvent.change(within(form).getByLabelText('Reason'), { target: { value: 'why1' } });
    fireEvent.submit(form);
    await screen.findByText('Late return approved.');
    expect(calls.find((c) => c.key.endsWith('late-approval'))!.body).toEqual({ reasonCodeId: 'why1' });
  });

  it('SM-42, BI-40: cancelling needs a reason chosen from the organization’s, and sends it with the event', async () => {
    const calls = serve({
      [LIST]: { body: { items: [row({ lines: 1 })], next: null } },
      [DETAIL]: [{ body: oneLine }, { body: { ...oneLine, status: 'Cancelled' } }],
      [SALE]: { body: sale },
      [LOCATIONS]: { body: locations },
      [REASONS]: { body: reasons },
      'POST /api/v1/transitions': { body: { subject: 'r1', state: 'Cancelled', changed: true } },
    });
    await openFirst();
    const form = screen.getByRole('form', { name: 'Cancel this return' });
    fireEvent.submit(form);
    expect((await within(form).findByRole('alert')).textContent).toBe('Choose a reason first.');
    fireEvent.change(within(form).getByLabelText('Reason'), { target: { value: 'why1' } });
    fireEvent.submit(form);
    await screen.findByText('Return 7 cancelled.');
    expect(calls.find((c) => c.key === 'POST /api/v1/transitions')!.body).toEqual({ machine: 'CustomerReturn', event: 'cancel', subject: 'r1', reasonCodeId: 'why1' });
  });

  it('AC-01, UX-05, UX-08: without Return.Create there is nothing to add, post or cancel, and without Return.Approve no late approval', async () => {
    serve({ [LIST]: { body: { items: [row({ lines: 1 })], next: null } }, ...detailRoutes(oneLine) });
    await openFirst(['Return.View', 'Sale.View']);
    expect(screen.queryByRole('button', { name: 'Post the return' })).toBeNull();
    expect(screen.queryByRole('form', { name: 'Cancel this return' })).toBeNull();
    expect(screen.queryByRole('form', { name: 'Approve this return late' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(screen.queryByLabelText('Item')).toBeNull();
  });

  it('RR-01: a posted return offers a refund of it to someone who may issue refunds, and only then', async () => {
    const posted = { ...oneLine, status: 'Posted' };
    serve({ [LIST]: { body: { items: [row({ status: 'Posted', lines: 1 })], next: null } }, ...detailRoutes(posted) });
    const started = vi.fn();
    const { unmount } = render(<Returns storeId="s1" permissions={[...ALL, 'Sale.Refund']} onRefund={started} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open return 7' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Refund this return' }));
    expect(started).toHaveBeenCalledWith('r1');
    unmount();
    serve({ [LIST]: { body: { items: [row({ status: 'Posted', lines: 1 })], next: null } }, ...detailRoutes(posted) });
    render(<Returns storeId="s1" permissions={ALL} onRefund={started} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open return 7' }));
    await screen.findByRole('heading', { name: /Return 7 of sale 42/ });
    expect(screen.queryByRole('button', { name: 'Refund this return' }), 'Sale.Refund is the key').toBeNull();
  });

  it('AC-01: a manager who only approves late sees the approval and nothing else to change', async () => {
    serve({ [LIST]: { body: { items: [row({ lines: 1 })], next: null } }, ...detailRoutes(oneLine) });
    await openFirst(['Return.View', 'Return.Approve', 'Sale.View']);
    expect(screen.getByRole('form', { name: 'Approve this return late' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Post the return' })).toBeNull();
  });

  it('UX-59: a server failure is shown as the system’s, and says the till is still working', async () => {
    serve({
      [LIST]: { body: { items: [row({ lines: 1 })], next: null } },
      ...detailRoutes(oneLine),
      'POST /api/v1/transitions': { status: 500, body: { error: { code: 'internal', message: 'Something went wrong on the server. Nothing was saved; try again.' } } },
    });
    await openFirst();
    fireEvent.click(screen.getByRole('button', { name: 'Post the return' }));
    const alert = await screen.findByRole('alert');
    expect(alert.getAttribute('data-kind')).toBe('system');
    expect(alert.textContent).toMatch(/till is still working/);
  });
});
