import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';

/**
 * The till's shell: who is signed in, where, and the state of the drawer. The network is stubbed at `fetch`, never at
 * the `api` module, so the screen, the client and the server's response shapes run together.
 */

const store = { id: 's1', code: 'S1', name: 'High Street', currencyCode: 'GBP', minorUnitExponent: 2, permissions: ['Sale.Create', 'Shift.Open'] };
const atTill = {
  employee: { id: 'e1', name: 'Ada Cashier', readOnly: false },
  organization: { id: 'o1', name: 'Corner Shop', permissions: [] },
  stores: [store],
  terminal: { id: 't1', code: 'T1', label: 'Till 1', storeId: 's1' },
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Answers each `METHOD /api/v1/path` with its JSON body; anything else is a 404 in the server's error shape (§18.4). */
function serve(routes: Record<string, unknown>) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`;
    return key in routes ? json(routes[key]) : json({ error: { code: 'not_found', message: 'There is nothing at this address.' } }, 404);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the till shell (UX-35, UX-52, UX-07, UX-08)', () => {
  it('UX-35, UX-52: an open shift is shown on the bar as "Shift open", in words beside a symbol', async () => {
    serve({ 'GET /api/v1/session': atTill, 'GET /api/v1/stores/s1/shift': { shift: { id: 'sh1', status: 'Open' } } });
    render(<App />);
    const words = await screen.findByText('Shift open');
    const chip = words.closest('.chip');
    expect(chip?.getAttribute('data-state')).toBe('open');
    expect(chip?.querySelector('[aria-hidden="true"]')?.textContent, 'a symbol, not colour alone').toBe('●');
    expect(screen.getByText('Corner Shop · High Street · Till 1')).toBeTruthy();
    expect(screen.getByText('Ada Cashier')).toBeTruthy();
  });

  it('UX-35, CD-10: with no shift open, the bar says so, and the till asks for the counted float in the store currency', async () => {
    serve({ 'GET /api/v1/session': atTill, 'GET /api/v1/stores/s1/shift': { shift: null } });
    render(<App />);
    const words = await screen.findByText('No open shift');
    expect(words.closest('.chip')?.querySelector('[aria-hidden="true"]')?.textContent).toBe('○');
    expect(screen.getByLabelText('Counted opening float (GBP)')).toBeTruthy();
  });

  it('UX-35, UX-33, BI-39: a shift being counted is shown as "Counting the drawer", and the till offers no sale', async () => {
    serve({ 'GET /api/v1/session': atTill, 'GET /api/v1/stores/s1/shift': { shift: { id: 'sh1', status: 'Reconciling' } } });
    render(<App />);
    const words = await screen.findByText('Counting the drawer');
    expect(words.closest('.chip')?.getAttribute('data-state')).toBe('counting');
    expect(words.closest('.chip')?.querySelector('[aria-hidden="true"]')?.textContent).toBe('◐');
    expect(screen.queryByLabelText('Scan or type a barcode, then Enter')).toBeNull();
  });

  it('UX-08: without Shift.Close, the till offers no way to close the shift', async () => {
    serve({ 'GET /api/v1/session': atTill, 'GET /api/v1/stores/s1/shift': { shift: { id: 'sh1', status: 'Open' } } });
    render(<App />);
    await screen.findByText('Shift open');
    expect(screen.queryByRole('button', { name: 'Close shift…' })).toBeNull();
  });

  it('UX-02, UX-57: closing the shift asks above the sale, and "Keep selling" returns to the cart exactly as it was', async () => {
    const closer = { ...atTill, stores: [{ ...store, permissions: [...store.permissions, 'Shift.Close'] }] };
    serve({
      'GET /api/v1/session': closer,
      'GET /api/v1/stores/s1/shift': { shift: { id: 'sh1', status: 'Open' } },
      'GET /api/v1/stores/s1/scan/012345678905': {
        variantId: 'v1',
        description: 'Oat milk',
        barcode: '012345678905',
        price: { amount: 1_250, currencyCode: 'GBP', minorUnitExponent: 2 },
        quote: 'signed-quote',
      },
    });
    render(<App />);
    const scan = await screen.findByLabelText('Scan or type a barcode, then Enter');
    fireEvent.change(scan, { target: { value: '012345678905' } });
    fireEvent.submit(scan.closest('form')!);
    expect(await screen.findAllByTestId('cart-line')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close shift…' }));
    expect(screen.getByRole('heading', { name: 'Close the shift?' })).toBeTruthy();
    expect(screen.getAllByTestId('cart-line'), 'the sale stays on screen under the question').toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Keep selling' }));
    expect(screen.queryByRole('heading', { name: 'Close the shift?' })).toBeNull();
    expect(screen.getAllByTestId('cart-line'), 'the cart is as it was').toHaveLength(1);
  });

  it('UX-57: while the cart has items, closing the shift offers only "Keep selling", and says why', async () => {
    const closer = { ...atTill, stores: [{ ...store, permissions: [...store.permissions, 'Shift.Close'] }] };
    serve({
      'GET /api/v1/session': closer,
      'GET /api/v1/stores/s1/shift': { shift: { id: 'sh1', status: 'Open' } },
      'GET /api/v1/stores/s1/scan/012345678905': {
        variantId: 'v1',
        description: 'Oat milk',
        barcode: '012345678905',
        price: { amount: 1_250, currencyCode: 'GBP', minorUnitExponent: 2 },
        quote: 'signed-quote',
      },
    });
    render(<App />);
    const scan = await screen.findByLabelText('Scan or type a barcode, then Enter');
    fireEvent.change(scan, { target: { value: '012345678905' } });
    fireEvent.submit(scan.closest('form')!);
    await screen.findAllByTestId('cart-line');
    fireEvent.click(screen.getByRole('button', { name: 'Close shift…' }));
    expect(screen.getByText('There is 1 item in the cart. Complete the sale, or remove the items, before closing the shift.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Begin counting' }), 'nothing to strand the cart').toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Keep selling' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Oat milk' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close shift…' }));
    expect(screen.getByRole('button', { name: 'Begin counting' }), 'an empty cart may close').toBeTruthy();
  });

  it('UX-33, UX-35: beginning the count turns the till into its counting mode, and the bar says so', async () => {
    const closer = { ...atTill, stores: [{ ...store, permissions: [...store.permissions, 'Shift.Close'] }] };
    const fetch = serve({
      'GET /api/v1/session': closer,
      'GET /api/v1/stores/s1/shift': { shift: { id: 'sh1', status: 'Open' } },
      'POST /api/v1/transitions': { subject: 'sh1', state: 'Reconciling', changed: true },
    });
    render(<App />);
    await screen.findByText('Shift open');
    fireEvent.click(screen.getByRole('button', { name: 'Close shift…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Begin counting' }));
    expect(await screen.findByRole('heading', { name: 'Count the drawer' })).toBeTruthy();
    expect(screen.getByText('Counting the drawer')).toBeTruthy();
    expect(screen.queryByLabelText('Scan or type a barcode, then Enter'), 'no sale while counting').toBeNull();
    expect(fetch).toHaveBeenCalledWith('/api/v1/transitions', expect.objectContaining({ method: 'POST' }));
  });

  it('UX-05, UX-08: away from a till, someone with Cash.Count.View sees the shifts, and only the sections they may use', async () => {
    const manager = { ...atTill, terminal: null, stores: [{ ...store, permissions: ['Cash.Count.View'] }] };
    serve({ 'GET /api/v1/session': manager, 'GET /api/v1/stores/s1/shifts': { items: [] } });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Shifts' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Back office' }), 'one section needs no tabs').toBeNull();
    expect(screen.queryByText('Set up this browser as a till')).toBeNull();
  });

  it('UX-05, UX-52: with both, the sections are tabs, and the one shown is marked in text weight and underline, not colour alone', async () => {
    const manager = { ...atTill, terminal: null, stores: [{ ...store, permissions: ['Cash.Count.View', 'Device.View'] }] };
    serve({ 'GET /api/v1/session': manager, 'GET /api/v1/stores/s1/shifts': { items: [] }, 'GET /api/v1/stores/s1/terminals': { items: [] } });
    render(<App />);
    const tabs = await screen.findByRole('navigation', { name: 'Back office' });
    expect(screen.getByRole('button', { name: 'Shifts' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: 'Till set-up' }));
    expect(await screen.findByRole('heading', { name: 'Set up this browser as a till' })).toBeTruthy();
    expect(tabs.querySelector('[aria-current="page"]')?.textContent).toBe('Till set-up');
  });

  it('UX-07, MS-05: an employee with no store access sees an empty workspace that says who to ask', async () => {
    serve({ 'GET /api/v1/session': { ...atTill, stores: [], terminal: null } });
    render(<App />);
    expect(await screen.findByText('You have no access to a store yet. Ask the owner or a manager to give you access.')).toBeTruthy();
    expect(screen.queryByText('No open shift'), 'no drawer state away from a till').toBeNull();
  });

  it('UX-08: at a till, someone who may not sell is told so, and is offered neither a sale nor the drawer state', async () => {
    serve({ 'GET /api/v1/session': { ...atTill, stores: [{ ...store, permissions: ['Shift.Open'] }] } });
    render(<App />);
    expect(await screen.findByText('You cannot sell at this till. Ask a manager for access.')).toBeTruthy();
    expect(screen.queryByLabelText('Scan or type a barcode, then Enter')).toBeNull();
    expect(screen.queryByText('Shift open')).toBeNull();
  });
});
