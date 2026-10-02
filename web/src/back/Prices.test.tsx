import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serve } from '../test/serve.ts';
import { Prices, type PriceVersion } from './Prices.tsx';

/**
 * Price history (`PR-32`, `RT-041`). The server's own refusals (zero, the past, below cost) are the server's tests' to
 * prove; this proves they are said in its words.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const NPR = { code: 'NPR', exponent: 2 };
const oat = {
  id: 'p1',
  name: 'Oat milk',
  status: 'Active',
  variants: [
    { id: 'v1', name: '1 L', archivedAt: null, barcodes: [{ value: '012345678905', isPrimary: true }] },
    { id: 'v0', name: 'Retired size', archivedAt: '2026-09-01T00:00:00.000Z', barcodes: [] },
  ],
};
const version = (over: Partial<PriceVersion>): PriceVersion => ({
  id: 'x1',
  amount: 1_200,
  currencyCode: 'NPR',
  minorUnitExponent: 2,
  effectiveFrom: '2026-09-01T09:00:00.000Z',
  started: true,
  setByName: 'Olive Owner',
  ...over,
});
const history = [
  version({ id: 'x3', amount: 1_400, effectiveFrom: '2026-12-01T09:00:00.000Z', started: false, setByName: 'Mona Lee' }),
  version({ id: 'x2', amount: 1_250, effectiveFrom: '2026-10-01T09:00:00.000Z' }),
  version({}),
];
const LIST = 'GET /api/v1/products';
const OAT = 'GET /api/v1/products/p1';
const OAT_PRICES = 'GET /api/v1/variants/v1/prices';
const SET = 'POST /api/v1/variants/v1/prices';

const openOat = async () => fireEvent.click(await screen.findByRole('button', { name: /^Oat milk/ }));
const cells = () => screen.getAllByRole('row').slice(1).map((row) => [...row.querySelectorAll('td')].map((td) => td.textContent));

describe('price history (PR-32, RT-041, UX-52)', () => {
  it("PR-32, RT-041, UX-52: a product found by name shows each live variant's prices, newest first: scheduled, in force or replaced, in words beside a symbol, and who set each", async () => {
    serve({
      [LIST]: { body: { items: [{ id: 'p0', name: 'Bread', status: 'Active' }], next: 'c1' } },
      [`${LIST}?after=c1`]: { body: { items: [{ id: 'p2', name: 'Butter', status: 'Draft' }], next: null } },
      [`${LIST}?search=oat`]: { body: { items: [{ id: 'p1', name: 'Oat milk', status: 'Active' }], next: null } },
      [OAT]: { body: oat },
      [OAT_PRICES]: { body: { items: history } },
    });
    render(<Prices permissions={['Product.View', 'Price.View']} currency={NPR} />);
    await screen.findByRole('button', { name: /^Bread/ });
    fireEvent.click(screen.getByRole('button', { name: 'Show more products' }));
    expect(await screen.findByRole('button', { name: 'Butter (Draft)' }), 'a page at a time').toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show more products' })).toBeNull();

    fireEvent.change(screen.getByLabelText('Find a product by name'), { target: { value: 'oat' } });
    fireEvent.submit(screen.getByRole('search'));
    await openOat();
    expect(await screen.findByRole('heading', { name: 'Oat milk — 1 L · 012345678905' })).toBeTruthy();
    await screen.findByText('Mona Lee');
    expect(cells().map((row) => [row[0], row[2], row[3]])).toEqual([
      ['NPR\u00a014.00', '◐Scheduled', 'Mona Lee'],
      ['NPR\u00a012.50', '●In force', 'Olive Owner'],
      ['NPR\u00a012.00', '○Replaced', 'Olive Owner'],
    ]);
    expect(screen.queryByText(/Retired size/), 'an archived variant is not shown').toBeNull();
    expect(screen.queryByRole('button', { name: 'Set the price' }), 'Price.View alone sets nothing').toBeNull();
  });

  it("PR-32, PR-33: Price.Edit sets a new price from now or later; a malformed amount is said first, and the server's refusal in its words", async () => {
    const calls = serve({
      [LIST]: { body: { items: [{ id: 'p1', name: 'Oat milk', status: 'Active' }], next: null } },
      [OAT]: { body: oat },
      [OAT_PRICES]: [{ body: { items: history } }, { body: { items: [version({ id: 'x4', amount: 1_300, effectiveFrom: '2026-12-15T09:00:00.000Z', started: false }), ...history] } }],
      [SET]: [
        { status: 409, body: { error: { code: 'below_cost', message: 'This price is below the standard cost. That needs approval by another employee, which this version does not have.' } } },
        { status: 201, body: { id: 'x4' } },
      ],
    });
    render(<Prices permissions={['Product.View', 'Price.View', 'Price.Edit']} currency={NPR} />);
    await openOat();
    const form = await screen.findByRole('form', { name: 'New price for Oat milk — 1 L' });
    const amount = within(form).getByLabelText('New price (NPR)');
    fireEvent.change(amount, { target: { value: '12.345' } });
    fireEvent.submit(form);
    expect((await within(form).findByRole('alert')).textContent).toBe('Enter the new price in NPR, with at most 2 decimal places.');
    expect(calls.some((c) => c.key === SET)).toBe(false);

    fireEvent.change(amount, { target: { value: '9' } });
    fireEvent.submit(form);
    await vi.waitFor(() =>
      expect(within(form).getByRole('alert').textContent).toBe('This price is below the standard cost. That needs approval by another employee, which this version does not have.'),
    );

    fireEvent.change(amount, { target: { value: '13' } });
    fireEvent.change(within(form).getByLabelText('Starts (leave empty for now)'), { target: { value: '2026-12-15T09:00' } });
    fireEvent.submit(form);
    expect(await screen.findByText(/^Oat milk — 1 L costs NPR 13\.00 from /)).toBeTruthy();
    expect(calls.filter((c) => c.key === SET).map((c) => c.body)).toEqual([{ amount: 900 }, { amount: 1_300, effectiveFrom: new Date('2026-12-15T09:00').toISOString() }]);
    await vi.waitFor(() => expect(cells()[0]?.[0], 'read again').toBe('NPR\u00a013.00'));
  });
});
