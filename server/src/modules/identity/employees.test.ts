import { randomUUID } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionApp, signedInAs, testApp } from '../../../test/app.ts';
import { createTestDb, STAFF_ORGANIZATION, type TestDb } from '../../../test/db.ts';
import {
  actor,
  employeeWithAccess,
  insertOrganization,
  insertReasonCode,
  insertStore,
  tillWorld,
  withReason,
} from '../../../test/fixtures.ts';

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

/** An organization with a manager holding `keys` organization-wide (OQ-025 item 6), and a store they can access. */
async function managed(keys: string[]): Promise<{ org: string; store: string; manager: string; as: Record<string, string> }> {
  const org = await insertOrganization(db.app);
  const store = await insertStore(db.app, org);
  const manager = await employeeWithAccess(db.app, org, keys, { assignedStore: null, accessStores: [store] });
  return { org, store, manager, as: signedInAs(manager, org) };
}

const post = (url: string, as: Record<string, string>, payload: object) => app.inject({ method: 'POST', url, headers: as, payload });
const transition = (as: Record<string, string>, subject: string, event: string, extra: Record<string, unknown> = {}) =>
  post('/api/v1/transitions', as, { machine: 'Employee', event, subject, ...extra });

async function newEmployee(m: { as: Record<string, string> }): Promise<string> {
  const created = await post('/api/v1/employees', m.as, { employeeNumber: `E-${randomUUID()}`, firstName: 'Ada', lastName: 'Lovelace' });
  expect(created.statusCode).toBe(201);
  return created.json().id;
}

async function withLogin(m: { as: Record<string, string> }, employee: string): Promise<string> {
  const username = `u-${randomUUID()}`;
  const set = await app.inject({ method: 'PUT', url: `/api/v1/employees/${employee}/login`, headers: m.as, payload: { username, password: PASSWORD } });
  expect(set.statusCode).toBe(200);
  return username;
}

const signIn = (username: string, password = PASSWORD) =>
  real.inject({ method: 'POST', url: '/api/v1/session', payload: { username, password } });

const cookieOf = (response: LightMyRequestResponse) => {
  const header = String(response.headers['set-cookie']);
  return header.slice(0, header.indexOf(';'));
};

describe('employees (EM-01..EM-06, s22.9 creation, architecture s18.5)', () => {
  it('EM-01, s22.9, AU-05: an employee is created Active, by the signed-in employee, with Employee.Create held organization-wide', async () => {
    const m = await managed(['Employee.Create', 'Employee.View']);
    const id = await newEmployee(m);
    const row = await db.app.query('SELECT status, status_changed_by FROM employee WHERE id = $1', [id]);
    expect(row.rows).toEqual([{ status: 'Active', status_changed_by: m.manager }]);
    const event = await db.app.query("SELECT actor_id FROM audit_event WHERE entity_id = $1 AND event_type = 'Employee.StateChange'", [id]);
    expect(event.rows).toEqual([{ actor_id: m.manager }]);
    const contract = await db.app.query("SELECT creation_permission_key FROM state_machine_state WHERE machine = 'Employee' AND is_initial");
    expect(contract.rows, 'the route asks for the creation key of the s22.9 row').toEqual([{ creation_permission_key: 'Employee.Create' }]);

    const viewer = await managed(['Employee.View']);
    expect((await post('/api/v1/employees', viewer.as, { employeeNumber: 'X', firstName: 'A', lastName: 'B' })).statusCode).toBe(403);
    const storeOnly = await employeeWithAccess(db.app, m.org, ['Employee.Create'], { assignedStore: m.store, accessStores: [m.store] });
    const refused = await post('/api/v1/employees', signedInAs(storeOnly, m.org), { employeeNumber: 'X', firstName: 'A', lastName: 'B' });
    expect(refused.statusCode, 'an organization-level action needs an organization-wide assignment (OQ-025)').toBe(403);
  });

  it('EM-05: an employee number is used once in an organization', async () => {
    const m = await managed(['Employee.Create']);
    const employeeNumber = `E-${randomUUID()}`;
    expect((await post('/api/v1/employees', m.as, { employeeNumber, firstName: 'A', lastName: 'B' })).statusCode).toBe(201);
    const again = await post('/api/v1/employees', m.as, { employeeNumber, firstName: 'C', lastName: 'D' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toEqual({ code: 'duplicate', message: 'That employee number is already in use.' });
  });

  it("EM-06, MS-04, s18.5: details change, the status does not; lists page; another organization's employee is not found", async () => {
    const m = await managed(['Employee.Create', 'Employee.View', 'Employee.Edit']);
    const id = await newEmployee(m);
    await newEmployee(m);
    const patch = (payload: object) => app.inject({ method: 'PATCH', url: `/api/v1/employees/${id}`, headers: m.as, payload });
    expect((await patch({ firstName: 'Grace', department: 'Tills' })).statusCode).toBe(200);
    const read = await app.inject({ method: 'GET', url: `/api/v1/employees/${id}`, headers: m.as });
    expect(read.json()).toMatchObject({ firstName: 'Grace', department: 'Tills', status: 'Active', hasLogin: false });
    expect((await patch({ status: 'Suspended' })).statusCode, 'the status is not a detail').toBe(400);
    const foreignStore = await insertStore(db.app, await insertOrganization(db.app));
    expect((await patch({ homeStoreId: foreignStore })).json().error.code).toBe('invalid_reference');

    const first = await app.inject({ method: 'GET', url: '/api/v1/employees?limit=2', headers: m.as });
    expect(first.json().items).toHaveLength(2);
    const second = await app.inject({ method: 'GET', url: `/api/v1/employees?limit=2&after=${first.json().next}`, headers: m.as });
    expect(second.json().items).toHaveLength(1);

    const other = await managed(['Employee.View', 'Employee.Edit']);
    expect((await app.inject({ method: 'GET', url: `/api/v1/employees/${id}`, headers: other.as })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/employees/${id}`, headers: other.as, payload: { firstName: 'X' } })).statusCode).toBe(404);
  });
});

describe('logins and passwords (EM-02, EM-03, EM-04, SM-49)', () => {
  it('EM-02, EM-04: Employee.Password.Reset gives a login or sets a new password; the password is never stored or returned', async () => {
    const m = await managed(['Employee.Create', 'Employee.Password.Reset']);
    const id = await newEmployee(m);
    const username = await withLogin(m, id);
    const stored = await db.app.query<{ password_hash: string }>('SELECT password_hash FROM user_account WHERE employee_id = $1', [id]);
    expect(stored.rows[0]!.password_hash).toMatch(/^\$argon2id\$/);
    expect((await signIn(username)).statusCode).toBe(201);

    const reset = await app.inject({ method: 'PUT', url: `/api/v1/employees/${id}/login`, headers: m.as, payload: { username, password: 'TEST-ONLY new' } });
    expect(reset.json()).toEqual({ employeeId: id, username });
    expect((await signIn(username)).statusCode, 'the old password').toBe(401);
    expect((await signIn(username, 'TEST-ONLY new')).statusCode).toBe(201);

    const colleague = await newEmployee(m);
    const taken = await app.inject({ method: 'PUT', url: `/api/v1/employees/${colleague}/login`, headers: m.as, payload: { username: username.toUpperCase(), password: PASSWORD } });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.message).toBe('That username is already taken in this organization.');

    const other = await managed(['Employee.Password.Reset']);
    const foreign = await app.inject({ method: 'PUT', url: `/api/v1/employees/${colleague}/login`, headers: other.as, payload: { username: `x-${randomUUID()}`, password: PASSWORD } });
    expect(foreign.statusCode, "another organization's employee").toBe(404);
    expect((await db.app.query('SELECT 1 FROM user_account WHERE employee_id = $1', [colleague])).rows).toHaveLength(0);
  });

  it('EM-03, SM-49: an employee changes their own password with the current one; a wrong one counts as a failed sign-in', async () => {
    const m = await managed(['Employee.Create', 'Employee.Password.Reset']);
    const id = await newEmployee(m);
    const username = await withLogin(m, id);
    const own = (payload: object) => app.inject({ method: 'PUT', url: '/api/v1/session/password', headers: signedInAs(id, m.org), payload });
    const wrong = await own({ currentPassword: 'guess', newPassword: 'TEST-ONLY mine' });
    expect(wrong.statusCode).toBe(403);
    const account = await db.app.query<{ id: string }>('SELECT id FROM user_account WHERE employee_id = $1', [id]);
    const failed = await db.app.query("SELECT after FROM audit_event WHERE entity_id = $1 AND event_type = 'Security.LoginFailed'", [account.rows[0]!.id]);
    expect(failed.rows).toEqual([{ after: { reason: 'PasswordChange' } }]);
    expect((await own({ currentPassword: PASSWORD, newPassword: 'TEST-ONLY mine' })).statusCode).toBe(204);
    expect((await signIn(username, 'TEST-ONLY mine')).statusCode).toBe(201);
  });
});

describe('the transition endpoint, on the Employee machine (architecture s8.4, s18.1, s22.9)', () => {
  it('SM-47, AU-03: a suspension ends every live session of the employee, each recorded', async () => {
    const m = await managed(['Employee.Create', 'Employee.Password.Reset', 'Employee.Edit']);
    const id = await newEmployee(m);
    const cookie = cookieOf(await signIn(await withLogin(m, id)));
    const suspended = await transition(m.as, id, 'suspend');
    expect(suspended.statusCode).toBe(200);
    expect(suspended.json()).toEqual({ subject: id, state: 'Suspended', changed: true });
    expect((await real.inject({ method: 'GET', url: '/api/v1/session', headers: { cookie } })).statusCode).toBe(401);
    const ended = await db.app.query(
      `SELECT s.end_reason, e.actor_id FROM user_session s JOIN audit_event e ON e.entity_id = s.id AND e.event_type = 'Security.SessionEnded'
       WHERE s.employee_id = $1`,
      [id],
    );
    expect(ended.rows).toEqual([{ end_reason: 'Revoked', actor_id: m.manager }]);
  });

  it('SM-04, SM-06: repeating a transition already made changes nothing; an illegal one is refused by name', async () => {
    const m = await managed(['Employee.Create', 'Employee.Edit']);
    const id = await newEmployee(m);
    expect((await transition(m.as, id, 'suspend')).json().changed).toBe(true);
    const again = await transition(m.as, id, 'suspend');
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ subject: id, state: 'Suspended', changed: false });
    const archive = await transition(m.as, id, 'archive');
    expect(archive.statusCode).toBe(409);
    expect(archive.json().error).toEqual({ code: 'illegal_transition', message: 'This employee is Suspended, so it cannot archive.' });
  });

  it("s8.4, AU-03: the permission checked is the edge's own; a refusal names it and is recorded", async () => {
    const m = await managed(['Employee.Create', 'Employee.Edit']);
    const id = await newEmployee(m);
    const terminate = await transition(m.as, id, 'terminate');
    expect(terminate.statusCode).toBe(403);
    expect(terminate.json().error.message).toBe('You do not have access to this: it needs the Employee.Terminate permission for the whole organization.');
    const denied = await db.app.query(
      "SELECT after FROM audit_event WHERE event_type = 'Security.PermissionDenied' AND actor_id = $1",
      [m.manager],
    );
    expect(denied.rows).toEqual([
      {
        after: {
          permission: 'Employee.Terminate',
          method: 'POST',
          route: '/api/v1/transitions',
          storeId: null,
          machine: 'Employee',
          event: 'terminate',
          subject: id,
          rule: 'Key',
        },
      },
    ]);
    expect((await db.app.query('SELECT status FROM employee WHERE id = $1', [id])).rows).toEqual([{ status: 'Active' }]);
  });

  it('SM-02d, OQ-025: an edge whose permission is undecided refuses everyone, even a holder of every key', async () => {
    const m = await managed(['Employee.Create', 'Employee.Edit']);
    const id = await newEmployee(m);
    await transition(m.as, id, 'suspend');
    const everything = await employeeWithAccess(db.app, m.org, [], { assignedStore: null, accessStores: [] });
    await db.app.query(
      `INSERT INTO role_permission (role_id, organization_id, permission_key, granted_by)
       SELECT a.role_id, a.organization_id, p.key, $2 FROM employee_role_assignment a, permission p WHERE a.employee_id = $1`,
      [everything, actor()],
    );
    const reactivate = await transition(signedInAs(everything, m.org), id, 'reactivate');
    expect(reactivate.statusCode).toBe(403);
    expect(reactivate.json().error.code).toBe('not_permitted');
    expect((await db.app.query('SELECT status FROM employee WHERE id = $1', [id])).rows).toEqual([{ status: 'Suspended' }]);
  });

  it('SS055, D-06, AU-05: an edge that needs a reason refuses without one, and records it, with the actor, when given', async () => {
    const m = await managed(['Employee.Create', 'Employee.Edit']);
    const id = await newEmployee(m);
    const missing = await transition(m.as, id, 'leave');
    expect(missing.statusCode).toBe(409);
    expect(missing.json().error).toEqual({ code: 'SS055', message: 'This needs a reason. Choose one and try again.' });
    const reason = await insertReasonCode(db.app, m.org);
    const operation = randomUUID();
    // Someone other than the creator, so that who changed it cannot be left over from the creation.
    const editor = await employeeWithAccess(db.app, m.org, ['Employee.Edit'], { assignedStore: null, accessStores: [] });
    const leave = await transition(signedInAs(editor, m.org), id, 'leave', { reasonCodeId: reason, clientOperationId: operation });
    expect(leave.json().state).toBe('OnLeave');
    const row = await db.app.query('SELECT status, status_changed_by FROM employee WHERE id = $1', [id]);
    expect(row.rows, 'who changed it is the session').toEqual([{ status: 'OnLeave', status_changed_by: editor }]);
    const event = await db.app.query(
      "SELECT actor_id, reason_code_id, client_operation_id FROM audit_event WHERE entity_id = $1 AND event_type = 'Employee.StateChange' ORDER BY seq DESC LIMIT 1",
      [id],
    );
    expect(event.rows).toEqual([{ actor_id: editor, reason_code_id: reason, client_operation_id: operation }]);
  });

  it('EM-10, SS057: an employee with a till shift that is not closed cannot be terminated', async () => {
    const t = await tillWorld(db.app);
    const hr = await employeeWithAccess(db.app, STAFF_ORGANIZATION, ['Employee.Terminate'], { assignedStore: null, accessStores: [] });
    const refused = await transition(signedInAs(hr, STAFF_ORGANIZATION), t.cashier, 'terminate');
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('SS057');
  });

  it('ADR-25: the subject is locked before its edge is chosen, so a concurrent change decides the outcome by name', async () => {
    const m = await managed(['Employee.Create', 'Employee.Edit']);
    const id = await newEmployee(m);
    const reason = await insertReasonCode(db.app, m.org);
    const holder = await db.app.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM employee WHERE id = $1 FOR UPDATE', [id]);
      const pending = transition(m.as, id, 'suspend');
      await new Promise((resolve) => setTimeout(resolve, 300));
      await holder.query(`SELECT set_config('smartstore.reason_code_id', $1, true)`, [reason]);
      await holder.query("UPDATE employee SET status = 'OnLeave', status_changed_by = $2 WHERE id = $1", [id, actor()]);
      await holder.query('COMMIT');
      const response = await pending;
      expect(response.statusCode).toBe(409);
      expect(response.json().error, 'decided on the state it waited for, not the one it first saw').toEqual({
        code: 'illegal_transition',
        message: 'This employee is OnLeave, so it cannot suspend.',
      });
    } finally {
      holder.release();
    }
  });

  it("MS-04, architecture s24.3: another organization's employee is not found, and an unknown machine is refused", async () => {
    const m = await managed(['Employee.Create', 'Employee.Edit']);
    const id = await newEmployee(m);
    const other = await managed(['Employee.Edit']);
    expect((await transition(other.as, id, 'suspend')).statusCode).toBe(404);
    expect((await post('/api/v1/transitions', m.as, { machine: 'Spaceship', event: 'launch', subject: id })).statusCode).toBe(400);
  });

  it('employee-domain s3: an employee on leave cannot make a transition', async () => {
    const m = await managed(['Employee.Create', 'Employee.Edit', 'Employee.Password.Reset']);
    const id = await newEmployee(m);
    const username = await withLogin(m, id);
    await db.app.query('INSERT INTO employee_role_assignment (employee_id, role_id, organization_id, assigned_by) SELECT $1, role_id, organization_id, $2 FROM employee_role_assignment WHERE employee_id = $3', [
      id,
      actor(),
      m.manager,
    ]);
    await withReason(db.app, await insertReasonCode(db.app, m.org), "UPDATE employee SET status = 'OnLeave', status_changed_by = $2 WHERE id = $1", [id, actor()]);
    const cookie = cookieOf(await signIn(username));
    const target = await newEmployee(m);
    const refused = await real.inject({ method: 'POST', url: '/api/v1/transitions', headers: { cookie }, payload: { machine: 'Employee', event: 'suspend', subject: target } });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe('read_only');
  });
});
