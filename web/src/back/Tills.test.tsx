import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serve } from '../test/serve.ts';
import { StoreSettings, Tills } from './Tills.tsx';

/**
 * Tills and the store's settings versions (`CD-01`, `MS-16`, `RT-423`, `REQ-AU-06`, §2.12).
 *
 * Three keys decide what is on the screen: `Device.View` to read the tills, `Device.Register` to add one, `Device.Edit`
 * to move one through its states. Settings have only `Config.Store` — the catalogue has no read-only key for them — so
 * reading them takes the key that changes them, and a version is a whole snapshot: every field is sent, never a patch.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const STORE = 's1';
const TERMINALS = 'GET /api/v1/stores/s1/terminals';
const terminals = {
  body: {
    items: [
      { id: 't1', code: 'T1', label: 'Till 1', mode: 'Standard', status: 'Registered', sellFromLocationId: 'l1', drawerId: null },
    ],
  },
};

const settings = (over: Record<string, unknown> = {}) => ({
  inForce: {
    taxMode: 'Exclusive',
    negativeStockPolicy: 'BlockNegative',
    returnWindowDays: 7,
    defaultReturnDisposition: 'Sellable',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    createdBy: 'e1',
  },
  scheduled: [],
  ...over,
});

const field = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = (button: string) => fireEvent.submit(screen.getByRole('button', { name: button }).closest('form')!);

describe('tills (RT-423, SM-06, UX-05)', () => {
  it('Device.View reads the tills; without it nothing is fetched', async () => {
    const calls = serve({ [TERMINALS]: terminals });
    render(<Tills storeId={STORE} permissions={['Price.Edit']} />);
    expect(await screen.findByText(/You do not have permission to see this store's tills/)).toBeTruthy();
    expect(calls.map((c) => c.key)).toEqual([]);
  });

  it('a registered till trades only after it is activated, and the move is the Device machine’s', async () => {
    const calls = serve({
      [TERMINALS]: [terminals, { body: { items: [{ ...terminals.body.items[0]!, status: 'Active' }] } }],
      'POST /api/v1/transitions': { body: { ok: true } },
    });
    render(<Tills storeId={STORE} permissions={['Device.View', 'Device.Edit', 'Device.Disable']} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Activate it — Till 1' }));
    submit('Activate it'); // the question comes first, and only the answer moves anything (UX-03)

    expect(calls.find((c) => c.key === 'POST /api/v1/transitions')?.body).toEqual({ machine: 'Device', event: 'activate', subject: 't1' });
    expect(await screen.findByRole('button', { name: 'Disable it — Till 1' })).toBeTruthy();
  });

  it('Device.View alone changes nothing and registers nothing', async () => {
    serve({ [TERMINALS]: terminals });
    render(<Tills storeId={STORE} permissions={['Device.View']} />);
    await screen.findByText('Till 1');
    expect(screen.queryByRole('button', { name: /Activate/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Register/ })).toBeNull();
  });

  it('registering needs a code and a name, and sells from a sellable location only', async () => {
    const calls = serve({
      [TERMINALS]: terminals,
      'GET /api/v1/stores/s1/locations': {
        body: {
          items: [
            { id: 'l1', code: 'SHOP', name: 'Shop floor', isSellable: true },
            { id: 'l2', code: 'CENTRAL', name: 'Central store', isSellable: false },
          ],
        },
      },
      [`POST /api/v1/stores/${STORE}/terminals`]: { status: 201, body: { id: 't2', code: 'T2', label: 'Till 2', mode: 'Standard', status: 'Registered', sellFromLocationId: 'l1', drawerId: 'd2' } },
    });
    render(<Tills storeId={STORE} permissions={['Device.View', 'Device.Register']} />);
    await screen.findByText('Till 1');

    submit('Register the till');
    expect((await screen.findByRole('alert')).textContent).toBe('Give the till a code. It is how the till is known on a receipt.');

    field('Code', 'T2');
    field('Name', 'Till 2');
    const where = await screen.findByLabelText('Sells from');
    expect(within(where).queryByRole('option', { name: /Central/ }), 'a location that cannot sell is not offered').toBeNull();
    field('Sells from', 'l1');
    submit('Register the till');

    expect(calls.find((c) => c.key === 'POST /api/v1/stores/s1/terminals')?.body).toEqual({
      code: 'T2',
      label: 'Till 2',
      sellFromLocationId: 'l1',
    });
  });
});

/**
 * Disabling and retiring a till record a reason (`SS055`, D6 §3), so the screen asks for one before it sends anything,
 * and a person without `Device.Disable` is offered neither (`UX-08`). Putting a disabled till back in service is `activate`
 * under `Device.Disable` with a reason (owner decision D-16, Q6).
 */
describe("a till's states that need a reason (SS055, UX-03, UX-08, HD-32, D-16)", () => {
  const REASONS = 'GET /api/v1/reason-codes';
  const reasons = { body: { items: [{ id: 'r1', code: 'BROKEN', name: 'Broken' }] } };
  const active = { body: { items: [{ ...terminals.body.items[0]!, status: 'Active' }] } };
  const disabled = { body: { items: [{ ...terminals.body.items[0]!, status: 'Disabled' }] } };

  it('disabling asks the question and a reason, and sends neither until both are given', async () => {
    const calls = serve({
      [TERMINALS]: [active, { body: { items: [{ ...terminals.body.items[0]!, status: 'Disabled' }] } }],
      [REASONS]: reasons,
      'POST /api/v1/transitions': { body: { ok: true } },
    });
    render(<Tills storeId={STORE} permissions={['Device.View', 'Device.Disable']} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Disable it — Till 1' }));

    expect(screen.getByText(/Disable this till\? It will sell nothing and open no shift/), 'the question names the consequence (UX-03)').toBeTruthy();
    expect(calls.some((c) => c.key === 'POST /api/v1/transitions'), 'nothing sent before the reason').toBe(false);

    submit('Disable it');
    expect((await screen.findByRole('alert')).textContent).toBe('Choose the reason, so the record says why.');
    expect(calls.some((c) => c.key === 'POST /api/v1/transitions'), 'nothing sent without a reason').toBe(false);

    fireEvent.change(await screen.findByLabelText('Reason'), { target: { value: 'r1' } });
    submit('Disable it');
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'POST /api/v1/transitions')?.body).toEqual({
        machine: 'Device',
        event: 'disable',
        subject: 't1',
        reasonCodeId: 'r1',
      }),
    );
  });

  it('Device.Edit does not disable a till, and Device.Disable does not retire one', async () => {
    serve({ [TERMINALS]: active });
    const { unmount } = render(<Tills storeId={STORE} permissions={['Device.View', 'Device.Edit']} />);
    await screen.findByText('Till 1');
    expect(screen.queryByRole('button', { name: /Disable/ }), 'Device.Disable is the only key that disables').toBeNull();
    expect(screen.getByRole('button', { name: 'Retire it — Till 1' }), 'Device.Edit retires').toBeTruthy();
    unmount();

    render(<Tills storeId={STORE} permissions={['Device.View', 'Device.Disable']} />);
    await screen.findByText('Till 1');
    expect(screen.queryByRole('button', { name: /Retire/ }), 'retiring needs Device.Edit').toBeNull();
  });

  it('D-16 Q6, HD-32: a disabled till is put back in service by Device.Disable, with a reason, sent as the activate event', async () => {
    const calls = serve({
      [TERMINALS]: [disabled, active],
      [REASONS]: reasons,
      'POST /api/v1/transitions': { body: { ok: true } },
    });
    render(<Tills storeId={STORE} permissions={['Device.View', 'Device.Disable']} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Put it back in service — Till 1' }));
    expect(screen.getByText(/It can sell and open a shift again/), 'the question names the consequence (UX-03)').toBeTruthy();
    submit('Put it back in service');
    expect((await screen.findByRole('alert')).textContent).toBe('Choose the reason, so the record says why.');
    expect(calls.some((c) => c.key === 'POST /api/v1/transitions'), 'nothing sent without a reason').toBe(false);
    fireEvent.change(await screen.findByLabelText('Reason'), { target: { value: 'r1' } });
    submit('Put it back in service');
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'POST /api/v1/transitions')?.body).toEqual({ machine: 'Device', event: 'activate', subject: 't1', reasonCodeId: 'r1' }),
    );
    expect(await screen.findByText('The till is back in service. It can sell and open a shift again.')).toBeTruthy();
  });

  it('D-16 Q6: Device.Edit does not put a disabled till back, and the screen says whose key it is', async () => {
    serve({ [TERMINALS]: disabled, [REASONS]: reasons });
    render(<Tills storeId={STORE} permissions={['Device.View', 'Device.Edit']} />);
    await screen.findByText('Till 1');
    expect(screen.queryByRole('button', { name: /back in service/ })).toBeNull();
    expect(screen.getByText(/needs Device\.Disable, the permission that took it out/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retire it — Till 1' }), 'Device.Edit still retires').toBeTruthy();
  });

  it('a retired till offers nothing and is not deleted (HD-08, BI-40)', async () => {
    const calls = serve({ [TERMINALS]: { body: { items: [{ ...terminals.body.items[0]!, status: 'Retired' }] } } });
    render(<Tills storeId={STORE} permissions={['Device.View', 'Device.Edit', 'Device.Disable']} />);
    await screen.findByText('Till 1');
    expect(screen.getByText('Retired. Nothing moves it back.')).toBeTruthy();
    expect(calls.filter((c) => c.key !== TERMINALS).map((c) => c.key), 'nothing was asked of the server').toEqual([]);
  });
});

describe('store settings (REQ-AU-06, AU-05, §2.12)', () => {
  it('reads nothing without Config.Store, and says which key is missing', async () => {
    const calls = serve({});
    render(<StoreSettings storeId={STORE} canSet={false} />);
    expect(await screen.findByText(/Reading these settings takes `Config.Store`/)).toBeTruthy();
    expect(calls.map((c) => c.key)).toEqual([]);
  });

  it('a new version sends the whole snapshot, and who set it is never taken from the form', async () => {
    const calls = serve({
      [`GET /api/v1/stores/${STORE}/settings`]: [
        { body: settings() },
        { body: settings({ inForce: { ...settings().inForce, taxMode: 'Inclusive' } }) },
      ],
      [`POST /api/v1/stores/${STORE}/settings`]: { status: 201, body: settings().inForce },
    });
    render(<StoreSettings storeId={STORE} canSet />);
    await screen.findByText('Tax is added on top');

    field('Tax', 'Inclusive');
    submit('Set these settings');
    expect(calls.find((c) => c.key === 'POST /api/v1/stores/s1/settings')?.body).toEqual({
      taxMode: 'Inclusive',
      negativeStockPolicy: 'BlockNegative',
      returnWindowDays: 7,
      defaultReturnDisposition: 'Sellable',
    });
    expect((await screen.findAllByText('Prices include tax')).length, 'the new version is read back').toBeGreaterThan(0);
  });

  it('a return window that is not a whole number of days is refused before anything is sent', async () => {
    const calls = serve({ [`GET /api/v1/stores/${STORE}/settings`]: { body: settings() } });
    render(<StoreSettings storeId={STORE} canSet />);
    await screen.findByText('Tax is added on top');

    field('Return window, in days', '4.5');
    submit('Set these settings');
    expect((await screen.findByRole('alert')).textContent).toBe('The return window is a whole number of days, between 0 and 32767.');
    expect(calls.some((c) => c.key === 'POST /api/v1/stores/s1/settings'), 'nothing sent').toBe(false);
  });
});
