import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signedInAs, testApp } from '../../../test/app.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import {
  actor,
  employeeWithAccess,
  insertOrganization,
  insertSettings,
  insertStore,
  sell,
  tillWorld,
} from '../../../test/fixtures.ts';

let db: TestDb;
let app: FastifyInstance;

beforeAll(async () => {
  db = await createTestDb();
  app = await testApp(db);
});

afterAll(async () => {
  await app.close();
  await db.drop();
});

const settings = {
  taxMode: 'Inclusive',
  negativeStockPolicy: 'BlockNegative',
  returnWindowDays: 14,
  defaultReturnDisposition: 'Sellable',
} as const;

async function storeWithManager(): Promise<{ org: string; store: string; manager: string }> {
  const org = await insertOrganization(db.app);
  const store = await insertStore(db.app, org);
  await insertSettings(db.app, store, 'AllowNegative');
  const manager = await employeeWithAccess(db.app, org, ['Config.Store'], { assignedStore: store, accessStores: [store] });
  return { org, store, manager };
}

describe('store settings over HTTP (REQ-AU-06, SP-33, IV-16, RR-10)', () => {
  it('REQ-AU-06: the settings in force and those scheduled are read separately', async () => {
    const { org, store, manager } = await storeWithManager();
    await insertSettings(db.app, store, 'BlockNegative', new Date(Date.now() + 86_400_000).toISOString());
    const response = await app.inject({ method: 'GET', url: `/api/v1/stores/${store}/settings`, headers: signedInAs(manager, org) });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.inForce).toMatchObject({ storeId: store, negativeStockPolicy: 'AllowNegative', taxMode: 'Inclusive' });
    expect(body.scheduled).toHaveLength(1);
    expect(body.scheduled[0]).toMatchObject({ negativeStockPolicy: 'BlockNegative' });
  });

  it('AU-05, BI-33, REQ-AU-06: a new version is made by the signed-in employee, whoever the body names, and takes effect now', async () => {
    const { org, store, manager } = await storeWithManager();
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/stores/${store}/settings`,
      headers: signedInAs(manager, org),
      payload: { ...settings, createdBy: actor() },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ ...settings, storeId: store, createdBy: manager });
    const now = await app.inject({ method: 'GET', url: `/api/v1/stores/${store}/settings`, headers: signedInAs(manager, org) });
    expect(now.json().inForce).toMatchObject({ negativeStockPolicy: 'BlockNegative', returnWindowDays: 14 });
  });

  it('REQ-AU-06: a version dated in the past is refused; a later one is scheduled', async () => {
    const { org, store, manager } = await storeWithManager();
    const post = (effectiveFrom: string) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/stores/${store}/settings`,
        headers: signedInAs(manager, org),
        payload: { ...settings, effectiveFrom },
      });
    const past = await post(new Date(Date.now() - 60_000).toISOString());
    expect(past.statusCode).toBe(422);
    expect(past.json()).toEqual({
      error: { code: 'invalid_value', message: 'New settings take effect now or later, never in the past.' },
    });
    const later = await post(new Date(Date.now() + 3_600_000).toISOString());
    expect(later.statusCode).toBe(201);
  });

  it('UX-55: a malformed version is refused with the fields to fix, before anything is written', async () => {
    const { org, store, manager } = await storeWithManager();
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/stores/${store}/settings`,
      headers: signedInAs(manager, org),
      payload: { ...settings, taxMode: 'Sometimes', returnWindowDays: -1 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_request');
    expect(response.json().error.message).toMatch(/taxMode.*returnWindowDays/);
  });

  it('SP-33, PR-38: the tax mode cannot change once the store has sold', async () => {
    const t = await tillWorld(db.app);
    await sell(db.app, t, [{ variant: t.variant, quantity: 1 }]);
    const manager = await employeeWithAccess(db.app, t.org, ['Config.Store'], { assignedStore: t.store, accessStores: [t.store] });
    const post = (taxMode: string) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/stores/${t.store}/settings`,
        headers: signedInAs(manager, t.org),
        payload: { ...settings, taxMode },
      });
    const changed = await post('Exclusive');
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error.code).toBe('SS038');
    expect((await post('Inclusive')).statusCode, 'other settings still change').toBe(201);
  });
});

describe('who may read and change store settings (AC-01, AC-02, EM-13, MS-03, MS-11)', () => {
  it('AC-01, EM-13, MS-03, MS-11: only Config.Store held in that store, with access to it, opens the settings', async () => {
    const org = await insertOrganization(db.app);
    const store = await insertStore(db.app, org);
    const other = await insertStore(db.app, org);
    await insertSettings(db.app, store, 'AllowNegative');
    const get = (employee: string, inOrg = org) =>
      app.inject({ method: 'GET', url: `/api/v1/stores/${store}/settings`, headers: signedInAs(employee, inOrg) });

    const noRole = await employeeWithAccess(db.app, org, [], { assignedStore: null, accessStores: [store] });
    const wrongKey = await employeeWithAccess(db.app, org, ['Sale.View'], { assignedStore: null, accessStores: [store] });
    const otherStore = await employeeWithAccess(db.app, org, ['Config.Store'], { assignedStore: other, accessStores: [store, other] });
    const noAccess = await employeeWithAccess(db.app, org, ['Config.Store'], { assignedStore: null, accessStores: [other] });
    const orgWide = await employeeWithAccess(db.app, org, ['Config.Store'], { assignedStore: null, accessStores: [store] });

    for (const [employee, why] of [
      [noRole, 'no role'],
      [wrongKey, 'another key'],
      [otherStore, 'assigned in another store'],
      [noAccess, 'no access to this store'],
    ] as const) {
      const response = await get(employee);
      expect(response.statusCode, why).toBe(403);
      expect(response.json().error, why).toEqual({
        code: 'forbidden',
        message: 'You do not have access to this: it needs the Config.Store permission in this store.',
      });
    }
    expect((await get(orgWide)).statusCode, 'organization-wide, with access').toBe(200);
  });

  it('MS-03, architecture s24.3: a store of another organization, or none at all, gets the same 403', async () => {
    const { org, manager } = await storeWithManager();
    const foreign = await insertStore(db.app, await insertOrganization(db.app));
    for (const store of [foreign, crypto.randomUUID()]) {
      const response = await app.inject({ method: 'GET', url: `/api/v1/stores/${store}/settings`, headers: signedInAs(manager, org) });
      expect(response.statusCode).toBe(403);
    }
    const malformed = await app.inject({ method: 'GET', url: '/api/v1/stores/not-a-store/settings', headers: signedInAs(manager, org) });
    expect(malformed.statusCode).toBe(400);
  });
});
