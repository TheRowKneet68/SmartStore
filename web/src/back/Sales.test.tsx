import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serve } from '../test/serve.ts';
import { Sales } from './Sales.tsx';

/**
 * Sales in the back office: the list with its filters, and one sale's receipt as the server renders it from the stored
 * numbers (`SP-57`, `SP-59`, `BI-11`). Two filters need keys of their own — tills are `Device.View`, cashiers
 * `Employee.View` — and neither is fetched or offered without it (`UX-05`). A reprint is `Sale.Create` and its reason is
 * mandatory (owner instruction of 2026-10-01).
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const STORE = 's1';
const currency = { code: 'NPR', exponent: 2 };
const noSales = 'No sale matches that.';

const sale = (over: Record<string, unknown> = {}) => ({
  saleId: 'x1',
  documentNumber: 1,
  businessDate: '2026-10-01',
  completedAt: '2026-10-01T13:00:00.000Z',
  terminalLabel: 'Till 1',
  cashierName: 'Ada Cashier',
  currencyCode: 'NPR',
  totalDue: 11300,
  tendered: 12000,
  change: 700,
  status: 'Completed',
  receiptStatus: 'Printed',
  lines: [{ lineNumber: 1, description: 'TEST-ONLY cola 500ml', quantity: '2', unitPrice: 5000, lineTotal: 10000 }],
  ...over,
});

const receipt = (over: Record<string, unknown> = {}) => ({
  saleId: 'x1',
  documentNumber: 1,
  businessDate: '2026-10-01',
  completedAt: '2026-10-01T13:00:00.000Z',
  store: { code: 'MAIN', name: 'TEST-ONLY Main Street', address: '1 Test Street', contactDetails: '01-0000000' },
  currencyCode: 'NPR',
  minorUnitExponent: 2,
  subtotal: 10000,
  taxTotal: 1300,
  totalDue: 11300,
  change: 700,
  receiptStatus: 'Printed',
  lines: [{ lineNumber: 1, description: 'TEST-ONLY cola 500ml', quantity: '2', unitName: 'bottle', unitPrice: 5000, lineTotal: 10000 }],
  payments: [{ method: 'CASH', amount: 12000, tendered: 12000 }],
  reprint: null,
  ...over,
});

const field = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const openTheSale = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Open sale 1' }));
};

describe('filters (UX-05, SP-58, RT-140)', () => {
  it('leaves out the till and cashier filters when the keys behind them are not held, and asks for neither', async () => {
    const calls = serve({ 'GET /api/v1/stores/s1/sales': { body: { items: [], next: null } } });
    render(<Sales storeId={STORE} permissions={['Sale.View']} currency={currency} />);
    expect(await screen.findByText(noSales)).toBeTruthy();
    expect(screen.queryByLabelText('Till')).toBeNull();
    expect(screen.queryByLabelText('Cashier')).toBeNull();
    expect(calls.map((c) => c.key)).toEqual(['GET /api/v1/stores/s1/sales']);
  });

  it('offers both filters with their keys, names the cashier the way the server stores them, and sends the filter', async () => {
    const calls = serve({
      'GET /api/v1/stores/s1/terminals': { body: { items: [{ id: 't1', label: 'Till 1' }] } },
      'GET /api/v1/employees?limit=100': {
        body: { items: [{ id: 'e1', firstName: 'Ada', lastName: 'Cashier', preferredName: 'Addy' }] },
      },
      'GET /api/v1/stores/s1/sales': { body: { items: [sale()], next: null } },
      'GET /api/v1/stores/s1/sales?employeeId=e1': { body: { items: [], next: null } },
    });
    render(<Sales storeId={STORE} permissions={['Sale.View', 'Device.View', 'Employee.View']} currency={currency} />);
    await screen.findByText('Ada Cashier');
    expect(screen.getByRole('option', { name: 'Addy Cashier' })).toBeTruthy();

    field('Cashier', 'e1');
    expect(await screen.findByText(noSales)).toBeTruthy();
    expect(calls.map((c) => c.key)).toContain('GET /api/v1/stores/s1/sales?employeeId=e1');
  });
});

describe('the receipt (SP-57, BI-11, §18.5)', () => {
  it('shows the stored numbers through the money helper, and carries no cost', async () => {
    serve({
      'GET /api/v1/stores/s1/sales': { body: { items: [sale()], next: null } },
      'GET /api/v1/stores/s1/sales/x1': { body: sale() },
      'GET /api/v1/stores/s1/sales/x1/receipt': { body: receipt() },
    });
    render(<Sales storeId={STORE} permissions={['Sale.View', 'Sale.Create']} currency={currency} />);
    await openTheSale();

    expect(await screen.findByText(/TEST-ONLY Main Street \(MAIN\)/)).toBeTruthy();
    expect(screen.getByText('Receipt')).toBeTruthy();
    // The minor units are divided for display, never parsed back: 11,300 paisa reads as 113.00.
    const onTheCopy = within(screen.getByRole('region', { name: 'Receipt' }));
    expect(onTheCopy.getByRole('row', { name: /Total due/ }).textContent).toMatch(/113\.00/);
    expect(onTheCopy.getByRole('row', { name: /^Change/ }).textContent).toMatch(/7\.00/);
    expect(document.body.textContent?.toLowerCase().includes('cost'), 'a receipt carries no cost (`UX-33`)').toBe(false);
  });

  it('D-16 Q13: Sale.View alone sees the sale, is not shown a receipt, asks the server for none, and is told whose work it is', async () => {
    const calls = serve({
      'GET /api/v1/stores/s1/sales': { body: { items: [sale()], next: null } },
      'GET /api/v1/stores/s1/sales/x1': { body: sale() },
      'GET /api/v1/stores/s1/sales/x1/receipt': { body: receipt() },
    });
    render(<Sales storeId={STORE} permissions={['Sale.View']} currency={currency} />);
    await openTheSale();
    expect(await screen.findByText(/The receipt is read at the till, by someone who can sell \(Sale\.Create\)/)).toBeTruthy();
    expect(calls.some((c) => c.key.endsWith('/receipt')), 'nothing is asked and refused').toBe(false);
    expect(screen.queryByRole('region', { name: 'Receipt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reprint' })).toBeNull();
  });

  it('with Sale.Create, a reprint without a reason is refused before anything is sent', async () => {
    const reprinted = receipt({ reprint: { reprintedAt: '2026-10-01T13:05:00.000Z', reason: 'Printer jammed' } });
    const calls = serve({
      'GET /api/v1/stores/s1/sales': { body: { items: [sale()], next: null } },
      'GET /api/v1/stores/s1/sales/x1': { body: sale() },
      'GET /api/v1/stores/s1/sales/x1/receipt': [{ body: receipt() }, { body: reprinted }],
      'GET /api/v1/reason-codes': { body: { items: [{ id: 'r1', code: 'JAM', name: 'Printer jammed' }] } },
      'POST /api/v1/stores/s1/sales/x1/reprints': { body: reprinted },
    });
    render(<Sales storeId={STORE} permissions={['Sale.View', 'Sale.Create']} currency={currency} />);
    await openTheSale();
    await screen.findByText(/TEST-ONLY Main Street \(MAIN\)/);

    fireEvent.submit(screen.getByRole('button', { name: 'Reprint' }).closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toBe('Choose why this receipt is being reprinted.');
    expect(calls.some((c) => c.key.startsWith('POST') && c.key.includes('reprints')), 'nothing sent').toBe(false);

    field('Why is it being reprinted?', 'r1');
    fireEvent.submit(screen.getByRole('button', { name: 'Reprint' }).closest('form')!);
    expect(calls.find((c) => c.key === 'POST /api/v1/stores/s1/sales/x1/reprints')?.body).toEqual({ reasonCodeId: 'r1' });
    expect(await screen.findByText(/was reprinted: Printer jammed/)).toBeTruthy();
    expect(await screen.findByText(/This is a reprint/)).toBeTruthy();
  });
});

describe('what is offered (UX-05)', () => {
  it('without Sale.View the screen says so and asks for nothing', async () => {
    const calls = serve({});
    render(<Sales storeId={STORE} permissions={['Device.View']} currency={currency} />);
    expect(await screen.findByText(/You do not have permission to see this store's sales/)).toBeTruthy();
    expect(calls.map((c) => c.key)).toEqual([]);
  });
});
