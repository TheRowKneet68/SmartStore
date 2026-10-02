import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serve } from '../test/serve.ts';
import { TillWork } from './TillWork.tsx';

/**
 * What a till does besides sell (`RR-01`, `PY-27`, D-17, `UX-05`, `UX-08`, `UX-57`). The network is stubbed at `fetch`, never at
 * the `api` module.
 */

const USD = { code: 'USD', exponent: 2 };
const S = '/api/v1/stores/s1';
const ITEM = { variantId: 'v-1', description: 'Oat milk 1 L', barcode: '5012345678900', price: { amount: 250, currencyCode: 'USD', minorUnitExponent: 2 }, quote: 'q-1' };
const refund = (status: string) => ({
  id: 'f1', documentNumber: 3, saleId: 'sa1', returnId: null, paymentId: 'pc', status, method: 'OriginalTender', disbursement: 'Drawer', amount: 250, taxAmount: 23,
  currencyCode: 'USD', providerOutcome: null, simulated: false, lines: [],
});
const listRow = { id: 'f1', documentNumber: 3, saleDocumentNumber: 42, returnId: null, paymentId: 'pc', status: 'Approved', method: 'OriginalTender', disbursement: 'Drawer', amount: 250, currencyCode: 'USD', simulated: false, createdAt: '2026-10-02T08:00:00.000Z' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the till’s tools (UX-05, UX-08, UX-57)', () => {
  it('UX-05, UX-08: a till with no key that reads returns or refunds offers neither, and is only the sale', async () => {
    serve({});
    render(<TillWork storeId="s1" currency={USD} permissions={['Sale.Create']} />);
    expect(screen.queryByRole('navigation', { name: 'At the till' })).toBeNull();
    expect(screen.getByLabelText('Scan or type a barcode, then Enter')).toBeTruthy();
  });

  it('UX-05: Return.View offers Returns, and Refund.View offers Refunds, each only with its own key', async () => {
    serve({});
    const first = render(<TillWork storeId="s1" currency={USD} permissions={['Sale.Create', 'Return.View']} />);
    expect(screen.getByRole('button', { name: 'Returns' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Refunds' })).toBeNull();
    first.unmount();
    render(<TillWork storeId="s1" currency={USD} permissions={['Sale.Create', 'Refund.View']} />);
    expect(screen.getByRole('button', { name: 'Refunds' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Returns' })).toBeNull();
  });

  it('UX-57, UX-01: the cart survives a visit to Refunds, and coming back puts the cursor in the scan field', async () => {
    serve({ [`GET ${S}/scan/5012345678900`]: { body: ITEM }, [`GET ${S}/refunds?limit=50`]: { body: { items: [], next: null } } });
    render(<TillWork storeId="s1" currency={USD} permissions={['Sale.Create', 'Refund.View']} />);
    const scan = screen.getByLabelText('Scan or type a barcode, then Enter') as HTMLInputElement;
    fireEvent.change(scan, { target: { value: '5012345678900' } });
    fireEvent.submit(scan.closest('form')!);
    await screen.findByText('Oat milk 1 L');
    fireEvent.click(screen.getByRole('button', { name: 'Refunds' }));
    await screen.findByRole('heading', { name: 'Refunds' });
    expect(screen.queryByRole('table', { name: 'Cart' }), 'the sale is hidden while refunds are open').toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to the sale' }));
    expect(await screen.findByRole('table', { name: 'Cart' }), 'the cart is exactly as it was').toBeTruthy();
    expect(screen.getByText('Oat milk 1 L')).toBeTruthy();
    await vi.waitFor(() => expect(document.activeElement?.id).toBe('code'));
  });

  it('PY-27, D-17: at a till a cash refund can be paid, which the back office cannot do', async () => {
    const calls = serve({
      [`GET ${S}/refunds?limit=50`]: { body: { items: [listRow], next: null } },
      [`GET ${S}/refunds/f1`]: [{ body: refund('Approved') }, { body: refund('Completed') }],
      [`GET ${S}/sales/sa1`]: { body: { saleId: 'sa1', documentNumber: 42, status: 'Completed', lines: [], payments: [] } },
      'GET /api/v1/reason-codes': { body: { items: [{ id: 'why1', code: 'W', name: 'Because' }] } },
      'POST /api/v1/transitions': { body: { subject: 'f1', state: 'Completed', changed: true } },
    });
    render(<TillWork storeId="s1" currency={USD} permissions={['Sale.Create', 'Refund.View', 'Refund.Pay', 'Sale.View']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Refunds' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open refund 3' }));
    const pay = (await screen.findByRole('button', { name: 'Pay the refund' })) as HTMLButtonElement;
    expect(pay.disabled, 'at a till').toBe(false);
    fireEvent.click(pay);
    await screen.findByText('Refund 3 paid.');
    expect(calls.find((c) => c.key === 'POST /api/v1/transitions')!.body).toEqual({ machine: 'Refund', event: 'submit to provider', subject: 'f1' });
  });

  it('RR-01: a posted return hands over to the refund of it, on the refunds screen at the till', async () => {
    serve({
      [`GET ${S}/returns?limit=50`]: { body: { items: [{ id: 'r1', documentNumber: 7, saleId: 'sa1', saleDocumentNumber: 42, status: 'Posted', businessDate: '2026-10-02', createdAt: '2026-10-02T08:00:00.000Z', lines: 1 }], next: null } },
      [`GET ${S}/returns/r1`]: { body: { id: 'r1', documentNumber: 7, saleId: 'sa1', status: 'Posted', businessDate: '2026-10-02', lateApprovedBy: null, lines: [{ id: 'ln', saleLineId: 'l1', variantId: 'v', quantity: '1.0000', disposition: 'Sellable', locationId: 'loc' }] } },
      [`GET ${S}/sales/sa1`]: { body: { saleId: 'sa1', documentNumber: 42, status: 'PartiallyReturned', payments: [], lines: [{ saleLineId: 'l1', lineNumber: 1, description: 'Oat milk', quantity: '2.0000', returnedQuantity: '1.0000', settledAmount: 500, refundedAmount: 0 }] } },
      [`GET ${S}/returns?saleId=sa1&status=Posted`]: { body: { items: [{ id: 'r1', documentNumber: 7 }], next: null } },
      'GET /api/v1/reason-codes': { body: { items: [] } },
    });
    render(<TillWork storeId="s1" currency={USD} permissions={['Sale.Create', 'Return.View', 'Refund.View', 'Sale.Refund', 'Sale.View']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Returns' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open return 7' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Refund this return' }));
    expect(await screen.findByRole('heading', { name: 'Refund sale 42' })).toBeTruthy();
    expect((screen.getByLabelText('For a return') as HTMLSelectElement).value).toBe('r1');
  });
});
