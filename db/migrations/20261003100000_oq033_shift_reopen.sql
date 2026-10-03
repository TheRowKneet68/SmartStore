-- migrate:up

-- OQ-033 (2026-10-03): implement the Closed → Reopened edge on the Shift machine.
-- Key: Shift.Reopen (already in permission_key from 20261002100000_d7_d16_permission_keys.sql).
-- Audit event: Shift.Reopened (already registered in 20261001100000_d6_audit.sql).
-- Reason: required always (CD-26: a reopened shift is exceptional, audited, standing-reported).
-- References: state-machines §22.11, CD-26, GAP-036, OWNER-DECISIONS D-16.

-- 1. Columns for who reopened the shift and why.
ALTER TABLE cash_shift
  ADD COLUMN reopened_by           uuid REFERENCES employee (id),
  ADD COLUMN reopen_reason_code_id uuid REFERENCES reason_code (id);

COMMENT ON COLUMN cash_shift.reopened_by IS
  'Cites: OQ-033, CD-26. Set when the shift transitions Closed → Reopened; identifies the manager who authorised the reopen.';
COMMENT ON COLUMN cash_shift.reopen_reason_code_id IS
  'Cites: OQ-033, CD-26. Reason given at reopen; required because every reopen is exceptional and must be audited (state-machines s22.11).';
COMMENT ON CONSTRAINT cash_shift_reopened_by_fkey ON cash_shift IS
  'Cites: OQ-033, CD-26. The employee who authorised the reopen must be a known employee of record.';
COMMENT ON CONSTRAINT cash_shift_reopen_reason_code_id_fkey ON cash_shift IS
  'Cites: OQ-033, CD-26. The reason given at reopen must exist; liveness is checked at the trigger level (SS024).';

-- 2. Relax ck_cash_shift_closed_when.
--    Old (biconditional): (status = 'Closed') = (closed_by IS NOT NULL).
--    Problem: a Reopened shift retains closed_by but its status is no longer 'Closed', so the biconditional fails.
--    New (implication): status = 'Closed' IMPLIES closed_by IS NOT NULL; closed_by may persist through Reopened status.
ALTER TABLE cash_shift DROP CONSTRAINT ck_cash_shift_closed_when;
ALTER TABLE cash_shift ADD CONSTRAINT ck_cash_shift_closed_when
  CHECK (status <> 'Closed' OR closed_by IS NOT NULL);
COMMENT ON CONSTRAINT ck_cash_shift_closed_when ON cash_shift IS
  'Cites: CD-20, SM-57, OQ-033. A Closed shift always records its closer; closed_by persists through subsequent Reopened status.';

-- 3. Add the Closed → Reopened edge with all non-null columns in one INSERT.
INSERT INTO state_machine_edge (machine, from_state, to_state, event, permission_rule, permission_key, audit_event_type, requires_reason) VALUES
  ('Shift', 'Closed', 'Reopened', 'reopen', 'Key', 'Shift.Reopen', 'Shift.Reopened', true);

-- 5. Runtime role grants for the new columns.
GRANT UPDATE (reopened_by, reopen_reason_code_id) ON cash_shift TO smartstore_app;

-- migrate:down
-- Forward-only migrations only (CONVENTIONS §3). This block is required by dbmate but intentionally empty.
