-- migrate:up

-- Owner decisions OQ-031 and OQ-032 (2026-10-03):
--   OQ-031: Shift.Reopen is granted to roles that hold all other Shift.* permission keys
--           (Store Manager, Assistant Manager, and similarly composed roles), following the
--           wildcard-group principle of D-01: a role holding Shift.* stays complete when Shift.*
--           grows.
--   OQ-032: Employee.Reactivate is granted to roles that hold all Employee.* keys except
--           Employee.Terminate (HR Manager and similar), also following D-01's wildcard-group
--           principle. Employee.Terminate is explicitly excluded (actors-and-roles s3.13: the HR
--           Manager may not terminate).
--
-- Both grants use a predicate analogous to grant_to_complete_roles (20261002100000): the role
-- must already hold every key in the target family except the one being granted, and it must not
-- already hold the new key.

-- OQ-031: grant Shift.Reopen to roles holding Shift.Close + Shift.Manage + Shift.Open
INSERT INTO role_permission (role_id, organization_id, permission_key, granted_by)
SELECT r.id, r.organization_id, 'Shift.Reopen',
       (SELECT g.granted_by FROM role_permission g WHERE g.role_id = r.id ORDER BY g.granted_at, g.id LIMIT 1)
FROM role r
WHERE r.archived_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM role_permission g WHERE g.role_id = r.id AND g.permission_key = 'Shift.Reopen' AND g.revoked_at IS NULL)
  AND (SELECT COUNT(*) FROM role_permission g WHERE g.role_id = r.id AND g.revoked_at IS NULL
       AND g.permission_key IN ('Shift.Close', 'Shift.Manage', 'Shift.Open')) = 3;

-- OQ-032: grant Employee.Reactivate to roles holding all Employee.* except Terminate
-- (Employee.Create + Employee.Edit + Employee.Password.Reset + Employee.StoreAccess.Grant + Employee.View)
INSERT INTO role_permission (role_id, organization_id, permission_key, granted_by)
SELECT r.id, r.organization_id, 'Employee.Reactivate',
       (SELECT g.granted_by FROM role_permission g WHERE g.role_id = r.id ORDER BY g.granted_at, g.id LIMIT 1)
FROM role r
WHERE r.archived_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM role_permission g WHERE g.role_id = r.id AND g.permission_key = 'Employee.Reactivate' AND g.revoked_at IS NULL)
  AND (SELECT COUNT(*) FROM role_permission g WHERE g.role_id = r.id AND g.revoked_at IS NULL
       AND g.permission_key IN ('Employee.Create', 'Employee.Edit', 'Employee.Password.Reset',
                                'Employee.StoreAccess.Grant', 'Employee.View')) = 5;

COMMENT ON TABLE role_permission IS
  'Cites: AC-01, AC-02, D-01, D-16, OQ-031, OQ-032. A role''s permission grants. Revoked grants are kept for audit; a new grant replaces a revoked one.';

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'Migrations are forward-only and are never rolled back (docs/database/CONVENTIONS.md s14).'; END $$;
