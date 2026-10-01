import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api.ts';

/**
 * `api.ts` is the only place the browser talks to the server, and the only place the server's error shape
 * (architecture §18.4) becomes something a screen can act on. `fetch` is stubbed; nothing here reaches the network.
 *
 * The test that matters most is `details`. The server puts anything beyond `code` and `message` inside the error
 * object — a shift close answers `variance_unacknowledged` with the count's id in exactly that position — and
 * `details` is the only path by which a screen can reach it. If that mapping breaks, a cashier is told the
 * difference is unacknowledged and is not told which count to acknowledge.
 */

/** A `Response` good enough for what `api` reads: `status`, `ok`, `json`. */
const reply = (status: number, body: unknown) => ({
  status,
  ok: status >= 200 && status < 300,
  json: () => Promise.resolve(body),
});

const lastCall = () => vi.mocked(fetch).mock.calls.at(-1) as [string, RequestInit];

afterEach(() => vi.unstubAllGlobals());

describe('the request it makes', () => {
  it('calls the versioned API on this origin, with the session cookie (architecture §7.1)', async () => {
    const fetchStub = vi.fn().mockResolvedValue(reply(200, { ok: true }));
    vi.stubGlobal('fetch', fetchStub);
    await api('GET', '/stores/s1/sales');
    const [url, init] = lastCall();
    expect(url).toBe('/api/v1/stores/s1/sales');
    expect(init.credentials).toBe('same-origin');
    expect(init.method).toBe('GET');
  });

  it('sends no content-type and no body when there is no body (architecture §7.1)', async () => {
    const fetchStub = vi.fn().mockResolvedValue(reply(200, {}));
    vi.stubGlobal('fetch', fetchStub);
    await api('GET', '/stores/s1/sales');
    const [, init] = lastCall();
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({});
  });

  it('sends JSON, and only when there is something to send (architecture §7.1)', async () => {
    const fetchStub = vi.fn().mockResolvedValue(reply(200, {}));
    vi.stubGlobal('fetch', fetchStub);
    await api('POST', '/stores/s1/sales', { quantity: 2 });
    const [, init] = lastCall();
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"quantity":2}');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
  });

  it('resolves 204 to nothing, and does not try to read a body that is not there (architecture §18.4)', async () => {
    const json = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204, ok: true, json }));
    expect(await api('DELETE', '/stores/s1/sales/x')).toBeUndefined();
    expect(json, 'a 204 has no body to parse').not.toHaveBeenCalled();
  });
});

describe('the error it raises', () => {
  it('carries the status, code and message the server sent, so the screen can branch on code (§18.4)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(409, { error: { code: 'variance_unacknowledged', message: 'Nobody has acknowledged the difference.' } })));
    const raised = await api('POST', '/transitions', {}).catch((e: unknown) => e);
    expect(raised).toBeInstanceOf(ApiError);
    expect(raised).toMatchObject({ status: 409, code: 'variance_unacknowledged', message: 'Nobody has acknowledged the difference.' });
  });

  it('puts every key beyond code and message into details, which is the only route to them (§18.4)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(409, { error: { code: 'variance_unacknowledged', message: '…', countId: 'c-1' } })));
    const raised = (await api('POST', '/transitions', {}).catch((e: unknown) => e)) as ApiError;
    expect(raised.details).toEqual({ countId: 'c-1' });
    expect(raised.code, 'the code stays the code').toBe('variance_unacknowledged');
  });

  it('still raises when the error body cannot be parsed, rather than resolving a broken answer (§18.4)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 500, ok: false, json: () => Promise.reject(new Error('not json')) }));
    const raised = (await api('GET', '/stores/s1/sales').catch((e: unknown) => e)) as ApiError;
    expect(raised).toBeInstanceOf(ApiError);
    expect(raised).toMatchObject({ status: 500, code: 'internal', message: 'Something went wrong on the server.', details: {} });
  });

  it('raises the same fallback when the server sends an error with no code or message (§18.4)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(422, {})));
    const raised = (await api('POST', '/stores/s1/sales', {}).catch((e: unknown) => e)) as ApiError;
    expect(raised).toMatchObject({ status: 422, code: 'internal', message: 'Something went wrong on the server.' });
  });

  it('reports an unreachable server as offline, and promises nothing was lost (UX-57)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed to fetch')));
    const raised = (await api('POST', '/stores/s1/sales', {}).catch((e: unknown) => e)) as ApiError;
    expect(raised).toMatchObject({ status: 0, code: 'offline' });
    // The claim is only true because the cart lives in the browser until the server saves it (ADR-31 §8, UX-57).
    expect(raised.message).toContain('Nothing was lost');
  });

  it('is an Error, so a screen that only catches Error still shows something (§18.4)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(400, { error: { code: 'invalid_request', message: 'bad' } })));
    const raised = await api('POST', '/stores/s1/sales', {}).catch((e: unknown) => e);
    expect(raised).toBeInstanceOf(Error);
    expect((raised as Error).message).toBe('bad');
  });
});

describe('a successful answer', () => {
  it('resolves to the parsed body, unchanged (§18.4)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(200, { variantId: 'v1', description: 'Oat milk' })));
    expect(await api('GET', '/stores/s1/scan/1000')).toEqual({ variantId: 'v1', description: 'Oat milk' });
  });
});
