import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serve } from '../test/serve.ts';
import { Stock } from './Stock.tsx';

/**
 * Stock on hand, the movement ledger and the store's locations (`IV-06`, `IV-12`, `MS-16`, `MS-17`, `D-03`). Balances
 * need `Inventory.View`, the ledger `Inventory.Ledger.View`: a tab whose key is not held is left out rather than offered
 * and refused (`UX-05`). The ledger pages by the last sequence shown and never edits a movement — a reversal is a new
 * row.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const STORE = 's1';
const LOCATIONS = 'GET /api/v1/stores/s1/locations';
const locations = {
  body: {
    items: [
      { id: 'l1', code: 'SHOP', name: 'Shop floor', locationType: 'Store', isSellable: true, warehouseCode: 'MAIN', warehouseName: 'Main' },
      { id: 'l2', code: 'CENTRAL', name: 'Central store', locationType: 'Central', isSellable: false, warehouseCode: 'CENT', warehouseName: 'Central' },
    ],
  },
};

const balance = {
  body: {
    items: [
      {
        variantId: 'v1',
        product: 'TEST-ONLY cola',
        variant: '500ml',
        locationId: 'l1',
        location: 'SHOP — Shop floor',
        onHand: '7.000',
        movementCount: 3,
        lastMovementAt: '2026-10-01T09:00:00.000Z',
      },
    ],
  },
};

const movement = {
  body: {
    items: [
      {
        id: 'm2',
        createdAt: '2026-10-01T09:00:00.000Z',
        movementType: 'OPENING_BALANCE',
        direction: 'In',
        quantity: '10.000',
        resultingBalance: '10.000',
        variantId: 'v1',
        locationId: 'l1',
        product: 'TEST-ONLY cola',
        variant: '500ml',
        createdBy: 'e1',
        reversesMovementId: null,
      },
    ],
    before: 42,
  },
};

describe('balances (IV-05, UX-05)', () => {
  it('Inventory.View alone reads balances, and narrows them by location when asked', async () => {
    const calls = serve({
      [LOCATIONS]: locations,
      'GET /api/v1/stores/s1/stock': balance,
      'GET /api/v1/stores/s1/stock?locationId=l1': balance,
    });
    render(<Stock storeId={STORE} permissions={['Inventory.View']} />);
    expect(await screen.findByText('TEST-ONLY cola — 500ml')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Movement ledger' }), 'the ledger needs its own key').toBeNull();

    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'l1' } });
    expect(calls.map((c) => c.key)).toContain('GET /api/v1/stores/s1/stock?locationId=l1');
  });
});

describe('the ledger (IV-06, IV-12, §18.5)', () => {
  it('is not offered without Inventory.Ledger.View, and pages by the last sequence when it is', async () => {
    const calls = serve({
      [LOCATIONS]: locations,
      'GET /api/v1/stores/s1/movements': movement,
      'GET /api/v1/stores/s1/movements?before=42': { body: { items: [], before: null } },
    });
    render(<Stock storeId={STORE} permissions={['Inventory.Ledger.View']} startOn="ledger" />);
    expect(await screen.findByText(/opening balance/)).toBeTruthy();
    expect(screen.getByText('In — added')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stock on hand' }), 'balances need Inventory.View').toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show earlier movements' }));
    await screen.findByText('Nothing has moved here.');
    expect(calls.map((c) => c.key)).toContain('GET /api/v1/stores/s1/movements?before=42');
  });

  it('says a reversal is a movement of its own, not an edited one', async () => {
    serve({
      [LOCATIONS]: locations,
      'GET /api/v1/stores/s1/movements': {
        body: { ...movement.body, items: [{ ...movement.body.items[0]!, movementType: 'ADJUSTMENT', reversesMovementId: 'm1' }] },
      },
    });
    render(<Stock storeId={STORE} permissions={['Inventory.Ledger.View']} startOn="ledger" />);
    expect(await screen.findByText(/reverses an earlier movement/)).toBeTruthy();
  });
});

describe('locations (MS-16, MS-17, D-03)', () => {
  it('tells a sellable location from one that holds stock only', async () => {
    serve({ [LOCATIONS]: locations });
    render(<Stock storeId={STORE} permissions={['Inventory.View']} startOn="locations" />);
    expect(await screen.findByText('No — stock only')).toBeTruthy();
    expect(screen.getByText('Yes')).toBeTruthy();
    expect(screen.getByText(/CENT — Central/), 'a central location names the warehouse it belongs to').toBeTruthy();
  });
});

describe('what is offered (UX-05)', () => {
  it('without Inventory.View the screen says so and asks for nothing', async () => {
    const calls = serve({});
    render(<Stock storeId={STORE} permissions={['Price.Edit']} />);
    expect(await screen.findByText(/You do not have permission to read stock/)).toBeTruthy();
    expect(calls.map((c) => c.key)).toEqual([]);
  });
});
