import type { Queryable } from '../../db/pool.ts';

/** The descriptive fields of an employee (employee-domain §2). None drives a permission (`EM-06`). */
export interface EmployeeDetails {
  firstName: string;
  lastName: string;
  preferredName?: string | null;
  email?: string | null;
  phone?: string | null;
  startDate?: string | null;
  employmentType?: string | null;
  homeStoreId?: string | null;
  department?: string | null;
  position?: string | null;
}

/** Field to column, for the fields a change may touch. The employee number never changes (`EM-05`). */
export const EMPLOYEE_COLUMNS: Record<keyof EmployeeDetails, string> = {
  firstName: 'first_name',
  lastName: 'last_name',
  preferredName: 'preferred_name',
  email: 'email',
  phone: 'phone',
  startDate: 'start_date',
  employmentType: 'employment_type',
  homeStoreId: 'home_store_id',
  department: 'department',
  position: 'position',
};

/** An employee, created `Active` (`EM-01`, `SM-48a`; §22.9 creation). */
export async function createEmployee(
  db: Queryable,
  employee: EmployeeDetails & { id?: string; organizationId: string; employeeNumber: string; createdBy: string },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO employee (id, organization_id, employee_number, first_name, last_name, preferred_name, email, phone,
                           start_date, employment_type, home_store_id, department, position, status_changed_by)
     VALUES (coalesce($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
    [
      employee.id ?? null,
      employee.organizationId,
      employee.employeeNumber,
      employee.firstName,
      employee.lastName,
      employee.preferredName ?? null,
      employee.email ?? null,
      employee.phone ?? null,
      employee.startDate ?? null,
      employee.employmentType ?? null,
      employee.homeStoreId ?? null,
      employee.department ?? null,
      employee.position ?? null,
      employee.createdBy,
    ],
  );
  return rows[0]!.id;
}

/** A login, exactly one employee's (`EM-02`), holding only a slow hash (`EM-04`). */
export async function createLogin(
  db: Queryable,
  login: { organizationId: string; employeeId: string; username: string; passwordHash: string },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO user_account (organization_id, employee_id, username, password_hash) VALUES ($1, $2, $3, $4) RETURNING id`,
    [login.organizationId, login.employeeId, login.username, login.passwordHash],
  );
  return rows[0]!.id;
}

/**
 * A role with its grants (`AC-01`, `AC-02`). `keys: 'everything'` grants every catalogue key: the Owner template
 * (actors-and-roles §4, "everything in the organization").
 */
export async function createRole(
  db: Queryable,
  role: { organizationId: string; name: string; description?: string | null; keys: string[] | 'everything'; grantedBy: string },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO role (organization_id, name, description) VALUES ($1, $2, $3) RETURNING id',
    [role.organizationId, role.name, role.description ?? null],
  );
  const roleId = rows[0]!.id;
  await db.query(
    `INSERT INTO role_permission (role_id, organization_id, permission_key, granted_by)
     SELECT $1, $2, key, $3 FROM permission WHERE $4::text[] IS NULL OR key = ANY($4::text[])`,
    [roleId, role.organizationId, role.grantedBy, role.keys === 'everything' ? null : role.keys],
  );
  return roleId;
}

/** A role held organization-wide (`storeId` null) or in one store (`MS-11`). Records `Security.Role.Assign` (`RT-020`). */
export async function assignRole(
  db: Queryable,
  assignment: { employeeId: string; roleId: string; organizationId: string; storeId: string | null; assignedBy: string },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO employee_role_assignment (employee_id, role_id, organization_id, store_id, assigned_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [assignment.employeeId, assignment.roleId, assignment.organizationId, assignment.storeId, assignment.assignedBy],
  );
  return rows[0]!.id;
}

/** Access to one store, with optional dates (`EM-12`). */
export async function grantStoreAccess(
  db: Queryable,
  access: {
    employeeId: string;
    storeId: string;
    organizationId: string;
    validFrom?: Date | null;
    validTo?: Date | null;
    grantedBy: string;
  },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO employee_store_access (employee_id, store_id, organization_id, valid_from, valid_to, granted_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [access.employeeId, access.storeId, access.organizationId, access.validFrom ?? null, access.validTo ?? null, access.grantedBy],
  );
  return rows[0]!.id;
}
