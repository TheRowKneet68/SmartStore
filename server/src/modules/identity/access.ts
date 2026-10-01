import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction } from '../../db/pool.ts';
import { AppError } from '../../http/errors.ts';
import { auditContext, type Access } from '../../http/gate.ts';
import { assignRole, createRole, grantStoreAccess } from './repo.ts';
import { endSessions } from './sessions.ts';

// Roles, assignments and store access are organization-scoped, so these keys are held organization-wide (OQ-025 item
// 6). The catalogue's Role.* keys are used, not Config.Roles, which overlaps them (D7 §9).
const access = (key: string): { config: { access: Access } } => ({ config: { access: { kind: 'permission', key, scope: 'organization' } } });

const text = z.string().trim().min(1).max(200);
const NewRole = z.object({ name: text, description: text.nullable().optional(), keys: z.array(z.string().min(1)).max(200) });
const ChangedRole = z.object({ name: text.optional(), description: text.nullable().optional() });
const RoleId = z.object({ roleId: z.uuid() });
const RoleKey = z.object({ roleId: z.uuid(), key: z.string().min(1).max(200) });
const Confirm = z.object({ confirmAffected: z.coerce.number().int().min(0).optional() });
const EmployeeId = z.object({ employeeId: z.uuid() });
const Assignment = z.object({ roleId: z.uuid(), storeId: z.uuid().nullable() });
const StoreGrant = z.object({ storeId: z.uuid(), validFrom: z.iso.datetime({ offset: true }).nullable().optional(), validTo: z.iso.datetime({ offset: true }).nullable().optional() });
const AssignmentId = z.object({ assignmentId: z.uuid() });
const AccessId = z.object({ accessId: z.uuid() });

const notFound = (what: string) => new AppError(404, 'not_found', `There is no such ${what}.`);

/**
 * Roles and their grants, role assignments, and store access (actors-and-roles §1, §6; employee-domain §4). Nothing is
 * deleted: a removal is a recorded revocation, so the grant set at any moment can be rebuilt (`PC-01`, `BI-40`).
 */
export async function accessRoutes(app: FastifyInstance, options: { pool: pg.Pool }): Promise<void> {
  const { pool } = options;

  app.get('/roles', access('Role.View'), async (request) => {
    const { rows } = await pool.query(
      `SELECT r.id, r.name, r.description, r.archived_at AS "archivedAt",
              array(SELECT g.permission_key::text FROM role_permission g
                    WHERE g.role_id = r.id AND g.revoked_at IS NULL ORDER BY g.permission_key) AS keys
       FROM role r WHERE r.organization_id = $1 ORDER BY r.name`,
      [request.principal!.organizationId],
    );
    return { items: rows };
  });

  /** A role from catalogue keys only (`AC-02`, `D-01`): a key outside the catalogue is refused by its foreign key. */
  app.post('/roles', access('Role.Create'), async (request, reply) => {
    const body = NewRole.parse(request.body);
    const principal = request.principal!;
    const id = await withTransaction(pool, auditContext(request), async (c) => {
      const unknown = await c.query<{ key: string }>('SELECT k AS key FROM unnest($1::text[]) k WHERE k NOT IN (SELECT key FROM permission)', [body.keys]);
      if (unknown.rows.length > 0) {
        throw new AppError(422, 'unknown_permission', `Not permissions: ${unknown.rows.map((r) => r.key).join(', ')}.`);
      }
      return createRole(c, { organizationId: principal.organizationId, name: body.name, description: body.description ?? null, keys: body.keys, grantedBy: principal.employeeId });
    });
    return reply.status(201).send({ id });
  });

  app.patch('/roles/:roleId', access('Role.Edit'), async (request) => {
    const { roleId } = RoleId.parse(request.params);
    const body = ChangedRole.parse(request.body);
    const updated = await withTransaction(pool, auditContext(request), (c) =>
      c.query(
        `UPDATE role SET name = coalesce($3, name), description = CASE WHEN $4 THEN $5 ELSE description END
         WHERE id = $1 AND organization_id = $2`,
        [roleId, request.principal!.organizationId, body.name ?? null, body.description !== undefined, body.description ?? null],
      ),
    );
    if (updated.rowCount === 0) throw notFound('role');
    return { id: roleId };
  });

  /**
   * Archives a role: it grants nothing from now on, and stays on record (`AC-01`, `BI-40`). Archiving an archived role
   * changes nothing and keeps who archived it first (the database refuses a rewrite, `SS001`; SM-04's repeat rule).
   */
  app.post('/roles/:roleId/archive', access('Role.Edit'), async (request) => {
    const { roleId } = RoleId.parse(request.params);
    const principal = request.principal!;
    const changed = await withTransaction(pool, auditContext(request), async (c) => {
      const role = await c.query<{ archived: boolean }>(
        'SELECT archived_at IS NOT NULL AS archived FROM role WHERE id = $1 AND organization_id = $2 FOR UPDATE',
        [roleId, principal.organizationId],
      );
      if (role.rows.length === 0) throw notFound('role');
      if (role.rows[0]!.archived) return false;
      await c.query('UPDATE role SET archived_by = $2 WHERE id = $1', [roleId, principal.employeeId]);
      return true;
    });
    return { id: roleId, archived: true, changed };
  });

  /**
   * Grants one key to a role. Granting a key the role already holds changes nothing. A role edit applies from the
   * next request and signs nobody out (`PC-03`).
   */
  app.put('/roles/:roleId/permissions/:key', access('Role.Edit'), async (request) => {
    const { roleId, key } = RoleKey.parse(request.params);
    const principal = request.principal!;
    await withTransaction(pool, auditContext(request), async (c) => {
      const role = await c.query('SELECT 1 FROM role WHERE id = $1 AND organization_id = $2 FOR UPDATE', [roleId, principal.organizationId]);
      if (role.rows.length === 0) throw notFound('role');
      const known = await c.query('SELECT 1 FROM permission WHERE key = $1', [key]);
      if (known.rows.length === 0) throw new AppError(422, 'unknown_permission', `Not a permission: ${key}.`);
      await c.query(
        `INSERT INTO role_permission (role_id, organization_id, permission_key, granted_by)
         SELECT $1, $2, $3, $4 WHERE NOT EXISTS
           (SELECT 1 FROM role_permission WHERE role_id = $1 AND permission_key = $3 AND revoked_at IS NULL)`,
        [roleId, principal.organizationId, key, principal.employeeId],
      );
    });
    return { roleId, key, granted: true };
  });

  /**
   * Revokes one key from a role. The request must state how many employees lose it (`PC-02`); without the right number
   * it is refused, with the number. It applies from the next request and signs nobody out (`PC-03`).
   */
  app.delete('/roles/:roleId/permissions/:key', access('Role.Edit'), async (request) => {
    const { roleId, key } = RoleKey.parse(request.params);
    const { confirmAffected } = Confirm.parse(request.query);
    const principal = request.principal!;
    await withTransaction(pool, auditContext(request), async (c) => {
      const role = await c.query('SELECT 1 FROM role WHERE id = $1 AND organization_id = $2 FOR UPDATE', [roleId, principal.organizationId]);
      if (role.rows.length === 0) throw notFound('role');
      const affected = await c.query<{ n: number }>(
        'SELECT count(DISTINCT employee_id)::int AS n FROM employee_role_assignment WHERE role_id = $1 AND revoked_at IS NULL',
        [roleId],
      );
      const n = affected.rows[0]!.n;
      if (confirmAffected !== n) {
        throw new AppError(409, 'confirm_affected', `This takes ${key} from ${n} employee${n === 1 ? '' : 's'}. Confirm with that number.`, { affected: n });
      }
      const revoked = await c.query(
        'UPDATE role_permission SET revoked_by = $3 WHERE role_id = $1 AND permission_key = $2 AND revoked_at IS NULL',
        [roleId, key, principal.employeeId],
      );
      if (revoked.rowCount === 0) throw new AppError(404, 'not_found', `The role does not hold ${key}.`);
    });
    return { roleId, key, granted: false };
  });

  app.get('/employees/:employeeId/roles', access('Role.View'), async (request) => {
    const { employeeId } = EmployeeId.parse(request.params);
    const { rows } = await pool.query(
      `SELECT a.id, a.role_id AS "roleId", r.name AS "roleName", a.store_id AS "storeId", a.assigned_at AS "assignedAt"
       FROM employee_role_assignment a JOIN role r ON r.id = a.role_id
       WHERE a.employee_id = $1 AND a.organization_id = $2 AND a.revoked_at IS NULL ORDER BY r.name`,
      [employeeId, request.principal!.organizationId],
    );
    return { items: rows };
  });

  /**
   * Assigns a role, organization-wide or in one store (`MS-11`). The database records `Security.Role.Assign` (`RT-020`).
   * The employee's sessions end, so none carries an identifier from before the change (architecture §7.1, `EM-16`).
   */
  app.post('/employees/:employeeId/roles', access('Role.Assign'), async (request, reply) => {
    const { employeeId } = EmployeeId.parse(request.params);
    const body = Assignment.parse(request.body);
    const principal = request.principal!;
    const id = await withTransaction(pool, auditContext(request), async (c) => {
      const assignment = await assignRole(c, { employeeId, roleId: body.roleId, organizationId: principal.organizationId, storeId: body.storeId, assignedBy: principal.employeeId });
      await endSessions(c, { employeeId }, 'Revoked');
      return assignment;
    });
    return reply.status(201).send({ id });
  });

  app.delete('/role-assignments/:assignmentId', access('Role.Assign'), async (request) => {
    const { assignmentId } = AssignmentId.parse(request.params);
    const principal = request.principal!;
    await withTransaction(pool, auditContext(request), async (c) => {
      const revoked = await c.query<{ employee_id: string }>(
        'UPDATE employee_role_assignment SET revoked_by = $3 WHERE id = $1 AND organization_id = $2 AND revoked_at IS NULL RETURNING employee_id',
        [assignmentId, principal.organizationId, principal.employeeId],
      );
      if (revoked.rows.length === 0) throw notFound('live role assignment');
      await endSessions(c, { employeeId: revoked.rows[0]!.employee_id }, 'Revoked');
    });
    return { id: assignmentId, revoked: true };
  });

  app.get('/employees/:employeeId/stores', access('Employee.View'), async (request) => {
    const { employeeId } = EmployeeId.parse(request.params);
    const { rows } = await pool.query(
      `SELECT id, store_id AS "storeId", valid_from AS "validFrom", valid_to AS "validTo", granted_at AS "grantedAt"
       FROM employee_store_access WHERE employee_id = $1 AND organization_id = $2 AND revoked_at IS NULL ORDER BY granted_at`,
      [employeeId, request.principal!.organizationId],
    );
    return { items: rows };
  });

  /**
   * Grants access to a store (`EM-12`, `EM-14`: a high-value grant). A role without store access grants nothing
   * (`EM-13`). The employee's sessions end (architecture §7.1).
   */
  app.post('/employees/:employeeId/stores', access('Employee.StoreAccess.Grant'), async (request, reply) => {
    const { employeeId } = EmployeeId.parse(request.params);
    const body = StoreGrant.parse(request.body);
    const principal = request.principal!;
    const id = await withTransaction(pool, auditContext(request), async (c) => {
      const grant = await grantStoreAccess(c, {
        employeeId,
        storeId: body.storeId,
        organizationId: principal.organizationId,
        validFrom: body.validFrom ? new Date(body.validFrom) : null,
        validTo: body.validTo ? new Date(body.validTo) : null,
        grantedBy: principal.employeeId,
      });
      await endSessions(c, { employeeId }, 'Revoked');
      return grant;
    });
    return reply.status(201).send({ id });
  });

  /** Revokes store access, immediately (`EM-15`, `EM-16`): the employee's sessions end with it. */
  app.delete('/store-access/:accessId', access('Employee.StoreAccess.Grant'), async (request) => {
    const { accessId } = AccessId.parse(request.params);
    const principal = request.principal!;
    await withTransaction(pool, auditContext(request), async (c) => {
      const revoked = await c.query<{ employee_id: string }>(
        'UPDATE employee_store_access SET revoked_by = $3 WHERE id = $1 AND organization_id = $2 AND revoked_at IS NULL RETURNING employee_id',
        [accessId, principal.organizationId, principal.employeeId],
      );
      if (revoked.rows.length === 0) throw notFound('live store access');
      await endSessions(c, { employeeId: revoked.rows[0]!.employee_id }, 'Revoked');
    });
    return { id: accessId, revoked: true };
  });
}
