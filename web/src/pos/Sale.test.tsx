import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SaleScreen } from './Sale.tsx';

/**
 * The sale screen, driven through a stubbed `fetch` rather than a stubbed `api` module. That is deliberate: mocking
 * `api` would only prove the screen calls a function we replaced, whereas stubbing the network exercises the whole
 * chain — screen, client, and the server's response shape — which is where the failures actually live.
 *
 * Plain matchers only. `@testing-library/jest-dom` is deliberately not installed, so assertions read `textContent`
 * directly. Queries are role-scoped where a phrase appears twice on purpose: the outcome heading and the live region
 * both say the sale completed, and that repetition is the feature (RT-339, UX-51), not a duplicate to search past.
 *
 * Rules cited per test: UX-09 scanning, UX-10 the running total, UX-01 the keyboard path, UX-11 an error leaves the
 * cart alone, UX-57 a failed save keeps the cart and the cash, UX-04/UX-15/UX-21 the outcome, SM-04 one cart is one
 * sale, BI-30 the client sends no amounts.
 */

const CURRENCY = { code: 'USD', exponent: 2 };
const STORE = 's-1';

const ITEM = {
  variantId: 'v-1',
  description: 'Oat milk 1 L',
  barcode: '5012345678900',
  price: { amount: 250, currencyCode: 'USD', minorUnitExponent: 2 },
  quote: 'q-1',
};

const SALE = { saleId: 'sale-1', documentNumber: 1042, currencyCode: 'USD', totalDue: 250, tendered: 500, change: 250 };

const ok = (body: unknown) => ({ status: 200, ok: true, json: () => Promise.resolve(body) });
const refused = (status: number, code: string, message: string) => ({
  status,
  ok: false,
  json: () => Promise.resolve({ error: { code, message } }),
});

/** Serves the scan route, and the save route from `onSave` when given. */
function serve(onSave?: (attempt: number) => unknown) {
  let attempt = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (init.method === 'POST') {
      attempt += 1;
      return ok(onSave === undefined ? SALE : onSave(attempt));
    }
    if (String(url).includes('/scan/')) return ok(ITEM);
    throw new Error(`unstubbed ${init.method} ${url}`);
  }));
}

interface Saved {
  clientOperationId: string;
  lines: { quote: string; quantity: number }[];
  cash: { tendered: number };
}

const savedBodies = (): Saved[] =>
  vi.mocked(fetch).mock.calls
    .filter(([, init]) => init?.method === 'POST')
    .map(([, init]) => JSON.parse(String(init?.body)) as Saved);

/** The nth save sent, failing loudly rather than silently answering about `undefined`. */
const sent = (at: number): Saved => {
  const body = savedBodies()[at];
  if (body === undefined) throw new Error(`no save at ${at}; there were ${savedBodies().length}`);
  return body;
};

const renderSale = () => render(<SaleScreen storeId={STORE} currency={CURRENCY} />);

const scanField = () => screen.getByLabelText('Scan or type a barcode, then Enter') as HTMLInputElement;
const cashField = () => screen.getByLabelText(/Cash given/) as HTMLInputElement;
const cartLines = () => screen.queryAllByTestId('cart-line');
/** The nth cart line, failing loudly if the screen has fewer. */
const cartLine = (at = 0): HTMLElement => {
  const row = cartLines()[at];
  if (row === undefined) throw new Error(`no cart line at ${at}; there were ${cartLines().length}`);
  return row;
};
const theForm = (input: HTMLElement) => input.closest('form') as HTMLFormElement;
const total = () => screen.getByTestId('total').textContent;
const line = (at = 0) => cartLine(at).textContent ?? '';
const alert = () => screen.getByRole('alert').textContent ?? '';
/** The outcome panel. Scoped so the live region's repetition cannot make a query ambiguous. */
const outcome = () => screen.getByRole('heading', { name: /Sale \d+ completed/ }).closest('section') as HTMLElement;
const announced = () => screen.getByRole('status').textContent ?? '';

const scan = async (code: string) => {
  fireEvent.change(scanField(), { target: { value: code } });
  fireEvent.submit(theForm(scanField()));
  await waitFor(() => expect(scanField().value).toBe(''));
};

const pay = async (cash?: string) => {
  if (cash !== undefined) fireEvent.change(cashField(), { target: { value: cash } });
  fireEvent.submit(theForm(cashField()));
};

/**
 * Scoped to one line: two lines of the same product carry the same label, so the query must say which. See the
 * ambiguity recorded in the log — it is a real finding about the screen, not a test problem.
 */
const setQuantity = (value: string, at = 0) =>
  fireEvent.change(within(cartLine(at)).getByLabelText('Quantity of Oat milk 1 L'), { target: { value } });

const completed = () => waitFor(() => expect(outcome().textContent).toContain('Sale 1042 completed'));

afterEach(() => vi.unstubAllGlobals());

describe('scanning (UX-09)', () => {
  it('turns a scanned code into a line with its description, price and line total', async () => {
    serve();
    renderSale();
    await scan('5012345678900');
    expect(cartLines()).toHaveLength(1);
    expect(line()).toContain('Oat milk 1 L');
    expect(line()).toContain('$2.50');
  });

  it('keeps the running total visible at all times, including before anything is scanned (UX-10)', async () => {
    serve();
    renderSale();
    expect(total(), 'an empty cart still states a total').toBe('$0.00');
    await scan('5012345678900');
    expect(total()).toBe('$2.50');
  });

  it('adds each scan as its own line, and sums quantity into the total (UX-09, UX-10)', async () => {
    serve();
    renderSale();
    await scan('5012345678900');
    await scan('5012345678900');
    expect(cartLines()).toHaveLength(2);
    expect(total()).toBe('$5.00');
    setQuantity('3');
    expect(line(0), 'three of $2.50').toContain('$7.50');
    expect(total(), 'only the edited line changes').toBe('$10.00');
  });

  it('moves to the cash field on Enter in an empty scan field, and scans nothing (UX-01)', async () => {
    serve();
    renderSale();
    await scan('5012345678900');
    const called = vi.mocked(fetch).mock.calls.length;
    fireEvent.submit(scanField().closest('form') as HTMLFormElement);
    await waitFor(() => expect(document.activeElement).toBe(cashField()));
    expect(fetch, 'an empty field is not a barcode').toHaveBeenCalledTimes(called);
  });
});

describe('a rejected scan (UX-11)', () => {
  it('puts the message under the field and leaves the cart untouched', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(refused(404, 'not_found', 'No product carries that code.')));
    renderSale();
    await scan('nope');
    expect(alert()).toContain('No product carries that code.');
    expect(cartLines()).toHaveLength(0);
    expect(total()).toBe('$0.00');
  });
});

describe('taking the cash', () => {
  it('refuses cash with more decimals than the currency allows, naming the limit (UX-11)', async () => {
    serve();
    renderSale();
    await scan('5012345678900');
    await pay('2.505');
    expect(alert()).toContain('at most 2 decimal places');
    expect(savedBodies(), 'nothing was sent').toHaveLength(0);
    expect(cartLines(), 'the cart survives the refusal').toHaveLength(1);
  });

  it('takes the total as the tendered amount when the cash field is left empty (UX-01)', async () => {
    serve();
    renderSale();
    await scan('5012345678900');
    await pay();
    await waitFor(() => expect(savedBodies()).toHaveLength(1));
    expect(sent(0).cash.tendered).toBe(250);
  });

  it('sends only quotes and quantities, never an amount, so the server recomputes every figure (BI-30)', async () => {
    serve();
    renderSale();
    await scan('5012345678900');
    await pay('5.00');
    await waitFor(() => expect(savedBodies()).toHaveLength(1));
    expect(sent(0).lines).toEqual([{ quote: 'q-1', quantity: 1 }]);
    expect(JSON.stringify(sent(0)), 'no amount is sent').not.toMatch(/"(amount|price|total)"/);
  });
});

describe('the outcome (UX-21, UX-04, UX-15)', () => {
  it('states the sale number, the total taken and the change', async () => {
    serve();
    renderSale();
    await scan('5012345678900');
    await pay('5.00');
    await completed();
    expect(outcome().textContent).toContain('Total $2.50, cash $5.00');
    expect(outcome().textContent).toContain('Change $2.50');
  });

  it('offers no way to void the completed sale', async () => {
    serve();
    renderSale();
    await scan('5012345678900');
    await pay('5.00');
    await completed();
    expect(screen.queryByRole('button', { name: /void|cancel|undo/i })).toBeNull();
    expect(screen.getAllByRole('button'), 'only the way forward').toHaveLength(1);
  });

  it('announces the outcome to a screen reader (RT-339, UX-51)', async () => {
    serve();
    renderSale();
    await scan('5012345678900');
    await pay('5.00');
    await completed();
    expect(announced()).toContain('Sale 1042 completed');
    expect(announced()).toContain('Change $2.50');
  });
});

describe('a failed save (UX-57)', () => {
  it('keeps the cart and the cash typed, and claims nothing completed', async () => {
    serve(() => SALE);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) =>
      init.method === 'POST' ? refused(409, 'illegal_transition', 'That shift is closed.') : ok(ITEM)));
    renderSale();
    await scan('5012345678900');
    await pay('5.00');
    await waitFor(() => expect(alert()).toContain('That shift is closed.'));
    expect(cartLines(), 'the cart survives').toHaveLength(1);
    expect(cashField().value, 'the cash typed survives').toBe('5.00');
    expect(screen.queryByRole('heading', { name: /completed/ }), 'nothing claims to have completed').toBeNull();
  });
});

describe('one cart is one sale (SM-04)', () => {
  it('sends the same operation id when a save is retried', async () => {
    serve((attempt) => {
      if (attempt === 1) throw new Error('unused');
      return SALE;
    });
    let attempt = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (init.method === 'POST') {
        attempt += 1;
        return attempt === 1 ? refused(409, 'busy', 'Try again.') : ok(SALE);
      }
      return ok(ITEM);
    }));
    renderSale();
    await scan('5012345678900');
    await pay('5.00');
    await waitFor(() => expect(alert()).toContain('Try again.'));
    await pay('5.00');
    await completed();
    expect(savedBodies()).toHaveLength(2);
    expect(sent(0).clientOperationId, 'a retried save is the same sale').toBe(sent(1).clientOperationId);
  });

  it('mints a new operation id for the next customer', async () => {
    serve();
    renderSale();
    await scan('5012345678900');
    await pay('5.00');
    await completed();
    fireEvent.click(screen.getByRole('button', { name: 'Next customer' }));
    expect(cartLines()).toHaveLength(0);
    expect(total()).toBe('$0.00');
    await scan('5012345678900');
    await pay('5.00');
    await waitFor(() => expect(savedBodies()).toHaveLength(2));
    expect(sent(0).clientOperationId).not.toBe(sent(1).clientOperationId);
  });
});

describe('editing the cart', () => {
  it('clamps a quantity to at least one', async () => {
    serve();
    renderSale();
    await scan('5012345678900');
    setQuantity('0');
    expect(line()).toContain('$2.50');
  });

  it('clamps a quantity to at most 9999', async () => {
    serve();
    renderSale();
    await scan('5012345678900');
    setQuantity('99999');
    expect(line(), '9999 at $2.50').toContain('$24,997.50');
    expect(total()).toBe('$24,997.50');
  });

  it('removes a line', async () => {
    serve();
    renderSale();
    await scan('5012345678900');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Oat milk 1 L' }));
    expect(cartLines()).toHaveLength(0);
    expect(total()).toBe('$0.00');
  });
});
