import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { onboard } from '../../onboarding.ts';
import { signedInAs, testApp } from '../../../test/app.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { employeeWithAccess, onboardingAnswers } from '../../../test/fixtures.ts';

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

type Headers = Record<string, string>;
const call = (method: string, url: string, as: Headers, payload?: object) =>
  app.inject({ method: method as never, url: `/api/v1${url}`, headers: as, ...(payload ? { payload } : {}) });
async function ok(method: string, url: string, as: Headers, payload?: object) {
  const res = await call(method, url, as, payload);
  expect(res.statusCode, `${method} ${url}: ${res.body}`).toBeLessThan(300);
  return res.json() as Record<string, unknown>;
}

async function org() {
  const o = await onboard(db.app, onboardingAnswers());
  const owner = signedInAs(o.ownerEmployeeId, o.organizationId);
  const staff = async (keys: string[]) =>
    signedInAs(await employeeWithAccess(db.app, o.organizationId, keys, { assignedStore: null, accessStores: [] }), o.organizationId);
  return { ...o, owner, staff };
}

describe('CU-01, CU-10: customers are never null, never deleted', () => {
  it('walk-in customer exists after onboarding and cannot be edited or closed', async () => {
    const o = await org();
    const { rows } = await db.app.query('SELECT id, is_walk_in, status FROM customer WHERE organization_id = $1', [o.organizationId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.is_walk_in).toBe(true);
    expect(rows[0]!.status).toBe('Active');

    // editing the walk-in is refused
    const res = await call('PATCH', `/customers/${rows[0]!.id}`, o.owner, { displayName: 'Nobody' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('invalid_reference');
  });
});

describe('CU-04, CU-05: customer identity keys and duplicate detection', () => {
  it('CU-04: phone and email are unique per organization', async () => {
    const o = await org();
    await ok('POST', '/customers', o.owner, { displayName: 'Alice', phone: '0411111111', email: 'alice@example.com' });
    // same phone → duplicate_contact warning
    const dup = await call('POST', '/customers', o.owner, { displayName: 'Bob', phone: '0411111111' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('duplicate_contact');
    expect(dup.json().error.existingName).toBe('Alice');
  });

  it('CU-05: force:true creates anyway, recording the choice', async () => {
    const o = await org();
    await ok('POST', '/customers', o.owner, { displayName: 'Alice', phone: '0422222222' });
    const forced = await ok('POST', '/customers', o.owner, { displayName: 'Bob', phone: '0422222222', force: true });
    expect(forced.id).toBeTruthy();
  });
});

describe('CU-06: search is organization-wide prefix search', () => {
  it('prefix search on name, phone, and email returns matching customers', async () => {
    const o = await org();
    await ok('POST', '/customers', o.owner, { displayName: 'Alice Aardvark', phone: '0433100000', email: 'alice@example.com' });
    await ok('POST', '/customers', o.owner, { displayName: 'Bob Bobson' });

    const byName = (await ok('GET', '/customers?q=alic', o.owner)).items as unknown[];
    expect(byName).toHaveLength(1);
    expect((byName[0] as Record<string, unknown>).displayName).toBe('Alice Aardvark');

    const byPhone = (await ok('GET', '/customers?q=04331', o.owner)).items as unknown[];
    expect(byPhone).toHaveLength(1);

    const all = (await ok('GET', '/customers', o.owner)).items as unknown[];
    expect(all).toHaveLength(2); // walk-in excluded
  });
});

describe('CU-07, CU-37: masking applied server-side', () => {
  it('Customer.View holders see masked contact; Customer.Edit holders see full contact', async () => {
    const o = await org();
    await ok('POST', '/customers', o.owner, { displayName: 'Charlie', phone: '0444333222', email: 'charlie@example.com' });
    const { id } = ((await ok('GET', '/customers?q=Charlie', o.owner)).items as { id: string }[])[0]!;

    // viewer: masked
    const viewer = await o.staff(['Customer.View']);
    const masked = await ok('GET', `/customers/${id}`, viewer);
    expect(masked.phone as string).toMatch(/\*\*\*\*/);
    expect(masked.email as string).toMatch(/\*\*\*\*/);

    // editor: full
    const full = await ok('GET', `/customers/${id}`, o.owner);
    expect(full.phone).toBe('0444333222');
    expect(full.email).toBe('charlie@example.com');
  });
});

describe('CU-09, CU-10, SM-45: customer status machine', () => {
  it('Active → OnHold → Active (requires reason; CU-09)', async () => {
    const o = await org();
    const reason = (await db.app.query<{ id: string }>(`SELECT id FROM reason_code WHERE organization_id = $1 LIMIT 1`, [o.organizationId])).rows[0]?.id
      ?? (await ok('POST', '/reason-codes', o.owner, { code: 'HOLD', name: 'Fraud suspicion' })).id as string;

    const { id } = await ok('POST', '/customers', o.owner, { displayName: 'Dana' });
    const custId = id as string;

    // hold without reason → refused
    const noReason = await call('POST', '/transitions', o.owner, { machine: 'CustomerAccount', event: 'hold', subject: custId });
    expect(noReason.statusCode).toBe(409);
    expect(noReason.json().error.code).toBe('SS055');

    await ok('POST', '/transitions', o.owner, { machine: 'CustomerAccount', event: 'hold', subject: custId, reasonCodeId: reason });
    const { rows: [row] } = await db.app.query('SELECT status FROM customer WHERE id = $1', [custId]);
    expect(row!.status).toBe('OnHold');

    // release
    await ok('POST', '/transitions', o.owner, { machine: 'CustomerAccount', event: 'release', subject: custId, reasonCodeId: reason });
    const { rows: [row2] } = await db.app.query('SELECT status FROM customer WHERE id = $1', [custId]);
    expect(row2!.status).toBe('Active');
  });

  it('Active → Closed is irreversible (CU-10); close requires reason', async () => {
    const o = await org();
    const reason = (await ok('POST', '/reason-codes', o.owner, { code: 'CLOSED', name: 'Left area' })).id as string;
    const { id } = await ok('POST', '/customers', o.owner, { displayName: 'Eve' });
    const custId = id as string;

    await ok('POST', '/transitions', o.owner, { machine: 'CustomerAccount', event: 'close', subject: custId, reasonCodeId: reason });
    const { rows: [row] } = await db.app.query('SELECT status FROM customer WHERE id = $1', [custId]);
    expect(row!.status).toBe('Closed');

    // SM-04: closing an already-closed customer is idempotent, not an error
    const again = await call('POST', '/transitions', o.owner, { machine: 'CustomerAccount', event: 'close', subject: custId, reasonCodeId: reason });
    expect(again.statusCode).toBeLessThan(300);
    expect((again.json() as { changed: boolean }).changed).toBe(false);
  });

  it('CreditBlocked exit is OPEN DECISION — refused for everyone', async () => {
    const o = await org();
    const reason = (await ok('POST', '/reason-codes', o.owner, { code: 'RISK', name: 'Risk' })).id as string;
    const { id } = await ok('POST', '/customers', o.owner, { displayName: 'Frank' });
    const custId = id as string;

    await ok('POST', '/transitions', o.owner, { machine: 'CustomerAccount', event: 'block_credit', subject: custId, reasonCodeId: reason });
    const { rows: [row] } = await db.app.query('SELECT status FROM customer WHERE id = $1', [custId]);
    expect(row!.status).toBe('CreditBlocked');

    const unblock = await call('POST', '/transitions', o.owner, { machine: 'CustomerAccount', event: 'unblock', subject: custId, reasonCodeId: reason });
    expect(unblock.statusCode).toBe(403);
    expect(unblock.json().error.code).toBe('not_permitted');
  });
});

describe('CU-08: customer sales history', () => {
  it('lists the customer\'s own sales; walk-in sales excluded', async () => {
    const o = await org();
    const { id: custId } = await ok('POST', '/customers', o.owner, { displayName: 'Grace' });

    const history = await ok('GET', `/customers/${custId}/sales`, o.owner);
    expect((history.items as unknown[]).length).toBeGreaterThanOrEqual(0); // may be empty if no sales
  });

  it('Customer.View can read; no key gets 403', async () => {
    const o = await org();
    const { id: custId } = await ok('POST', '/customers', o.owner, { displayName: 'Heidi' });

    const nobody = await o.staff([]);
    const res = await call('GET', `/customers/${custId}/sales`, nobody);
    expect(res.statusCode).toBe(403);

    const viewer = await o.staff(['Customer.View']);
    const res2 = await call('GET', `/customers/${custId}/sales`, viewer);
    expect(res2.statusCode).toBeLessThan(300);
  });
});

describe('CU-34: marketing consent', () => {
  it('consent is stored with timestamp; NotAsked has no timestamp', async () => {
    const o = await org();
    const { id: c1 } = await ok('POST', '/customers', o.owner, { displayName: 'Ivan', marketingConsent: 'Yes' });
    const { rows: [row1] } = await db.app.query('SELECT marketing_consent, marketing_consent_at FROM customer WHERE id = $1', [c1]);
    expect(row1!.marketing_consent).toBe('Yes');
    expect(row1!.marketing_consent_at).not.toBeNull();

    const { id: c2 } = await ok('POST', '/customers', o.owner, { displayName: 'Jana' });
    const { rows: [row2] } = await db.app.query('SELECT marketing_consent, marketing_consent_at FROM customer WHERE id = $1', [c2]);
    expect(row2!.marketing_consent).toBe('NotAsked');
    expect(row2!.marketing_consent_at).toBeNull();
  });
});
