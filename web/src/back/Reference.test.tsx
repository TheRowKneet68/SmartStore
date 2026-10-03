import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serve } from '../test/serve.ts';
import { ReferenceData } from './Reference.tsx';

/**
 * Units, tax categories and brands (product-domain §3, §4, §6). Each change is offered only with its key (`UX-05`,
 * `UX-08`); the server's refusals are the server's tests' to prove.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const each = { id: 'u1', code: 'EA', name: 'Each', pluralName: null, quantityKind: 'Countable', scale: 0 };
const kilo = { id: 'u2', code: 'KG', name: 'Kilogram', pluralName: null, quantityKind: 'Measurable', scale: 3 };
const standard = { id: 't1', code: 'STD', name: 'TEST-ONLY standard', ratesInForce: [{ jurisdiction: 'TEST-ONLY', ratePercent: '10.0000', effectiveFrom: '2026-10-01T00:00:00.000Z' }] };
const zero = { id: 't2', code: 'ZERO', name: 'TEST-ONLY zero', ratesInForce: [] };
const drinks = { id: 'c1', parentId: null, name: 'TEST-ONLY drinks', sortOrder: 1, archivedAt: null };
const gone = { id: 'c2', parentId: null, name: 'TEST-ONLY archived', sortOrder: 2, archivedAt: '2026-10-01T00:00:00.000Z' };
const UNITS = 'GET /api/v1/units';
const TAX = 'GET /api/v1/tax-categories';
const BRANDS = 'GET /api/v1/brands';
const CATEGORIES = 'GET /api/v1/categories';

const rowOf = async (text: string) => (await screen.findByText(text)).closest('tr')!;
const submit = (button: string) => fireEvent.submit(screen.getByRole('button', { name: button }).closest('form')!);
const field = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('units (PR-14, PR-15, RT-491)', () => {
  it('PR-15: a unit is added with its kind and decimal places; a countable unit with decimal places is said first, and not sent', async () => {
    const calls = serve({ [UNITS]: [{ body: { items: [each] } }, { body: { items: [each, kilo] } }], [BRANDS]: { body: { items: [] } }, [CATEGORIES]: { body: { items: [] } }, 'POST /api/v1/units': { status: 201, body: { id: 'u2' } } });
    render(<ReferenceData permissions={['Product.View', 'Product.Create']} />);
    const row = within(await rowOf('EA'));
    expect(row.getByText('Countable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add a unit' }));
    field('Code', 'KG');
    field('Name', 'Kilogram');
    field('Decimal places', '3');
    submit('Add the unit');
    expect((await screen.findByRole('alert')).textContent).toBe('A countable unit has no decimal places.');
    expect(calls.some((c) => c.key === 'POST /api/v1/units')).toBe(false);
    field('Kind', 'Measurable');
    submit('Add the unit');
    expect(await screen.findByText('The unit KG was added.')).toBeTruthy();
    expect(calls.find((c) => c.key === 'POST /api/v1/units')?.body).toEqual({ code: 'KG', name: 'Kilogram', pluralName: null, quantityKind: 'Measurable', scale: 3 });
    expect(within(await rowOf('KG')).getByText('Measurable')).toBeTruthy();
  });

  it("PR-14, RT-491: a change sends only what changed; a change the server refuses is said in the server's words", async () => {
    const calls = serve({
      [UNITS]: [{ body: { items: [each] } }, { body: { items: [{ ...each, name: 'Each one' }] } }],
[BRANDS]: { body: { items: [] } },
      [CATEGORIES]: { body: { items: [] } },
      'PATCH /api/v1/units/u1': [
        { body: { id: 'u1' } },
        { status: 409, body: { error: { code: 'SS021', message: 'This unit has already been used, so its kind cannot change.' } } },
      ],
    });
    render(<ReferenceData permissions={['Product.View', 'Product.Edit']} />);
    fireEvent.click(within(await rowOf('EA')).getByRole('button', { name: 'Change the unit EA' }));
    submit('Save the change');
    expect((await screen.findByRole('alert')).textContent, 'nothing to send').toBe('Nothing has changed.');
    field('Name', 'Each one');
    submit('Save the change');
    expect(await screen.findByText('The unit EA was changed.')).toBeTruthy();
    expect(calls.find((c) => c.key === 'PATCH /api/v1/units/u1')?.body, 'only what changed').toEqual({ name: 'Each one' });

    fireEvent.click(within(await rowOf('Each one')).getByRole('button', { name: 'Change the unit EA' }));
    field('Kind', 'Service');
    submit('Save the change');
    const refused = await screen.findByRole('alert');
    expect(refused.textContent).toBe('This unit has already been used, so its kind cannot change.');
    expect(refused.getAttribute('data-kind'), 'a refusal to act on, not a system problem').toBe('user');
    expect(calls.at(-1)?.body).toEqual({ quantityKind: 'Service' });
  });
});

describe('tax categories and rates (PR-37, PR-40, RT-047, D-12)', () => {
  it('RT-047, PR-40, D-12: each category shows its rates in force; a rate is added as a new version, as the decimal typed, from now or from a later time', async () => {
    const zeroRated = { ...zero, ratesInForce: [{ jurisdiction: 'TEST-ONLY', ratePercent: '0.0000', effectiveFrom: '2026-10-01T10:00:00.000Z' }] };
    const calls = serve({
      [TAX]: [{ body: { items: [standard, zero] } }, { body: { items: [standard, zeroRated] } }],
      'POST /api/v1/tax-categories/t2/rates': { status: 201, body: { id: 'x1' } },
      'POST /api/v1/tax-categories/t1/rates': { status: 201, body: { id: 'x2' } },
    });
    render(<ReferenceData permissions={['Tax.View', 'Tax.Edit']} />);
    expect(within(await rowOf('STD')).getByText('TEST-ONLY: 10%')).toBeTruthy();
    expect(within(await rowOf('ZERO')).getByText('None yet')).toBeTruthy();
    expect(screen.getByText('No rate is built in: each is entered here, as your jurisdiction sets it.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add a rate to ZERO' }));
    field('Jurisdiction', 'TEST-ONLY');
    field('Rate (%)', '5,5');
    submit('Add the rate');
    expect((await screen.findByRole('alert')).textContent).toBe('Enter the rate as a percentage, such as 20 or 5.5, with at most 4 decimal places.');
    field('Rate (%)', '0');
    submit('Add the rate');
    expect(await screen.findByText('ZERO has a new rate of 0% for TEST-ONLY, from now.')).toBeTruthy();
    expect(calls.find((c) => c.key === 'POST /api/v1/tax-categories/t2/rates')?.body, 'zero is an exemption, sent as typed').toEqual({ jurisdiction: 'TEST-ONLY', ratePercent: '0' });
    expect(within(await rowOf('ZERO')).getByText('TEST-ONLY: 0%')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add a rate to STD' }));
    expect((screen.getByLabelText('Jurisdiction') as HTMLInputElement).value, "the category's own jurisdiction, ready").toBe('TEST-ONLY');
    field('Rate (%)', '12.5');
    field('Starts (leave empty for now)', '2026-12-01T09:00');
    submit('Add the rate');
    await screen.findByText('STD has a new rate of 12.5% for TEST-ONLY, from the time given.');
    expect(calls.find((c) => c.key === 'POST /api/v1/tax-categories/t1/rates')?.body).toEqual({
      jurisdiction: 'TEST-ONLY',
      ratePercent: '12.5',
      effectiveFrom: new Date('2026-12-01T09:00').toISOString(),
    });
  });

  it('a category is added and renamed; a change sends only what changed', async () => {
    const calls = serve({
      [TAX]: [{ body: { items: [standard] } }, { body: { items: [standard, zero] } }, { body: { items: [standard, { ...zero, name: 'TEST-ONLY exempt' }] } }],
      'POST /api/v1/tax-categories': { status: 201, body: { id: 't2' } },
      'PATCH /api/v1/tax-categories/t2': { body: { id: 't2' } },
    });
    render(<ReferenceData permissions={['Tax.View', 'Tax.Edit']} />);
    await rowOf('STD');
    fireEvent.click(screen.getByRole('button', { name: 'Add a tax category' }));
    field('Code', 'ZERO');
    field('Name', 'TEST-ONLY zero');
    submit('Add the tax category');
    expect(await screen.findByText('The tax category ZERO was added. Add its rate before anything in it can be sold.')).toBeTruthy();
    fireEvent.click(within(await rowOf('ZERO')).getByRole('button', { name: 'Change the tax category ZERO' }));
    field('Name', 'TEST-ONLY exempt');
    submit('Save the change');
    expect(await screen.findByText('The tax category ZERO was changed.')).toBeTruthy();
    expect(calls.find((c) => c.key === 'PATCH /api/v1/tax-categories/t2')?.body).toEqual({ name: 'TEST-ONLY exempt' });
  });
});

describe('categories (PR-04..PR-06, RT-026, SS006)', () => {
  it('a category is added under a parent, an archived one drops off the list, and a change sends only what changed', async () => {
    const calls = serve({
      [UNITS]: { body: { items: [] } },
      [BRANDS]: { body: { items: [] } },
      [CATEGORIES]: [
        { body: { items: [drinks, gone] } },
        { body: { items: [drinks, gone, { id: 'c3', parentId: 'c1', name: 'TEST-ONLY bottled water', sortOrder: 2, archivedAt: null }] } },
        { body: { items: [{ ...drinks, name: 'TEST-ONLY cold drinks' }, gone] } },
      ],
      'POST /api/v1/categories': { status: 201, body: { id: 'c3' } },
      'POST /api/v1/categories/c1/archive': { body: { id: 'c1', archived: true } },
      'PATCH /api/v1/categories/c1': { body: { id: 'c1' } },
    });
    render(<ReferenceData permissions={['Product.View', 'Product.Create', 'Product.Edit']} />);
    await rowOf('TEST-ONLY drinks');
    expect(screen.queryByText('TEST-ONLY archived'), 'an archived category is not offered').toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add a category' }));
    field('Name', 'TEST-ONLY bottled water');
    field('Sits under (leave empty for a top-level category)', 'c1');
    field('Order among its siblings', '2');
    submit('Add the category');
    expect(await screen.findByText('The category TEST-ONLY bottled water was added.')).toBeTruthy();
    expect(calls.find((c) => c.key === 'POST /api/v1/categories')?.body).toEqual({
      name: 'TEST-ONLY bottled water',
      parentId: 'c1',
      sortOrder: 2,
    });
    expect(within(await rowOf('TEST-ONLY bottled water')).getAllByRole('cell')[1]?.textContent, 'the parent is named').toBe('TEST-ONLY drinks');

    fireEvent.click(screen.getByRole('button', { name: 'Archive the category TEST-ONLY drinks' }));
    expect(await screen.findByText('TEST-ONLY drinks was archived. Products still pointing at it keep it.')).toBeTruthy();
    expect(calls.find((c) => c.key === 'POST /api/v1/categories/c1/archive')).toBeTruthy();

    fireEvent.click(within(await rowOf('TEST-ONLY cold drinks')).getByRole('button', { name: 'Change the category TEST-ONLY cold drinks' }));
    submit('Save the change');
    expect((await screen.findByRole('alert')).textContent, 'nothing to send').toBe('Nothing has changed.');
    field('Order among its siblings', '5');
    submit('Save the change');
    expect(await screen.findByText('The category TEST-ONLY cold drinks was changed.')).toBeTruthy();
    expect(calls.find((c) => c.key === 'PATCH /api/v1/categories/c1')?.body).toEqual({ sortOrder: 5 });
  });

  it('UX-08: with the view key alone, categories are shown and nothing is offered', async () => {
    serve({ [UNITS]: { body: { items: [] } }, [BRANDS]: { body: { items: [] } }, [CATEGORIES]: { body: { items: [drinks] } } });
    render(<ReferenceData permissions={['Product.View']} />);
    await rowOf('TEST-ONLY drinks');
    expect(screen.queryByRole('button', { name: /^(Add|Change|Archive)/ })).toBeNull();
  });
});

describe('brands, and what is offered (product-domain s3, UX-05, UX-08)', () => {
  it('a brand is added and renamed', async () => {
    const calls = serve({
      [UNITS]: { body: { items: [] } },
      [BRANDS]: [{ body: { items: [] } }, { body: { items: [{ id: 'b1', name: 'Acme' }] } }, { body: { items: [{ id: 'b1', name: 'ACME Foods' }] } }],
      [CATEGORIES]: { body: { items: [] } },
      'POST /api/v1/brands': { status: 201, body: { id: 'b1' } },
      'PATCH /api/v1/brands/b1': { body: { id: 'b1' } },
    });
    render(<ReferenceData permissions={['Product.View', 'Product.Create', 'Product.Edit']} />);
    expect(await screen.findByText('No brands yet. A product needs none.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add a brand' }));
    field('Brand name', 'Acme');
    submit('Add the brand');
    expect(await screen.findByText('The brand Acme was added.')).toBeTruthy();
    fireEvent.click(within(await rowOf('Acme')).getByRole('button', { name: 'Change the brand Acme' }));
    field('Brand name', 'ACME Foods');
    submit('Save the change');
    expect(await screen.findByText('The brand ACME Foods was changed.')).toBeTruthy();
    expect(calls.find((c) => c.key === 'PATCH /api/v1/brands/b1')?.body).toEqual({ name: 'ACME Foods' });
  });

  it('UX-08: with the view keys alone, everything is shown and nothing is offered to add or change', async () => {
    serve({ [UNITS]: { body: { items: [each] } }, [TAX]: { body: { items: [standard] } }, [BRANDS]: { body: { items: [{ id: 'b1', name: 'Acme' }] } }, [CATEGORIES]: { body: { items: [drinks] } } });
    render(<ReferenceData permissions={['Product.View', 'Tax.View']} />);
    await rowOf('EA');
    await rowOf('STD');
    await rowOf('Acme');
    expect(screen.queryByRole('button', { name: /^(Add|Change)/ })).toBeNull();
  });
});
