import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signedInAs, testApp } from '../../../test/app.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { actor, insertOrganization, insertReasonCode, insertStore } from '../../../test/fixtures.ts';
import { chainBreaks } from './chain.ts';

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

/** An employee of `org` holding, through each role, that role's keys organization-wide. Returns the role ids too. */
async function staffWithRoles(org: string, roles: string[][]): Promise<{ employee: string; roleIds: string[] }> {
  const store = await insertStore(db.app, org);
  const person = await db.app.query<{ id: string }>(
    `INSERT INTO employee (organization_id, employee_number, first_name, last_name, status_changed_by)
     VALUES ($1, $2, 'Test', 'Employee', $3) RETURNING id`,
    [org, `E-${randomUUID()}`, actor()],
  );
  const employee = person.rows[0]!.id;
  await db.app.query('INSERT INTO employee_store_access (employee_id, store_id, organization_id, granted_by) VALUES ($1, $2, $3, $4)', [
    employee,
    store,
    org,
    actor(),
  ]);
  const roleIds: string[] = [];
  for (const keys of roles) {
    const role = await db.app.query<{ id: string }>('INSERT INTO role (organization_id, name) VALUES ($1, $2) RETURNING id', [org, `Role ${randomUUID()}`]);
    const id = role.rows[0]!.id;
    roleIds.push(id);
    for (const key of keys) {
      await db.app.query('INSERT INTO role_permission (role_id, organization_id, permission_key, granted_by) VALUES ($1, $2, $3, $4)', [id, org, key, actor()]);
    }
    await db.app.query('INSERT INTO employee_role_assignment (employee_id, role_id, organization_id, assigned_by) VALUES ($1, $2, $3, $4)', [
      employee,
      id,
      org,
      actor(),
    ]);
  }
  return { employee, roleIds };
}

const stateChange = (entity: string) =>
  db.app.query<{ actor_id: string; role_used: string | null; source: string; correlation_id: string; ip_address: string }>(
    `SELECT actor_id, role_used, source, correlation_id, host(ip_address) AS ip_address FROM audit_event
     WHERE entity_id = $1 AND event_type = 'Employee.StateChange' ORDER BY seq DESC LIMIT 1`,
    [entity],
  );

describe('what every audit entry carries from the request (AU-05, AU-10, architecture s8.5, s14.2, s25.3)', () => {
  it('AU-10, s14.2, s25.3: a change made over HTTP records the actor, the role used, the source, the IP and the correlation id the response returned', async () => {
    const org = await insertOrganization(db.app);
    const manager = await staffWithRoles(org, [['Employee.Create']]);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/employees',
      headers: signedInAs(manager.employee, org),
      payload: { employeeNumber: `E-${randomUUID()}`, firstName: 'Ada', lastName: 'Lovelace' },
    });
    expect(created.statusCode).toBe(201);
    const { rows } = await stateChange(created.json().id);
    expect(rows).toEqual([
      {
        actor_id: manager.employee,
        role_used: manager.roleIds[0],
        source: 'UI',
        correlation_id: created.headers['x-correlation-id'],
        ip_address: '127.0.0.1',
      },
    ]);
  });

  it('s8.5: when several roles grant the key, each is a role used; a role that does not grant it here, now, is not', async () => {
    const org = await insertOrganization(db.app);
    const manager = await staffWithRoles(org, [
      ['Employee.Create'],
      ['Employee.Create', 'Sale.View'],
      ['Sale.View'],
      ['Employee.Create'], // archived below
      ['Employee.Create'], // its grant revoked below
      ['Employee.Create'], // its assignment revoked below
    ]);
    const [, , , archived, ungranted, unassigned] = manager.roleIds;
    await db.app.query('UPDATE role SET archived_by = $2 WHERE id = $1', [archived, actor()]);
    await db.app.query('UPDATE role_permission SET revoked_by = $2 WHERE role_id = $1', [ungranted, actor()]);
    await db.app.query('UPDATE employee_role_assignment SET revoked_by = $3 WHERE role_id = $1 AND employee_id = $2', [unassigned, manager.employee, actor()]);
    const storeRole = await db.app.query<{ id: string }>('INSERT INTO role (organization_id, name) VALUES ($1, $2) RETURNING id', [org, `Store role ${randomUUID()}`]);
    await db.app.query('INSERT INTO role_permission (role_id, organization_id, permission_key, granted_by) VALUES ($1, $2, $3, $4)', [storeRole.rows[0]!.id, org, 'Employee.Create', actor()]);
    await db.app.query(
      `INSERT INTO employee_role_assignment (employee_id, role_id, organization_id, store_id, assigned_by)
       SELECT $1, $2, $3, store_id, $4 FROM employee_store_access WHERE employee_id = $1`,
      [manager.employee, storeRole.rows[0]!.id, org, actor()],
    );
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/employees',
      headers: signedInAs(manager.employee, org),
      payload: { employeeNumber: `E-${randomUUID()}`, firstName: 'Ada', lastName: 'Lovelace' },
    });
    const { rows } = await stateChange(created.json().id);
    expect(rows[0]!.role_used).toBe([manager.roleIds[0]!, manager.roleIds[1]!].sort().join(','));
  });

  it("s14.2: a transition records the role that granted its edge's permission", async () => {
    const org = await insertOrganization(db.app);
    const creator = await staffWithRoles(org, [['Employee.Create']]);
    const editor = await staffWithRoles(org, [['Employee.Edit'], ['Sale.View']]);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/employees',
      headers: signedInAs(creator.employee, org),
      payload: { employeeNumber: `E-${randomUUID()}`, firstName: 'Ada', lastName: 'Lovelace' },
    });
    const leave = await app.inject({
      method: 'POST',
      url: '/api/v1/transitions',
      headers: signedInAs(editor.employee, org),
      payload: { machine: 'Employee', event: 'leave', subject: created.json().id, reasonCodeId: await insertReasonCode(db.app, org) },
    });
    expect(leave.statusCode).toBe(200);
    const { rows } = await stateChange(created.json().id);
    expect(rows[0]).toMatchObject({ actor_id: editor.employee, role_used: editor.roleIds[0], correlation_id: leave.headers['x-correlation-id'] });
  });
});

describe('the chain check (AU-29, AU-30, RT-302, EC-76)', () => {
  it('AU-29, AU-30: an intact chain reports nothing; an event outside the chain is reported, and nothing is repaired', async () => {
    const org = await insertOrganization(db.app);
    await staffWithRoles(org, [['Sale.View']]);
    const mine = (breaks: Awaited<ReturnType<typeof chainBreaks>>) => breaks.filter((b) => b.organizationId === org);
    expect(mine(await chainBreaks(db.app))).toEqual([]);

    await db.owner.query('ALTER TABLE audit_event DISABLE TRIGGER tg_audit_event_chain');
    let unlinked: string;
    try {
      const inserted = await db.owner.query<{ id: string }>(
        `INSERT INTO audit_event (organization_id, event_type, entity_type, actor_id, source, correlation_id)
         VALUES ($1, 'Security.Login', 'employee', $2, 'API', $3) RETURNING id`,
        [org, actor(), randomUUID()],
      );
      unlinked = inserted.rows[0]!.id;
    } finally {
      await db.owner.query('ALTER TABLE audit_event ENABLE TRIGGER tg_audit_event_chain');
    }
    const found = mine(await chainBreaks(db.app));
    expect(found).toEqual([{ organizationId: org, chainSeq: null, auditEventId: unlinked, problem: 'the event is not in the chain' }]);
    expect(mine(await chainBreaks(db.app)), 'checking repairs nothing').toEqual(found);
  });
});
