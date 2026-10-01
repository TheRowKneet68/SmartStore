import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionApp, TEST_SESSION_POLICY } from '../../../test/app.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import {
  actor,
  employeeWithAccess,
  insertOrganization,
  insertReasonCode,
  insertSettings,
  insertStore,
  tillWorld,
  withReason,
} from '../../../test/fixtures.ts';
import { hashPassword } from './password.ts';

let db: TestDb;
let app: FastifyInstance;

beforeAll(async () => {
  db = await createTestDb();
  app = await sessionApp(db);
});

afterAll(async () => {
  await app.close();
  await db.drop();
});

const PASSWORD = 'TEST-ONLY correct horse';

interface Person {
  org: string;
  store: string;
  employee: string;
  username: string;
}

/** An employee with a login, holding `keys` organization-wide with access to one store. */
async function person(keys: string[] = ['Config.Store'], options: { access?: boolean; org?: string; username?: string } = {}): Promise<Person> {
  const org = options.org ?? (await insertOrganization(db.app));
  const store = await insertStore(db.app, org);
  await insertSettings(db.app, store, 'AllowNegative');
  const employee = await employeeWithAccess(db.app, org, keys, { assignedStore: null, accessStores: options.access === false ? [] : [store] });
  const username = options.username ?? `user-${randomUUID()}`;
  await db.app.query('INSERT INTO user_account (organization_id, employee_id, username, password_hash) VALUES ($1, $2, $3, $4)', [
    org,
    employee,
    username,
    await hashPassword(PASSWORD),
  ]);
  return { org, store, employee, username };
}

const signIn = (body: Record<string, unknown>, cookie?: string, on: FastifyInstance = app) =>
  on.inject({ method: 'POST', url: '/api/v1/session', payload: body, headers: cookie ? { cookie } : {} });

/** The cookie a response set, as the browser would send it back. */
function cookieOf(response: LightMyRequestResponse): string {
  const header = String(response.headers['set-cookie']);
  return header.slice(0, header.indexOf(';'));
}

const tokenHash = (cookie: string) => createHash('sha256').update(Buffer.from(cookie.split('=')[1]!, 'base64url')).digest();

const events = (type: string, entity: string) =>
  db.app.query<{ actor_id: string | null; after: Record<string, unknown> | null; source: string; store_id: string | null }>(
    'SELECT actor_id, after, source, store_id FROM audit_event WHERE event_type = $1 AND entity_id = $2 ORDER BY seq',
    [type, entity],
  );

const accountOf = async (p: Person) =>
  (await db.app.query<{ id: string }>('SELECT id FROM user_account WHERE employee_id = $1', [p.employee])).rows[0]!.id;

describe('signing in (ADR-12, EM-02, EM-04, architecture s7.1)', () => {
  it('ADR-12, architecture s7.1: a sign-in sets an httpOnly, Secure, SameSite=Strict cookie, and the database keeps only its hash', async () => {
    const p = await person();
    const response = await signIn({ username: p.username, password: PASSWORD });
    expect(response.statusCode).toBe(201);
    expect(String(response.headers['set-cookie'])).toMatch(
      /^smartstore_session=[A-Za-z0-9_-]{43}; Path=\/api; HttpOnly; Secure; SameSite=Strict; Max-Age=3600$/,
    );
    const cookie = cookieOf(response);
    const stored = await db.app.query<{ token_hash: Buffer }>('SELECT token_hash FROM user_session WHERE employee_id = $1', [p.employee]);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]!.token_hash.equals(tokenHash(cookie))).toBe(true);

    const login = await events('Security.Login', (await db.app.query<{ id: string }>('SELECT id FROM user_session WHERE employee_id = $1', [p.employee])).rows[0]!.id);
    expect(login.rows).toEqual([{ actor_id: p.employee, after: null, source: 'UI', store_id: null }]);

    const again = await app.inject({ method: 'GET', url: '/api/v1/session', headers: { cookie } });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(response.json());
  });

  it('UX-05, UX-08, MS-01: the workspace lists the stores where the employee holds permissions, and which', async () => {
    const p = await person(['Config.Store', 'Sale.View']);
    const body = (await signIn({ username: p.username, password: PASSWORD })).json();
    expect(body.employee).toEqual({ id: p.employee, name: 'Test Employee', readOnly: false });
    expect(body.stores).toEqual([expect.objectContaining({ id: p.store, permissions: ['Config.Store', 'Sale.View'] })]);
    expect(body.organization.permissions).toEqual(['Config.Store', 'Sale.View']);
    expect(body.terminal).toBeNull();
  });

  it('MS-05, UX-07: an employee with no store access signs in to an empty workspace, not an error', async () => {
    const p = await person(['Sale.View'], { access: false });
    const response = await signIn({ username: p.username, password: PASSWORD });
    expect(response.statusCode).toBe(201);
    expect(response.json().stores).toEqual([]);
  });

  it('architecture s24.3, AU-03: a wrong password and an unknown username get the same answer; the failure is audited with no actor', async () => {
    const p = await person();
    const wrong = await signIn({ username: p.username, password: 'not it' });
    const unknown = await signIn({ username: `nobody-${randomUUID()}`, password: PASSWORD });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
    expect(wrong.json()).toEqual({ error: { code: 'sign_in_failed', message: 'The username or password is not right.' } });
    expect(wrong.headers['set-cookie']).toBeUndefined();
    const failed = await events('Security.LoginFailed', await accountOf(p));
    expect(failed.rows).toEqual([{ actor_id: null, after: { reason: 'Password' }, source: 'UI', store_id: null }]);
  });

  it('EM-02: usernames match whatever their case', async () => {
    const p = await person();
    expect((await signIn({ username: p.username.toUpperCase(), password: PASSWORD })).statusCode).toBe(201);
  });

  it('OQ-025 item 7: a username used in two organizations needs the organization to sign in', async () => {
    const username = `shared-${randomUUID()}`;
    const first = await person(['Sale.View'], { username });
    await person(['Sale.View'], { username });
    expect((await signIn({ username, password: PASSWORD })).statusCode, 'ambiguous').toBe(401);
    const named = await signIn({ username, password: PASSWORD, organizationId: first.org });
    expect(named.statusCode).toBe(201);
    expect(named.json().employee.id).toBe(first.employee);
  });

  it('SM-49: repeated failures throttle the login, never the employee: even the right password waits', async () => {
    const p = await person();
    const bystander = await person();
    for (let i = 0; i < TEST_SESSION_POLICY.failureLimit; i += 1) {
      expect((await signIn({ username: p.username, password: 'guess' })).statusCode).toBe(401);
    }
    const throttled = await signIn({ username: p.username, password: PASSWORD });
    expect(throttled.statusCode).toBe(429);
    expect(throttled.json().error.code).toBe('sign_in_throttled');
    const status = await db.app.query('SELECT status FROM employee WHERE id = $1', [p.employee]);
    expect(status.rows[0], 'the employee is not locked out of the business').toEqual({ status: 'Active' });
    expect((await signIn({ username: bystander.username, password: PASSWORD })).statusCode, 'another login').toBe(201);

    const lenient = await sessionApp(db, { ...TEST_SESSION_POLICY, failureLimit: 100 });
    expect((await signIn({ username: p.username, password: PASSWORD }, undefined, lenient)).statusCode, 'the limit is the configured one').toBe(201);
    await lenient.close();
  });

  it('architecture s7.3: a password stored at an older cost is rehashed by the next sign-in', async () => {
    const p = await person();
    const weak = await hashPassword(PASSWORD, { memory: 8_192, passes: 1, parallelism: 1 });
    await db.app.query('UPDATE user_account SET password_hash = $2 WHERE employee_id = $1', [p.employee, weak]);
    expect((await signIn({ username: p.username, password: PASSWORD })).statusCode).toBe(201);
    const { rows } = await db.app.query<{ password_hash: string }>('SELECT password_hash FROM user_account WHERE employee_id = $1', [p.employee]);
    expect(rows[0]!.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect((await signIn({ username: p.username, password: PASSWORD })).statusCode, 'and still signs in').toBe(201);
  });
});

describe('who may sign in, and for how long (employee-domain s3, SM-47, architecture s7.5)', () => {
  it('employee-domain s3: Suspended, Terminated and Archived employees cannot sign in; the attempt is audited', async () => {
    const suspended = await person();
    await db.app.query("UPDATE employee SET status = 'Suspended', status_changed_by = $2 WHERE id = $1", [suspended.employee, actor()]);
    const terminated = await person();
    await db.app.query("UPDATE employee SET status = 'Terminated', status_changed_by = $2 WHERE id = $1", [terminated.employee, actor()]);
    const archived = await person();
    await db.app.query("UPDATE employee SET status = 'Terminated', status_changed_by = $2 WHERE id = $1", [archived.employee, actor()]);
    await withReason(db.app, await insertReasonCode(db.app, archived.org), "UPDATE employee SET status = 'Archived', status_changed_by = $2 WHERE id = $1", [
      archived.employee,
      actor(),
    ]);
    for (const p of [suspended, terminated, archived]) {
      const response = await signIn({ username: p.username, password: PASSWORD });
      expect(response.statusCode).toBe(403);
      expect(response.json().error).toEqual({ code: 'sign_in_blocked', message: 'This login cannot sign in. Ask your manager.' });
      expect((await events('Security.LoginFailed', await accountOf(p))).rows[0]!.after).toEqual({ reason: 'Status' });
    }
  });

  it('employee-domain s3: an employee on leave signs in read-only: they may look, not change', async () => {
    const p = await person();
    await withReason(db.app, await insertReasonCode(db.app, p.org), "UPDATE employee SET status = 'OnLeave', status_changed_by = $2 WHERE id = $1", [
      p.employee,
      actor(),
    ]);
    const response = await signIn({ username: p.username, password: PASSWORD });
    expect(response.statusCode).toBe(201);
    expect(response.json().employee.readOnly).toBe(true);
    const cookie = cookieOf(response);
    const read = await app.inject({ method: 'GET', url: `/api/v1/stores/${p.store}/settings`, headers: { cookie } });
    expect(read.statusCode).toBe(200);
    const write = await app.inject({
      method: 'POST',
      url: `/api/v1/stores/${p.store}/settings`,
      headers: { cookie },
      payload: { taxMode: 'Inclusive', negativeStockPolicy: 'AllowNegative', returnWindowDays: 30, defaultReturnDisposition: 'Quarantine' },
    });
    expect(write.statusCode).toBe(403);
    expect(write.json().error.code).toBe('read_only');
  });

  it('architecture s7.5, SM-47: a live session is refused at its next request once its employee is suspended, and is ended', async () => {
    const p = await person();
    const cookie = cookieOf(await signIn({ username: p.username, password: PASSWORD }));
    await db.app.query("UPDATE employee SET status = 'Suspended', status_changed_by = $2 WHERE id = $1", [p.employee, actor()]);
    expect((await app.inject({ method: 'GET', url: '/api/v1/session', headers: { cookie } })).statusCode).toBe(401);
    const session = await db.app.query<{ id: string; end_reason: string }>('SELECT id, end_reason FROM user_session WHERE employee_id = $1', [p.employee]);
    expect(session.rows[0]!.end_reason).toBe('Revoked');
    expect((await events('Security.SessionEnded', session.rows[0]!.id)).rows[0]!.after).toEqual({ reason: 'Revoked' });
  });

  it('AU-12a: an expired session is refused and recorded as Expired', async () => {
    const p = await person();
    const brief = await sessionApp(db, { ...TEST_SESSION_POLICY, lifetimeMinutes: 0.001 });
    const cookie = cookieOf(await signIn({ username: p.username, password: PASSWORD }, undefined, brief));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect((await brief.inject({ method: 'GET', url: '/api/v1/session', headers: { cookie } })).statusCode).toBe(401);
    const { rows } = await db.app.query('SELECT end_reason FROM user_session WHERE employee_id = $1', [p.employee]);
    expect(rows).toEqual([{ end_reason: 'Expired' }]);
    await brief.close();
  });

  it('architecture s7.1: signing in again on the same browser rotates the old session out', async () => {
    const p = await person();
    const first = cookieOf(await signIn({ username: p.username, password: PASSWORD }));
    const second = cookieOf(await signIn({ username: p.username, password: PASSWORD }, first));
    expect(second).not.toBe(first);
    expect((await app.inject({ method: 'GET', url: '/api/v1/session', headers: { cookie: first } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/v1/session', headers: { cookie: second } })).statusCode).toBe(200);
    const { rows } = await db.app.query('SELECT end_reason FROM user_session WHERE employee_id = $1 ORDER BY created_at', [p.employee]);
    expect(rows).toEqual([{ end_reason: 'Rotated' }, { end_reason: null }]);
  });

  it('AU-03, AU-12a: signing out ends the session once, records Security.Logout and clears the cookie', async () => {
    const p = await person();
    const cookie = cookieOf(await signIn({ username: p.username, password: PASSWORD }));
    const out = await app.inject({ method: 'DELETE', url: '/api/v1/session', headers: { cookie } });
    expect(out.statusCode).toBe(204);
    expect(String(out.headers['set-cookie'])).toMatch(/^smartstore_session=; .*Max-Age=0$/);
    expect((await app.inject({ method: 'GET', url: '/api/v1/session', headers: { cookie } })).statusCode).toBe(401);
    const session = await db.app.query<{ id: string; end_reason: string }>('SELECT id, end_reason FROM user_session WHERE employee_id = $1', [p.employee]);
    expect(session.rows[0]!.end_reason).toBe('Logout');
    expect((await events('Security.Logout', session.rows[0]!.id)).rows).toHaveLength(1);
  });

  it('AC-03: a forged, malformed or absent cookie is no session', async () => {
    for (const cookie of ['smartstore_session=abc', `smartstore_session=${randomBytes(32).toString('base64url')}`, 'other=1']) {
      expect((await app.inject({ method: 'GET', url: '/api/v1/session', headers: { cookie } })).statusCode, cookie).toBe(401);
    }
  });
});

describe('a session at a till (PT-01, MS-01, architecture s7.4)', () => {
  it('PT-01, MS-01: a session binds to a till of a store where the employee works; another till is refused', async () => {
    const t = await tillWorld(db.app);
    const cashier = await person(['Sale.Create'], { org: t.org });
    await db.app.query('INSERT INTO employee_store_access (employee_id, store_id, organization_id, granted_by) VALUES ($1, $2, $3, $4)', [
      cashier.employee,
      t.store,
      t.org,
      actor(),
    ]);
    const response = await signIn({ username: cashier.username, password: PASSWORD, terminalId: t.terminal });
    expect(response.statusCode).toBe(201);
    expect(response.json().terminal).toMatchObject({ id: t.terminal, storeId: t.store });
    const session = await db.app.query<{ id: string }>('SELECT id FROM user_session WHERE employee_id = $1', [cashier.employee]);
    expect((await events('Security.Login', session.rows[0]!.id)).rows[0]).toMatchObject({ source: 'Terminal', store_id: t.store });

    const elsewhere = await tillWorld(db.app);
    const refused = await signIn({ username: cashier.username, password: PASSWORD, terminalId: elsewhere.terminal });
    expect(refused.statusCode, "another organization's till").toBe(403);
    expect(refused.json().error.code).toBe('sign_in_blocked');

    const colleague = await person(['Sale.Create'], { org: t.org });
    const notTheirStore = await signIn({ username: colleague.username, password: PASSWORD, terminalId: t.terminal });
    expect(notTheirStore.statusCode, 'a till of their organization, in a store where they hold nothing').toBe(403);
  });
});

describe('refusals are recorded (AU-03)', () => {
  it('AU-03: a request refused by the gate is recorded as Security.PermissionDenied, with the permission it lacked', async () => {
    const p = await person(['Sale.View']);
    const cookie = cookieOf(await signIn({ username: p.username, password: PASSWORD }));
    const refused = await app.inject({ method: 'GET', url: `/api/v1/stores/${p.store}/settings`, headers: { cookie } });
    expect(refused.statusCode).toBe(403);
    const { rows } = await db.app.query<{ actor_id: string; store_id: string; after: Record<string, unknown> }>(
      `SELECT actor_id, store_id, after FROM audit_event WHERE event_type = 'Security.PermissionDenied' AND actor_id = $1`,
      [p.employee],
    );
    expect(rows).toEqual([
      {
        actor_id: p.employee,
        store_id: p.store,
        after: { permission: 'Config.Store', method: 'GET', route: '/api/v1/stores/:storeId/settings', storeId: p.store },
      },
    ]);
  });
});
