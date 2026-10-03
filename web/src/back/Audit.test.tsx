import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AuditLog } from './Audit.tsx';

/**
 * Back-office audit log screen (OQ-024, AU-11, RT-292). The network is stubbed at `fetch`.
 */

type Reply = { status?: number; body: unknown };

function serve(routes: Record<string, Reply | Reply[]>) {
  const served = new Map<string, number>();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${String(input)}`;
      const route = routes[key];
      const turn = served.get(key) ?? 0;
      served.set(key, turn + 1);
      const reply =
        route === undefined
          ? { status: 404, body: { error: { code: 'not_found', message: 'not found' } } }
          : Array.isArray(route)
            ? route[Math.min(turn, route.length - 1)]!
            : route;
      return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } });
    }),
  );
}

afterEach(() => { vi.unstubAllGlobals(); });

const LIST = 'GET /api/v1/audit-events';

const row = (over: Partial<{ eventType: string; entityType: string; entityId: string }> = {}) => ({
  id: 'ev-1',
  seq: '1',
  occurredAt: '2026-10-03T10:00:00.000Z',
  eventType: 'Employee.StateChange',
  entityType: 'employee',
  entityId: 'e-uuid-1',
  actorId: 'a-uuid-1',
  storeId: null,
  reasonCodeId: null,
  source: 'UI',
  correlationId: 'c-uuid-1',
  ...over,
});

it('OQ-024: shows a permission notice without Audit.View', () => {
  render(<AuditLog permissions={[]} />);
  expect(screen.getByText(/do not have permission/i)).toBeTruthy();
});

it('OQ-024, AU-11: with Audit.View, loads and displays events', async () => {
  serve({ [LIST]: { body: { items: [row()], next: null } } });
  render(<AuditLog permissions={['Audit.View']} />);
  expect(await screen.findByText('Employee.StateChange')).toBeTruthy();
  expect(screen.getByText('employee')).toBeTruthy();
});

it('OQ-024: shows "no events" message for empty result', async () => {
  serve({ [LIST]: { body: { items: [], next: null } } });
  render(<AuditLog permissions={['Audit.View']} />);
  expect(await screen.findByText(/no events match/i)).toBeTruthy();
});
