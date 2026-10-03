import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, sqlState, type TestDb } from './db.ts';
import {
  actor,
  ensureTestCurrency,
  insertCategory,
  insertOrganization,
  insertReasonCode,
  insertStore,
  tillWorld,
  withReason,
} from './fixtures.ts';

/** Domain 7 — Employee / Role / Permission. Design: docs/database/D7-EMPLOYEE-ROLE-PERMISSION.md */

/** The five keys owner decision D-16 added to the catalogue. */
const ADDED_BY_D17 = ['Return.View', 'Refund.View'];
const ADDED_BY_D16 = ['Payment.Capture', 'Payment.Void', 'Employee.Reactivate', 'Refund.Pay', 'Shift.Reopen'];

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
  await ensureTestCurrency(db.owner);
});
afterAll(async () => {
  await db.drop();
});

async function employee(org: string, contact: { email?: string; phone?: string } = {}): Promise<string> {
  const { rows } = await db.app.query<{ id: string }>(
    `INSERT INTO employee (organization_id, employee_number, first_name, last_name, email, phone, status_changed_by)
     VALUES ($1, $2, 'Ada', 'Lovelace', $3, $4, $5) RETURNING id`,
    [org, `E-${randomUUID()}`, contact.email ?? null, contact.phone ?? null, actor()],
  );
  return rows[0]!.id;
}

const setStatus = (id: string, status: string) =>
  db.app.query('UPDATE employee SET status = $2, status_changed_by = $3 WHERE id = $1', [id, status, actor()]);
const setStatusWithReason = (id: string, status: string, reason: string) =>
  withReason(db.app, reason, 'UPDATE employee SET status = $2, status_changed_by = $3 WHERE id = $1', [id, status, actor()]);

const bcrypt12 = `$2b$12$${'a'.repeat(53)}`;
const argon2id = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA';

async function account(org: string, employeeId: string, username = `user-${randomUUID()}`): Promise<string> {
  const { rows } = await db.app.query<{ id: string }>(
    `INSERT INTO user_account (organization_id, employee_id, username, password_hash) VALUES ($1, $2, $3, $4) RETURNING id`,
    [org, employeeId, username, argon2id],
  );
  return rows[0]!.id;
}

describe('employees (EM-01..EM-11, s22.9)', () => {
  it('EM-01, EM-02, SM-48a: an employee is created Active, with or without a login, and a login is exactly one employee\'s', async () => {
    const org = await insertOrganization(db.app);
    const e = await employee(org);
    const { rows } = await db.app.query<{ status: string }>('SELECT status FROM employee WHERE id = $1', [e]);
    expect(rows[0]!.status).toBe('Active');
    await account(org, e);
    expect(await sqlState(account(org, e)), 'a second login for the same person').toBe('23505');
    const elsewhere = await insertOrganization(db.app);
    expect(await sqlState(account(elsewhere, await employee(org))), 'a login in another organization').toBe('23503');
  });

  it('EM-05: an employee number is unique within its organization', async () => {
    const org = await insertOrganization(db.app);
    const insert = (o: string) =>
      db.app.query(
        `INSERT INTO employee (organization_id, employee_number, first_name, last_name, status_changed_by)
         VALUES ($1, 'E-001', 'Grace', 'Hopper', $2)`,
        [o, actor()],
      );
    await insert(org);
    expect(await sqlState(insert(org))).toBe('23505');
    expect(await sqlState(insert(await insertOrganization(db.app)))).toBeUndefined();
  });

  it('SM-48a, SM-50, s22.9: the contract\'s edges, their reasons, and nothing out of Terminated but Archived', async () => {
    const org = await insertOrganization(db.app);
    const reason = await insertReasonCode(db.app, org);
    const e = await employee(org);
    expect(await sqlState(setStatus(e, 'OnLeave')), 'leave needs a reason').toBe('SS055');
    await setStatusWithReason(e, 'OnLeave', reason);
    await setStatus(e, 'Active');
    await setStatus(e, 'Suspended');
    expect(await sqlState(setStatus(e, 'Active')), 'a reactivation needs a reason').toBe('SS055');
    await setStatusWithReason(e, 'Active', reason);
    await setStatus(e, 'Terminated');
    expect(await sqlState(setStatusWithReason(e, 'Active', reason)), 'EM-08: no un-terminate').toBe('SS004');
    expect(await sqlState(setStatus(e, 'Archived')), 'archiving needs a reason').toBe('SS055');
    await setStatusWithReason(e, 'Archived', reason);
    expect(await sqlState(setStatusWithReason(e, 'Active', reason)), 'Archived is terminal').toBe('SS004');

    const other = await employee(org);
    expect(await sqlState(setStatusWithReason(other, 'Archived', reason)), 'Active -> Archived is only drawn (OQ-025)').toBe('SS004');
    await setStatus(other, 'Suspended');
    expect(await sqlState(setStatus(other, 'Terminated')), 'Suspended -> Terminated is only drawn (OQ-025)').toBe('SS004');
  });

  it('EM-10: termination is refused while the employee has a till shift that is not closed', async () => {
    const t = await tillWorld(db.app, { stock: 0 });
    expect(await sqlState(setStatus(t.cashier, 'Terminated'))).toBe('SS057');
    expect(await sqlState(setStatus(actor(), 'Terminated')), 'an employee with no open shift').toBeUndefined();
  });

  it('D-06, EM-10: employee transitions record their contracted events, and a suspension records none of its own', async () => {
    const org = await insertOrganization(db.app);
    const reason = await insertReasonCode(db.app, org);
    const e = await employee(org);
    await setStatusWithReason(e, 'OnLeave', reason);
    await setStatus(e, 'Active');
    await setStatus(e, 'Suspended');
    await setStatusWithReason(e, 'Active', reason);
    await setStatus(e, 'Terminated');
    await setStatusWithReason(e, 'Archived', reason);
    const { rows } = await db.app.query<{ event_type: string; reason_code_id: string | null }>(
      'SELECT event_type, reason_code_id FROM audit_event WHERE entity_id = $1 ORDER BY seq',
      [e],
    );
    expect(rows).toEqual([
      { event_type: 'Employee.StateChange', reason_code_id: null },
      { event_type: 'Employee.StateChange', reason_code_id: reason },
      { event_type: 'Employee.StateChange', reason_code_id: null },
      { event_type: 'Employee.StateChange', reason_code_id: reason },
      { event_type: 'Employee.Terminate', reason_code_id: null },
      { event_type: 'Employee.StateChange', reason_code_id: reason },
    ]);
  });

  it('AU-09, CU-35, RT-295: an employee\'s name and contact details are redacted in the audit trail at write time', async () => {
    const org = await insertOrganization(db.app);
    const e = await employee(org, { email: 'ada@example.test' });
    const { rows } = await db.owner.query<{ after: Record<string, unknown> }>(
      `SELECT after FROM audit_event WHERE entity_id = $1 AND event_type = 'Employee.StateChange'`,
      [e],
    );
    expect(rows[0]!.after).toMatchObject({
      first_name: '[redacted]',
      last_name: '[redacted]',
      email: '[redacted]',
      phone: null,
      status: 'Active',
      organization_id: org,
    });
    const stored = await db.owner.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit_event WHERE entity_id = $1 AND (after::text LIKE '%Lovelace%' OR after::text LIKE '%ada@%')`,
      [e],
    );
    expect(stored.rows[0]!.n, 'a direct database read shows no personal data').toBe('0');
  });
});

describe('logins and sessions (EM-02, EM-04, ADR-12)', () => {
  it('EM-04, ADR-12: only an Argon2id hash, or a bcrypt hash of cost 12 or more, is stored; never a password', async () => {
    const org = await insertOrganization(db.app);
    const insert = (hash: string) =>
      db.app.query(`INSERT INTO user_account (organization_id, employee_id, username, password_hash) VALUES ($1, $2, $3, $4)`, [
        org,
        randomUUID(),
        `u-${randomUUID()}`,
        hash,
      ]);
    const refused = async (hash: string) => {
      const e = await employee(org);
      return sqlState(
        db.app.query(`INSERT INTO user_account (organization_id, employee_id, username, password_hash) VALUES ($1, $2, $3, $4)`, [
          org,
          e,
          `u-${randomUUID()}`,
          hash,
        ]),
      );
    };
    expect(await refused('hunter2'), 'a plain password').toBe('23514');
    expect(await refused(`$2b$10$${'a'.repeat(53)}`), 'bcrypt below cost 12').toBe('23514');
    expect(await refused('$argon2i$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA'), 'Argon2i, not Argon2id').toBe('23514');
    expect(await refused(bcrypt12)).toBeUndefined();
    expect(await refused(argon2id)).toBeUndefined();
    expect(await sqlState(insert(argon2id)), 'no such employee').toBe('23503');

    const e = await employee(org);
    const id = await account(org, e);
    const { rows } = await db.app.query<{ changed: boolean }>(
      'UPDATE user_account SET password_hash = $2 WHERE id = $1 RETURNING password_changed_at = now() AS changed',
      [id, bcrypt12],
    );
    expect(rows[0]!.changed).toBe(true);
  });

  it('EM-02, OQ-025: a username names one login in its organization, whatever its case', async () => {
    const org = await insertOrganization(db.app);
    await account(org, await employee(org), 'Alice');
    expect(await sqlState(account(org, await employee(org), 'alice'))).toBe('23505');
    const other = await insertOrganization(db.app);
    expect(await sqlState(account(other, await employee(other), 'alice'))).toBeUndefined();
  });

  it('ADR-12, AU-12a, EM-16: a session keeps only its token\'s hash, ends once with its cause, and is kept', async () => {
    const t = await tillWorld(db.app, { stock: 0 });
    const e = await employee(t.org);
    const acct = await account(t.org, e);
    const open = (token: Buffer, terminal: string | null = t.terminal, expiresIn = '8 hours') =>
      db.app.query<{ id: string }>(
        `INSERT INTO user_session (organization_id, user_account_id, employee_id, token_hash, pos_terminal_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + $6::interval) RETURNING id`,
        [t.org, acct, e, token, terminal, expiresIn],
      );
    const token = randomBytes(32);
    const { rows } = await open(token);
    const id = rows[0]!.id;
    expect(await sqlState(open(token)), 'one session per token').toBe('23505');
    expect(await sqlState(open(randomBytes(16))), 'a token kept as itself').toBe('23514');
    expect(await sqlState(open(randomBytes(32), null, '-1 minute')), 'already expired').toBe('23514');
    const foreign = await tillWorld(db.app, { stock: 0 });
    expect(await sqlState(open(randomBytes(32), foreign.terminal)), "another organization's till").toBe('23503');

    const end = (reason: string) => db.app.query('UPDATE user_session SET end_reason = $2 WHERE id = $1', [id, reason]);
    expect(await sqlState(end('Whenever')), 'an unknown cause').toBe('23514');
    await end('Logout');
    const ended = await db.app.query<{ ended: boolean }>('SELECT ended_at IS NOT NULL AS ended FROM user_session WHERE id = $1', [id]);
    expect(ended.rows[0]!.ended).toBe(true);
    expect(await sqlState(end('Revoked')), 'ended once').toBe('SS001');
    expect(await sqlState(db.app.query('DELETE FROM user_session WHERE id = $1', [id])), 'never deleted').toBe('42501');
  });
});

describe('permissions (AC-01, AC-02, EM-13, MS-11, MS-12)', () => {
  interface Access {
    org: string;
    storeA: string;
    storeB: string;
    person: string;
    role: string;
  }

  async function world(keys: string[]): Promise<Access> {
    const org = await insertOrganization(db.app);
    const storeA = await insertStore(db.app, org);
    const storeB = await insertStore(db.app, org);
    const person = await employee(org);
    const role = (
      await db.app.query<{ id: string }>(`INSERT INTO role (organization_id, name) VALUES ($1, $2) RETURNING id`, [
        org,
        `Role ${randomUUID()}`,
      ])
    ).rows[0]!.id;
    for (const key of keys) {
      await db.app.query(`INSERT INTO role_permission (role_id, organization_id, permission_key, granted_by) VALUES ($1, $2, $3, $4)`, [
        role,
        org,
        key,
        actor(),
      ]);
    }
    return { org, storeA, storeB, person, role };
  }
  const assign = (w: Access, store: string | null) =>
    db.app.query<{ id: string }>(
      `INSERT INTO employee_role_assignment (employee_id, role_id, organization_id, store_id, assigned_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [w.person, w.role, w.org, store, actor()],
    );
  const access = (w: Access, store: string, from: string | null = null, to: string | null = null) =>
    db.app.query<{ id: string }>(
      `INSERT INTO employee_store_access (employee_id, store_id, organization_id, valid_from, valid_to, granted_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [w.person, store, w.org, from, to, actor()],
    );
  const holds = async (w: Access, store: string | null, key: string) =>
    (await db.app.query<{ ok: boolean }>('SELECT employee_holds_permission($1, $2, $3) AS ok', [w.person, store, key])).rows[0]!.ok;

  it('AC-02, D-01, D-16, RT-009: the catalogue is exactly the 124 keys of actors-and-roles s2, and only a catalogue key can be granted', async () => {
    const { rows } = await db.app.query<{ n: string }>('SELECT count(*) AS n FROM permission');
    expect(rows[0]!.n).toBe('124');
    for (const key of ['Product.Edit', 'Sale.Refund.Large.Approve', 'Inventory.Count.Post', 'Backup.Restore', ...ADDED_BY_D16, ...ADDED_BY_D17]) {
      expect((await db.app.query('SELECT 1 FROM permission WHERE key = $1', [key])).rows, key).toHaveLength(1);
    }
    const w = await world([]);
    const grant = (key: string) =>
      db.app.query(`INSERT INTO role_permission (role_id, organization_id, permission_key, granted_by) VALUES ($1, $2, $3, $4)`, [
        w.role,
        w.org,
        key,
        actor(),
      ]);
    expect(await sqlState(grant('Product.*')), 'a wildcard is not a key').toBe('23503');
    expect(await sqlState(grant('Refund.Large.Approve')), 'a name used in s4 but not in the catalogue').toBe('23503');
  });

  it("D-16, actors-and-roles s3.2, s4: when keys join the catalogue, a role that held every other key is given them, in its first granter's name; no other role is", async () => {
    const everyOther = (await db.app.query<{ key: string }>('SELECT key FROM permission WHERE key <> ALL ($1)', [ADDED_BY_D16])).rows.map((r) => r.key);
    // A role written as an Owner's role was before D-16: every key then in the catalogue. The first was granted by one
    // person and the rest by another, so that whose name the new grants carry is a real choice.
    const complete = await world([]);
    const granter = actor();
    const later = actor();
    for (const [i, key] of everyOther.entries()) {
      await db.app.query('INSERT INTO role_permission (role_id, organization_id, permission_key, granted_by) VALUES ($1, $2, $3, $4)', [
        complete.role, complete.org, key, i === 0 ? granter : later,
      ]);
    }
    const partial = await world(everyOther.slice(1));
    const archived = await world([]);
    for (const key of everyOther) {
      await db.app.query('INSERT INTO role_permission (role_id, organization_id, permission_key, granted_by) VALUES ($1, $2, $3, $4)', [
        archived.role, archived.org, key, granter,
      ]);
    }
    await db.app.query('UPDATE role SET archived_by = $2 WHERE id = $1', [archived.role, actor()]);

    const granted = await db.owner.query<{ n: number }>('SELECT grant_to_complete_roles($1) AS n', [ADDED_BY_D16]);
    expect(granted.rows[0]!.n, 'five keys, to the one complete live role').toBe(5);
    const held = async (role: string) =>
      (await db.app.query<{ permission_key: string; granted_by: string }>(
        'SELECT permission_key, granted_by FROM role_permission WHERE role_id = $1 AND permission_key = ANY ($2) AND revoked_at IS NULL ORDER BY permission_key',
        [role, ADDED_BY_D16],
      )).rows;
    expect(await held(complete.role)).toEqual([...ADDED_BY_D16].sort().map((key) => ({ permission_key: key, granted_by: granter })));
    expect(await held(partial.role), 'a role missing one key held nothing complete').toEqual([]);
    expect(await held(archived.role), 'an archived role grants nothing, and is given nothing').toEqual([]);
    expect((await db.owner.query<{ n: number }>('SELECT grant_to_complete_roles($1) AS n', [ADDED_BY_D16])).rows[0]!.n, 'given once').toBe(0);
    expect(await sqlState(db.app.query('SELECT grant_to_complete_roles($1)', [ADDED_BY_D16])), 'for migrations only').toBe('42501');
  });

  it('AC-01, EM-13: no assignment, or an assignment without store access, grants nothing', async () => {
    const w = await world(['Sale.Create']);
    expect(await holds(w, w.storeA, 'Sale.Create'), 'no role at all').toBe(false);
    await assign(w, w.storeA);
    expect(await holds(w, w.storeA, 'Sale.Create'), 'a role without store access').toBe(false);
    await access(w, w.storeA);
    expect(await holds(w, w.storeA, 'Sale.Create')).toBe(true);
  });

  it('AC-02: a permission is matched exactly, never by prefix', async () => {
    const w = await world(['Sale.Create']);
    await assign(w, null);
    await access(w, w.storeA);
    for (const key of ['Sale', 'Sale.Create.Anything', 'sale.create', 'Sale.Refund']) {
      expect(await holds(w, w.storeA, key), key).toBe(false);
    }
  });

  it('MS-11, MS-12: a store assignment applies in its store; an organization-wide one in every store the employee can access', async () => {
    const w = await world(['Sale.Create']);
    await assign(w, w.storeA);
    await access(w, w.storeA);
    await access(w, w.storeB);
    expect(await holds(w, w.storeA, 'Sale.Create')).toBe(true);
    expect(await holds(w, w.storeB, 'Sale.Create'), 'assigned to store A only').toBe(false);
    await assign(w, null);
    expect(await holds(w, w.storeB, 'Sale.Create'), 'organization-wide').toBe(true);
    expect(await holds(w, await insertStore(db.app, w.org), 'Sale.Create'), 'a store without access').toBe(false);
  });

  it('OQ-025: an organization-level action needs an organization-wide assignment', async () => {
    const w = await world(['Product.Edit']);
    await assign(w, w.storeA);
    await access(w, w.storeA);
    expect(await holds(w, null, 'Product.Edit'), 'a store assignment').toBe(false);
    await assign(w, null);
    expect(await holds(w, null, 'Product.Edit')).toBe(true);
  });

  it('EM-12, EM-15, PC-01, BI-40: a revoked key, an archived role, a revoked assignment, a closed access window, and a revoked access each grant nothing', async () => {
    const w = await world(['Sale.Create', 'Sale.View']);
    await assign(w, null);
    const grant = (await access(w, w.storeA)).rows[0]!.id;
    expect(await holds(w, w.storeA, 'Sale.Create')).toBe(true);

    await db.app.query(`UPDATE role_permission SET revoked_by = $3 WHERE role_id = $1 AND permission_key = $2`, [
      w.role,
      'Sale.Create',
      actor(),
    ]);
    expect(await holds(w, w.storeA, 'Sale.Create'), 'the key was revoked from the role').toBe(false);
    expect(await holds(w, w.storeA, 'Sale.View'), 'the rest of the role stands').toBe(true);

    await db.app.query('UPDATE employee_store_access SET revoked_by = $2 WHERE id = $1', [grant, actor()]);
    expect(await holds(w, w.storeA, 'Sale.View'), 'store access revoked').toBe(false);
    await access(w, w.storeA, null, new Date(Date.now() - 60_000).toISOString());
    expect(await holds(w, w.storeA, 'Sale.View'), 'an access window that has closed').toBe(false);
    await access(w, w.storeB, new Date(Date.now() + 86_400_000).toISOString(), null);
    expect(await holds(w, w.storeB, 'Sale.View'), 'an access window not yet open').toBe(false);

    const w2 = await world(['Sale.View']);
    await assign(w2, null);
    await access(w2, w2.storeA);
    await db.app.query('UPDATE role SET archived_by = $2 WHERE id = $1', [w2.role, actor()]);
    expect(await holds(w2, w2.storeA, 'Sale.View'), 'an archived role').toBe(false);

    const w3 = await world(['Sale.View']);
    const assignment = (await assign(w3, null)).rows[0]!.id;
    await access(w3, w3.storeA);
    expect(await holds(w3, w3.storeA, 'Sale.View')).toBe(true);
    await db.app.query('UPDATE employee_role_assignment SET revoked_by = $2 WHERE id = $1', [assignment, actor()]);
    expect(await holds(w3, w3.storeA, 'Sale.View'), 'the assignment was revoked').toBe(false);
    expect(await sqlState(db.app.query('UPDATE employee_role_assignment SET revoked_by = $2 WHERE id = $1', [assignment, actor()])), 'revoked once').toBe('SS001');
    for (const table of ['role_permission', 'employee_role_assignment', 'employee_store_access', 'role']) {
      expect(await sqlState(db.app.query(`DELETE FROM ${table} WHERE organization_id = $1`, [w.org])), table).toBe('42501');
    }
  });

  it('AC-02, MS-11: one live grant of a key per role, one live assignment per role and scope, one live access per store', async () => {
    const w = await world(['Sale.Create']);
    const again = db.app.query(`INSERT INTO role_permission (role_id, organization_id, permission_key, granted_by) VALUES ($1, $2, 'Sale.Create', $3)`, [
      w.role,
      w.org,
      actor(),
    ]);
    expect(await sqlState(again), 'the same key twice').toBe('23505');
    await assign(w, null);
    expect(await sqlState(assign(w, null)), 'the same organization-wide assignment twice').toBe('23505');
    await assign(w, w.storeA);
    expect(await sqlState(assign(w, w.storeA)), 'the same store assignment twice').toBe('23505');
    await access(w, w.storeA);
    expect(await sqlState(access(w, w.storeA)), 'the same store access twice').toBe('23505');
  });

  it('RT-020, AU-03: every role assignment and every removal records Security.Role.Assign', async () => {
    const w = await world(['Sale.Create']);
    const id = (await assign(w, w.storeA)).rows[0]!.id;
    await db.app.query('UPDATE employee_role_assignment SET revoked_by = $2 WHERE id = $1', [id, actor()]);
    const { rows } = await db.app.query<{ event_type: string; before: Record<string, unknown> | null; after: Record<string, unknown> }>(
      'SELECT event_type, before, after FROM audit_event WHERE entity_id = $1 ORDER BY seq',
      [id],
    );
    expect(rows.map((r) => r.event_type)).toEqual(['Security.Role.Assign', 'Security.Role.Assign']);
    expect(rows[0]!.after).toMatchObject({ role_id: w.role, store_id: w.storeA });
    expect(rows[1]!.before).toMatchObject({ revoked_by: null });
    expect(Object.keys(rows[1]!.after).sort()).toEqual(['revoked_at', 'revoked_by']);
    const forged = db.app.query(`SELECT record_audit_event('Security.Role.Assign', $1, NULL, 'employee_role_assignment', $2, NULL)`, [
      w.org,
      id,
    ]);
    expect(await sqlState(forged), 'the application cannot record an assignment that did not happen').toBe('SS056');
  });
});

describe('the permission each transition needs (architecture s8.4, SM-02d, D-01)', () => {
  it('SM-02d, D-01, D-16: every creation and edge of the built machines names its permission as its s22 row does', async () => {
    type Row = [string, string, string, string | null, string | null];
    const key = (machine: string, from: string, to: string, k: string): Row => [machine, from, to, 'Key', k];
    const system = (machine: string, from: string, to: string): Row => [machine, from, to, 'System', null];
    const none = (machine: string, to: string): Row => [machine, '*', to, null, null];
    const contract: Row[] = [
      none('Product', 'Draft'),
      key('Product', 'Draft', 'Active', 'Product.Edit'),
      key('Product', 'Active', 'Discontinued', 'Product.Edit'),
      key('Product', 'Discontinued', 'Active', 'Product.Edit'),
      key('Product', 'Active', 'Hidden', 'Product.Edit'),
      key('Product', 'Hidden', 'Active', 'Product.Edit'),
      ...['Draft', 'Active', 'Discontinued', 'Hidden'].map((from) => key('Product', from, 'Archived', 'Product.Archive')),
      none('StockAdjustment', 'Draft'),
      key('StockAdjustment', 'Draft', 'PendingApproval', 'Inventory.Adjust'),
      key('StockAdjustment', 'PendingApproval', 'Approved', 'Inventory.Adjust.Large.Approve'),
      key('StockAdjustment', 'Approved', 'Posted', 'Inventory.Adjust'),
      key('StockAdjustment', 'Draft', 'Cancelled', 'Inventory.Adjust'),
      key('StockAdjustment', 'Posted', 'Reversed', 'Inventory.Adjust'),
      key('Sale', '*', 'Completed', 'Sale.Create'),
      key('Sale', 'Completed', 'Voided', 'Sale.Void'),
      key('Sale', 'Completed', 'PartiallyReturned', 'Return.Create'),
      key('Sale', 'PartiallyReturned', 'Returned', 'Return.Create'),
      key('Payment', '*', 'Pending', 'Sale.Create'),
      system('Payment', 'Pending', 'Authorized'),
      key('Payment', 'Authorized', 'Captured', 'Payment.Capture'),
      key('Payment', 'Pending', 'Voided', 'Payment.Void'),
      key('Payment', 'Authorized', 'Voided', 'Payment.Void'),
      system('Payment', 'Pending', 'Declined'),
      system('Payment', 'Pending', 'Failed'),
      key('Shift', '*', 'Open', 'Shift.Open'),
      key('Shift', 'Open', 'Reconciling', 'Shift.Close'),
      key('Shift', 'Reconciling', 'Closed', 'Shift.Close'),
      key('Shift', 'Closed', 'Reopened', 'Shift.Reopen'),
      key('Shift', 'Reopened', 'Reconciling', 'Shift.Close'),
      key('Device', '*', 'Registered', 'Device.Register'),
      key('Device', 'Registered', 'Active', 'Device.Edit'),
      key('Device', 'Active', 'Disabled', 'Device.Disable'),
      key('Device', 'Disabled', 'Active', 'Device.Disable'),
      ...['Registered', 'Active', 'Disabled'].map((from) => key('Device', from, 'Retired', 'Device.Edit')),
      none('CustomerReturn', 'Draft'),
      key('CustomerReturn', 'Draft', 'Posted', 'Return.Create'),
      key('CustomerReturn', 'Draft', 'Cancelled', 'Return.Create'),
      none('Refund', 'Draft'),
      key('Refund', 'Draft', 'Cancelled', 'Sale.Refund'), // D-17 item 5: a draft is withdrawn
      key('Refund', 'Draft', 'PendingApproval', 'Sale.Refund'),
      key('Refund', 'PendingApproval', 'Approved', 'Sale.Refund.Large.Approve'),
      key('Refund', 'Approved', 'Processing', 'Refund.Pay'),
      system('Refund', 'Processing', 'Completed'),
      system('Refund', 'Processing', 'Failed'),
      key('Refund', 'Failed', 'Cancelled', 'Sale.Refund'), // D-19: a failed refund is cancelled
      key('Refund', 'Failed', 'Processing', 'Sale.Refund'),
      key('Refund', 'Approved', 'Cancelled', 'Sale.Refund'),
      key('Refund', 'Processing', 'Cancelled', 'Sale.Refund'),
      key('Employee', '*', 'Active', 'Employee.Create'),
      key('Employee', 'Active', 'OnLeave', 'Employee.Edit'),
      key('Employee', 'OnLeave', 'Active', 'Employee.Edit'),
      key('Employee', 'Active', 'Suspended', 'Employee.Edit'),
      key('Employee', 'Suspended', 'Active', 'Employee.Reactivate'),
      key('Employee', 'Active', 'Terminated', 'Employee.Terminate'),
      key('Employee', 'OnLeave', 'Terminated', 'Employee.Terminate'),
      key('Employee', 'Terminated', 'Archived', 'Employee.Edit'),
    ];
    const { rows } = await db.app.query<{ machine: string; from_state: string; to_state: string; rule: string | null; key: string | null }>(
      `SELECT machine, '*' AS from_state, state AS to_state, creation_permission_rule AS rule, creation_permission_key AS key
       FROM state_machine_state WHERE is_initial
       UNION ALL
       SELECT machine, from_state, to_state, permission_rule, permission_key FROM state_machine_edge`,
    );
    const text = (r: unknown[]) => JSON.stringify(r);
    expect(rows.map((r) => text([r.machine, r.from_state, r.to_state, r.rule, r.key])).sort()).toEqual(contract.map(text).sort());
  });

  it('D-06, SM-50: the employee machine records the events of its s22.9 row, and its reasons', async () => {
    const { rows } = await db.app.query<{ from_state: string; to_state: string; type: string | null; reason: boolean }>(
      `SELECT '*' AS from_state, state AS to_state, creation_audit_event_type AS type, false AS reason
       FROM state_machine_state WHERE machine = 'Employee' AND is_initial
       UNION ALL
       SELECT from_state, to_state, audit_event_type, requires_reason FROM state_machine_edge WHERE machine = 'Employee'
       ORDER BY 1, 2`,
    );
    expect(rows).toEqual([
      { from_state: '*', to_state: 'Active', type: 'Employee.StateChange', reason: false },
      { from_state: 'Active', to_state: 'OnLeave', type: 'Employee.StateChange', reason: true },
      { from_state: 'Active', to_state: 'Suspended', type: null, reason: false },
      { from_state: 'Active', to_state: 'Terminated', type: 'Employee.Terminate', reason: false },
      { from_state: 'OnLeave', to_state: 'Active', type: 'Employee.StateChange', reason: false },
      { from_state: 'OnLeave', to_state: 'Terminated', type: 'Employee.Terminate', reason: false },
      { from_state: 'Suspended', to_state: 'Active', type: 'Employee.StateChange', reason: true },
      { from_state: 'Terminated', to_state: 'Archived', type: 'Employee.StateChange', reason: true },
    ]);
  });
});

describe('who did it (BI-23)', () => {
  it('BI-23, EM-11: a document can name only an employee of record as who did something', async () => {
    const org = await insertOrganization(db.app);
    const category = await insertCategory(db.app, org);
    const insert = (who: string) =>
      db.app.query(`INSERT INTO product (organization_id, category_id, name, status_changed_by) VALUES ($1, $2, 'P', $3)`, [org, category, who]);
    expect(await sqlState(insert(randomUUID())), 'nobody').toBe('23503');
    expect(await sqlState(insert(await employee(org)))).toBeUndefined();
  });
});
