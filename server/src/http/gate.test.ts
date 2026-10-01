import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../../test/db.ts';
import { testApp } from '../../test/app.ts';
import { registerGate } from './gate.ts';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.drop();
});

/** A bare server with the gate and one route, to prove what the gate refuses to start with. */
async function serverWith(route: { url: string; config?: Record<string, unknown> }) {
  const app = Fastify();
  registerGate(app, db.app, async () => null);
  app.get(route.url, { config: route.config ?? {} }, async () => 'ok');
  await app.ready();
  return app;
}

describe('the one authorization gate: what it refuses to start with (AC-01, AC-02, MS-03; architecture s8.2)', () => {
  it('AC-01: the server refuses to start with a route that declares no access', async () => {
    await expect(serverWith({ url: '/open' })).rejects.toThrow(/declares no access/);
  });

  it('AC-02, D-01: the server refuses to start with a route whose permission is not a catalogue key', async () => {
    await expect(
      serverWith({ url: '/x/:storeId', config: { access: { kind: 'permission', key: 'Sales.Create', scope: 'store' } } }),
    ).rejects.toThrow(/missing from the catalogue: Sales.Create/);
  });

  it('MS-03: the server refuses to start with a store-scoped route that names no store', async () => {
    await expect(
      serverWith({ url: '/x', config: { access: { kind: 'permission', key: 'Sale.View', scope: 'store' } } }),
    ).rejects.toThrow(/names no :storeId/);
  });
});

describe('the gate at request time (AC-03, architecture s18.4, s25.3)', () => {
  it('AC-03: a request with no signed-in employee is refused with a stable code and a correlation id', async () => {
    const app = await testApp(db);
    const response = await app.inject({ method: 'GET', url: `/api/v1/stores/${crypto.randomUUID()}/settings` });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: 'unauthenticated', message: 'You are not signed in. Sign in to continue.' },
    });
    expect(response.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
    await app.close();
  });

  it('s18.4: an address with nothing at it is a 404 with the same error shape', async () => {
    const app = await testApp(db);
    const response = await app.inject({ method: 'GET', url: '/api/v1/nothing-here' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'not_found' } });
    await app.close();
  });
});
