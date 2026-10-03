import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serve } from '../test/serve.ts';
import { PaymentMethods, ReasonCodes } from './Setup.tsx';

/**
 * Reason codes (`BI-25`, `IV-33`, `SS024`) and payment methods (`PY-03`, `PY-05`, `SS045`).
 *
 * Payment methods are the honest case: the server has no route that says whether a method is on at a store, so the
 * screen must not draw a switch that looks like a known state. It says the standing is not read, offers an explicit
 * accept/stop action only where the store key is held, and labels the result as what this session set.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const METHODS = 'GET /api/v1/payment-methods';
const methods = {
  body: {
    items: [
      { id: 'm1', code: 'CASH', name: 'Cash', methodType: 'Cash' },
      { id: 'm2', code: 'CARD', name: 'Card', methodType: 'Card' },
    ],
  },
};
const field = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = (button: string) => fireEvent.submit(screen.getByRole('button', { name: button }).closest('form')!);

describe('reason codes (BI-25, IV-33, SS024)', () => {
  it('reading them needs no key of its own; archiving one needs Config.Organization', async () => {
    const calls = serve({ 'GET /api/v1/reason-codes': { body: { items: [{ id: 'r1', code: 'DAMAGED', name: 'Damaged in the shop' }] } } });
    render(<ReasonCodes canConfigure={false} />);
    expect(await screen.findByText('Damaged in the shop')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Archive/ })).toBeNull();
    expect(calls.map((c) => c.key)).toEqual(['GET /api/v1/reason-codes']);
  });

  it('archives rather than deletes, and says documents already naming it keep it', async () => {
    const calls = serve({
      'GET /api/v1/reason-codes': [
        { body: { items: [{ id: 'r1', code: 'DAMAGED', name: 'Damaged in the shop' }] } },
        { body: { items: [] } },
      ],
      'POST /api/v1/reason-codes/r1/archive': { body: { ok: true } },
    });
    render(<ReasonCodes canConfigure />);
    fireEvent.click(await screen.findByRole('button', { name: 'Archive the reason code Damaged in the shop' }));
    expect(await screen.findByText('Damaged in the shop was archived. Documents that already name it keep it.')).toBeTruthy();
    expect(calls.map((c) => c.key)).toContain('POST /api/v1/reason-codes/r1/archive');
    expect(calls.some((c) => c.key.includes('r1') && c.key.startsWith('DELETE')), 'nothing is deleted (`SS024`)').toBe(false);
  });

  it('a code without a value is refused before anything is sent', async () => {
    const calls = serve({ 'GET /api/v1/reason-codes': { body: { items: [] } } });
    render(<ReasonCodes canConfigure />);
    submit('Add the reason code');
    expect((await screen.findByRole('alert')).textContent).toBe('Give the code a short value, like DAMAGED or CUSTOMER_RETURN.');
    expect(calls.some((c) => c.key === 'POST /api/v1/reason-codes'), 'nothing sent').toBe(false);

    field('Code', 'DAMAGED');
    submit('Add the reason code');
    expect((await screen.findByRole('alert')).textContent).toBe('Say what the reason is for.');
    expect(calls.some((c) => c.key === 'POST /api/v1/reason-codes'), 'still nothing sent').toBe(false);

    field('What it is for', 'Damaged in the shop');
    submit('Add the reason code');
    expect(calls.find((c) => c.key === 'POST /api/v1/reason-codes')?.body).toEqual({ code: 'DAMAGED', name: 'Damaged in the shop' });
  });
});

describe('payment methods (PY-03, PY-05, SS045)', () => {
  it('says the standing is not read instead of drawing a switch that looks known', async () => {
    serve({ [METHODS]: methods });
    render(<PaymentMethods storeId="s1" storeName="Main Street" canSetAtStore />);
    expect(await screen.findAllByText('Not read — the server has no route that says it')).toHaveLength(2);
  });

  it('sets a method at the store explicitly, and shows only what this session set', async () => {
    const calls = serve({ [METHODS]: methods, 'PUT /api/v1/stores/s1/payment-methods/m1': { body: { ok: true } } });
    render(<PaymentMethods storeId="s1" storeName="Main Street" canSetAtStore />);
    fireEvent.click(await screen.findByRole('button', { name: 'Accept Cash at Main Street' }));

    expect(calls.find((c) => c.key === 'PUT /api/v1/stores/s1/payment-methods/m1')?.body).toEqual({ enabled: true });
    expect(await screen.findByText('Cash is now accepted at Main Street.')).toBeTruthy();
    expect(screen.getAllByText(/Accepted here/)).toHaveLength(1);
    expect(screen.getByText('Not read — the server has no route that says it'), 'Card is untouched').toBeTruthy();
  });

  it('without the key in this store, the method may be defined but not set', async () => {
    serve({ [METHODS]: methods });
    render(<PaymentMethods storeId="s1" storeName="Main Street" canSetAtStore={false} />);
    expect(await screen.findByText(/You may define methods but not set one at Main Street/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Accept Cash at Main Street/ })).toBeNull();
  });

  it('a method needs a code and a name before anything is sent', async () => {
    const calls = serve({ [METHODS]: methods });
    render(<PaymentMethods storeId="s1" storeName="Main Street" canSetAtStore />);
    await screen.findByText('Cash');
    submit('Add the payment method');
    expect((await screen.findByRole('alert')).textContent).toBe('Give the method a short code.');
    expect(calls.some((c) => c.key === 'POST /api/v1/payment-methods'), 'nothing sent').toBe(false);
  });
});
