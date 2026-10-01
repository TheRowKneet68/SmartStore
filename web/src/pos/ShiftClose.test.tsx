import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BeginCount, CountDrawer, type Pass } from './ShiftClose.tsx';

/**
 * Closing a shift at the till (cash-management §6; state-machines §22.11). The network is stubbed at `fetch`, never at
 * the `api` module, so the screen, the client and the server's response shapes run together, and every request body
 * is checked as the server would receive it.
 */

const GBP = { code: 'GBP', exponent: 2 };
const COUNTS = 'POST /api/v1/stores/s1/shifts/sh1/counts';
const ACKNOWLEDGE = 'POST /api/v1/stores/s1/shifts/sh1/counts/c1/acknowledge';
const TRANSITIONS = 'POST /api/v1/transitions';
const REASONS = 'GET /api/v1/reason-codes';
const UNACKNOWLEDGED =
  'The latest count differs from the expected amount, and nobody has acknowledged the difference. Acknowledge it with a reason, or count the drawer again.';

type Reply = { status?: number; body: unknown };

/** Answers each `METHOD /api/v1/path`; anything else is a 404 in the server's error shape. Records every call. */
function serve(routes: Record<string, Reply>) {
  const calls: { key: string; body: unknown }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`;
    calls.push({ key, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
    const reply = routes[key] ?? { status: 404, body: { error: { code: 'not_found', message: 'There is nothing at this address.' } } };
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetch);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const pass = (over: Partial<Pass> = {}): Pass => ({
  id: 'c1',
  passNumber: 1,
  countedAmount: 2_200,
  expectedAmount: 2_250,
  variance: -50,
  tolerance: 0,
  acknowledgedBy: null,
  reasonCodeId: null,
  ...over,
});
const balanced = pass({ countedAmount: 2_250, variance: 0 });

const drawer = (canAcknowledge = true, onClosed = vi.fn(), onDone = vi.fn()) =>
  render(<CountDrawer storeId="s1" shiftId="sh1" currency={GBP} canAcknowledge={canAcknowledge} onClosed={onClosed} onDone={onDone} />);
const type = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = (button: string) => fireEvent.submit(screen.getByRole('button', { name: button }).closest('form')!);
const figures = () => [...document.querySelectorAll('dl.figures dd')].map((dd) => dd.textContent);
const alertText = async () => (await screen.findByRole('alert')).textContent;

async function counted(amount: string) {
  type(/Cash counted in the drawer/, amount);
  submit('Submit count');
  await screen.findByText('Expected');
}

describe('counting the drawer (CD-21, CD-22, CD-31, UX-33, UX-34)', () => {
  it('CD-21, CD-31, RT-243, UX-33: the count is blind; nothing says what the drawer should hold until it is submitted', async () => {
    const calls = serve({ [COUNTS]: { status: 201, body: pass() }, [REASONS]: { body: { items: [] } } });
    drawer();
    expect(screen.getByRole('heading', { name: 'Count the drawer' })).toBeTruthy();
    expect(screen.queryByText('Expected')).toBeNull();
    expect(document.body.textContent, 'no expected figure anywhere').not.toContain('22.50');
    expect(calls, 'nothing is fetched before the count').toHaveLength(0);
    await counted('22.00');
    expect(calls[0]).toEqual({ key: COUNTS, body: { countedAmount: 2_200 } });
  });

  it('UX-34, UX-52, CD-22: counted, expected, difference and allowed difference are shown together, and a shortage is named in words beside a symbol', async () => {
    serve({ [COUNTS]: { status: 201, body: pass() }, [REASONS]: { body: { items: [] } } });
    drawer();
    await counted('22');
    expect(figures()).toEqual(['£22.00', '£22.50', '-£0.50', '£0.00']);
    const words = screen.getByText('Short by £0.50. This needs an acknowledgement before the shift can close.');
    expect(words.closest('.notice')?.getAttribute('data-tone')).toBe('warn');
    expect(words.closest('.notice')?.querySelector('[aria-hidden="true"]')?.textContent).toBe('⚠');
  });

  it('UX-52, CD-22: an over count is named "Over by", and a matching count balances and goes straight to the close', async () => {
    serve({ [COUNTS]: { status: 201, body: pass({ countedAmount: 2_300, variance: 50 }) }, [REASONS]: { body: { items: [] } } });
    const first = drawer();
    await counted('23');
    expect(screen.getByText('Over by £0.50. This needs an acknowledgement before the shift can close.')).toBeTruthy();
    first.unmount();

    serve({ [COUNTS]: { status: 201, body: balanced } });
    drawer();
    await counted('22.50');
    const words = screen.getByText('The drawer balances.');
    expect(words.closest('.notice')?.getAttribute('data-tone')).toBe('ok');
    expect(screen.queryByLabelText('Reason for the difference'), 'nothing to acknowledge').toBeNull();
    expect(screen.getByLabelText(/Cash left in the drawer for the next shift/)).toBeTruthy();
  });

  it('BI-01, CD-04: a count with more decimals than the currency has is refused, naming them, and nothing is sent', async () => {
    const calls = serve({});
    drawer();
    type(/Cash counted in the drawer/, '22.005');
    submit('Submit count');
    expect(await alertText()).toBe('Enter the cash counted, with at most 2 decimal places.');
    expect(calls).toHaveLength(0);
  });

  it('SM-57, CD-21: counting again is a new blind pass: the figures leave the screen until it is submitted', async () => {
    serve({ [COUNTS]: { status: 201, body: pass() }, [REASONS]: { body: { items: [] } } });
    drawer();
    await counted('22');
    fireEvent.click(screen.getByRole('button', { name: 'Count again' }));
    expect(screen.getByRole('heading', { name: 'Count the drawer' })).toBeTruthy();
    expect(screen.queryByText('Expected')).toBeNull();
  });
});

describe('acknowledging the difference (CD-23, BI-25, RT-245, UX-08)', () => {
  it('CD-23, BI-25, RT-245: with Cash.Variance.Acknowledge, the difference is acknowledged with a reason from the live list, and only then can the shift close', async () => {
    const calls = serve({
      [COUNTS]: { status: 201, body: pass() },
      [REASONS]: { body: { items: [{ id: 'r1', code: 'SHORT', name: 'Drawer short' }] } },
      [ACKNOWLEDGE]: { body: pass({ acknowledgedBy: 'm1', reasonCodeId: 'r1' }) },
    });
    drawer(true);
    await counted('22');
    await screen.findByRole('option', { name: 'Drawer short' });
    expect(screen.queryByRole('button', { name: 'Close shift' }), 'no close before the acknowledgement').toBeNull();
    submit('Acknowledge the difference');
    expect(await alertText()).toBe('Choose the reason for the difference.');
    expect(calls.some((c) => c.key === ACKNOWLEDGE), 'nothing sent without a reason').toBe(false);
    type('Reason for the difference', 'r1');
    submit('Acknowledge the difference');
    expect(await screen.findByText('Short by £0.50, acknowledged.')).toBeTruthy();
    expect(calls.find((c) => c.key === ACKNOWLEDGE)?.body).toEqual({ reasonCodeId: 'r1' });
    expect(screen.getByRole('button', { name: 'Close shift' })).toBeTruthy();
  });

  it('UX-08, CD-23, UX-55, UX-57: without the key there is no acknowledge control, the till says who must, and a refused close keeps the count on screen with the server\'s words', async () => {
    serve({
      [COUNTS]: { status: 201, body: pass() },
      [TRANSITIONS]: { status: 409, body: { error: { code: 'variance_unacknowledged', message: UNACKNOWLEDGED, countId: 'c1' } } },
    });
    drawer(false);
    await counted('22');
    expect(screen.getByText('Ask a manager to acknowledge the difference, then close the shift. Or count the drawer again.')).toBeTruthy();
    expect(screen.queryByLabelText('Reason for the difference')).toBeNull();
    type(/Cash left in the drawer for the next shift/, '100');
    submit('Close shift');
    expect(await alertText()).toBe(UNACKNOWLEDGED);
    expect(figures(), 'the count stays').toEqual(['£22.00', '£22.50', '-£0.50', '£0.00']);
  });
});

describe('closing the shift (CD-20, RT-526)', () => {
  it('CD-20, RT-526: the close declares the float left for the next shift, and the summary shows what was left', async () => {
    const onClosed = vi.fn();
    const onDone = vi.fn();
    const calls = serve({ [COUNTS]: { status: 201, body: balanced }, [TRANSITIONS]: { body: { subject: 'sh1', state: 'Closed', changed: true } } });
    drawer(true, onClosed, onDone);
    await counted('22.50');
    type(/Cash left in the drawer for the next shift/, '100');
    submit('Close shift');
    expect(await screen.findByRole('heading', { name: 'Shift closed' })).toBeTruthy();
    expect(calls.at(-1)).toEqual({ key: TRANSITIONS, body: { machine: 'Shift', event: 'close', subject: 'sh1', payload: { closingFloat: 10_000 } } });
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(figures()).toEqual(['£22.50', '£22.50', '£0.00', '£0.00', '£100.00']);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('CD-20, BI-01: the float must be declared, to the currency\'s decimal places; zero is a declaration', async () => {
    const calls = serve({ [COUNTS]: { status: 201, body: balanced }, [TRANSITIONS]: { body: { subject: 'sh1', state: 'Closed', changed: true } } });
    drawer();
    await counted('22.50');
    const refused = 'Enter the cash left in the drawer for the next shift, with at most 2 decimal places. Enter 0 if none.';
    submit('Close shift');
    expect(await alertText(), 'nothing declared').toBe(refused);
    type(/Cash left in the drawer for the next shift/, '1.234');
    submit('Close shift');
    expect(await alertText(), 'too many decimals').toBe(refused);
    expect(calls.some((c) => c.key === TRANSITIONS)).toBe(false);
    type(/Cash left in the drawer for the next shift/, '0');
    submit('Close shift');
    await screen.findByRole('heading', { name: 'Shift closed' });
    expect(calls.at(-1)?.body).toMatchObject({ payload: { closingFloat: 0 } });
  });
});

describe('asking before the count begins (UX-02, OQ-014)', () => {
  it('UX-02, OQ-014: closing the shift asks first, with the safe choice focused, and begins the count only when asked', async () => {
    const calls = serve({ [TRANSITIONS]: { body: { subject: 'sh1', state: 'Reconciling', changed: true } } });
    const onBegun = vi.fn();
    const onCancel = vi.fn();
    render(<BeginCount shiftId="sh1" onBegun={onBegun} onCancel={onCancel} />);
    expect(document.activeElement?.textContent).toBe('Keep selling');
    fireEvent.click(screen.getByRole('button', { name: 'Keep selling' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Begin counting' }));
    await vi.waitFor(() => expect(onBegun).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([{ key: TRANSITIONS, body: { machine: 'Shift', event: 'begin count', subject: 'sh1' } }]);
  });

  it('UX-55, UX-58: a refused start shows the server\'s words, and stays on the question', async () => {
    const message = 'You do not have access to this: it needs the Shift.Close permission in this store.';
    serve({ [TRANSITIONS]: { status: 403, body: { error: { code: 'forbidden', message } } } });
    const onBegun = vi.fn();
    render(<BeginCount shiftId="sh1" onBegun={onBegun} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Begin counting' }));
    expect(await alertText()).toBe(message);
    expect(onBegun).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Begin counting' })).toBeTruthy();
  });
});
