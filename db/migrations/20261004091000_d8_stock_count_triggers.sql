-- migrate:up

-- Stock count: missing state-machine triggers and paired-timestamp stamps (SM-02, SM-03, AU-01, AU-03, D-09).
-- The d8 migration created the stock_count table but did not register the three triggers every state-machine
-- table needs:  enforce_state_transition (SM-02, SM-06), audit_state_transition (AU-01, AU-12), and
-- stamp_status_change (SM-03, RT-353).  It also omitted a function that stamps posted_at and cancelled_at
-- together with posted_by / cancelled_by, which the ck_stock_count_posted and ck_stock_count_cancelled
-- constraints require.

-- 1. Stamp posted_at / cancelled_at when the corresponding _by column lands -----------

CREATE FUNCTION stamp_stock_count_dates() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    CASE NEW.status
      WHEN 'Posted'    THEN NEW.posted_at    := now();
      WHEN 'Cancelled' THEN NEW.cancelled_at := now();
      ELSE NULL;
    END CASE;
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION stamp_stock_count_dates() IS
  'Cites: SM-03, IV-28, IV-25. Sets posted_at / cancelled_at in the same row write that sets the _by column.';

CREATE TRIGGER tg_stock_count_dates BEFORE UPDATE OF status ON stock_count
  FOR EACH ROW EXECUTE FUNCTION stamp_stock_count_dates();

COMMENT ON TRIGGER tg_stock_count_dates ON stock_count IS
  'Cites: SM-03, IV-28. Timestamps posted_at and cancelled_at together with their _by columns.';

-- 2. Stamp status_changed_at on every status change -----------------------------------

CREATE TRIGGER tg_stock_count_status_stamp BEFORE UPDATE OF status ON stock_count
  FOR EACH ROW EXECUTE FUNCTION stamp_status_change();

COMMENT ON TRIGGER tg_stock_count_status_stamp ON stock_count IS
  'Cites: SM-03, RT-353. Server time for each status change.';

-- 3. Enforce state-machine edges (SM-02, SM-06) ---------------------------------------

CREATE TRIGGER tg_stock_count_state_machine BEFORE INSERT OR UPDATE OF status ON stock_count
  FOR EACH ROW EXECUTE FUNCTION enforce_state_transition('StockCount', 'status');

COMMENT ON TRIGGER tg_stock_count_state_machine ON stock_count IS
  'Cites: SM-02, SM-06, D-09. A stock count is created Open and moves only along the four edges of state-machines §22.17.';

-- 4. Audit every state change (AU-01, AU-12) ------------------------------------------

CREATE TRIGGER tg_stock_count_audit AFTER INSERT OR UPDATE OF status ON stock_count
  FOR EACH ROW EXECUTE FUNCTION audit_state_transition('StockCount');

COMMENT ON TRIGGER tg_stock_count_audit ON stock_count IS
  'Cites: AU-01, AU-12, D-06. Records Inventory.CountStateChange on creation and every edge.';

-- 5. Runtime permissions for smartstore_app ------------------------------------
-- The d8 migration created these tables and columns but omitted the GRANTs the application user needs.

GRANT SELECT ON stock_count TO smartstore_app;
GRANT INSERT (id, store_id, organization_id, scope, note, created_by, status_changed_by)
  ON stock_count TO smartstore_app;
-- Transitions set status and actor columns; posted_at / cancelled_at are set by the trigger.
GRANT UPDATE (status, status_changed_by, posted_by, cancelled_by)
  ON stock_count TO smartstore_app;

GRANT SELECT ON stock_count_line TO smartstore_app;
GRANT INSERT (id, stock_count_id, store_id, organization_id, variant_id, storage_location_id, expected_quantity)
  ON stock_count_line TO smartstore_app;
-- Line entry writes counted_quantity, reason and the derived movement columns.
GRANT UPDATE (counted_quantity, reason_code_id, movement_type, direction)
  ON stock_count_line TO smartstore_app;

-- The d8 migration added stock_count_id and stock_count_line_id to inventory_movement;
-- extend the INSERT grant to include them (additive to the existing column-level grant in d3).
GRANT INSERT (stock_count_id, stock_count_line_id) ON inventory_movement TO smartstore_app;

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'Migrations are forward-only and are never rolled back (docs/database/CONVENTIONS.md s14).'; END $$;
