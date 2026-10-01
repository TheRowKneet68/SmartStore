import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { createPool } from '../db/pool.ts';
import { TEST_LOCK_TIMEOUT_MS, TEST_QUOTE_MAX_AGE_MINUTES, TEST_SESSION_POLICY, testApp } from '../../test/app.ts';
import { createTestDb, type TestDb } from '../../test/db.ts';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.drop();
});

/** The server on a pool of its own, which a test may then break. */
const onPool = (pool: ReturnType<typeof createPool>) =>
  buildApp({ pool, session: TEST_SESSION_POLICY, quoteMaxAgeMinutes: TEST_QUOTE_MAX_AGE_MINUTES, lockTimeoutMs: TEST_LOCK_TIMEOUT_MS });

describe("liveness and readiness (the owner's brief, Phase D; architecture s24.3, s25.4)", () => {
  it('liveness and readiness answer without a session, outside the versioned API', async () => {
    const app = await testApp(db);
    const live = await app.inject({ method: 'GET', url: '/health' });
    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ status: 'ok' });
    const ready = await app.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: 'ready' });
    expect((await app.inject({ method: 'GET', url: '/api/v1/health' })).statusCode, 'not part of the API').toBe(404);
    await app.close();
  });

  it('s24.3, s25.4: with the database refusing, readiness says not ready and nothing more, and liveness still answers', async () => {
    const pool = createPool(db.appUrl, 1);
    const app = await onPool(pool);
    await pool.end();
    const ready = await app.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(503);
    expect(ready.body, 'no internals').toBe(JSON.stringify({ status: 'not_ready' }));
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode, 'the process is alive').toBe(200);
    await app.close();
  });

  it('with the database not answering, readiness gives up within its time and says not ready', async () => {
    const pool = createPool(db.appUrl, 1);
    const app = await onPool(pool);
    const held = await pool.connect(); // The pool's only connection: the probe's query waits behind it.
    const started = Date.now();
    const ready = await app.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(503);
    expect(Date.now() - started, 'about a second, never the request timeout').toBeLessThan(3_000);
    held.release();
    await app.close();
    await pool.end();
  });
});
