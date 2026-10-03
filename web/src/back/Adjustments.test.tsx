import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serve } from '../test/serve.ts';
import { Adjustments } from './Adjustments.tsx';

/**
 * Corrections, write-offs and opening stock (`IV-14`, `IV-15`, `UX-36`, `UX-37`, `SM-06`, `BI-26`, `SS018`). The two ways
 * of entering a line must stay apart: a correction is what you counted, the others say what happened. The server's
 * refusals and its arithmetic are its own tests' to prove; what is proved here is what this screen sends.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const STORE = 's1';
const reasons = { body: { items: [{ id: 'r1', code: 'DAMAGED', name: 'Damaged in the shop' }] } };
const locations = { body: { items: [{ id: 'l1', code: 'SHOP', name: 'Shop floor' }] } };
const empty = { body: { items: [] } };
const REASONS = 'GET /api/v1/reason-codes';
const LOCATIONS = 'GET /api/v1/stores/s1/locations';
const PRODUCTS = 'GET /api/v1/products?search=cola';
const hits = { body: { items: [{ id: 'p1', name: 'TEST-ONLY cola', status: 'Active', categoryId: 'c1', brandId: null }], next: null } };
const listed = (status: string) => ({
  body: { items: [{ id: 'a1', documentNumber: 'ADJ-0001', status, reason: 'Damaged in the shop', statusChangedAt: '2026-10-01T09:00:00.000Z', lines: 0 }] },
});

const document = (status: string, lines: unknown[] = []) => ({
  body: {
    id: 'a1',
    documentNumber: 'ADJ-0001',
    status,
    reason: 'Damaged in the shop',
    note: null,
    createdBy: 'e1',
    submittedBy: null,
    approvedBy: null,
    statusChangedAt: '2026-10-01T09:00:00.000Z',
    lines,
  },
});

const line = {
  id: 'l9',
  product: 'TEST-ONLY cola',
  variant: '500ml',
  movementType: 'DAMAGE',
  direction: 'Out',
  quantity: '2',
  countedQuantity: null,
  systemQuantity: null,
};

const field = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = (button: string) => fireEvent.submit(screen.getByRole('button', { name: button }).closest('form')!);

/** Opens the one document in the list and chooses the variant, so the quantity is the only thing left to fill in. */
async function openAndChoose() {
  fireEvent.click(within((await screen.findByText('ADJ-0001')).closest('tr')!).getByRole('button', { name: /Open/ }));
  await screen.findByText('Lines');
  field('Find the product', 'cola');
  await screen.findByLabelText('Product');
  field('Product', 'p1');
  await screen.findByLabelText('Variant');
  field('Variant', 'v1');
  field('Location', 'l1');
}

const variants = {
  body: { id: 'p1', name: 'TEST-ONLY cola', variants: [{ id: 'v1', name: '500ml', archivedAt: null }] },
};

describe('lines (UX-36, UX-37, IV-15)', () => {
  it('a correction sends what was counted, and never a signed quantity', async () => {
    const calls = serve({
      'GET /api/v1/stores/s1/adjustments': listed('Draft'),
      'GET /api/v1/stores/s1/adjustments/a1': document('Draft'),
      [REASONS]: reasons,
      [LOCATIONS]: locations,
      [PRODUCTS]: hits,
      'GET /api/v1/products/p1': variants,
      'POST /api/v1/stores/s1/adjustments/a1/lines': { status: 201, body: document('Draft').body },
    });
    render(<Adjustments storeId={STORE} permissions={['Inventory.View', 'Inventory.Adjust']} />);
    await openAndChoose();

    field('What you counted', '-2');
    submit('Add the line');
    expect((await screen.findByRole('alert')).textContent).toBe('Enter the quantity as a plain number, with no sign and up to four decimal places.');
    expect(calls.some((c) => c.key.startsWith('POST') && c.key.includes('/lines')), 'nothing sent').toBe(false);

    field('What you counted', '7');
    submit('Add the line');
    expect(calls.find((c) => c.key === 'POST /api/v1/stores/s1/adjustments/a1/lines')?.body).toEqual({
      variantId: 'v1',
      locationId: 'l1',
      countedQuantity: '7',
    });
  });

  it('a write-off says what happened instead, and never sends a counted quantity', async () => {
    const calls = serve({
      'GET /api/v1/stores/s1/adjustments': listed('Draft'),
      'GET /api/v1/stores/s1/adjustments/a1': document('Draft'),
      [REASONS]: reasons,
      [LOCATIONS]: locations,
      [PRODUCTS]: hits,
      'GET /api/v1/products/p1': variants,
      'POST /api/v1/stores/s1/adjustments/a1/lines': { status: 201, body: document('Draft').body },
    });
    render(<Adjustments storeId={STORE} permissions={['Inventory.View', 'Inventory.Adjust']} />);
    await openAndChoose();

    fireEvent.click(screen.getByLabelText(/A write-off or a find/));
    expect(screen.queryByLabelText('What you counted'), 'a write-off is not a count').toBeNull();
    field('How much', '3');
    submit('Add the line');
    expect(calls.find((c) => c.key === 'POST /api/v1/stores/s1/adjustments/a1/lines')?.body).toEqual({
      variantId: 'v1',
      locationId: 'l1',
      movementType: 'DAMAGE',
      quantity: '3',
    });
  });
});

describe('moves (SM-06, BI-26, IV-12)', () => {
  it('only the edges the machine has are offered, each sent as the event the server names', async () => {
    const calls = serve({
      'GET /api/v1/stores/s1/adjustments': listed('Draft'),
      'GET /api/v1/stores/s1/adjustments/a1': [
        document('Draft', [line]),
        document('PendingApproval', [line]),
        document('Approved', [line]),
        document('Posted', [line]),
      ],
      [REASONS]: reasons,
      [LOCATIONS]: locations,
      'POST /api/v1/transitions': { body: { ok: true } },
    });
    render(<Adjustments storeId={STORE} permissions={['Inventory.View', 'Inventory.Adjust']} />);
    fireEvent.click(within((await screen.findByText('ADJ-0001')).closest('tr')!).getByRole('button', { name: /Open/ }));
    await screen.findByRole('button', { name: 'Send for approval' });
    expect(screen.queryByRole('button', { name: /^Post/ }), 'nothing is posted before approval').toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }));
    expect(await screen.findByRole('button', { name: 'Approve it' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Cancel/ }), 'a waiting document is not the author’s to cancel').toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Approve it' }));
    expect(await screen.findByRole('button', { name: 'Post it, moving the stock' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Post it, moving the stock' }));

    await screen.findByRole('button', { name: 'Reverse it' });
    expect(calls.filter((c) => c.key === 'POST /api/v1/transitions').map((c) => (c.body as { event: string }).event)).toEqual([
      'submit',
      'approve',
      'post',
    ]);
    expect((calls[0] ? (calls.find((c) => c.key === 'POST /api/v1/transitions')?.body as { machine: string }).machine : '')).toBe('StockAdjustment');
  });

  it('lines may only be added or removed while the document is a draft', async () => {
    serve({
      'GET /api/v1/stores/s1/adjustments': { body: { items: [{ ...listed('Posted').body.items[0], lines: 1 }] } },
      'GET /api/v1/stores/s1/adjustments/a1': document('Posted', [line]),
      [REASONS]: reasons,
      [LOCATIONS]: locations,
    });
    render(<Adjustments storeId={STORE} permissions={['Inventory.View', 'Inventory.Adjust']} />);
    fireEvent.click(within((await screen.findByText('ADJ-0001')).closest('tr')!).getByRole('button', { name: /Open/ }));
    expect(await screen.findByText(/Lines can only be added or removed while the document is a draft/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove the line for TEST-ONLY cola' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reverse it' })).toBeTruthy();
  });
});

describe('what is offered (UX-05, inventory-domain s5)', () => {
  it('opening stock needs Config.Organization, and the screen says so instead of starting one', async () => {
    serve({ 'GET /api/v1/stores/s1/adjustments': empty, [REASONS]: empty, [LOCATIONS]: empty });
    render(<Adjustments storeId={STORE} permissions={['Inventory.View', 'Inventory.Adjust']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opening stock' }));
    expect(await screen.findByText(/Config.Organization/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Start/ })).toBeNull();
  });

  it('Inventory.View alone reads the documents but starts none', async () => {
    serve({ 'GET /api/v1/stores/s1/adjustments': empty, [REASONS]: empty });
    render(<Adjustments storeId={STORE} permissions={['Inventory.View']} />);
    expect(await screen.findByText(/your role does not have it/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Start/ })).toBeNull();
  });
});
