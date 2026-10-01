-- migrate:up

-- Domain 4, after the shift close's application layer (2026-10-01): who acted on a shift is fixed.
-- Found by a probe during the shift close's mutation check: the runtime role could rewrite closed_by and
-- status_changed_by on a closed shift, and no audit event recorded it. Design: docs/database/D4-SALE-PAYMENT.md s9.

CREATE FUNCTION assert_shift_actors_fixed() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND (NEW.status_changed_by IS DISTINCT FROM OLD.status_changed_by OR NEW.closed_by IS DISTINCT FROM OLD.closed_by) THEN
    RAISE EXCEPTION 'who changed shift % and who closed it are recorded by its transitions and cannot be rewritten', OLD.id
      USING ERRCODE = 'SS001';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION assert_shift_actors_fixed() IS
  'Cites: SM-57, AU-05, CD-20, BI-08. A shift''s actors are written by its transitions alone: who last changed its status, and who closed it, change only together with the status. A closed shift''s record therefore cannot be rewritten, at any privilege.';

CREATE TRIGGER tg_cash_shift_actors_fixed BEFORE UPDATE OF status_changed_by, closed_by ON cash_shift
  FOR EACH ROW EXECUTE FUNCTION assert_shift_actors_fixed();
COMMENT ON TRIGGER tg_cash_shift_actors_fixed ON cash_shift IS
  'Cites: SM-57, AU-05. Rewriting who acted on a shift, without a transition, is refused (SS001).';

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'Migrations are forward-only and are never rolled back (docs/database/CONVENTIONS.md s14).'; END $$;
