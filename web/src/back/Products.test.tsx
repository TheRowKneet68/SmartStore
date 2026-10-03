import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serve } from '../test/serve.ts';
import { Products } from './Products.tsx';

/**
 * Products and their variants (`PR-04`, `PR-09`, `PR-47`, `RT-042`, `SS008`, `D2 §4`, `PR-33`, `PR-35`).
 *
 * Three things must hold here: a move is posted to the transition endpoint as an event the machine names, never as a
 * URL of the client's choosing; a change sends only what changed; and a first price is only offered with `Price.Edit`,
 * because the server checks that key separately from creating the variant.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const currency = { code: 'NPR', exponent: 2 };
const HITS = 'GET /api/v1/products?search=cola';
const hits = {
  body: { items: [{ id: 'p1', name: 'TEST-ONLY cola', status: 'Draft', categoryId: 'c1', brandId: null }], next: null },
};
const product = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'TEST-ONLY cola',
  description: null,
  status: 'Draft',
  categoryId: 'c1',
  brandId: null,
  statusChangedAt: '2026-10-01T09:00:00.000Z',
  variants: [
    {
      id: 'v1',
      name: '500ml',
      baseUnitId: 'u1',
      taxCategoryId: 't1',
      archivedAt: null,
      barcodes: [{ id: 'b1', value: '9800000000001', kind: 'EAN13', isPrimary: true }],
    },
  ],
  ...over,
});

const field = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = (name: string, scope: 'form' | 'button' = 'form') => {
  const button = screen.getByRole('button', { name });
  fireEvent.submit(scope === 'form' ? button.closest('form')! : button);
};

/** The search form carries `role="search"`, so it is the form element itself. */
const searchFor = (term: string) => {
  field('Find a product by name', term);
  fireEvent.submit(screen.getByRole('search'));
};

const findTheProduct = async () => {
  searchFor('cola');
  await screen.findByText('TEST-ONLY cola');
  fireEvent.click(screen.getByRole('button', { name: 'Open TEST-ONLY cola' }));
  return screen.findByRole('heading', { name: 'TEST-ONLY cola', level: 1 });
};

describe('finding and adding (PR-04, UX-08)', () => {
  it('a new product is a draft and goes on sale only once a variant has a price', async () => {
    const calls = serve({
      [HITS]: hits,
      'GET /api/v1/categories': { body: { items: [{ id: 'c1', name: 'Drinks' }] } },
      'GET /api/v1/brands': { body: { items: [] } },
      'POST /api/v1/products': { status: 201, body: product() },
      [`GET /api/v1/products/p1`]: { body: product() },
    });
    render(<Products permissions={['Product.View', 'Product.Create']} currency={currency} />);
    searchFor('cola');
    await screen.findByText('TEST-ONLY cola');

    field('Name', 'TEST-ONLY lemonade');
    field('Category', 'c1');
    submit('Add the product');
    expect(calls.find((c) => c.key === 'POST /api/v1/products')?.body).toEqual({
      name: 'TEST-ONLY lemonade',
      categoryId: 'c1',
    });
    expect(await screen.findByText('TEST-ONLY lemonade was added as a draft.')).toBeTruthy();
  });

  it('Product.View alone reads the product and offers nothing on it', async () => {
    serve({ [HITS]: hits, [`GET /api/v1/products/p1`]: { body: product() } });
    render(<Products permissions={['Product.View']} currency={currency} />);
    await findTheProduct();
    expect(screen.queryByRole('button', { name: 'Change this product' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a variant' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Put on sale' })).toBeNull();
  });
});

describe('a change (D2 §4)', () => {
  it('sends only what changed, and refuses a change that changes nothing', async () => {
    const calls = serve({
      [HITS]: hits,
      [`GET /api/v1/products/p1`]: [{ body: product() }, { body: product({ name: 'TEST-ONLY cola water' }) }],
      'GET /api/v1/categories': { body: { items: [{ id: 'c1', name: 'Drinks' }] } },
      'GET /api/v1/brands': { body: { items: [] } },
      'PATCH /api/v1/products/p1': { body: product({ name: 'TEST-ONLY cola water' }) },
    });
    render(<Products permissions={['Product.View', 'Product.Edit']} currency={currency} />);
    await findTheProduct();

    fireEvent.click(screen.getByRole('button', { name: 'Change this product' }));
    await screen.findByRole('heading', { name: 'Change the product' });
    submit('Save the change');
    expect((await screen.findByRole('alert')).textContent).toBe('Nothing has changed.');
    expect(calls.some((c) => c.key === 'PATCH /api/v1/products/p1'), 'nothing sent').toBe(false);

    field('Name', 'TEST-ONLY cola water');
    submit('Save the change');
    expect(calls.find((c) => c.key === 'PATCH /api/v1/products/p1')?.body).toEqual({ name: 'TEST-ONLY cola water' });
  });
});

describe('moves (SM-02, §8.4, PR-47)', () => {
  it('offers the machine’s own edges and posts the event, not a URL', async () => {
    const calls = serve({
      [HITS]: hits,
      [`GET /api/v1/products/p1`]: [{ body: product() }, { body: product({ status: 'Active' }) }],
      'POST /api/v1/transitions': { body: { ok: true } },
    });
    render(<Products permissions={['Product.View', 'Product.Edit']} currency={currency} />);
    await findTheProduct();

    expect(screen.getByRole('button', { name: 'Put on sale' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Discontinue' }), 'a draft cannot be discontinued').toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Put on sale' }));

    expect(calls.find((c) => c.key === 'POST /api/v1/transitions')?.body).toEqual({ machine: 'Product', event: 'activate', subject: 'p1' });
    expect(await screen.findByRole('button', { name: 'Hide from the till' })).toBeTruthy();
  });

  it('an archived product is the end of its life and says so', async () => {
    serve({ [HITS]: hits, [`GET /api/v1/products/p1`]: { body: product({ status: 'Archived' }) } });
    render(<Products permissions={['Product.View', 'Product.Edit']} currency={currency} />);
    await findTheProduct();
    expect(await screen.findByText(/nothing moves it back/)).toBeTruthy();
  });
});

describe('variants (RT-042, SS008, PR-33, PR-35)', () => {
  it('a first price is offered only with Price.Edit, and is sent in minor units', async () => {
    const calls = serve({
      [HITS]: hits,
      [`GET /api/v1/products/p1`]: [{ body: product() }, { body: product({ variants: [] }) }],
      'GET /api/v1/units': { body: { items: [{ id: 'u1', name: 'Bottle' }] } },
      'GET /api/v1/tax-categories': { body: { items: [{ id: 't1', name: 'Standard' }] } },
      'POST /api/v1/products/p1/variants': { status: 201, body: { id: 'v2' } },
    });
    render(<Products permissions={['Product.View', 'Product.Create']} currency={currency} />);
    await findTheProduct();

    expect(screen.queryByLabelText(/First price/), 'Price.Edit is not held').toBeNull();
    await screen.findByRole('option', { name: 'Bottle' }); // the units load after the product does
    field('Sold by', 'u1');
    submit('Add the variant');
    expect(calls.find((c) => c.key === 'POST /api/v1/products/p1/variants')?.body).toEqual({ baseUnitId: 'u1' });
  });

  it('with Price.Edit the price is parsed exactly, and a stray decimal place is refused', async () => {
    const calls = serve({
      [HITS]: hits,
      [`GET /api/v1/products/p1`]: [{ body: product() }, { body: product({ variants: [] }) }],
      'GET /api/v1/units': { body: { items: [{ id: 'u1', name: 'Bottle' }] } },
      'GET /api/v1/tax-categories': { body: { items: [{ id: 't1', name: 'Standard' }] } },
      'POST /api/v1/products/p1/variants': { status: 201, body: { id: 'v2' } },
    });
    render(<Products permissions={['Product.View', 'Product.Create', 'Price.Edit']} currency={currency} />);
    await findTheProduct();

    await screen.findByRole('option', { name: 'Bottle' }); // the units load after the product does
    field('Sold by', 'u1');
    field(/First price/, '12.345');
    submit('Add the variant');
    expect((await screen.findByRole('alert')).textContent).toBe('Enter the price in NPR, with at most 2 decimal places.');
    expect(calls.some((c) => c.key === 'POST /api/v1/products/p1/variants'), 'nothing sent').toBe(false);

    field(/First price/, '12.30');
    submit('Add the variant');
    expect(calls.find((c) => c.key === 'POST /api/v1/products/p1/variants')?.body).toEqual({ baseUnitId: 'u1', price: { amount: 1230 } });
  });

  // The server needs both keys to record a cost (Product.Edit, and Product.Cost.View beside it), so the screen offers it only with both.
  it('the standard cost needs Product.Cost.View with Product.Edit, and is only ever a new version', async () => {
    const calls = serve({
      [HITS]: hits,
      [`GET /api/v1/products/p1`]: { body: product() },
      'GET /api/v1/units': { body: { items: [{ id: 'u1', name: 'Bottle' }] } },
      'GET /api/v1/tax-categories': { body: { items: [{ id: 't1', name: 'Standard' }] } },
      'POST /api/v1/variants/v1/costs': { status: 201, body: { id: 'c9' } },
    });
    const { unmount } = render(<Products permissions={['Product.View', 'Product.Edit']} currency={currency} />);
    await findTheProduct();
    expect(screen.queryByRole('button', { name: 'Set the standard cost' }), 'Product.Edit alone does not see cost').toBeNull();
    unmount();

    render(<Products permissions={['Product.View', 'Product.Cost.View']} currency={currency} />);
    await findTheProduct();
    expect(screen.queryByRole('button', { name: 'Set the standard cost' }), 'Product.Cost.View alone cannot record one').toBeNull();
    cleanup();

    render(<Products permissions={['Product.View', 'Product.Edit', 'Product.Cost.View']} currency={currency} />);
    await findTheProduct();
    const cost = within(screen.getByRole('form', { name: /Standard cost for/ }));
    fireEvent.change(cost.getByLabelText('What this costs you (NPR)'), { target: { value: '10' } });
    fireEvent.submit(cost.getByRole('button', { name: 'Set the standard cost' }).closest('form')!);
    expect(calls.find((c) => c.key === 'POST /api/v1/variants/v1/costs')?.body).toEqual({ amount: 1000 });
  });

  it('a barcode is archived rather than deleted, so its value can be issued again', async () => {
    const calls = serve({
      [HITS]: hits,
      [`GET /api/v1/products/p1`]: [{ body: product() }, { body: product({ variants: [{ ...product().variants[0]!, barcodes: [] }] }) }],
      'GET /api/v1/units': { body: { items: [{ id: 'u1', name: 'Bottle' }] } },
      'GET /api/v1/tax-categories': { body: { items: [{ id: 't1', name: 'Standard' }] } },
      'POST /api/v1/barcodes/b1/archive': { body: { ok: true } },
    });
    render(<Products permissions={['Product.View', 'Product.Edit']} currency={currency} />);
    await findTheProduct();

    fireEvent.click(screen.getByRole('button', { name: 'Archive the barcode 9800000000001 of TEST-ONLY cola — 500ml' }));
    expect(calls.map((c) => c.key)).toContain('POST /api/v1/barcodes/b1/archive');
    expect(calls.some((c) => c.key.startsWith('DELETE')), 'nothing is deleted (`PR-09`)').toBe(false);
    expect(await screen.findByText(/was archived, so its value can be issued again/)).toBeTruthy();
  });
});
