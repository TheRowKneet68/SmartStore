-- migrate:up

-- Owner decision D-16 (2026-10-02): the permission keys for the transitions and creations that had none. Five keys
-- join the catalogue, and the edges D-16 names stop refusing everyone. Design: docs/architecture/OWNER-DECISIONS.md
-- D-16; docs/database/D7-EMPLOYEE-ROLE-PERMISSION.md s11.
--
-- Not here: a shift's Closed -> Reopened edge. D-16 names its key, Shift.Reopen, but what a reopened shift's recount
-- counts, and what happens to the closing float already handed on, is not specified (OQ-033), so the edge stays
-- unbuilt and refuses (architecture s8.4).

INSERT INTO permission (key) VALUES
  ('Payment.Capture'),
  ('Payment.Void'),
  ('Employee.Reactivate'),
  ('Refund.Pay'),
  ('Shift.Reopen');

-- s22.10: a card tender's own transitions. A cash tender is created and captured inside the sale's completion, under
-- Sale.Create (s22.6; OQ-018's reading).
UPDATE state_machine_state SET creation_permission_rule = 'Key', creation_permission_key = 'Sale.Create'
  WHERE machine = 'Payment' AND state = 'Pending';
UPDATE state_machine_edge SET permission_rule = 'Key', permission_key = 'Payment.Capture'
  WHERE machine = 'Payment' AND event = 'capture';
UPDATE state_machine_edge SET permission_rule = 'Key', permission_key = 'Payment.Void'
  WHERE machine = 'Payment' AND event = 'void';

-- s22.9: back from leave, and reactivation after suspension (SM-50: reasoned and audited, already in the data).
UPDATE state_machine_edge SET permission_rule = 'Key', permission_key = 'Employee.Edit'
  WHERE machine = 'Employee' AND from_state = 'OnLeave' AND to_state = 'Active';
UPDATE state_machine_edge SET permission_rule = 'Key', permission_key = 'Employee.Reactivate'
  WHERE machine = 'Employee' AND from_state = 'Suspended' AND to_state = 'Active';

-- s22.12, HD-32: a disabled till back in service, with the authority that took it out (and a reason, already set).
UPDATE state_machine_edge SET permission_rule = 'Key', permission_key = 'Device.Disable'
  WHERE machine = 'Device' AND from_state = 'Disabled' AND to_state = 'Active';

-- s22.7: a return's cancel, and a refund's payment, retry and cancel.
UPDATE state_machine_edge SET permission_rule = 'Key', permission_key = 'Return.Create'
  WHERE machine = 'CustomerReturn' AND event = 'cancel';
UPDATE state_machine_edge SET permission_rule = 'Key', permission_key = 'Refund.Pay'
  WHERE machine = 'Refund' AND event = 'submit to provider';
UPDATE state_machine_edge SET permission_rule = 'Key', permission_key = 'Sale.Refund'
  WHERE machine = 'Refund' AND event IN ('retry', 'cancel');

CREATE FUNCTION grant_to_complete_roles(p_keys text[]) RETURNS integer
  LANGUAGE plpgsql
AS $$
DECLARE
  v_granted integer;
BEGIN
  INSERT INTO role_permission (role_id, organization_id, permission_key, granted_by)
  SELECT r.id, r.organization_id, k.key,
         (SELECT g.granted_by FROM role_permission g WHERE g.role_id = r.id ORDER BY g.granted_at, g.id LIMIT 1)
  FROM role r CROSS JOIN unnest(p_keys) AS k(key)
  WHERE r.archived_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM role_permission g
                    WHERE g.role_id = r.id AND g.permission_key = k.key AND g.revoked_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM permission p
                    WHERE p.key <> ALL (p_keys)
                      AND NOT EXISTS (SELECT 1 FROM role_permission g
                                      WHERE g.role_id = r.id AND g.permission_key = p.key AND g.revoked_at IS NULL));
  GET DIAGNOSTICS v_granted = ROW_COUNT;
  RETURN v_granted;
END
$$;

COMMENT ON FUNCTION grant_to_complete_roles(text[]) IS
  'Cites: AC-01, AC-02, D-01, D-16. Gives every live role that holds every other catalogue key the keys named, so that a role holding everything (the Owner''s, actors-and-roles s3.2, s4) still does when keys are added. Each grant names whoever granted the role its first key, as onboarding records the Owner granting their own. For migrations only.';

REVOKE EXECUTE ON FUNCTION grant_to_complete_roles(text[]) FROM PUBLIC;

SELECT grant_to_complete_roles(ARRAY['Payment.Capture', 'Payment.Void', 'Employee.Reactivate', 'Refund.Pay', 'Shift.Reopen']);

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'Migrations are forward-only and are never rolled back (docs/database/CONVENTIONS.md s14).'; END $$;
