-- migrate:up

-- Owner decision D-17 (2026-10-02): the two keys that read returns and refunds, and the edge that withdraws a draft refund.
-- Design: docs/architecture/OWNER-DECISIONS.md D-17; docs/database/D5-RETURNS-REFUNDS.md s12; D7 s12.
--
-- The rule that the person who pays a drawer refund is at the refund's till (D-17 item 4) is not here: it is the
-- application's, because the session's till is known only to the application.

INSERT INTO permission (key) VALUES
  ('Return.View'),
  ('Refund.View');

-- s22.7: a draft refund may be withdrawn (D-17 item 5). It is the refund's `cancel` event, from Draft, with the key the
-- other cancels carry (D-16 Q9: Sale.Refund), a reason (SM-42, BI-40) and the same audit type. Nothing is held in
-- Draft (the hold is taken at Processing, RR-24), so withdrawing releases nothing; its lines stay as drafted (AP-03).
INSERT INTO state_machine_edge (machine, from_state, to_state, event, audit_event_type, requires_reason, permission_rule, permission_key)
SELECT 'Refund', 'Draft', 'Cancelled', 'cancel', audit_event_type, requires_reason, permission_rule, permission_key
FROM state_machine_edge
WHERE machine = 'Refund' AND from_state = 'Approved' AND event = 'cancel';

-- A withdrawn draft was never submitted, so "every refund past Draft records who submitted it" gains its one exception:
-- a cancelled refund that was never approved (SM-03). One that was approved still carries who submitted it.
ALTER TABLE refund DROP CONSTRAINT ck_refund_submitted_when;
ALTER TABLE refund ADD CONSTRAINT ck_refund_submitted_when
  CHECK (status = 'Draft' OR submitted_by IS NOT NULL OR (status = 'Cancelled' AND approved_by IS NULL));
COMMENT ON CONSTRAINT ck_refund_submitted_when ON refund IS
  'Cites: SM-03, D-17. Every refund past Draft records who submitted it, except a withdrawn draft, which was never submitted.';

SELECT grant_to_complete_roles(ARRAY['Return.View', 'Refund.View']);

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'Migrations are forward-only and are never rolled back (docs/database/CONVENTIONS.md s14).'; END $$;
