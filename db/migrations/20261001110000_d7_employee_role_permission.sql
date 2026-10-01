-- migrate:up

-- Domain 7: Employee / Role / Permission.
-- Design, citations and decisions: docs/database/D7-EMPLOYEE-ROLE-PERMISSION.md

-- ============================================================================ employee (employee-domain s1..s3, s22.9)

CREATE TABLE employee (
  id                uuid          NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid          NOT NULL,
  employee_number   nonblank_text NOT NULL,
  first_name        nonblank_text NOT NULL,
  last_name         nonblank_text NOT NULL,
  preferred_name    nonblank_text,
  email             nonblank_text,
  phone             nonblank_text,
  start_date        date,
  employment_type   nonblank_text,
  home_store_id     uuid,
  department        nonblank_text,
  position          nonblank_text,
  status            text          NOT NULL DEFAULT 'Active',
  created_at        timestamptz   NOT NULL DEFAULT now(),
  status_changed_at timestamptz   NOT NULL DEFAULT now(),
  status_changed_by uuid          NOT NULL,
  CONSTRAINT pk_employee PRIMARY KEY (id),
  CONSTRAINT fk_employee_organization FOREIGN KEY (organization_id) REFERENCES organization (id),
  CONSTRAINT fk_employee_home_store FOREIGN KEY (home_store_id, organization_id) REFERENCES store (id, organization_id),
  CONSTRAINT uq_employee_number UNIQUE (organization_id, employee_number),
  CONSTRAINT uq_employee_id_organization UNIQUE (id, organization_id),
  CONSTRAINT ck_employee_status CHECK (status IN ('Active', 'OnLeave', 'Suspended', 'Terminated', 'Archived'))
);

COMMENT ON TABLE employee IS
  'Cites: EM-01, EM-05, EM-06, EM-08, EM-11, SM-48, SM-48a, RT-009. A person the organization employs, with or without a login. Kept for ever once created: documents name their employees, and a terminated employee stays answerable for what they did (never a delete).';
COMMENT ON CONSTRAINT fk_employee_organization ON employee IS
  'Cites: RT-001. An employee belongs to one organization.';
COMMENT ON CONSTRAINT fk_employee_home_store ON employee IS
  'Cites: BI-14. A home store of the employee''s own organization; descriptive, granting nothing (EM-06).';
COMMENT ON CONSTRAINT uq_employee_number ON employee IS
  'Cites: EM-05. The employee number is unique per organization (employee-domain s2).';
COMMENT ON CONSTRAINT uq_employee_id_organization ON employee IS
  'Cites: BI-14. Lets an account, assignment or grant prove, by foreign key, that its employee is of its organization.';
COMMENT ON CONSTRAINT ck_employee_status ON employee IS
  'Cites: SM-48a, EM-09. The employee statuses of employee-domain s3, verbatim.';

CREATE TRIGGER tg_employee_status_stamp BEFORE UPDATE OF status ON employee
  FOR EACH ROW EXECUTE FUNCTION stamp_status_change();
COMMENT ON TRIGGER tg_employee_status_stamp ON employee IS
  'Cites: SM-03, RT-353. Server time for each status change.';

CREATE TRIGGER tg_employee_state_machine BEFORE INSERT OR UPDATE OF status ON employee
  FOR EACH ROW EXECUTE FUNCTION enforce_state_transition('Employee', 'status');
COMMENT ON TRIGGER tg_employee_state_machine ON employee IS
  'Cites: SM-48a, SM-02, EM-08. An employee is created Active and moves only along the edges of state-machines s22.9; Terminated leads only to Archived.';

CREATE FUNCTION forbid_termination_with_open_shift() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'Terminated' AND OLD.status IS DISTINCT FROM 'Terminated'
     AND EXISTS (SELECT 1 FROM cash_shift WHERE opened_by = NEW.id AND status <> 'Closed') THEN
    RAISE EXCEPTION 'employee % has a till shift that is not closed; close it first', NEW.id USING ERRCODE = 'SS057';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION forbid_termination_with_open_shift() IS
  'Cites: EM-10, BI-39, CD-01. Termination is refused while the employee has a till shift that is not closed.';

CREATE TRIGGER tg_employee_termination BEFORE UPDATE OF status ON employee
  FOR EACH ROW EXECUTE FUNCTION forbid_termination_with_open_shift();
COMMENT ON TRIGGER tg_employee_termination ON employee IS
  'Cites: EM-10. No termination with an open drawer.';

CREATE TRIGGER tg_employee_audit AFTER INSERT OR UPDATE OF status ON employee
  FOR EACH ROW EXECUTE FUNCTION audit_state_transition('Employee');
COMMENT ON TRIGGER tg_employee_audit ON employee IS
  'Cites: D-06, EM-10, SM-50. Employee.StateChange and Employee.Terminate (s22.9).';

-- ============================================================================ login (employee-domain s1, architecture s7)

CREATE TABLE user_account (
  id                  uuid          NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid          NOT NULL,
  employee_id         uuid          NOT NULL,
  username            nonblank_text NOT NULL,
  password_hash       text          NOT NULL,
  password_changed_at timestamptz   NOT NULL DEFAULT now(),
  created_at          timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT pk_user_account PRIMARY KEY (id),
  CONSTRAINT fk_user_account_employee FOREIGN KEY (employee_id, organization_id) REFERENCES employee (id, organization_id),
  CONSTRAINT uq_user_account_employee UNIQUE (employee_id),
  CONSTRAINT uq_user_account_identity UNIQUE (id, employee_id, organization_id),
  CONSTRAINT ck_user_account_password_hash CHECK (
    password_hash ~ '^\$argon2id\$' OR password_hash ~ '^\$2[aby]\$(1[2-9]|[23][0-9])\$')
);

CREATE UNIQUE INDEX uq_user_account_username ON user_account (organization_id, lower(username));

COMMENT ON TABLE user_account IS
  'Cites: EM-01, EM-02, EM-04, RT-293. A login credential, optional for an employee and belonging to exactly one. The password is kept only as a slow salted hash made by the application.';
COMMENT ON CONSTRAINT fk_user_account_employee ON user_account IS
  'Cites: EM-02, BI-23. A login belongs to one employee of its organization: never a shared account.';
COMMENT ON CONSTRAINT uq_user_account_employee ON user_account IS
  'Cites: EM-01, EM-02. At most one login per employee.';
COMMENT ON CONSTRAINT uq_user_account_identity ON user_account IS
  'Cites: EM-02. Lets a session prove, by foreign key, whose login it is.';
COMMENT ON CONSTRAINT ck_user_account_password_hash ON user_account IS
  'Cites: EM-04, ADR-12. Only an Argon2id hash, or a bcrypt hash of cost 12 or more, is stored (architecture s7.3); a password is never stored in a form that could be shown.';
COMMENT ON INDEX uq_user_account_username IS
  'Cites: EM-02. A username identifies one login in its organization, whatever its case (OQ-025).';

CREATE FUNCTION stamp_password_change() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
    NEW.password_changed_at := now();
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION stamp_password_change() IS
  'Cites: EM-04, RT-353. Records when a credential last changed, with server time.';

CREATE TRIGGER tg_user_account_password BEFORE UPDATE OF password_hash ON user_account
  FOR EACH ROW EXECUTE FUNCTION stamp_password_change();
COMMENT ON TRIGGER tg_user_account_password ON user_account IS
  'Cites: EM-04. Server time for each password change.';

ALTER TABLE pos_terminal ADD CONSTRAINT uq_pos_terminal_id_organization UNIQUE (id, organization_id);
COMMENT ON CONSTRAINT uq_pos_terminal_id_organization ON pos_terminal IS
  'Cites: BI-14. Lets a till session prove, by foreign key, that its terminal is of its organization.';

CREATE TABLE user_session (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL,
  user_account_id uuid        NOT NULL,
  employee_id     uuid        NOT NULL,
  token_hash      bytea       NOT NULL,
  pos_terminal_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  ended_at        timestamptz,
  end_reason      text,
  CONSTRAINT pk_user_session PRIMARY KEY (id),
  CONSTRAINT fk_user_session_account FOREIGN KEY (user_account_id, employee_id, organization_id)
    REFERENCES user_account (id, employee_id, organization_id),
  CONSTRAINT fk_user_session_terminal FOREIGN KEY (pos_terminal_id, organization_id)
    REFERENCES pos_terminal (id, organization_id),
  CONSTRAINT uq_user_session_token UNIQUE (token_hash),
  CONSTRAINT ck_user_session_token CHECK (octet_length(token_hash) = 32),
  CONSTRAINT ck_user_session_expiry CHECK (expires_at > created_at),
  CONSTRAINT ck_user_session_end CHECK ((ended_at IS NULL) = (end_reason IS NULL)),
  CONSTRAINT ck_user_session_end_reason CHECK (end_reason IN ('Logout', 'Expired', 'Revoked', 'Rotated'))
);

CREATE INDEX ix_user_session_employee_live ON user_session (employee_id) WHERE ended_at IS NULL;

COMMENT ON TABLE user_session IS
  'Cites: ADR-12, AU-12a, EM-16, RT-293. A server-held session (architecture s7.1): only a hash of its opaque token is kept, so a copy of the database cannot be replayed as a login. Ended once, with the cause, and kept.';
COMMENT ON CONSTRAINT fk_user_session_account ON user_session IS
  'Cites: EM-02, AU-05. A session is one login''s, and so one employee''s.';
COMMENT ON CONSTRAINT fk_user_session_terminal ON user_session IS
  'Cites: AU-10, HD-18. The till a session was opened at, in its organization.';
COMMENT ON CONSTRAINT uq_user_session_token ON user_session IS
  'Cites: ADR-12. One session per token.';
COMMENT ON CONSTRAINT ck_user_session_token ON user_session IS
  'Cites: ADR-12. The token is kept as its SHA-256 hash, never itself.';
COMMENT ON CONSTRAINT ck_user_session_expiry ON user_session IS
  'Cites: ADR-12. A session expires after it starts.';
COMMENT ON CONSTRAINT ck_user_session_end ON user_session IS
  'Cites: AU-12a, SM-03. An end records when and why together.';
COMMENT ON CONSTRAINT ck_user_session_end_reason ON user_session IS
  'Cites: AU-12a, EM-16, SM-47. A sign-out is Logout; an expiry, a revocation (suspension, access removed) or a rotation on a privilege change are session ends with their cause (architecture s7.1).';
COMMENT ON INDEX ix_user_session_employee_live IS
  'Cites: EM-16, SM-47. Finds an employee''s live sessions to end them at once.';

CREATE FUNCTION record_session_end() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.end_reason IS NOT NULL THEN
    RAISE EXCEPTION 'session % has ended; how and when cannot be changed', OLD.id USING ERRCODE = 'SS001';
  END IF;
  IF NEW.end_reason IS NOT NULL THEN
    NEW.ended_at := now();
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION record_session_end() IS
  'Cites: AU-12a, SM-03, RT-353. A session ends once, stamped with server time.';

CREATE TRIGGER tg_user_session_end BEFORE UPDATE ON user_session
  FOR EACH ROW EXECUTE FUNCTION record_session_end();
COMMENT ON TRIGGER tg_user_session_end ON user_session IS
  'Cites: AU-12a. The end of a session is written once.';

-- ============================================================================ permissions and roles (actors-and-roles s1, s2, s4)

CREATE TABLE permission (
  key        nonblank_text NOT NULL,
  created_at timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT pk_permission PRIMARY KEY (key),
  CONSTRAINT ck_permission_key CHECK (key ~ '^[A-Z][A-Za-z]*(\.[A-Z][A-Za-z]*)+$')
);

COMMENT ON TABLE permission IS
  'Cites: AC-02, D-01, RT-009. The permission catalogue of actors-and-roles s2: 117 opaque dotted keys, matched only for equality. A key is added only by a migration.';
COMMENT ON CONSTRAINT ck_permission_key ON permission IS
  'Cites: AC-02. A key is a dotted name of capitalised parts; there are no wildcards.';

INSERT INTO permission (key) VALUES
  ('Product.View'), ('Product.Create'), ('Product.Edit'), ('Product.Archive'), ('Product.Cost.View'), ('Price.View'),
  ('Price.Edit'), ('Price.Override'), ('Price.BelowCost.Approve'), ('Tax.View'), ('Tax.Edit'), ('Discount.View'),
  ('Discount.Create'), ('Discount.Edit'), ('Discount.Apply'), ('Discount.Large.Approve'), ('Import.Run'),
  ('Import.Approve'), ('Inventory.View'), ('Inventory.Receive'), ('Inventory.Adjust'), ('Inventory.Adjust.Large.Approve'),
  ('Inventory.Count.Create'), ('Inventory.Count.Post'), ('Inventory.Transfer.Create'), ('Inventory.Transfer.Dispatch'),
  ('Inventory.Transfer.Receive'), ('Inventory.Reservation.Manage'), ('Inventory.FEFO.Override'),
  ('Inventory.Ledger.View'), ('Purchase.View'), ('Purchase.Requisition.Create'), ('Purchase.Requisition.Submit'),
  ('Purchase.Order.Create'), ('Purchase.Order.Submit'), ('Purchase.Order.Approve'), ('Purchase.Order.Send'),
  ('Purchase.Receive'), ('Purchase.Invoice.Record'), ('Purchase.ThreeWayMatch.View'), ('Purchase.Return.Create'),
  ('Purchase.Return.Approve'), ('Purchase.Pay'), ('Sale.View'), ('Sale.Create'), ('Sale.Discount'), ('Sale.Suspend'),
  ('Sale.Resume'), ('Sale.Void'), ('Sale.Void.Posted.Approve'), ('Sale.Refund'), ('Sale.Refund.Large.Approve'),
  ('Sale.OfflineQueue.Manage'), ('Return.Create'), ('Return.Approve'), ('Return.Dispose'), ('Customer.View'),
  ('Customer.Create'), ('Customer.Edit'), ('Customer.Credit.Grant'), ('Customer.Credit.Approve'),
  ('Customer.Payment.Record'), ('Customer.Loyalty.Adjust'), ('Customer.Statement.View'), ('Customer.DataExport'),
  ('Supplier.View'), ('Supplier.Create'), ('Supplier.Edit'), ('Supplier.Payment.Record'), ('Supplier.Credit.Adjust'),
  ('Supplier.Balance.View'), ('Employee.View'), ('Employee.Create'), ('Employee.Edit'), ('Employee.Terminate'),
  ('Employee.StoreAccess.Grant'), ('Employee.Password.Reset'), ('Role.View'), ('Role.Create'), ('Role.Edit'),
  ('Role.Assign'), ('Attendance.View'), ('Attendance.Correct'), ('Attendance.Correct.Approve'), ('Shift.Manage'),
  ('Rfid.View'), ('Rfid.Reader.Register'), ('Rfid.Reader.Edit'), ('Rfid.Credential.Issue'), ('Rfid.Credential.Revoke'),
  ('Rfid.Event.View'), ('Device.View'), ('Device.Register'), ('Device.Edit'), ('Device.Disable'), ('Shift.Open'),
  ('Shift.Close'), ('Cash.In'), ('Cash.Out'), ('Cash.Out.Approve'), ('Cash.Variance.Acknowledge'), ('Cash.Count.View'),
  ('Payment.View'), ('Payment.Method.Configure'), ('Payment.Provider.Configure'), ('Report.View'), ('Report.Financial'),
  ('Report.OrganizationWide'), ('Report.Export'), ('Audit.View'), ('Audit.View.Sensitive'), ('Config.Store'),
  ('Config.Organization'), ('Config.Roles'), ('Config.Backup'), ('Backup.Restore'), ('Config.NotificationRule');

CREATE FUNCTION record_revocation() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.revoked_by IS NOT NULL THEN
    IF NEW.revoked_by IS DISTINCT FROM OLD.revoked_by OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
      RAISE EXCEPTION '% % is already revoked; who revoked it and when cannot be changed', TG_TABLE_NAME, OLD.id
        USING ERRCODE = 'SS001';
    END IF;
  ELSIF NEW.revoked_by IS NOT NULL THEN
    NEW.revoked_at := now();
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION record_revocation() IS
  'Cites: BI-40, PC-01, EM-15, RT-353. A grant is revoked once, recording who and when with server time; the grant row stays as history, so the permission set as it stood at any time can be rebuilt.';

CREATE TABLE role (
  id              uuid          NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid          NOT NULL,
  name            nonblank_text NOT NULL,
  description     nonblank_text,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  archived_by     uuid,
  CONSTRAINT pk_role PRIMARY KEY (id),
  CONSTRAINT fk_role_organization FOREIGN KEY (organization_id) REFERENCES organization (id),
  CONSTRAINT uq_role_name UNIQUE (organization_id, name),
  CONSTRAINT uq_role_id_organization UNIQUE (id, organization_id),
  CONSTRAINT ck_role_archival CHECK ((archived_at IS NULL) = (archived_by IS NULL))
);

COMMENT ON TABLE role IS
  'Cites: AC-01, AC-04, EM-06, RT-009. A named permission set of the organization. Custom roles are permitted; templates are a starting point (actors-and-roles s4, OQ-025), and there are no nested roles.';
COMMENT ON CONSTRAINT fk_role_organization ON role IS
  'Cites: RT-001. A role belongs to one organization.';
COMMENT ON CONSTRAINT uq_role_name ON role IS
  'Cites: AC-04. A role name identifies one role in its organization.';
COMMENT ON CONSTRAINT uq_role_id_organization ON role IS
  'Cites: BI-14. Lets a grant or assignment prove, by foreign key, that its role is of its organization.';
COMMENT ON CONSTRAINT ck_role_archival ON role IS
  'Cites: BI-40. An archived role records who and when together; a role is never deleted.';

CREATE TRIGGER tg_role_archival BEFORE UPDATE ON role
  FOR EACH ROW EXECUTE FUNCTION record_archival();
COMMENT ON TRIGGER tg_role_archival ON role IS
  'Cites: BI-40. A role''s archival is recorded once, with server time.';

CREATE TABLE role_permission (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  role_id         uuid        NOT NULL,
  organization_id uuid        NOT NULL,
  permission_key  text        NOT NULL,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  granted_by      uuid        NOT NULL,
  revoked_at      timestamptz,
  revoked_by      uuid,
  CONSTRAINT pk_role_permission PRIMARY KEY (id),
  CONSTRAINT fk_role_permission_role FOREIGN KEY (role_id, organization_id) REFERENCES role (id, organization_id),
  CONSTRAINT fk_role_permission_key FOREIGN KEY (permission_key) REFERENCES permission (key),
  CONSTRAINT ck_role_permission_revoked CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

CREATE UNIQUE INDEX uq_role_permission_live ON role_permission (role_id, permission_key) WHERE revoked_at IS NULL;

COMMENT ON TABLE role_permission IS
  'Cites: AC-02, PC-01, D-01, RT-020. A permission granted to a role: an exact catalogue key, never a pattern. Removing it records a revocation and keeps the row, so a role''s before and after permission sets are always recoverable.';
COMMENT ON CONSTRAINT fk_role_permission_role ON role_permission IS
  'Cites: RT-001. A grant belongs to a role of its organization.';
COMMENT ON CONSTRAINT fk_role_permission_key ON role_permission IS
  'Cites: AC-02, D-01. Only a catalogue key can be granted.';
COMMENT ON CONSTRAINT ck_role_permission_revoked ON role_permission IS
  'Cites: PC-01, SM-03. A revocation records who and when together.';
COMMENT ON INDEX uq_role_permission_live IS
  'Cites: AC-02. A role holds a key at most once at a time.';

CREATE TRIGGER tg_role_permission_revocation BEFORE UPDATE ON role_permission
  FOR EACH ROW EXECUTE FUNCTION record_revocation();
COMMENT ON TRIGGER tg_role_permission_revocation ON role_permission IS
  'Cites: PC-01, BI-40. A revocation is recorded once.';

CREATE TABLE employee_role_assignment (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  employee_id     uuid        NOT NULL,
  role_id         uuid        NOT NULL,
  organization_id uuid        NOT NULL,
  store_id        uuid,
  assigned_at     timestamptz NOT NULL DEFAULT now(),
  assigned_by     uuid        NOT NULL,
  revoked_at      timestamptz,
  revoked_by      uuid,
  CONSTRAINT pk_employee_role_assignment PRIMARY KEY (id),
  CONSTRAINT fk_employee_role_assignment_employee FOREIGN KEY (employee_id, organization_id)
    REFERENCES employee (id, organization_id),
  CONSTRAINT fk_employee_role_assignment_role FOREIGN KEY (role_id, organization_id) REFERENCES role (id, organization_id),
  CONSTRAINT fk_employee_role_assignment_store FOREIGN KEY (store_id, organization_id) REFERENCES store (id, organization_id),
  CONSTRAINT ck_employee_role_assignment_revoked CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

CREATE UNIQUE INDEX uq_employee_role_assignment_live ON employee_role_assignment (employee_id, role_id, store_id)
  NULLS NOT DISTINCT WHERE revoked_at IS NULL;

COMMENT ON TABLE employee_role_assignment IS
  'Cites: MS-11, MS-12, EM-13, RT-020. Which role an employee holds, and where: organization-wide (no store) or in one store. An organization-wide assignment broadens the stores a role applies to and never bypasses store access or default deny.';
COMMENT ON CONSTRAINT fk_employee_role_assignment_employee ON employee_role_assignment IS
  'Cites: BI-14. The employee is of the assignment''s organization.';
COMMENT ON CONSTRAINT fk_employee_role_assignment_role ON employee_role_assignment IS
  'Cites: BI-14. The role is of the assignment''s organization.';
COMMENT ON CONSTRAINT fk_employee_role_assignment_store ON employee_role_assignment IS
  'Cites: MS-11, BI-14. A store-scoped assignment names a store of the organization; none means organization-wide.';
COMMENT ON CONSTRAINT ck_employee_role_assignment_revoked ON employee_role_assignment IS
  'Cites: RT-020, SM-03. A removal records who and when together.';
COMMENT ON INDEX uq_employee_role_assignment_live IS
  'Cites: MS-11. An employee holds a role in a given scope at most once at a time.';

CREATE TRIGGER tg_employee_role_assignment_revocation BEFORE UPDATE ON employee_role_assignment
  FOR EACH ROW EXECUTE FUNCTION record_revocation();
COMMENT ON TRIGGER tg_employee_role_assignment_revocation ON employee_role_assignment IS
  'Cites: RT-020, BI-40. A removal is recorded once.';

CREATE FUNCTION audit_role_assignment() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM write_audit_event('Security.Role.Assign', TG_TABLE_NAME,
    CASE TG_OP WHEN 'INSERT' THEN NULL ELSE to_jsonb(OLD) END, to_jsonb(NEW), false);
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION audit_role_assignment() IS
  'Cites: AU-03, RT-020, PC-01. Every role assignment and every removal records Security.Role.Assign, naming the role and scope on the entity and the prior state in before.';

CREATE TRIGGER tg_employee_role_assignment_audit AFTER INSERT OR UPDATE OF revoked_by ON employee_role_assignment
  FOR EACH ROW EXECUTE FUNCTION audit_role_assignment();
COMMENT ON TRIGGER tg_employee_role_assignment_audit ON employee_role_assignment IS
  'Cites: AU-03, RT-020. Every permission change of an employee is audited.';

UPDATE audit_event_type SET origin = 'Database' WHERE code = 'Security.Role.Assign';

CREATE TABLE employee_store_access (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  employee_id     uuid        NOT NULL,
  store_id        uuid        NOT NULL,
  organization_id uuid        NOT NULL,
  valid_from      timestamptz,
  valid_to        timestamptz,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  granted_by      uuid        NOT NULL,
  revoked_at      timestamptz,
  revoked_by      uuid,
  CONSTRAINT pk_employee_store_access PRIMARY KEY (id),
  CONSTRAINT fk_employee_store_access_employee FOREIGN KEY (employee_id, organization_id)
    REFERENCES employee (id, organization_id),
  CONSTRAINT fk_employee_store_access_store FOREIGN KEY (store_id, organization_id) REFERENCES store (id, organization_id),
  CONSTRAINT ck_employee_store_access_window CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from),
  CONSTRAINT ck_employee_store_access_revoked CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

CREATE UNIQUE INDEX uq_employee_store_access_live ON employee_store_access (employee_id, store_id)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE employee_store_access IS
  'Cites: EM-12, EM-13, EM-14, EM-15, MS-03, RT-002. An employee''s access to a store, with optional dates. Access and a role are separate facts, and a role without access grants nothing. Revocation records a fact and keeps the row, so the scope before and after is recoverable (not yet an audit event: OQ-025).';
COMMENT ON CONSTRAINT fk_employee_store_access_employee ON employee_store_access IS
  'Cites: BI-14. The employee is of the store''s organization.';
COMMENT ON CONSTRAINT fk_employee_store_access_store ON employee_store_access IS
  'Cites: EM-12, RT-001. Access to one store of the organization.';
COMMENT ON CONSTRAINT ck_employee_store_access_window ON employee_store_access IS
  'Cites: EM-12. The optional access window ends after it starts.';
COMMENT ON CONSTRAINT ck_employee_store_access_revoked ON employee_store_access IS
  'Cites: EM-15, SM-03. A revocation records who and when together.';
COMMENT ON INDEX uq_employee_store_access_live IS
  'Cites: EM-12. One live access per employee per store.';

CREATE TRIGGER tg_employee_store_access_revocation BEFORE UPDATE ON employee_store_access
  FOR EACH ROW EXECUTE FUNCTION record_revocation();
COMMENT ON TRIGGER tg_employee_store_access_revocation ON employee_store_access IS
  'Cites: EM-15, BI-40. A revocation is recorded once.';

CREATE FUNCTION employee_holds_permission(p_employee_id uuid, p_store_id uuid, p_permission text) RETURNS boolean
  LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM employee_role_assignment a
    JOIN role r ON r.id = a.role_id AND r.archived_at IS NULL
    JOIN role_permission g ON g.role_id = r.id AND g.permission_key = p_permission AND g.revoked_at IS NULL
    WHERE a.employee_id = p_employee_id AND a.revoked_at IS NULL
      AND CASE WHEN p_store_id IS NULL THEN a.store_id IS NULL
               ELSE (a.store_id IS NULL OR a.store_id = p_store_id)
                    AND EXISTS (SELECT 1 FROM employee_store_access s
                                WHERE s.employee_id = p_employee_id AND s.store_id = p_store_id AND s.revoked_at IS NULL
                                  AND (s.valid_from IS NULL OR s.valid_from <= now())
                                  AND (s.valid_to IS NULL OR s.valid_to > now()))
          END)
$$;

COMMENT ON FUNCTION employee_holds_permission(uuid, uuid, text) IS
  'Cites: AC-01, AC-02, EM-13, MS-11, MS-12, BI-14. Whether an employee''s grants give a permission in a store: a live assignment, of a live role holding the exact key, in that store or organization-wide, intersected with live store access. An organization-level action (no store) needs an organization-wide assignment (OQ-025). Default deny. The one authorization gate also checks the employee''s status and session on every request (architecture s7.5, s8.2).';

-- ============================================================================ the permission each transition needs (architecture s8.4)

ALTER TABLE state_machine_state ADD COLUMN creation_permission_rule text;
ALTER TABLE state_machine_state ADD COLUMN creation_permission_key text;
ALTER TABLE state_machine_state ADD CONSTRAINT ck_state_machine_state_permission
  CHECK (creation_permission_rule IN ('Key', 'System', 'OpenDecision')
         AND (creation_permission_rule = 'Key') = (creation_permission_key IS NOT NULL));
ALTER TABLE state_machine_state ADD CONSTRAINT fk_state_machine_state_permission
  FOREIGN KEY (creation_permission_key) REFERENCES permission (key);
ALTER TABLE state_machine_edge ADD COLUMN permission_rule text;
ALTER TABLE state_machine_edge ADD COLUMN permission_key text;
ALTER TABLE state_machine_edge ADD CONSTRAINT ck_state_machine_edge_permission
  CHECK (permission_rule IN ('Key', 'System', 'OpenDecision') AND (permission_rule = 'Key') = (permission_key IS NOT NULL));
ALTER TABLE state_machine_edge ADD CONSTRAINT fk_state_machine_edge_permission
  FOREIGN KEY (permission_key) REFERENCES permission (key);

COMMENT ON CONSTRAINT ck_state_machine_state_permission ON state_machine_state IS
  'Cites: SM-02d, D-01. What authorizes a creation, where s22 contracts one: a catalogue key, the system, or an undecided key, which refuses.';
COMMENT ON CONSTRAINT fk_state_machine_state_permission ON state_machine_state IS
  'Cites: AC-02, D-01. Only a catalogue key.';
COMMENT ON CONSTRAINT ck_state_machine_edge_permission ON state_machine_edge IS
  'Cites: SM-02d, D-01, AC-01. What authorizes an edge (the s22 Permission column): a catalogue key; the system (a provider, telemetry); or OPEN DECISION, which the one authorization gate refuses until the owner names a key (architecture s8.4).';
COMMENT ON CONSTRAINT fk_state_machine_edge_permission ON state_machine_edge IS
  'Cites: AC-02, D-01. Only a catalogue key.';

-- Employee (s22.9). The two returns to Active come from the contract's Reversal column, which names no permission and no
-- event; "reactivate" is SM-50's word (OQ-025).
INSERT INTO state_machine_state (machine, state, is_initial, creation_audit_event_type, creation_permission_rule,
                                 creation_permission_key) VALUES
  ('Employee', 'Active', true, 'Employee.StateChange', 'Key', 'Employee.Create'),
  ('Employee', 'OnLeave', false, NULL, NULL, NULL),
  ('Employee', 'Suspended', false, NULL, NULL, NULL),
  ('Employee', 'Terminated', false, NULL, NULL, NULL),
  ('Employee', 'Archived', false, NULL, NULL, NULL);

INSERT INTO state_machine_edge (machine, from_state, to_state, event, audit_event_type, requires_reason, permission_rule,
                                permission_key) VALUES
  ('Employee', 'Active', 'OnLeave', 'leave', 'Employee.StateChange', true, 'Key', 'Employee.Edit'),
  ('Employee', 'OnLeave', 'Active', 'reactivate', 'Employee.StateChange', false, 'OpenDecision', NULL),
  ('Employee', 'Active', 'Suspended', 'suspend', NULL, false, 'Key', 'Employee.Edit'),
  ('Employee', 'Suspended', 'Active', 'reactivate', 'Employee.StateChange', true, 'OpenDecision', NULL),
  ('Employee', 'Active', 'Terminated', 'terminate', 'Employee.Terminate', false, 'Key', 'Employee.Terminate'),
  ('Employee', 'OnLeave', 'Terminated', 'terminate', 'Employee.Terminate', false, 'Key', 'Employee.Terminate'),
  ('Employee', 'Terminated', 'Archived', 'archive', 'Employee.StateChange', true, 'Key', 'Employee.Edit');

UPDATE state_machine_edge SET permission_rule = 'Key', permission_key = 'Product.Edit'
  WHERE machine = 'Product' AND event IN ('activate', 'discontinue', 'reactivate', 'hide', 'unhide');
UPDATE state_machine_edge SET permission_rule = 'Key', permission_key = 'Product.Archive'
  WHERE machine = 'Product' AND event = 'archive';

UPDATE state_machine_edge SET permission_rule = 'Key', permission_key = 'Inventory.Adjust'
  WHERE machine = 'StockAdjustment' AND event IN ('submit', 'post', 'cancel', 'reverse');
UPDATE state_machine_edge SET permission_rule = 'Key', permission_key = 'Inventory.Adjust.Large.Approve'
  WHERE machine = 'StockAdjustment' AND event = 'approve';

UPDATE state_machine_state SET creation_permission_rule = 'Key', creation_permission_key = 'Sale.Create'
  WHERE machine = 'Sale' AND state = 'Completed';
UPDATE state_machine_edge SET permission_rule = 'Key', permission_key = 'Sale.Void' WHERE machine = 'Sale' AND event = 'void';
UPDATE state_machine_edge SET permission_rule = 'Key', permission_key = 'Return.Create'
  WHERE machine = 'Sale' AND event IN ('return part', 'return rest');

UPDATE state_machine_state SET creation_permission_rule = 'OpenDecision' WHERE machine = 'Payment' AND state = 'Pending';
UPDATE state_machine_edge SET permission_rule = 'System' WHERE machine = 'Payment' AND event IN ('authorize', 'decline', 'fail');
UPDATE state_machine_edge SET permission_rule = 'OpenDecision' WHERE machine = 'Payment' AND event IN ('capture', 'void');

UPDATE state_machine_state SET creation_permission_rule = 'Key', creation_permission_key = 'Shift.Open'
  WHERE machine = 'Shift' AND state = 'Open';
UPDATE state_machine_edge SET permission_rule = 'Key', permission_key = 'Shift.Close'
  WHERE machine = 'Shift' AND event IN ('begin count', 'close', 'recount');

UPDATE state_machine_state SET creation_permission_rule = 'Key', creation_permission_key = 'Device.Register'
  WHERE machine = 'Device' AND state = 'Registered';
UPDATE state_machine_edge SET permission_rule = 'Key', permission_key = 'Device.Edit'
  WHERE machine = 'Device' AND (event = 'retire' OR (from_state = 'Registered' AND to_state = 'Active'));
UPDATE state_machine_edge SET permission_rule = 'Key', permission_key = 'Device.Disable'
  WHERE machine = 'Device' AND event = 'disable';
UPDATE state_machine_edge SET permission_rule = 'OpenDecision'
  WHERE machine = 'Device' AND from_state = 'Disabled' AND to_state = 'Active';

UPDATE state_machine_edge SET permission_rule = 'Key', permission_key = 'Return.Create'
  WHERE machine = 'CustomerReturn' AND event = 'post';
UPDATE state_machine_edge SET permission_rule = 'OpenDecision' WHERE machine = 'CustomerReturn' AND event = 'cancel';

UPDATE state_machine_edge SET permission_rule = 'Key', permission_key = 'Sale.Refund' WHERE machine = 'Refund' AND event = 'submit';
UPDATE state_machine_edge SET permission_rule = 'Key', permission_key = 'Sale.Refund.Large.Approve'
  WHERE machine = 'Refund' AND event = 'approve';
UPDATE state_machine_edge SET permission_rule = 'System' WHERE machine = 'Refund' AND event IN ('complete', 'fail');
UPDATE state_machine_edge SET permission_rule = 'OpenDecision'
  WHERE machine = 'Refund' AND event IN ('submit to provider', 'retry', 'cancel');

ALTER TABLE state_machine_edge ALTER COLUMN permission_rule SET NOT NULL;

-- ============================================================================ who did it is an employee (CONVENTIONS s11)

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT c.table_name, c.column_name
           FROM information_schema.columns c
           JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
           WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.column_name LIKE '%\_by'
           ORDER BY c.table_name, c.column_name LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES employee (id)',
                   r.table_name, 'fk_' || r.table_name || '_' || r.column_name, r.column_name);
    EXECUTE format('COMMENT ON CONSTRAINT %I ON %I IS %L', 'fk_' || r.table_name || '_' || r.column_name, r.table_name,
                   'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.');
  END LOOP;
END
$$;

ALTER TABLE sale ADD CONSTRAINT fk_sale_employee FOREIGN KEY (employee_id) REFERENCES employee (id);
COMMENT ON CONSTRAINT fk_sale_employee ON sale IS
  'Cites: RT-122, BI-23. The employee who made the sale is an employee of record.';

-- ============================================================================ personal data is redacted in the audit trail (AU-09)

CREATE TABLE audit_redacted_field (
  entity_type nonblank_text NOT NULL,
  field       nonblank_text NOT NULL,
  CONSTRAINT pk_audit_redacted_field PRIMARY KEY (entity_type, field)
);

COMMENT ON TABLE audit_redacted_field IS
  'Cites: AU-09, CU-33, CU-35, RT-295. The personal fields of each entity that an audit event records only as changed, never with their value.';

INSERT INTO audit_redacted_field (entity_type, field) VALUES
  ('employee', 'first_name'), ('employee', 'last_name'), ('employee', 'preferred_name'), ('employee', 'email'),
  ('employee', 'phone');

CREATE FUNCTION audit_redact(p_entity_type text, p_values jsonb) RETURNS jsonb
  LANGUAGE sql STABLE
AS $$
  SELECT jsonb_object_agg(e.key, CASE WHEN f.field IS NULL OR e.value = 'null'::jsonb THEN e.value
                                      ELSE to_jsonb('[redacted]'::text) END)
  FROM jsonb_each(p_values) e
  LEFT JOIN audit_redacted_field f ON f.entity_type = p_entity_type AND f.field = e.key
$$;

COMMENT ON FUNCTION audit_redact(text, jsonb) IS
  'Cites: AU-09, CU-35, RT-295. Replaces the value of each personal field with a marker, so the event shows that it changed and never what it holds.';

CREATE OR REPLACE FUNCTION write_audit_event(
  p_event_type  text,
  p_entity_type text,
  p_old         jsonb,
  p_new         jsonb,
  p_needs_reason boolean
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor  uuid := audit_setting('actor_id')::uuid;
  v_source text := audit_setting('source');
  v_corr   uuid := audit_setting('correlation_id')::uuid;
  v_store  uuid := (p_new ->> 'store_id')::uuid;
  v_org    uuid := (p_new ->> 'organization_id')::uuid;
  v_reason uuid;
  v_before jsonb;
  v_after  jsonb;
BEGIN
  IF v_actor IS NULL OR v_source IS NULL OR v_corr IS NULL THEN
    RAISE EXCEPTION 'an audited change needs the authenticated actor, the source and the correlation id'
      USING ERRCODE = 'SS054';
  END IF;
  IF v_org IS NULL THEN
    SELECT organization_id INTO v_org FROM store WHERE id = v_store;
  END IF;

  v_reason := coalesce((p_new ->> 'cancel_reason_code_id')::uuid, (p_new ->> 'late_reason_code_id')::uuid,
                       (p_new ->> 'reason_code_id')::uuid);
  IF v_reason IS NULL AND p_needs_reason THEN
    v_reason := audit_setting('reason_code_id')::uuid;
    IF v_reason IS NULL THEN
      RAISE EXCEPTION '% needs a reason', p_event_type USING ERRCODE = 'SS055';
    END IF;
    PERFORM assert_reason_code_live(v_reason);
  END IF;

  IF p_old IS NULL THEN
    v_after := p_new;
  ELSE
    SELECT jsonb_object_agg(k, p_old -> k), jsonb_object_agg(k, p_new -> k) INTO v_before, v_after
    FROM jsonb_object_keys(p_new) AS k WHERE p_old -> k IS DISTINCT FROM p_new -> k;
  END IF;

  INSERT INTO audit_event (organization_id, store_id, event_type, entity_type, entity_id, actor_id, effective_actor_id,
                           role_used, source, terminal_id, correlation_id, client_operation_id, ip_address,
                           reason_code_id, before, after)
  VALUES (v_org, v_store, p_event_type, p_entity_type, (p_new ->> 'id')::uuid, v_actor,
          audit_setting('effective_actor_id')::uuid, audit_setting('role'), v_source, audit_setting('terminal_id')::uuid,
          v_corr, audit_setting('client_operation_id')::uuid, audit_setting('ip_address')::inet, v_reason,
          audit_redact(p_entity_type, v_before), audit_redact(p_entity_type, v_after));
END
$$;

COMMENT ON FUNCTION write_audit_event(text, text, jsonb, jsonb, boolean) IS
  'Cites: AU-01, AU-04, AU-05, AU-06, AU-07, AU-08, AU-09, AU-10, RT-290, RT-293, RT-295, RT-464. Writes one event in the transaction of the change: the actor, source and correlation id from the authenticated context, refusing the change without them; the store and organization from the entity; the reason from the entity or the context, refusing a transition that needs one without it; the whole created row, or only the fields that changed, with personal fields redacted at write time.';

-- ============================================================================ runtime role grants (ADR-11, CONVENTIONS s10)

GRANT SELECT ON employee TO smartstore_app;
GRANT INSERT (id, organization_id, employee_number, first_name, last_name, preferred_name, email, phone, start_date,
              employment_type, home_store_id, department, position, status_changed_by)
  ON employee TO smartstore_app;
GRANT UPDATE (first_name, last_name, preferred_name, email, phone, start_date, employment_type, home_store_id, department,
              position, status, status_changed_by)
  ON employee TO smartstore_app;
-- employee_number and organization are the record's identity (EM-08: a re-hire is a new record).

GRANT SELECT ON user_account TO smartstore_app;
GRANT INSERT (id, organization_id, employee_id, username, password_hash) ON user_account TO smartstore_app;
GRANT UPDATE (username, password_hash) ON user_account TO smartstore_app;

GRANT SELECT ON user_session TO smartstore_app;
GRANT INSERT (id, organization_id, user_account_id, employee_id, token_hash, pos_terminal_id, expires_at)
  ON user_session TO smartstore_app;
GRANT UPDATE (end_reason) ON user_session TO smartstore_app;

GRANT SELECT ON permission TO smartstore_app;

GRANT SELECT ON role TO smartstore_app;
GRANT INSERT (id, organization_id, name, description) ON role TO smartstore_app;
GRANT UPDATE (name, description, archived_by) ON role TO smartstore_app;

GRANT SELECT ON role_permission TO smartstore_app;
GRANT INSERT (id, role_id, organization_id, permission_key, granted_by) ON role_permission TO smartstore_app;
GRANT UPDATE (revoked_by) ON role_permission TO smartstore_app;

GRANT SELECT ON employee_role_assignment TO smartstore_app;
GRANT INSERT (id, employee_id, role_id, organization_id, store_id, assigned_by) ON employee_role_assignment TO smartstore_app;
GRANT UPDATE (revoked_by) ON employee_role_assignment TO smartstore_app;

GRANT SELECT ON employee_store_access TO smartstore_app;
GRANT INSERT (id, employee_id, store_id, organization_id, valid_from, valid_to, granted_by)
  ON employee_store_access TO smartstore_app;
GRANT UPDATE (revoked_by) ON employee_store_access TO smartstore_app;

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'Migrations are forward-only and are never rolled back (docs/database/CONVENTIONS.md s14).'; END $$;
