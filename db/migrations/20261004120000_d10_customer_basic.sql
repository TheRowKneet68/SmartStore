-- migrate:up

-- Customer domain (basic): identity, status, contacts, state machine.
-- Cites: CU-01, CU-04, CU-05, CU-06, CU-07, CU-09, CU-10, CU-33, CU-34, CU-37,
--        SM-45, SM-45a, SM-45b, SM-45c, RT-001, SM-03, RT-353.

-- 1. Extend the customer table -----------------------------------------------

ALTER TABLE customer
  ADD COLUMN status              text          NOT NULL DEFAULT 'Active',
  ADD COLUMN phone               text,
  ADD COLUMN email               text,
  ADD COLUMN marketing_consent   text          NOT NULL DEFAULT 'NotAsked',
  ADD COLUMN marketing_consent_at timestamptz,
  ADD COLUMN status_changed_at   timestamptz   NOT NULL DEFAULT now(),
  ADD COLUMN status_changed_by   uuid,
  ADD COLUMN created_by          uuid;

-- CHECK constraints
ALTER TABLE customer
  ADD CONSTRAINT ck_customer_status
    CHECK (status IN ('Active', 'OnHold', 'CreditBlocked', 'Closed')),
  ADD CONSTRAINT ck_customer_marketing_consent
    CHECK (marketing_consent IN ('NotAsked', 'Yes', 'No')),
  ADD CONSTRAINT ck_customer_consent_when
    CHECK ((marketing_consent = 'NotAsked') = (marketing_consent_at IS NULL)),
  ADD CONSTRAINT ck_customer_walk_in_immutable
    CHECK (NOT is_walk_in OR status = 'Active');

-- FK constraints
ALTER TABLE customer
  ADD CONSTRAINT fk_customer_status_changed_by
    FOREIGN KEY (status_changed_by) REFERENCES employee(id),
  ADD CONSTRAINT fk_customer_created_by
    FOREIGN KEY (created_by) REFERENCES employee(id);

-- Lookup index for duplicate-contact detection (CU-04, CU-05).
-- Uniqueness is enforced at the application layer (checkDuplicate); force:true overrides it.
CREATE INDEX ix_customer_phone ON customer (organization_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX ix_customer_email ON customer (organization_id, email) WHERE email IS NOT NULL;

-- Search index: name/phone/email prefix search (CU-06)
CREATE INDEX ix_customer_display_name ON customer (organization_id, lower(display_name) text_pattern_ops);
CREATE INDEX ix_customer_phone_search  ON customer (organization_id, phone text_pattern_ops) WHERE phone IS NOT NULL;
CREATE INDEX ix_customer_email_search  ON customer (organization_id, email text_pattern_ops) WHERE email IS NOT NULL;

COMMENT ON COLUMN customer.status IS
  'Cites: CU-09, CU-10, SM-45. Active / OnHold / CreditBlocked / Closed. Closed is never deleted.';
COMMENT ON COLUMN customer.phone IS
  'Cites: CU-04, CU-05. Optional; duplicate detection is app-level (force:true overrides the warning).';
COMMENT ON COLUMN customer.email IS
  'Cites: CU-04, CU-05. Optional; duplicate detection is app-level (force:true overrides the warning).';
COMMENT ON COLUMN customer.marketing_consent IS
  'Cites: CU-34. NotAsked / Yes / No. Absence of consent never blocks a sale.';
COMMENT ON COLUMN customer.marketing_consent_at IS
  'Cites: CU-34. When consent was recorded. NULL when marketing_consent is NotAsked.';
COMMENT ON COLUMN customer.status_changed_at IS
  'Cites: SM-03, RT-353. Server time of the last status change.';
COMMENT ON COLUMN customer.status_changed_by IS
  'Cites: SM-45b. The employee who last changed the status. NULL only for the walk-in record.';
COMMENT ON COLUMN customer.created_by IS
  'Cites: CU-01. The employee who created the record. NULL only for the walk-in record.';

COMMENT ON CONSTRAINT ck_customer_status ON customer IS
  'Cites: SM-45. Only the four declared statuses are valid.';
COMMENT ON CONSTRAINT ck_customer_marketing_consent ON customer IS
  'Cites: CU-34. Consent is one of NotAsked, Yes, No.';
COMMENT ON CONSTRAINT ck_customer_consent_when ON customer IS
  'Cites: CU-34. Consent timestamp is set exactly when a consent value is recorded.';
COMMENT ON CONSTRAINT ck_customer_walk_in_immutable ON customer IS
  'Cites: CU-01. The walk-in record stays Active; its status must never change.';
COMMENT ON CONSTRAINT fk_customer_status_changed_by ON customer IS
  'Cites: SM-45b. Status changes are made by employees.';
COMMENT ON CONSTRAINT fk_customer_created_by ON customer IS
  'Cites: CU-01. Customers are created by employees.';

COMMENT ON INDEX ix_customer_phone IS
  'Cites: CU-04, CU-05. Lookup index for duplicate-contact detection; uniqueness is app-level.';
COMMENT ON INDEX ix_customer_email IS
  'Cites: CU-04, CU-05. Lookup index for duplicate-contact detection; uniqueness is app-level.';
COMMENT ON INDEX ix_customer_display_name IS
  'Cites: CU-06. Supports prefix search on customer name.';
COMMENT ON INDEX ix_customer_phone_search IS
  'Cites: CU-06. Supports prefix search on phone.';
COMMENT ON INDEX ix_customer_email_search IS
  'Cites: CU-06. Supports prefix search on email.';

-- Update the table comment to cite the new rules
COMMENT ON TABLE customer IS
  'Cites: CU-01, CU-04, CU-05, CU-06, CU-09, CU-10, CU-33, CU-34, RT-001, SM-45. '
  'A customer belonging to the organization. The walk-in record is created by onboarding and must never be '
  'closed, edited via customer routes, or deleted.';

-- 2. CustomerAccount state machine -------------------------------------------
-- Machine name: CustomerAccount
-- Table: customer, state column: status
-- SM-45, SM-45a, SM-45b, SM-45c

INSERT INTO state_machine_state
  (machine, state, is_initial,
   creation_permission_rule, creation_permission_key,
   creation_audit_event_type)
VALUES
  ('CustomerAccount', 'Active',         true,  'Key', 'Customer.Create', 'Customer.StateChange'),
  ('CustomerAccount', 'OnHold',         false,  null,  null,              null),
  ('CustomerAccount', 'CreditBlocked',  false,  null,  null,              null),
  ('CustomerAccount', 'Closed',         false,  null,  null,              null);

INSERT INTO state_machine_edge
  (machine, from_state, event, to_state, permission_rule, permission_key,
   requires_reason, audit_event_type)
VALUES
  -- SM-45: Active ↔ OnHold (CU-09)
  ('CustomerAccount', 'Active',        'hold',         'OnHold',        'Key',          'Customer.Edit',         true,  'Customer.StateChange'),
  ('CustomerAccount', 'OnHold',        'release',      'Active',        'Key',          'Customer.Edit',         true,  'Customer.StateChange'),
  -- SM-45: Active → CreditBlocked (CU-09)
  ('CustomerAccount', 'Active',        'block_credit', 'CreditBlocked', 'Key',          'Customer.Credit.Grant', true,  'Customer.StateChange'),
  -- SM-45c: CreditBlocked exit is OPEN DECISION
  ('CustomerAccount', 'CreditBlocked', 'unblock',      'Active',        'OpenDecision', null,                    true,  'Customer.StateChange'),
  -- SM-45: Active/OnHold → Closed (CU-10)
  ('CustomerAccount', 'Active',        'close',        'Closed',        'Key',          'Customer.Edit',         true,  'Customer.StateChange'),
  ('CustomerAccount', 'OnHold',        'close',        'Closed',        'Key',          'Customer.Edit',         true,  'Customer.StateChange');

-- 3. Triggers ----------------------------------------------------------------

CREATE TRIGGER tg_customer_state_machine
  BEFORE INSERT OR UPDATE OF status ON customer
  FOR EACH ROW EXECUTE FUNCTION enforce_state_transition('CustomerAccount', 'status');

COMMENT ON TRIGGER tg_customer_state_machine ON customer IS
  'Cites: SM-45, SM-45a, SM-45b. Enforces the CustomerAccount state machine.';

CREATE TRIGGER tg_customer_status_stamp
  BEFORE UPDATE OF status ON customer
  FOR EACH ROW EXECUTE FUNCTION stamp_status_change();

COMMENT ON TRIGGER tg_customer_status_stamp ON customer IS
  'Cites: SM-03, RT-353. Stamps status_changed_at with server time on every status change.';

CREATE TRIGGER tg_customer_audit
  AFTER INSERT OR UPDATE OF status ON customer
  FOR EACH ROW EXECUTE FUNCTION audit_state_transition('CustomerAccount');

COMMENT ON TRIGGER tg_customer_audit ON customer IS
  'Cites: CU-01, AU-01, AU-12, SM-45b. Records Customer.StateChange for every status transition.';

-- 4. GRANTs ------------------------------------------------------------------
-- SELECT and INSERT (id, organization_id, is_walk_in, display_name) are already
-- granted in d4. Add the new columns.

GRANT INSERT (status, phone, email, marketing_consent, marketing_consent_at,
              status_changed_by, created_by)
  ON customer TO smartstore_app;
GRANT UPDATE (display_name, phone, email, marketing_consent, marketing_consent_at,
              status, status_changed_by, status_changed_at)
  ON customer TO smartstore_app;

-- migrate:down

-- (intentionally empty — forward-only migrations)
