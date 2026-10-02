import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SaleScreen } from './Sale.tsx';

/**
 * The till's sale screen, for UI step U5: the payment step, problems styled by whose they are, and the cart's size told
 * to the till. The network is stubbed at `fetch`, never at the `api` module, so the screen, the client and the server's
 * response shapes run together. (Named apart from `Sale.test.tsx`, which the web agent's brief reserves.)
 */

const GBP = { code: 'GBP', exponent: 2 };
const SCAN = 'GET /api/v1/stores/s1/scan/012345678905';
const SALES = 'POST /api/v1/stores/s1/sales';
const milk = {
  variantId: 'v1',
  description: 'Oat milk',
  barcode: '012345678905',
  price: { amount: 1_250, currencyCode: 'GBP', minorUnitExponent: 2 },
  quote: 'signed-quote',
};
const SYSTEM = 'Something went wrong on the server. Nothing was saved; try again.';

type Reply = { status?: number; body: unknown } | 'offline';

/** Answers each `METHOD /api/v1/path`; a list of replies is given in turn, the last repeating. Records every call. */
function serve(routes: Record<string, Reply | Reply[]>) {
  const calls: { key: string; body: unknown }[] = [];
  const turns = new Map<string, number>();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${String(input)}`;
      calls.push({ key, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
      const turn = turns.get(key) ?? 0;
      turns.set(key, turn + 1);
      const route = routes[key];
      const reply = route === undefined ? { status: 404, body: { error: { code: 'not_found', message: 'There is nothing at this address.' } } } : Array.isArray(route) ? route[Math.min(turn, route.length - 1)]! : route;
      if (reply === 'offline') throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const till = (onCartChange = vi.fn()) => render(<SaleScreen storeId="s1" currency={GBP} onCartChange={onCartChange} />);
const scan = async (code = '012345678905') => {
  const field = screen.getByLabelText('Scan or type a barcode, then Enter');
  fireEvent.change(field, { target: { value: code } });
  fireEvent.submit(field.closest('form')!);
};
const typeCash = (value: string) => fireEvent.change(screen.getByLabelText('Cash given (Enter for the exact total)'), { target: { value } });
const pay = () => fireEvent.submit(screen.getByRole('form', { name: 'Payment' }));
const tender = () => [...document.querySelectorAll('dl.tender dt, dl.tender dd')].map((e) => e.textContent);
const problem = async () => {
  const alert = await screen.findByRole('alert');
  return { kind: alert.getAttribute('data-kind'), text: alert.textContent };
};

describe('the payment step (UX-14, UX-15, UX-17)', () => {
  it('UX-14, UX-15: the payment step shows the total due, the cash given and the change, as the cash is typed', async () => {
    serve({ [SCAN]: { body: milk } });
    till();
    await scan();
    await screen.findByTestId('cart-line');
    expect(tender(), 'an empty field is the exact total').toEqual(['Total due', '£12.50', 'Cash given', '£12.50', 'Change', '£0.00']);
    typeCash('20');
    expect(tender()).toEqual(['Total due', '£12.50', 'Cash given', '£20.00', 'Change', '£7.50']);
    typeCash('2.505');
    expect(tender(), 'not an amount: no figure').toEqual(['Total due', '£12.50', 'Cash given', '—', 'Change', '—']);
  });

  it('UX-17, SP-40: an underpayment is named with what is still to pay, and nothing is sent', async () => {
    const calls = serve({ [SCAN]: { body: milk } });
    till();
    await scan();
    await screen.findByTestId('cart-line');
    typeCash('10');
    expect(screen.getByTestId('still-to-pay').textContent).toBe('£2.50');
    expect(screen.queryByTestId('change-due')).toBeNull();
    pay();
    expect(await problem()).toEqual({ kind: 'user', text: 'The cash given is £2.50 short of the total due. Take more cash.' });
    expect(calls.some((c) => c.key === SALES)).toBe(false);
  });
});

describe('problems, by whose they are (UX-59, UX-11, UX-57)', () => {
  it('UX-59, UX-11: a refusal is a check the cashier can act on, with the cart untouched', async () => {
    serve({ [SCAN]: [{ body: milk }, { status: 404, body: { error: { code: 'not_found', message: 'No item has that barcode.' } } }] });
    till();
    await scan();
    await screen.findByTestId('cart-line');
    await scan();
    expect(await problem()).toEqual({ kind: 'user', text: 'No item has that barcode.' });
    expect(screen.getAllByTestId('cart-line')).toHaveLength(1);
  });

  it('UX-59, UX-57, SM-04: a server failure is a system problem that says the till is still working; the cart and the cash stay, and the retry is the same sale', async () => {
    const calls = serve({
      [SCAN]: { body: milk },
      [SALES]: [
        { status: 500, body: { error: { code: 'internal', message: SYSTEM } } },
        { status: 201, body: { saleId: 'sa1', documentNumber: 7, currencyCode: 'GBP', totalDue: 1_250, tendered: 2_000, change: 750 } },
      ],
    });
    till();
    await scan();
    await screen.findByTestId('cart-line');
    typeCash('20');
    pay();
    expect(await problem()).toEqual({ kind: 'system', text: `${SYSTEM} The till is still working, and nothing on screen was lost.` });
    expect(screen.getAllByTestId('cart-line')).toHaveLength(1);
    expect((screen.getByLabelText('Cash given (Enter for the exact total)') as HTMLInputElement).value).toBe('20');
    pay();
    expect(await screen.findByRole('heading', { name: 'Sale 7 completed' })).toBeTruthy();
    const saves = calls.filter((c) => c.key === SALES).map((c) => (c.body as { clientOperationId: string }).clientOperationId);
    expect(saves).toHaveLength(2);
    expect(saves[0], 'one operation id per cart').toBe(saves[1]);
  });

  it('UX-59, UX-57: a lost network is a system problem too, and the cart stays', async () => {
    serve({ [SCAN]: { body: milk }, [SALES]: 'offline' });
    till();
    await scan();
    await screen.findByTestId('cart-line');
    pay();
    const shown = await problem();
    expect(shown.kind).toBe('system');
    expect(shown.text).toContain('The server cannot be reached. Nothing was lost; try again.');
    expect(screen.getAllByTestId('cart-line')).toHaveLength(1);
  });
});

describe('the till knows the cart (UX-57, BI-30)', () => {
  it('UX-57: the till is told how many lines the cart holds, so the shift is not closed over them', async () => {
    serve({ [SCAN]: { body: milk } });
    const onCartChange = vi.fn();
    till(onCartChange);
    expect(onCartChange).toHaveBeenLastCalledWith(0);
    await scan();
    await screen.findByTestId('cart-line');
    expect(onCartChange).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Oat milk' }));
    expect(onCartChange).toHaveBeenLastCalledWith(0);
  });

  it('BI-30, UX-15: the completed sale shows the amounts the server computed, not the browser\'s', async () => {
    serve({
      [SCAN]: { body: milk },
      [SALES]: { status: 201, body: { saleId: 'sa1', documentNumber: 8, currencyCode: 'GBP', totalDue: 1_300, tendered: 2_000, change: 700 } },
    });
    till();
    await scan();
    await screen.findByTestId('cart-line');
    typeCash('20');
    pay();
    expect(await screen.findByText('Change £7.00')).toBeTruthy();
    expect(screen.getByText('Total £13.00, cash £20.00')).toBeTruthy();
  });
});

describe('finding an item by name (UX-48, UX-49, UX-11, RT-379)', () => {
  const byName = { ...milk, barcode: null, quote: 'quote-by-name' };
  const find = (name: string) => {
    fireEvent.change(screen.getByLabelText('Or find an item by name'), { target: { value: name } });
    fireEvent.submit(screen.getByRole('search', { name: 'Find an item by name' }));
  };

  it('UX-48, RT-379: a name is looked up by name, never as a barcode; the item chosen joins the cart, and the sale carries its own quote', async () => {
    const calls = serve({
      'GET /api/v1/stores/s1/items?name=oat': {
        body: { items: [byName, { ...byName, variantId: 'v2', description: 'Oat bar', price: { ...byName.price, amount: 150 }, quote: 'quote-2' }] },
      },
      [SALES]: { status: 201, body: { saleId: 'sa1', documentNumber: 1, currencyCode: 'GBP', totalDue: 1_250, tendered: 1_250, change: 0 } },
    });
    till();
    find('oat');
    const choices = await screen.findByRole('list', { name: 'Items found' });
    expect(within(choices).getAllByRole('button').map((b) => b.textContent)).toEqual(['Oat milk — £12.50', 'Oat bar — £1.50']);
    expect(calls.some((c) => c.key.includes('/scan/')), 'never as a barcode').toBe(false);
    fireEvent.click(within(choices).getByRole('button', { name: 'Oat milk — £12.50' }));
    expect(await screen.findByTestId('cart-line')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Items found' }), 'the list closes').toBeNull();
    await vi.waitFor(() => expect(document.activeElement, 'back to the scan field').toBe(screen.getByLabelText('Scan or type a barcode, then Enter')));
    pay();
    await screen.findByText('Sale 1 completed');
    expect(calls.find((c) => c.key === SALES)?.body).toMatchObject({ lines: [{ quote: 'quote-by-name', quantity: 1 }] });
  });

  it('UX-11, UX-49: a name that finds nothing says so, and the cart is untouched', async () => {
    serve({ [SCAN]: { body: milk }, 'GET /api/v1/stores/s1/items?name=tea': { body: { items: [] } } });
    till();
    await scan();
    await screen.findByTestId('cart-line');
    find('tea');
    expect(await screen.findByText('Nothing on sale here has that in its name.')).toBeTruthy();
    expect(screen.getAllByTestId('cart-line')).toHaveLength(1);
  });
});
