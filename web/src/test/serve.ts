import { vi } from 'vitest';

export type Reply = { status?: number; body: unknown };

/**
 * Stubs the network at `fetch`, never at the `api` module, so a screen, the client and the server's response shapes run
 * together. Each `METHOD /api/v1/path` is answered from `routes`. A list of replies is given in turn, and its last one
 * repeats. Anything else is a 404. Every call is recorded with its parsed body. Pair it with `vi.unstubAllGlobals()`.
 */
export function serve(routes: Record<string, Reply | Reply[]>) {
  const calls: { key: string; body: unknown }[] = [];
  const served = new Map<string, number>();
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`;
    calls.push({ key, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
    const route = routes[key];
    const turn = served.get(key) ?? 0;
    served.set(key, turn + 1);
    const reply =
      route === undefined
        ? { status: 404, body: { error: { code: 'not_found', message: 'There is nothing at this address.' } } }
        : Array.isArray(route)
          ? route[Math.min(turn, route.length - 1)]!
          : route;
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetch);
  return calls;
}
