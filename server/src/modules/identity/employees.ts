import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction } from '../../db/pool.ts';
import { AppError } from '../../http/errors.ts';
import { auditContext, type Access } from '../../http/gate.ts';
import type { MachineBinding } from '../../http/transitions.ts';
import { hashPassword, verifyPassword } from './password.ts';
import { createEmployee, EMPLOYEE_COLUMNS, type EmployeeDetails } from './repo.ts';
import { endSessions, type SessionPolicy } from './sessions.ts';

/**
 * The Employee machine (§22.9). Suspension and termination end every live session in the same transaction: "blocked
 * at authentication; live sessions revoked immediately" (`SM-47`), each recorded as `Security.SessionEnded`.
 */
export const employeeMachine: MachineBinding = {
  machine: 'Employee',
  noun: 'employee',
  table: 'employee',
  stateColumn: 'status',
  actorColumn: 'status_changed_by',
  storeColumn: null,
  after: async (client, employeeId, _from, to) => {
    if (to === 'Suspended' || to === 'Terminated') await endSessions(client, { employeeId }, 'Revoked');
  },
};

const text = z.string().trim().min(1).max(200);
const Details = z.object({
  firstName: text,
  lastName: text,
  preferredName: text.nullable().optional(),
  email: text.nullable().optional(),
  phone: text.nullable().optional(),
  startDate: z.iso.date().nullable().optional(),
  employmentType: text.nullable().optional(),
  homeStoreId: z.uuid().nullable().optional(),
  department: text.nullable().optional(),
  position: text.nullable().optional(),
});
const NewEmployee = Details.extend({ employeeNumber: text });
const ChangedEmployee = Details.partial();
const Login = z.object({ username: text, password: z.string().min(1).max(1024) });
const OwnPassword = z.object({ currentPassword: z.string().min(1).max(1024), newPassword: z.string().min(1).max(1024) });
const Page = z.object({ after: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });
const EmployeeId = z.object({ employeeId: z.uuid() });

// Employees are organization-scoped, so these keys are held organization-wide (OQ-025 item 6).
const access = (key: string): { config: { access: Access } } => ({ config: { access: { kind: 'permission', key, scope: 'organization' } } });

const COLUMNS = `id, employee_number AS "employeeNumber", first_name AS "firstName", last_name AS "lastName",
  preferred_name AS "preferredName", email, phone, start_date::text AS "startDate", employment_type AS "employmentType",
  home_store_id AS "homeStoreId", department, position, status, status_changed_at AS "statusChangedAt",
  EXISTS (SELECT 1 FROM user_account a WHERE a.employee_id = employee.id) AS "hasLogin"`;

export async function employeeRoutes(app: FastifyInstance, options: { pool: pg.Pool; session: SessionPolicy }): Promise<void> {
  const { pool } = options;

  /** Employees of the caller's organization, by employee number, a page at a time (architecture §18.5). */
  app.get('/employees', access('Employee.View'), async (request) => {
    const page = Page.parse(request.query);
    const { rows } = await pool.query(
      `SELECT ${COLUMNS} FROM employee WHERE organization_id = $1 AND ($2::text IS NULL OR employee_number > $2)
       ORDER BY employee_number LIMIT $3`,
      [request.principal!.organizationId, page.after ?? null, page.limit],
    );
    return { items: rows, next: rows.length === page.limit ? rows.at(-1)!.employeeNumber : null };
  });

  app.get('/employees/:employeeId', access('Employee.View'), async (request) => {
    const { employeeId } = EmployeeId.parse(request.params);
    const { rows } = await pool.query(`SELECT ${COLUMNS} FROM employee WHERE id = $1 AND organization_id = $2`, [
      employeeId,
      request.principal!.organizationId,
    ]);
    if (rows.length === 0) throw new AppError(404, 'not_found', 'There is no such employee.');
    return rows[0];
  });

  /** A new employee, `Active` (§22.9 creation: `Employee.Create`). Who created them is the session (`AU-05`). */
  app.post('/employees', access('Employee.Create'), async (request, reply) => {
    const body = NewEmployee.parse(request.body);
    const principal = request.principal!;
    const id = await withTransaction(pool, auditContext(request), (c) =>
      createEmployee(c, { ...body, organizationId: principal.organizationId, createdBy: principal.employeeId }),
    );
    return reply.status(201).send({ id });
  });

  /** Descriptive details only (`EM-06`); the status changes only by transition (§22.9). */
  app.patch('/employees/:employeeId', access('Employee.Edit'), async (request) => {
    const { employeeId } = EmployeeId.parse(request.params);
    const body = ChangedEmployee.parse(request.body);
    const fields = (Object.keys(body) as (keyof EmployeeDetails)[]).filter((field) => body[field] !== undefined);
    if (fields.length === 0) throw new AppError(400, 'invalid_request', 'The request changes nothing.');
    const sets = fields.map((field, i) => `${EMPLOYEE_COLUMNS[field]} = $${i + 3}`).join(', ');
    const updated = await withTransaction(pool, auditContext(request), (c) =>
      c.query(`UPDATE employee SET ${sets} WHERE id = $1 AND organization_id = $2`, [
        employeeId,
        request.principal!.organizationId,
        ...fields.map((field) => body[field]),
      ]),
    );
    if (updated.rowCount === 0) throw new AppError(404, 'not_found', 'There is no such employee.');
    return { id: employeeId };
  });

  /**
   * Gives an employee a login, or sets a new password on theirs (`EM-02`, `EM-04`: a reset sets a new credential and
   * never reveals the old one). `Employee.Password.Reset`, because it sets another person's credential.
   */
  app.put('/employees/:employeeId/login', access('Employee.Password.Reset'), async (request) => {
    const { employeeId } = EmployeeId.parse(request.params);
    const body = Login.parse(request.body);
    const hash = await hashPassword(body.password);
    const saved = await withTransaction(pool, auditContext(request), (c) =>
      c.query(
        `INSERT INTO user_account (organization_id, employee_id, username, password_hash)
         SELECT organization_id, id, $3, $4 FROM employee WHERE id = $1 AND organization_id = $2
         ON CONFLICT (employee_id) DO UPDATE SET username = EXCLUDED.username, password_hash = EXCLUDED.password_hash`,
        [employeeId, request.principal!.organizationId, body.username, hash],
      ),
    );
    if (saved.rowCount === 0) throw new AppError(404, 'not_found', 'There is no such employee.');
    return { employeeId, username: body.username };
  });

  /**
   * Changes the signed-in employee's own password (`EM-03`: self-service takes no employee id). The current password
   * must be right. A wrong one counts as a failed sign-in, so a borrowed session cannot be used to guess it (`SM-49`).
   */
  app.put('/session/password', { config: { access: { kind: 'session' } } }, async (request, reply) => {
    const body = OwnPassword.parse(request.body);
    const principal = request.principal!;
    const account = await pool.query<{ id: string; password_hash: string; failures: number }>(
      `SELECT a.id, a.password_hash,
              (SELECT count(*)::int FROM audit_event
               WHERE entity_id = a.id AND event_type = 'Security.LoginFailed'
                 AND occurred_at > now() - make_interval(secs => $2 * 60.0)) AS failures
       FROM user_account a WHERE a.employee_id = $1`,
      [principal.employeeId, options.session.failureWindowMinutes],
    );
    const login = account.rows[0];
    if (login === undefined) throw new AppError(404, 'not_found', 'You have no login.');
    const throttled = login.failures >= options.session.failureLimit;
    if (throttled || !(await verifyPassword(body.currentPassword, login.password_hash))) {
      await withTransaction(pool, { ...auditContext(request), actorId: null }, (c) =>
        c.query(`SELECT record_audit_event('Security.LoginFailed', $1, NULL, 'user_account', $2, $3)`, [
          principal.organizationId,
          login.id,
          { reason: throttled ? 'Throttled' : 'PasswordChange' },
        ]),
      );
      throw throttled
        ? new AppError(429, 'sign_in_throttled', 'Too many failed attempts for this login. Wait, then try again.')
        : new AppError(403, 'wrong_password', 'Your current password is not right.');
    }
    const hash = await hashPassword(body.newPassword);
    await withTransaction(pool, auditContext(request), (c) =>
      c.query('UPDATE user_account SET password_hash = $2 WHERE id = $1', [login.id, hash]),
    );
    return reply.status(204).send();
  });
}
