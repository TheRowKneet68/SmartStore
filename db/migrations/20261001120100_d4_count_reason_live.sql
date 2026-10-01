-- migrate:up

-- Domain 4, after the shift close's application layer (2026-10-01): a count's acknowledgement takes only a live
-- reason code. Found by a probe during the shift close's mutation check: the database accepted an archived one, and
-- only the route refused it. Design: docs/database/D4-SALE-PAYMENT.md s9.

CREATE FUNCTION assert_count_reason_live() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM assert_reason_code_live(NEW.reason_code_id);
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION assert_count_reason_live() IS
  'Cites: CD-23, BI-25, BI-40, RT-245. A variance is acknowledged with a live reason code: an archived one is kept for history and takes no new use (SS024), as on every other reasoned row.';

CREATE TRIGGER tg_shift_count_reason_live BEFORE UPDATE OF reason_code_id ON shift_count
  FOR EACH ROW WHEN (NEW.reason_code_id IS NOT NULL) EXECUTE FUNCTION assert_count_reason_live();
COMMENT ON TRIGGER tg_shift_count_reason_live ON shift_count IS
  'Cites: CD-23, BI-40. An acknowledgement with an archived reason code is refused (SS024).';

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'Migrations are forward-only and are never rolled back (docs/database/CONVENTIONS.md s14).'; END $$;
