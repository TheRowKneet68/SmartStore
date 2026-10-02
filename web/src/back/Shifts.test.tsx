import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShiftReview, type ShiftAnswers } from './Shifts.tsx';

/**
 * The shift screen for someone who may see counts and variance history (`Cash.Count.View`; cash-management §8). The
 * network is stubbed at `fetch`, never at the `api` module, so the screen, the client and the server's response shapes
 * run together.
 */

const NPR = { code: 'NPR', exponent: 2 };
const LIST = 'GET /api/v1/stores/s1/shifts';
const DETAIL = 'GET /api/v1/stores/s1/shifts/sh2';
const REASONS = 'GET /api/v1/reason-codes';
const ACKNOWLEDGE = 'POST /api/v1/stores/s1/shifts/sh2/counts/c2/acknowledge';

type Reply = { status?: number; body: unknown };

/** Answers each `METHOD /api/v1/path`; a list of replies is given in turn, the last one repeating. Records every call. */
function serve(routes: Record<string, Reply | Reply[]>) {
  const calls: { key: string; body: unknown }[] = [];
  const served = new Map<string, number>();
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`;
    calls.push({ key, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
    const route = routes[key];
    const turn = served.get(key) ?? 0;
    served.set(key, turn + 1);
    const reply = route === undefined ? { status: 404, body: { error: { code: 'not_found', message: 'There is nothing at this address.' } } } : Array.isArray(route) ? route[Math.min(turn, route.length - 1)]! : route;
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetch);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const shift = (over: Partial<ShiftAnswers>): ShiftAnswers => ({
  id: 'sh1',
  status: 'Closed',
  terminalLabel: 'Till 1',
  openedByName: 'Cass Employee',
  openedAt: '2026-10-01T08:00:00.000Z',
  closedByName: 'Cass Employee',
  closedAt: '2026-10-01T17:00:00.000Z',
  expected: 2_250,
  counted: 2_250,
  variance: 0,
  tolerance: 0,
  why: null,
  next: null,
  ...over,
});
const closed = shift({});
const short = shift({ id: 'sh2', status: 'Reconciling', terminalLabel: 'Till 2', closedByName: null, closedAt: null, counted: 2_200, variance: -50, next: 'acknowledge' });
const uncounted = shift({ id: 'sh3', status: 'Open', terminalLabel: 'Till 3', closedByName: null, closedAt: null, expected: null, counted: null, variance: null, next: 'begin count' });
const passes = [
  { id: 'c1', passNumber: 1, countedAmount: 2_000, expectedAmount: 2_250, variance: -250, countedByName: 'Cass Employee', acknowledgedByName: null, reason: null },
  { id: 'c2', passNumber: 2, countedAmount: 2_200, expectedAmount: 2_250, variance: -50, countedByName: 'Cass Employee', acknowledgedByName: null, reason: null },
];

const review = (canAcknowledge = true) => render(<ShiftReview storeId="s1" currency={NPR} canAcknowledge={canAcknowledge} />);
const rowOf = async (till: string) => (await screen.findByText(till)).closest('tr')!;

describe('the shift list (CD-30, CD-31, RT-527, UX-52)', () => {
  it('CD-30, RT-527, UX-52: each shift shows its till, who opened it, its status in words beside a symbol, and what was expected, counted, and the difference in words', async () => {
    serve({ [LIST]: { body: { items: [short, closed] } } });
    review();
    const counting = within(await rowOf('Till 2'));
    expect(counting.getByText('Cass Employee')).toBeTruthy();
    expect(counting.getByText('Counting').closest('.chip')?.querySelector('[aria-hidden="true"]')?.textContent).toBe('◐');
    expect(counting.getByText('NPR 22.50')).toBeTruthy();
    expect(counting.getByText('NPR 22.00')).toBeTruthy();
    expect(counting.getByText('Short by NPR 0.50')).toBeTruthy();
    const done = within(await rowOf('Till 1'));
    expect(done.getByText('Closed')).toBeTruthy();
    expect(done.getByText('Balanced')).toBeTruthy();
  });

  it('CD-21, CD-31, RT-243: a shift not yet counted shows no figure, only a dash', async () => {
    serve({ [LIST]: { body: { items: [uncounted] } } });
    review();
    const row = await rowOf('Till 3');
    expect(within(row).getByText('Trading')).toBeTruthy();
    expect(within(row).getAllByText('—')).toHaveLength(3);
    expect(row.textContent).not.toContain('NPR\u00a0');
  });

  it('CD-30: the status filter asks the server for shifts in that status', async () => {
    const calls = serve({ [LIST]: { body: { items: [closed] } }, [`${LIST}?status=Closed`]: { body: { items: [closed] } } });
    review();
    await rowOf('Till 1');
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'Closed' } });
    await vi.waitFor(() => expect(calls.at(-1)?.key).toBe(`${LIST}?status=Closed`));
    expect(await rowOf('Till 1'), 'the filtered list is shown').toBeTruthy();
  });
});

describe('one shift (CD-30, CD-23, BI-25, UX-08)', () => {
  it('CD-30, SM-57: the shift shows the four answers, says what happens now, and lists every count as it stands', async () => {
    serve({ [LIST]: { body: { items: [short] } }, [DETAIL]: { body: { ...short, passes } }, [REASONS]: { body: { items: [] } } });
    review(false);
    fireEvent.click(within(await rowOf('Till 2')).getByRole('button'));
    expect(await screen.findByText('The difference needs an acknowledgement with a reason before the shift can close.')).toBeTruthy();
    const figures = [...document.querySelectorAll('dl.figures dd')].map((dd) => dd.textContent);
    expect(figures).toEqual(['NPR\u00a022.50', 'NPR\u00a022.00', 'Short by NPR\u00a00.50', 'NPR\u00a00.00', '—']);
    const counts = screen.getAllByRole('row').slice(1).map((row) => row.textContent);
    expect(counts).toEqual(['1NPR\u00a020.00NPR\u00a022.50Short by NPR\u00a02.50Cass Employee—', '2NPR\u00a022.00NPR\u00a022.50Short by NPR\u00a00.50Cass Employee—']);
  });

  it('UX-08: without Cash.Variance.Acknowledge, the shift offers no acknowledge control', async () => {
    serve({ [LIST]: { body: { items: [short] } }, [DETAIL]: { body: { ...short, passes } } });
    review(false);
    fireEvent.click(within(await rowOf('Till 2')).getByRole('button'));
    await screen.findByText('The difference needs an acknowledgement with a reason before the shift can close.');
    expect(screen.queryByLabelText('Reason for the difference')).toBeNull();
  });

  it('CD-23, BI-25, RT-245: someone allowed acknowledges the latest count with a reason, and the shift is read again: approver, reason and next step', async () => {
    const acknowledged = { ...short, next: 'close', why: { reason: 'Drawer short', acknowledgedByName: 'Mona Employee', acknowledgedAt: '2026-10-01T17:05:00.000Z' } };
    const calls = serve({
      [LIST]: { body: { items: [short] } },
      [DETAIL]: [{ body: { ...short, passes } }, { body: { ...acknowledged, passes } }],
      [REASONS]: { body: { items: [{ id: 'r1', name: 'Drawer short' }] } },
      [ACKNOWLEDGE]: { body: { id: 'c2' } },
    });
    review(true);
    fireEvent.click(within(await rowOf('Till 2')).getByRole('button'));
    await screen.findByRole('option', { name: 'Drawer short' });
    fireEvent.submit(screen.getByRole('button', { name: 'Acknowledge the difference' }).closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toBe('Choose the reason for the difference.');
    fireEvent.change(screen.getByLabelText('Reason for the difference'), { target: { value: 'r1' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Acknowledge the difference' }).closest('form')!);
    expect(await screen.findByText('Ready to close at the till.')).toBeTruthy();
    expect(calls.find((c) => c.key === ACKNOWLEDGE)?.body, 'the latest count, with the reason').toEqual({ reasonCodeId: 'r1' });
    expect(screen.getByText(/^Drawer short, acknowledged by Mona Employee, /)).toBeTruthy();
    expect(screen.queryByLabelText('Reason for the difference'), 'nothing left to acknowledge').toBeNull();
  });
});
