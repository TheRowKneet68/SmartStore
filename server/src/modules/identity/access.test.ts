import { randomUUID } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionApp, signedInAs, testApp } from '../../../test/app.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { employeeWithAccess, insertOrganization, insertStore } from '../../../test/fixtures.ts';
import { hashPassword } from './password.ts';

let db: TestDb;
let app: FastifyInstance;
let real: FastifyInstance;

beforeAll(async () => {
  db = await createTestDb();
  app = await testApp(db);
  real = await sessionApp(db);
});

afterAll(async () => {
  await app.close();
  await real.close();
  await db.drop();
});

const PASSWORD = 'TEST-ONLY password';
const ADMIN_KEYS = ['Role.View', 'Role.Create', 'Role.Edit', 'Role.Assign', 'Employee.View', 'Employee.StoreAccess.Grant'];

async function organization() {
  const org = await insertOrganization(db.app);
  const store = await insertStore(db.app, org);
  const admin = await employeeWithAccess(db.app, org, ADMIN_KEYS, { assignedStore: null, accessStores: [store] });
  return { org, store, admin, as: signedInAs(admin, org) };
}

type Org = Awaited<ReturnType<typeof organization>>;

const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, as: Record<string, string>, payload?: object) =>
  app.inject({ method, url: `/api/v1${url}`, headers: as, ...(payload ? { payload } : {}) });

async function role(o: Org, keys: string[]): Promise<string> {
  const created = await call('POST', '/roles', o.as, { name: `Role ${randomUUID()}`, keys });
  expect(created.statusCode).toBe(201);
  return created.json().id;
}

/** An employee of `o` with a login and no role, store access only if asked. */
async function staff(o: Org, options: { access?: boolean } = {}): Promise<{ id: string; username: string }> {
  const id = await employeeWithAccess(db.app, o.org, [], { assignedStore: null, accessStores: options.access ? [o.store] : [] });
  await db.app.query('UPDATE employee_role_assignment SET revoked_by = $2 WHERE employee_id = $1', [id, o.admin]);
  const username = `u-${randomUUID()}`;
  await db.app.query('INSERT INTO user_account (organization_id, employee_id, username, password_hash) VALUES ($1, $2, $3, $4)', [
    o.org,
    id,
    username,
    await hashPassword(PASSWORD),
  ]);
  return { id, username };
}

const cookieOf = (response: LightMyRequestResponse) => {
  const header = String(response.headers['set-cookie']);
  return header.slice(0, header.indexOf(';'));
};
const signIn = async (username: string) => cookieOf(await real.inject({ method: 'POST', url: '/api/v1/session', payload: { username, password: PASSWORD } }));
const session = (cookie: string) => real.inject({ method: 'GET', url: '/api/v1/session', headers: { cookie } });
const holds = async (employee: string, store: string | null, key: string) =>
  (await db.app.query<{ ok: boolean }>('SELECT employee_holds_permission($1, $2, $3) AS ok', [employee, store, key])).rows[0]!.ok;

describe('roles and their grants (AC-01, AC-02, AC-04, PC-01..PC-03)', () => {
  it('AC-02, D-01: a role is made from catalogue keys only, and lists its keys', async () => {
    const o = await organization();
    const refused = await call('POST', '/roles', o.as, { name: 'Bad', keys: ['Sale.View', 'Sale.*', 'Refund.Large.Approve'] });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error).toEqual({ code: 'unknown_permission', message: 'Not permissions: Sale.*, Refund.Large.Approve.' });
    const id = await role(o, ['Sale.View', 'Sale.Create']);
    const listed = await call('GET', '/roles', o.as);
    expect(listed.json().items).toContainEqual(expect.objectContaining({ id, keys: ['Sale.Create', 'Sale.View'], archivedAt: null }));
    expect((await call('PUT', `/roles/${id}/permissions/Sale.Everything`, o.as)).statusCode).toBe(422);
  });

  it('PC-02, PC-03: removing a key needs the number of employees it affects, then applies at the next request and signs nobody out', async () => {
    const o = await organization();
    const id = await role(o, ['Sale.View', 'Sale.Create']);
    const holder = await staff(o, { access: true });
    const other = await staff(o, { access: true });
    for (const person of [holder, other]) {
      expect((await call('POST', `/employees/${person.id}/roles`, o.as, { roleId: id, storeId: null })).statusCode).toBe(201);
    }
    const cookie = await signIn(holder.username);
    const unconfirmed = await call('DELETE', `/roles/${id}/permissions/Sale.Create`, o.as);
    expect(unconfirmed.statusCode).toBe(409);
    expect(unconfirmed.json().error).toEqual({
      code: 'confirm_affected',
      message: 'This takes Sale.Create from 2 employees. Confirm with that number.',
      affected: 2,
    });
    expect((await call('DELETE', `/roles/${id}/permissions/Sale.Create?confirmAffected=1`, o.as)).statusCode).toBe(409);
    expect((await call('DELETE', `/roles/${id}/permissions/Sale.Create?confirmAffected=2`, o.as)).statusCode).toBe(200);

    const after = await session(cookie);
    expect(after.statusCode, 'still signed in').toBe(200);
    expect(after.json().stores[0].permissions).toEqual(['Sale.View']);
    const history = await db.app.query('SELECT revoked_at IS NOT NULL AS revoked FROM role_permission WHERE role_id = $1 AND permission_key = $2', [id, 'Sale.Create']);
    expect(history.rows, 'kept, as a revocation').toEqual([{ revoked: true }]);
    expect((await call('PUT', `/roles/${id}/permissions/Sale.Create`, o.as)).statusCode, 'granted again').toBe(200);
    expect(await holds(holder.id, o.store, 'Sale.Create')).toBe(true);
  });

  it('BI-40, AC-01, SM-04: an archived role stays on record and grants nothing; archiving it again changes nothing', async () => {
    const o = await organization();
    const id = await role(o, ['Sale.View']);
    const person = await staff(o, { access: true });
    await call('POST', `/employees/${person.id}/roles`, o.as, { roleId: id, storeId: null });
    expect(await holds(person.id, o.store, 'Sale.View')).toBe(true);
    expect((await call('POST', `/roles/${id}/archive`, o.as)).json()).toEqual({ id, archived: true, changed: true });
    expect(await holds(person.id, o.store, 'Sale.View')).toBe(false);
    const listed = (await call('GET', '/roles', o.as)).json().items.find((r: { id: string }) => r.id === id);
    expect(listed.archivedAt).not.toBeNull();

    const second = await employeeWithAccess(db.app, o.org, ['Role.Edit'], { assignedStore: null, accessStores: [] });
    expect((await call('POST', `/roles/${id}/archive`, signedInAs(second, o.org))).json()).toEqual({ id, archived: true, changed: false });
    const record = await db.app.query('SELECT archived_by FROM role WHERE id = $1', [id]);
    expect(record.rows, 'who archived it first is kept').toEqual([{ archived_by: o.admin }]);
    expect((await call('PATCH', `/roles/${id}`, o.as, { name: 'Renamed' })).statusCode).toBe(200);
  });
});

describe('role assignments and store access (MS-11, EM-12..EM-16, RT-020, architecture s7.1)', () => {
  it("MS-11, RT-020, s7.1: an assignment takes effect at once, is recorded, and ends the employee's sessions; so does its removal", async () => {
    const o = await organization();
    const id = await role(o, ['Sale.View']);
    const person = await staff(o, { access: true });
    const before = await signIn(person.username);
    const assigned = await call('POST', `/employees/${person.id}/roles`, o.as, { roleId: id, storeId: o.store });
    expect(assigned.statusCode).toBe(201);
    expect((await session(before)).statusCode, 'the old session identifier is gone').toBe(401);
    const event = await db.app.query("SELECT actor_id FROM audit_event WHERE entity_id = $1 AND event_type = 'Security.Role.Assign'", [assigned.json().id]);
    expect(event.rows).toEqual([{ actor_id: o.admin }]);
    expect(await holds(person.id, o.store, 'Sale.View')).toBe(true);
    expect((await call('GET', `/employees/${person.id}/roles`, o.as)).json().items).toEqual([
      expect.objectContaining({ id: assigned.json().id, roleId: id, storeId: o.store }),
    ]);

    const during = await signIn(person.username);
    expect((await call('DELETE', `/role-assignments/${assigned.json().id}`, o.as)).statusCode).toBe(200);
    expect((await session(during)).statusCode).toBe(401);
    expect(await holds(person.id, o.store, 'Sale.View')).toBe(false);
    expect((await call('DELETE', `/role-assignments/${assigned.json().id}`, o.as)).statusCode, 'removed once').toBe(404);
  });

  it('EM-12, EM-13, EM-15, EM-16: store access is granted and revoked; a role without it grants nothing; revoking it ends the sessions', async () => {
    const o = await organization();
    const id = await role(o, ['Sale.View']);
    const person = await staff(o);
    await call('POST', `/employees/${person.id}/roles`, o.as, { roleId: id, storeId: null });
    expect(await holds(person.id, o.store, 'Sale.View'), 'a role without access').toBe(false);
    const granted = await call('POST', `/employees/${person.id}/stores`, o.as, { storeId: o.store });
    expect(granted.statusCode).toBe(201);
    expect(await holds(person.id, o.store, 'Sale.View')).toBe(true);
    const cookie = await signIn(person.username);
    expect((await session(cookie)).json().stores.map((s: { id: string }) => s.id)).toEqual([o.store]);
    expect((await call('GET', `/employees/${person.id}/stores`, o.as)).json().items).toEqual([expect.objectContaining({ id: granted.json().id, storeId: o.store })]);

    expect((await call('DELETE', `/store-access/${granted.json().id}`, o.as)).statusCode).toBe(200);
    expect((await session(cookie)).statusCode, 'revoked while signed in (EM-16)').toBe(401);
    expect(await holds(person.id, o.store, 'Sale.View')).toBe(false);
  });

  it("AC-01, MS-04: each change needs its own key; another organization's role, store or assignment is refused", async () => {
    const o = await organization();
    const id = await role(o, ['Sale.View']);
    const person = await staff(o);
    const nobody = signedInAs(await employeeWithAccess(db.app, o.org, ['Employee.View'], { assignedStore: null, accessStores: [o.store] }), o.org);
    for (const [method, url, payload] of [
      ['POST', '/roles', { name: 'X', keys: [] }],
      ['PUT', `/roles/${id}/permissions/Sale.Create`, undefined],
      ['POST', `/employees/${person.id}/roles`, { roleId: id, storeId: null }],
      ['POST', `/employees/${person.id}/stores`, { storeId: o.store }],
    ] as const) {
      expect((await call(method, url, nobody, payload)).statusCode, `${method} ${url}`).toBe(403);
    }

    const other = await organization();
    const theirRole = await role(other, ['Sale.View']);
    expect((await call('POST', `/employees/${person.id}/roles`, o.as, { roleId: theirRole, storeId: null })).json().error.code).toBe('invalid_reference');
    expect((await call('POST', `/employees/${person.id}/stores`, o.as, { storeId: other.store })).json().error.code).toBe('invalid_reference');
    const theirs = await call('POST', `/employees/${(await staff(other)).id}/roles`, other.as, { roleId: theirRole, storeId: null });
    expect((await call('DELETE', `/role-assignments/${theirs.json().id}`, o.as)).statusCode).toBe(404);
    expect((await call('PUT', `/roles/${theirRole}/permissions/Sale.Create`, o.as)).statusCode).toBe(404);
  });
});
