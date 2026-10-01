-- migrate:up

-- Domain 5: Returns / Refunds.
-- Design, citations and decisions: docs/database/D5-RETURNS-REFUNDS.md

-- ============================================================================ supporting changes

ALTER TABLE storage_location DROP CONSTRAINT ck_storage_location_type;
ALTER TABLE storage_location ADD CONSTRAINT ck_storage_location_type
  CHECK (location_type IN ('Default', 'Receiving', 'Quarantine', 'Damaged', 'ReturnsPending', 'Transit', 'ExpiredHold'));
COMMENT ON CONSTRAINT ck_storage_location_type ON storage_location IS
  'Cites: WH-04, RT-510, BE-24, BE-36. The standard location types of organization-model s5, plus ExpiredHold, where an Expired disposition goes (batch-expiry-fefo s6; organization-model s5 names the IsExpiredHold flag).';

ALTER TABLE store_setting_version ADD COLUMN return_window_days smallint NOT NULL DEFAULT 30;
ALTER TABLE store_setting_version ADD COLUMN default_return_disposition text NOT NULL DEFAULT 'Quarantine';
ALTER TABLE store_setting_version ADD CONSTRAINT ck_store_setting_version_return_window CHECK (return_window_days >= 0);
ALTER TABLE store_setting_version ADD CONSTRAINT ck_store_setting_version_return_disposition
  CHECK (default_return_disposition IN ('Sellable', 'Quarantine'));
COMMENT ON CONSTRAINT ck_store_setting_version_return_window ON store_setting_version IS
  'Cites: RR-10, RT-150. The return window is a store setting in days, measured on the business date; the documented default is 30.';
COMMENT ON CONSTRAINT ck_store_setting_version_return_disposition ON store_setting_version IS
  'Cites: RR-18, BI-17. The disposition the return screen pre-fills and never applies by itself: Sellable or Quarantine (organization-model s3), Quarantine unless set, as Quarantine holds customer returns by default (organization-model s5).';

ALTER TABLE sale_line ADD COLUMN refunded_tax_amount bigint NOT NULL DEFAULT 0;
ALTER TABLE sale_line ADD CONSTRAINT ck_sale_line_refunded_tax CHECK (refunded_tax_amount BETWEEN 0 AND tax_amount);
ALTER TABLE sale_line ADD CONSTRAINT uq_sale_line_id_sale UNIQUE (id, sale_id);
ALTER TABLE sale_line ADD CONSTRAINT uq_sale_line_id_sale_variant UNIQUE (id, sale_id, variant_id);
COMMENT ON CONSTRAINT ck_sale_line_refunded_tax ON sale_line IS
  'Cites: RR-06, RR-42, RT-161. The tax refunded against a line never exceeds the tax it was charged.';
COMMENT ON CONSTRAINT uq_sale_line_id_sale ON sale_line IS
  'Cites: RR-03, RT-145. Lets a refund line prove, by foreign key, that it refunds a line of the refund''s own sale.';
COMMENT ON CONSTRAINT uq_sale_line_id_sale_variant ON sale_line IS
  'Cites: RR-08, BI-16. Lets a return line prove, by foreign key, that it returns this line''s variant from the return''s sale.';

INSERT INTO document_type (code) VALUES ('CustomerReturn'), ('Refund');

CREATE FUNCTION assert_reason_code_live(p_reason_code_id uuid) RETURNS void
  LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM reason_code WHERE id = p_reason_code_id AND archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'reason code % is archived and takes no new documents', p_reason_code_id USING ERRCODE = 'SS024';
  END IF;
END
$$;

COMMENT ON FUNCTION assert_reason_code_live(uuid) IS
  'Cites: BI-40, BI-25. An archived reason code is kept for history and takes no new use.';

-- ============================================================================ customer return (returns-refunds s3..s5, s12.1)

CREATE TABLE customer_return (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid(),
  store_id              uuid        NOT NULL,
  organization_id       uuid        NOT NULL,
  sale_id               uuid        NOT NULL,
  document_number       bigint      NOT NULL,
  client_operation_id   uuid        NOT NULL,
  status                text        NOT NULL DEFAULT 'Draft',
  business_date         date,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid        NOT NULL,
  posted_at             timestamptz,
  posted_by             uuid,
  late_approved_by      uuid,
  late_reason_code_id   uuid,
  cancel_reason_code_id uuid,
  status_changed_at     timestamptz NOT NULL DEFAULT now(),
  status_changed_by     uuid        NOT NULL,
  correlation_id        uuid,
  CONSTRAINT pk_customer_return PRIMARY KEY (id),
  CONSTRAINT fk_customer_return_sale FOREIGN KEY (sale_id, store_id) REFERENCES sale (id, store_id),
  CONSTRAINT fk_customer_return_store FOREIGN KEY (store_id, organization_id) REFERENCES store (id, organization_id),
  CONSTRAINT fk_customer_return_late_reason FOREIGN KEY (late_reason_code_id, organization_id)
    REFERENCES reason_code (id, organization_id),
  CONSTRAINT fk_customer_return_cancel_reason FOREIGN KEY (cancel_reason_code_id, organization_id)
    REFERENCES reason_code (id, organization_id),
  CONSTRAINT uq_customer_return_number UNIQUE (store_id, document_number),
  CONSTRAINT uq_customer_return_operation UNIQUE (store_id, client_operation_id),
  CONSTRAINT uq_customer_return_id_store UNIQUE (id, store_id),
  CONSTRAINT uq_customer_return_identity UNIQUE (id, sale_id, store_id),
  CONSTRAINT ck_customer_return_status CHECK (status IN ('Draft', 'Posted', 'Settled', 'Closed', 'Cancelled')),
  CONSTRAINT ck_customer_return_posted CHECK ((posted_at IS NULL) = (posted_by IS NULL)),
  CONSTRAINT ck_customer_return_posted_when CHECK ((status IN ('Draft', 'Cancelled')) = (posted_by IS NULL)),
  CONSTRAINT ck_customer_return_late CHECK ((late_approved_by IS NULL) = (late_reason_code_id IS NULL)),
  CONSTRAINT ck_customer_return_late_separation
    CHECK (late_approved_by IS NULL OR (late_approved_by <> created_by AND late_approved_by IS DISTINCT FROM posted_by)),
  CONSTRAINT ck_customer_return_cancelled CHECK ((status = 'Cancelled') = (cancel_reason_code_id IS NOT NULL))
);

COMMENT ON TABLE customer_return IS
  'Cites: RR-01, RR-08, RR-13, RR-15, RT-144, RT-148, RT-149. Goods coming back against exactly one sale. Stock moves only when it is posted, and the sold-quantity bound is taken atomically then.';
COMMENT ON CONSTRAINT fk_customer_return_sale ON customer_return IS
  'Cites: RR-08, RR-13, BI-16. A return references exactly one sale, of the same store.';
COMMENT ON CONSTRAINT fk_customer_return_store ON customer_return IS
  'Cites: RT-001. A return belongs to a store of its organization.';
COMMENT ON CONSTRAINT fk_customer_return_late_reason ON customer_return IS
  'Cites: RR-11, BI-25. A late return carries a reason code of the organization.';
COMMENT ON CONSTRAINT fk_customer_return_cancel_reason ON customer_return IS
  'Cites: SM-42, BI-25. A refused or withdrawn return carries a reason code of the organization.';
COMMENT ON CONSTRAINT uq_customer_return_number ON customer_return IS
  'Cites: BI-42, RT-479. The return number is unique per store and never reused.';
COMMENT ON CONSTRAINT uq_customer_return_operation ON customer_return IS
  'Cites: RR-15, BI-07, RT-149. A return is processed exactly once: a replay with the same operation id finds the original.';
COMMENT ON CONSTRAINT uq_customer_return_id_store ON customer_return IS
  'Cites: RT-001, BI-14. Lets a movement prove, by foreign key, that it belongs to the return''s store.';
COMMENT ON CONSTRAINT uq_customer_return_identity ON customer_return IS
  'Cites: RR-13, SM-39. Lets a return line or a refund prove, by foreign key, that it concerns the return''s one sale and store.';
COMMENT ON CONSTRAINT ck_customer_return_status ON customer_return IS
  'Cites: SM-43a. The return states of returns-refunds s12.1; a refusal is Cancelled from Draft (SM-42).';
COMMENT ON CONSTRAINT ck_customer_return_posted ON customer_return IS
  'Cites: SM-03. Posting records who and when together.';
COMMENT ON CONSTRAINT ck_customer_return_posted_when ON customer_return IS
  'Cites: BI-27, SM-03. A return records who posted it exactly when it has been posted.';
COMMENT ON CONSTRAINT ck_customer_return_late ON customer_return IS
  'Cites: RR-11. A late return is approved by someone, for a reason, together.';
COMMENT ON CONSTRAINT ck_customer_return_late_separation ON customer_return IS
  'Cites: AP-08, BI-26. The approver of a late return is neither the employee who opened it nor the one who posts it.';
COMMENT ON CONSTRAINT ck_customer_return_cancelled ON customer_return IS
  'Cites: SM-42, BI-25. A return is cancelled with a reason, and only a cancelled return carries one.';

CREATE TABLE customer_return_line (
  id                  uuid          NOT NULL DEFAULT gen_random_uuid(),
  customer_return_id  uuid          NOT NULL,
  store_id            uuid          NOT NULL,
  organization_id     uuid          NOT NULL,
  sale_id             uuid          NOT NULL,
  sale_line_id        uuid          NOT NULL,
  variant_id          uuid          NOT NULL,
  quantity            numeric(18,4) NOT NULL,
  disposition         text          NOT NULL,
  storage_location_id uuid          NOT NULL,
  client_operation_id uuid          NOT NULL,
  CONSTRAINT pk_customer_return_line PRIMARY KEY (id),
  CONSTRAINT fk_customer_return_line_return FOREIGN KEY (customer_return_id, sale_id, store_id)
    REFERENCES customer_return (id, sale_id, store_id),
  CONSTRAINT fk_customer_return_line_sale_line FOREIGN KEY (sale_line_id, sale_id, variant_id)
    REFERENCES sale_line (id, sale_id, variant_id),
  CONSTRAINT fk_customer_return_line_location FOREIGN KEY (storage_location_id, organization_id)
    REFERENCES storage_location (id, organization_id),
  CONSTRAINT uq_customer_return_line_operation UNIQUE (store_id, client_operation_id),
  CONSTRAINT uq_customer_return_line_identity
    UNIQUE (id, customer_return_id, variant_id, storage_location_id, disposition),
  CONSTRAINT ck_customer_return_line_quantity CHECK (quantity > 0),
  CONSTRAINT ck_customer_return_line_disposition CHECK (disposition IN ('Sellable', 'Quarantine', 'Damaged', 'Expired'))
);

CREATE INDEX ix_customer_return_line_return ON customer_return_line (customer_return_id);

COMMENT ON TABLE customer_return_line IS
  'Cites: RR-08, RR-14, RR-16, RR-17, RR-19, BI-17, RT-151. One returned quantity of one sold line, with its mandatory disposition and the location that disposition sends it to.';
COMMENT ON CONSTRAINT fk_customer_return_line_return ON customer_return_line IS
  'Cites: RR-13, RT-001. A line belongs to its return, and to that return''s one sale and store.';
COMMENT ON CONSTRAINT fk_customer_return_line_sale_line ON customer_return_line IS
  'Cites: RR-08, BI-16. A return line names the sold line it returns, and that line''s variant.';
COMMENT ON CONSTRAINT fk_customer_return_line_location ON customer_return_line IS
  'Cites: RR-19. The destination location, in the same organization.';
COMMENT ON CONSTRAINT uq_customer_return_line_operation ON customer_return_line IS
  'Cites: RR-16, BI-07. Each return line carries its own operation reference, so a retried line is not re-applied.';
COMMENT ON CONSTRAINT uq_customer_return_line_identity ON customer_return_line IS
  'Cites: BI-03, RT-096. Lets a movement prove, by foreign key, that it applies this line''s variant at this line''s location, naming this line''s disposition.';
COMMENT ON CONSTRAINT ck_customer_return_line_quantity ON customer_return_line IS
  'Cites: BI-05. A returned quantity is positive.';
COMMENT ON CONSTRAINT ck_customer_return_line_disposition ON customer_return_line IS
  'Cites: RR-17, BI-17. Every return line resolves to exactly one of the four dispositions.';
COMMENT ON INDEX ix_customer_return_line_return IS
  'Cites: RR-14. Finds a return''s lines when posting it.';

CREATE FUNCTION customer_return_line_rules() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  v_status   text;
  v_type     text;
  v_sellable boolean;
  v_left     numeric;
BEGIN
  SELECT status INTO v_status FROM customer_return
  WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.customer_return_id ELSE NEW.customer_return_id END
  FOR SHARE;
  IF v_status IS DISTINCT FROM 'Draft' THEN
    RAISE EXCEPTION 'document lines change only while the document is a draft (it is %)', v_status USING ERRCODE = 'SS018';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  -- An unknown or missing disposition is left to the column's CHECK and NOT NULL.
  SELECT location_type, is_sellable INTO v_type, v_sellable FROM storage_location WHERE id = NEW.storage_location_id;
  IF (CASE NEW.disposition
        WHEN 'Sellable' THEN NOT v_sellable
        WHEN 'Quarantine' THEN v_type <> 'Quarantine'
        WHEN 'Damaged' THEN v_type <> 'Damaged'
        WHEN 'Expired' THEN v_type <> 'ExpiredHold'
      END) THEN
    RAISE EXCEPTION 'a % return cannot go to a % location', NEW.disposition, v_type USING ERRCODE = 'SS047';
  END IF;

  -- s12.1: a draft is bounded as it is built. The atomic bound is taken when the return is posted (RR-14).
  SELECT l.quantity - l.returned_quantity
         - coalesce((SELECT sum(r.quantity) FROM customer_return_line r
                     WHERE r.customer_return_id = NEW.customer_return_id AND r.sale_line_id = l.id AND r.id <> NEW.id), 0)
    INTO v_left
  FROM sale_line l WHERE l.id = NEW.sale_line_id;
  IF NEW.quantity > v_left THEN
    RAISE EXCEPTION 'only % of that line can still be returned', v_left USING ERRCODE = 'SS046', DETAIL = v_left::text;
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION customer_return_line_rules() IS
  'Cites: RR-14, RR-17, RR-19, BI-17, WH-01, BI-08, RT-148. Lines change only while the return is a draft; each disposition sends the goods to its own kind of location, and only Sellable to a sellable one (batch-expiry-fefo s6); a draft never holds more than is still returnable, naming the remainder.';

CREATE TRIGGER tg_customer_return_line_rules BEFORE INSERT OR UPDATE OR DELETE ON customer_return_line
  FOR EACH ROW EXECUTE FUNCTION customer_return_line_rules();
COMMENT ON TRIGGER tg_customer_return_line_rules ON customer_return_line IS
  'Cites: RR-17, RR-19. Disposition and destination are checked at entry.';

CREATE FUNCTION customer_return_before_write() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  v_closes date;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM assert_reason_code_live(NEW.late_reason_code_id);
    NEW.document_number := allocate_document_number(NEW.store_id, 'CustomerReturn');
    RETURN NEW;
  END IF;
  IF OLD.status <> 'Draft' AND (NEW.posted_by IS DISTINCT FROM OLD.posted_by
       OR NEW.late_approved_by IS DISTINCT FROM OLD.late_approved_by
       OR NEW.late_reason_code_id IS DISTINCT FROM OLD.late_reason_code_id
       OR NEW.cancel_reason_code_id IS DISTINCT FROM OLD.cancel_reason_code_id) THEN
    RAISE EXCEPTION 'return % is % and its record of who and why is fixed', OLD.id, OLD.status USING ERRCODE = 'SS001';
  END IF;
  IF NEW.late_reason_code_id IS DISTINCT FROM OLD.late_reason_code_id THEN
    PERFORM assert_reason_code_live(NEW.late_reason_code_id);
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
    IF NEW.status = 'Cancelled' THEN
      PERFORM assert_reason_code_live(NEW.cancel_reason_code_id);
    END IF;
    IF NEW.status = 'Posted' THEN
      NEW.posted_at := now();
      SELECT (now() AT TIME ZONE s.time_zone)::date INTO NEW.business_date FROM store s WHERE s.id = NEW.store_id;
      SELECT sa.business_date + v.return_window_days INTO v_closes
      FROM sale sa, LATERAL (SELECT return_window_days FROM store_setting_version
                             WHERE store_id = NEW.store_id AND effective_from <= now()
                             ORDER BY effective_from DESC LIMIT 1) v
      WHERE sa.id = NEW.sale_id;
      IF NEW.business_date > v_closes AND NEW.late_approved_by IS NULL THEN
        RAISE EXCEPTION 'the return window for this sale closed on %', v_closes
          USING ERRCODE = 'SS048', DETAIL = to_char(v_closes, 'YYYY-MM-DD');
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION customer_return_before_write() IS
  'Cites: BI-42, RR-10, RR-11, SM-03, RT-234, RT-150. Allocates the return number; stamps posting with server time and business date; beyond the store''s return window a return needs an approver and a reason, and the refusal names the date the window closed; once a return leaves Draft its who and why are fixed.';

CREATE TRIGGER tg_customer_return_before_write BEFORE INSERT OR UPDATE ON customer_return
  FOR EACH ROW EXECUTE FUNCTION customer_return_before_write();
COMMENT ON TRIGGER tg_customer_return_before_write ON customer_return IS
  'Cites: RR-10, RR-11. Numbering, stamps and the return window.';

CREATE TRIGGER tg_customer_return_state_machine BEFORE INSERT OR UPDATE OF status ON customer_return
  FOR EACH ROW EXECUTE FUNCTION enforce_state_transition('CustomerReturn', 'status');
COMMENT ON TRIGGER tg_customer_return_state_machine ON customer_return IS
  'Cites: SM-43a, SM-02. A return is created Draft and moves only along the edges of state-machines s22.7.';

-- ============================================================================ posting: the sold-quantity bound (RR-14, SP-66)

CREATE FUNCTION apply_return_posting() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  v_line    record;
  v_left    numeric;
  v_status  text;
  v_derived text;
BEGIN
  IF NEW.status = 'Posted' AND OLD.status = 'Draft' THEN
    FOR v_line IN SELECT sale_line_id, sum(quantity) AS quantity FROM customer_return_line
                  WHERE customer_return_id = NEW.id GROUP BY sale_line_id ORDER BY sale_line_id LOOP
      -- RR-14: one conditional increment; it affects no row if the sold quantity would be passed.
      UPDATE sale_line SET returned_quantity = returned_quantity + v_line.quantity
      WHERE id = v_line.sale_line_id AND returned_quantity + v_line.quantity <= quantity;
      IF NOT FOUND THEN
        SELECT quantity - returned_quantity INTO v_left FROM sale_line WHERE id = v_line.sale_line_id;
        RAISE EXCEPTION 'only % of that line can still be returned', v_left USING ERRCODE = 'SS046', DETAIL = v_left::text;
      END IF;
    END LOOP;

    -- SP-66: the status caches the counters, moving along the contracted edges of s22.6 only, so a return that takes
    -- everything back at once passes through PartiallyReturned.
    SELECT status INTO v_status FROM sale WHERE id = NEW.sale_id FOR UPDATE;
    SELECT CASE WHEN bool_and(returned_quantity = quantity) THEN 'Returned'
                WHEN bool_or(returned_quantity > 0) THEN 'PartiallyReturned' ELSE 'Completed' END
      INTO v_derived
    FROM sale_line WHERE sale_id = NEW.sale_id;
    IF v_derived <> 'Completed' AND v_status = 'Completed' THEN
      UPDATE sale SET status = 'PartiallyReturned' WHERE id = NEW.sale_id;
    END IF;
    IF v_derived = 'Returned' AND v_status <> 'Returned' THEN
      UPDATE sale SET status = 'Returned' WHERE id = NEW.sale_id;
    END IF;
  END IF;
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION apply_return_posting() IS
  'Cites: RR-14, BI-06, BI-16, RT-148, SP-66, SM-35, SM-35a. Posting a return increments each sold line''s returned counter with one conditional update that refuses to pass the sold quantity and names the remainder, then moves the sale''s status to what its counters say.';

CREATE TRIGGER tg_customer_return_posting AFTER UPDATE OF status ON customer_return
  FOR EACH ROW EXECUTE FUNCTION apply_return_posting();
COMMENT ON TRIGGER tg_customer_return_posting ON customer_return IS
  'Cites: RR-14, BI-06. The atomic sold-quantity bound, taken when the goods are accepted.';

-- ============================================================================ the return's stock movements (RR-17, BE-36)

ALTER TABLE inventory_movement ADD COLUMN customer_return_id uuid;
ALTER TABLE inventory_movement ADD COLUMN customer_return_line_id uuid;
ALTER TABLE inventory_movement ADD COLUMN disposition text;
ALTER TABLE inventory_movement ADD CONSTRAINT fk_inventory_movement_return_line
  FOREIGN KEY (customer_return_line_id, customer_return_id, variant_id, storage_location_id, disposition)
  REFERENCES customer_return_line (id, customer_return_id, variant_id, storage_location_id, disposition);
ALTER TABLE inventory_movement ADD CONSTRAINT fk_inventory_movement_return_store
  FOREIGN KEY (customer_return_id, store_id) REFERENCES customer_return (id, store_id);
ALTER TABLE inventory_movement ADD CONSTRAINT ck_inventory_movement_return_triple
  CHECK (num_nulls(customer_return_id, customer_return_line_id, disposition) IN (0, 3));
ALTER TABLE inventory_movement ADD CONSTRAINT uq_inventory_movement_return_line UNIQUE (customer_return_line_id);
ALTER TABLE inventory_movement DROP CONSTRAINT ck_inventory_movement_one_cause;
ALTER TABLE inventory_movement ADD CONSTRAINT ck_inventory_movement_one_cause
  CHECK (num_nonnulls(stock_adjustment_line_id, sale_line_id, customer_return_line_id) = 1);

COMMENT ON CONSTRAINT fk_inventory_movement_return_line ON inventory_movement IS
  'Cites: BI-03, RT-096, RR-17, BE-36. The causing return line, with its variant, destination and disposition proven to match: the movement names its disposition.';
COMMENT ON CONSTRAINT fk_inventory_movement_return_store ON inventory_movement IS
  'Cites: MS-16, BI-14. A return''s movements are attributed to the return''s store.';
COMMENT ON CONSTRAINT ck_inventory_movement_return_triple ON inventory_movement IS
  'Cites: BI-03, BE-36. A return line is always named with its return and its disposition, and a disposition only with a return line.';
COMMENT ON CONSTRAINT uq_inventory_movement_return_line ON inventory_movement IS
  'Cites: BI-07, RR-15, RT-149. A return line brings its goods back once; a posted return is never reversed (SM-38).';
COMMENT ON CONSTRAINT ck_inventory_movement_one_cause ON inventory_movement IS
  'Cites: BI-03, RT-060, IV-14. Exactly one causing document line: an adjustment line, a sale line or a return line. Later domains add their line columns to this count.';

CREATE FUNCTION assert_movement_return_state() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.customer_return_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.movement_type <> 'SALE_RETURN'
     OR NOT EXISTS (SELECT 1 FROM customer_return WHERE id = NEW.customer_return_id AND status = 'Posted') THEN
    RAISE EXCEPTION 'a return moves stock only as SALE_RETURN, when it is posted' USING ERRCODE = 'SS016';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION assert_movement_return_state() IS
  'Cites: BI-27, IV-14, RR-17, SM-38. A return moves stock only as SALE_RETURN and only once posted. It is never reversed: a correction is a further reason-bearing movement.';

CREATE TRIGGER tg_inventory_movement_return_state BEFORE INSERT ON inventory_movement
  FOR EACH ROW EXECUTE FUNCTION assert_movement_return_state();
COMMENT ON TRIGGER tg_inventory_movement_return_state ON inventory_movement IS
  'Cites: BI-27, RR-17. Only a posted return brings goods back.';

CREATE FUNCTION assert_return_posting_complete() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'Posted' AND OLD.status = 'Draft' AND (
       NOT EXISTS (SELECT 1 FROM customer_return_line WHERE customer_return_id = NEW.id)
       OR EXISTS (SELECT 1 FROM customer_return_line l
                  WHERE l.customer_return_id = NEW.id
                    AND NOT EXISTS (SELECT 1 FROM inventory_movement m
                                    WHERE m.customer_return_line_id = l.id AND m.quantity = l.quantity))) THEN
    RAISE EXCEPTION 'return % was posted without exactly one movement per line', NEW.id USING ERRCODE = 'SS022';
  END IF;
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION assert_return_posting_complete() IS
  'Cites: RR-17, SM-43, BI-04, RT-153. At commit, a posted return has lines and has brought each one back, whole, into its dispositioned location.';

CREATE CONSTRAINT TRIGGER tg_customer_return_posting_complete AFTER UPDATE OF status ON customer_return
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_return_posting_complete();
COMMENT ON TRIGGER tg_customer_return_posting_complete ON customer_return IS
  'Cites: SM-43, BI-04. Posting is all or nothing, checked at commit.';

-- ============================================================================ refund (returns-refunds s2, s6, s9, s12.2)

CREATE TABLE refund (
  id                             uuid        NOT NULL DEFAULT gen_random_uuid(),
  store_id                       uuid        NOT NULL,
  organization_id                uuid        NOT NULL,
  sale_id                        uuid        NOT NULL,
  customer_return_id             uuid,
  document_number                bigint      NOT NULL,
  client_operation_id            uuid        NOT NULL,
  method                         text        NOT NULL,
  payment_id                     uuid,
  disbursement                   text        NOT NULL,
  pos_terminal_id                uuid,
  cash_drawer_id                 uuid,
  cash_shift_id                  uuid,
  amount                         bigint      NOT NULL,
  tax_amount                     bigint      NOT NULL,
  currency_code                  text        NOT NULL,
  reason_code_id                 uuid,
  cancel_reason_code_id          uuid,
  status                         text        NOT NULL DEFAULT 'Draft',
  provider_transaction_reference text,
  provider_outcome               text,
  provider_raw_code              text,
  created_at                     timestamptz NOT NULL DEFAULT now(),
  created_by                     uuid        NOT NULL,
  submitted_at                   timestamptz,
  submitted_by                   uuid,
  approved_at                    timestamptz,
  approved_by                    uuid,
  status_changed_at              timestamptz NOT NULL DEFAULT now(),
  status_changed_by              uuid        NOT NULL,
  correlation_id                 uuid,
  CONSTRAINT pk_refund PRIMARY KEY (id),
  CONSTRAINT fk_refund_sale FOREIGN KEY (sale_id, store_id) REFERENCES sale (id, store_id),
  CONSTRAINT fk_refund_store FOREIGN KEY (store_id, organization_id) REFERENCES store (id, organization_id),
  CONSTRAINT fk_refund_return FOREIGN KEY (customer_return_id, sale_id, store_id)
    REFERENCES customer_return (id, sale_id, store_id),
  CONSTRAINT fk_refund_payment FOREIGN KEY (payment_id) REFERENCES payment (id),
  CONSTRAINT fk_refund_shift FOREIGN KEY (cash_shift_id, cash_drawer_id, pos_terminal_id, store_id)
    REFERENCES cash_shift (id, cash_drawer_id, pos_terminal_id, store_id),
  CONSTRAINT fk_refund_currency FOREIGN KEY (store_id, currency_code) REFERENCES store (id, currency_code),
  CONSTRAINT fk_refund_reason FOREIGN KEY (reason_code_id, organization_id) REFERENCES reason_code (id, organization_id),
  CONSTRAINT fk_refund_cancel_reason FOREIGN KEY (cancel_reason_code_id, organization_id)
    REFERENCES reason_code (id, organization_id),
  CONSTRAINT uq_refund_number UNIQUE (store_id, document_number),
  CONSTRAINT uq_refund_operation UNIQUE (store_id, client_operation_id),
  CONSTRAINT uq_refund_provider_reference UNIQUE (provider_transaction_reference),
  CONSTRAINT uq_refund_id_sale UNIQUE (id, sale_id),
  CONSTRAINT uq_refund_id_shift UNIQUE (id, cash_shift_id),
  CONSTRAINT ck_refund_method CHECK (method IN ('OriginalTender', 'Cash')),
  CONSTRAINT ck_refund_method_payment CHECK ((method = 'OriginalTender') = (payment_id IS NOT NULL)),
  CONSTRAINT ck_refund_disbursement CHECK (disbursement IN ('Drawer', 'Provider')),
  CONSTRAINT ck_refund_drawer CHECK ((disbursement = 'Drawer') = (cash_shift_id IS NOT NULL)),
  CONSTRAINT ck_refund_till CHECK (num_nulls(pos_terminal_id, cash_drawer_id, cash_shift_id) IN (0, 3)),
  CONSTRAINT ck_refund_amounts CHECK (amount > 0 AND tax_amount >= 0 AND tax_amount <= amount),
  CONSTRAINT ck_refund_goodwill_reason CHECK (customer_return_id IS NOT NULL OR reason_code_id IS NOT NULL),
  CONSTRAINT ck_refund_status
    CHECK (status IN ('Draft', 'PendingApproval', 'Approved', 'Processing', 'Completed', 'Failed', 'Cancelled')),
  CONSTRAINT ck_refund_provider_outcome
    CHECK (provider_outcome IN ('Approved', 'Declined', 'Pending', 'Failed', 'Errored', 'Timeout')),
  CONSTRAINT ck_refund_submitted CHECK ((submitted_at IS NULL) = (submitted_by IS NULL)),
  CONSTRAINT ck_refund_approved CHECK ((approved_at IS NULL) = (approved_by IS NULL)),
  CONSTRAINT ck_refund_submitted_when CHECK (status = 'Draft' OR submitted_by IS NOT NULL),
  CONSTRAINT ck_refund_approved_when
    CHECK (status NOT IN ('Approved', 'Processing', 'Completed', 'Failed') OR approved_by IS NOT NULL),
  CONSTRAINT ck_refund_separation
    CHECK (approved_by IS NULL OR (approved_by <> created_by AND approved_by <> submitted_by)),
  CONSTRAINT ck_refund_cancelled CHECK ((status = 'Cancelled') = (cancel_reason_code_id IS NOT NULL))
);

COMMENT ON TABLE refund IS
  'Cites: RR-01, RR-03, RR-22, RR-23, RR-24, RR-35, RR-43, PY-21, PY-22, PY-23, PY-25, PY-26, PY-27, BI-09, BI-10, RT-144, RT-145, RT-154, RT-157. Money going back: a new, linked document with its own lifecycle, bounded per line by what each line settled and holding its amount while in flight. Linked to a return where there is one; without one it is a goodwill refund and carries a reason.';
COMMENT ON CONSTRAINT fk_refund_sale ON refund IS
  'Cites: BI-10, RT-145. A refund is bounded against one sale of the same store.';
COMMENT ON CONSTRAINT fk_refund_store ON refund IS
  'Cites: RT-001. A refund belongs to a store of its organization.';
COMMENT ON CONSTRAINT fk_refund_return ON refund IS
  'Cites: RR-01, SM-39. The originating return, where there is one, of the same sale and store; a return may have several refunds.';
COMMENT ON CONSTRAINT fk_refund_payment ON refund IS
  'Cites: RR-22, RR-23, BI-09. For a refund to the original tender, the payment it goes back to.';
COMMENT ON CONSTRAINT fk_refund_shift ON refund IS
  'Cites: PY-27, CD-19. Cash paid out of a drawer is paid in one shift of one till of the store.';
COMMENT ON CONSTRAINT fk_refund_currency ON refund IS
  'Cites: BI-01. A refund is in the store''s currency, as integer minor units.';
COMMENT ON CONSTRAINT fk_refund_reason ON refund IS
  'Cites: RR-35, BI-25. A reason code of the organization.';
COMMENT ON CONSTRAINT fk_refund_cancel_reason ON refund IS
  'Cites: BI-25. A cancelled refund carries a reason code of the organization (s22.7: cancel needs a reason).';
COMMENT ON CONSTRAINT uq_refund_number ON refund IS
  'Cites: BI-42, RT-479. The refund number is unique per store and never reused.';
COMMENT ON CONSTRAINT uq_refund_operation ON refund IS
  'Cites: BI-28, PY-39. A refund request replayed with the same operation id finds the original.';
COMMENT ON CONSTRAINT uq_refund_provider_reference ON refund IS
  'Cites: PY-15, RT-480. A provider refund transaction is recorded once.';
COMMENT ON CONSTRAINT uq_refund_id_sale ON refund IS
  'Cites: RR-03. Lets a refund line prove, by foreign key, that it refunds the refund''s own sale.';
COMMENT ON CONSTRAINT uq_refund_id_shift ON refund IS
  'Cites: PY-27. Lets the drawer payout prove, by foreign key, that it is in the refund''s shift.';
COMMENT ON CONSTRAINT ck_refund_method ON refund IS
  'Cites: RR-22. The refund methods v1 pays: back to the original tender, or cash out of the drawer. Store credit and exchange arrive with customer credit.';
COMMENT ON CONSTRAINT ck_refund_method_payment ON refund IS
  'Cites: RR-22, RR-23. A refund to the original tender names that tender, and only such a refund does.';
COMMENT ON CONSTRAINT ck_refund_disbursement ON refund IS
  'Cites: RR-23, PY-25, PY-27. The money leaves through the drawer or through the provider.';
COMMENT ON CONSTRAINT ck_refund_drawer ON refund IS
  'Cites: PY-27, CD-19. A drawer refund names the shift it is paid in; a provider refund names none.';
COMMENT ON CONSTRAINT ck_refund_till ON refund IS
  'Cites: PY-27, RT-122. The till, drawer and shift of a drawer refund are named together, or not at all.';
COMMENT ON CONSTRAINT ck_refund_amounts ON refund IS
  'Cites: RR-06, RR-43, BI-10. A refund is positive and carries its own tax total, which is part of it.';
COMMENT ON CONSTRAINT ck_refund_goodwill_reason ON refund IS
  'Cites: RR-35, PY-26, RT-157. A refund with no return is a goodwill refund and always carries a reason.';
COMMENT ON CONSTRAINT ck_refund_status ON refund IS
  'Cites: SM-43a, SM-40, SM-41. The refund states of returns-refunds s12.2.';
COMMENT ON CONSTRAINT ck_refund_provider_outcome ON refund IS
  'Cites: PY-10. The provider''s response normalised, with the raw code kept.';
COMMENT ON CONSTRAINT ck_refund_submitted ON refund IS
  'Cites: SM-03. Submission records who and when together.';
COMMENT ON CONSTRAINT ck_refund_approved ON refund IS
  'Cites: SM-03, BI-26. Approval records who and when together.';
COMMENT ON CONSTRAINT ck_refund_submitted_when ON refund IS
  'Cites: SM-03. Every refund past Draft records who submitted it.';
COMMENT ON CONSTRAINT ck_refund_approved_when ON refund IS
  'Cites: BI-27, RR-35. No refund is processed, completed or failed without an approver on record.';
COMMENT ON CONSTRAINT ck_refund_separation ON refund IS
  'Cites: BI-26, AP-08, RR-35. The approver is neither the employee who drafted the refund nor the one who submitted it (s22.7: approver differs from issuer).';
COMMENT ON CONSTRAINT ck_refund_cancelled ON refund IS
  'Cites: BI-25, SM-40. A refund is cancelled with a reason, and only a cancelled refund carries one.';

CREATE TABLE refund_line (
  id           uuid   NOT NULL DEFAULT gen_random_uuid(),
  refund_id    uuid   NOT NULL,
  store_id     uuid   NOT NULL,
  sale_id      uuid   NOT NULL,
  sale_line_id uuid   NOT NULL,
  amount       bigint NOT NULL,
  tax_amount   bigint NOT NULL,
  CONSTRAINT pk_refund_line PRIMARY KEY (id),
  CONSTRAINT fk_refund_line_refund FOREIGN KEY (refund_id, sale_id) REFERENCES refund (id, sale_id),
  CONSTRAINT fk_refund_line_sale_line FOREIGN KEY (sale_line_id, sale_id) REFERENCES sale_line (id, sale_id),
  CONSTRAINT fk_refund_line_store FOREIGN KEY (sale_id, store_id) REFERENCES sale (id, store_id),
  CONSTRAINT uq_refund_line_per_sale_line UNIQUE (refund_id, sale_line_id),
  CONSTRAINT ck_refund_line_amounts CHECK (amount > 0 AND tax_amount >= 0 AND tax_amount <= amount)
);

COMMENT ON TABLE refund_line IS
  'Cites: RR-03, RR-06, RR-42, RR-43, RT-161. The refund''s allocation to the sold lines, each with its tax taken from the line''s stored tax; these are the refund''s own tax lines.';
COMMENT ON CONSTRAINT fk_refund_line_refund ON refund_line IS
  'Cites: RR-03. A line belongs to its refund and to that refund''s sale.';
COMMENT ON CONSTRAINT fk_refund_line_sale_line ON refund_line IS
  'Cites: RR-03, RT-145. A line refunds a sold line of the same sale.';
COMMENT ON CONSTRAINT fk_refund_line_store ON refund_line IS
  'Cites: RT-001, MS-01. A line carries its sale''s store.';
COMMENT ON CONSTRAINT uq_refund_line_per_sale_line ON refund_line IS
  'Cites: RR-03. One allocation per sold line per refund.';
COMMENT ON CONSTRAINT ck_refund_line_amounts ON refund_line IS
  'Cites: RR-05, RR-06. A positive amount (a free item refunds nothing), with its tax part.';

CREATE FUNCTION refund_line_rules() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM refund
  WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.refund_id ELSE NEW.refund_id END
  FOR SHARE;
  IF v_status IS DISTINCT FROM 'Draft' THEN
    RAISE EXCEPTION 'document lines change only while the document is a draft (it is %)', v_status USING ERRCODE = 'SS018';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

COMMENT ON FUNCTION refund_line_rules() IS
  'Cites: BI-08, BI-27, AP-03. A refund''s allocation is fixed once it is submitted for approval, so the approver approves what is paid; a draft line may be deleted (overview s3.6).';

CREATE TRIGGER tg_refund_line_rules BEFORE INSERT OR UPDATE OR DELETE ON refund_line
  FOR EACH ROW EXECUTE FUNCTION refund_line_rules();
COMMENT ON TRIGGER tg_refund_line_rules ON refund_line IS
  'Cites: BI-27, AP-03. Freezes the allocation after Draft.';

CREATE FUNCTION refund_before_write() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  v_method_type text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.method = 'OriginalTender' THEN
      SELECT p.method_type INTO v_method_type
      FROM payment p JOIN sale s ON s.checkout_id = p.checkout_id
      WHERE p.id = NEW.payment_id AND s.id = NEW.sale_id AND p.status = 'Captured';
      IF v_method_type IS NULL THEN
        RAISE EXCEPTION 'payment % is not a captured tender of this sale', NEW.payment_id USING ERRCODE = 'SS050';
      END IF;
      NEW.disbursement := CASE v_method_type WHEN 'Cash' THEN 'Drawer' ELSE 'Provider' END;
    ELSE
      NEW.disbursement := 'Drawer';
    END IF;
    PERFORM assert_reason_code_live(NEW.reason_code_id);
    NEW.document_number := allocate_document_number(NEW.store_id, 'Refund');
    RETURN NEW;
  END IF;
  IF OLD.status IN ('Completed', 'Cancelled') THEN
    RAISE EXCEPTION 'refund % is % and is never changed; a correction is a further linked refund', OLD.id, OLD.status
      USING ERRCODE = 'SS035';
  END IF;
  IF (OLD.submitted_by IS NOT NULL AND NEW.submitted_by IS DISTINCT FROM OLD.submitted_by)
     OR (OLD.approved_by IS NOT NULL AND NEW.approved_by IS DISTINCT FROM OLD.approved_by) THEN
    RAISE EXCEPTION 'who submitted or approved refund % cannot be changed', OLD.id USING ERRCODE = 'SS001';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
    IF NEW.status = 'PendingApproval' THEN
      NEW.submitted_at := now();
    ELSIF NEW.status = 'Approved' THEN
      NEW.approved_at := now();
    ELSIF NEW.status = 'Cancelled' THEN
      PERFORM assert_reason_code_live(NEW.cancel_reason_code_id);
    ELSIF NEW.status = 'Completed' AND NEW.disbursement = 'Drawer' THEN
      IF NOT EXISTS (SELECT 1 FROM pos_terminal WHERE id = NEW.pos_terminal_id AND status = 'Active' AND mode <> 'Training') THEN
        RAISE EXCEPTION 'terminal % may not pay out a real refund', NEW.pos_terminal_id USING ERRCODE = 'SS025';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM cash_shift WHERE id = NEW.cash_shift_id AND status = 'Open') THEN
        RAISE EXCEPTION 'shift % is not open', NEW.cash_shift_id USING ERRCODE = 'SS026';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refund_before_write() IS
  'Cites: RR-22, RR-23, RR-25, PY-25, PY-27, PT-03, BI-09, BI-42, SM-03. A refund to the original tender goes back to a captured tender of the same sale, cash through the drawer and card through the provider; numbering; transition stamps; a completed or cancelled refund is frozen; drawer cash is paid out only at a till in service and not in training, during an open shift.';

CREATE TRIGGER tg_refund_before_write BEFORE INSERT OR UPDATE ON refund
  FOR EACH ROW EXECUTE FUNCTION refund_before_write();
COMMENT ON TRIGGER tg_refund_before_write ON refund IS
  'Cites: RR-23, BI-09. Refund routing, numbering and freezing.';

CREATE TRIGGER tg_refund_state_machine BEFORE INSERT OR UPDATE OF status ON refund
  FOR EACH ROW EXECUTE FUNCTION enforce_state_transition('Refund', 'status');
COMMENT ON TRIGGER tg_refund_state_machine ON refund IS
  'Cites: SM-43a, SM-02. A refund is created Draft and moves only along the edges of state-machines s22.7.';

-- ============================================================================ the hold: the refund bound (RR-03, RR-24)

CREATE FUNCTION apply_refund_hold() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  v_line record;
  v_left bigint;
BEGIN
  IF NEW.status = 'Processing' AND OLD.status = 'Approved' THEN
    IF NEW.customer_return_id IS NOT NULL AND (
         NOT EXISTS (SELECT 1 FROM customer_return WHERE id = NEW.customer_return_id AND status = 'Posted')
         OR EXISTS (SELECT 1 FROM refund_line f
                    WHERE f.refund_id = NEW.id
                      AND NOT EXISTS (SELECT 1 FROM customer_return_line r
                                      WHERE r.customer_return_id = NEW.customer_return_id
                                        AND r.sale_line_id = f.sale_line_id))) THEN
      RAISE EXCEPTION 'a refund for a return pays only for lines that the posted return took back' USING ERRCODE = 'SS051';
    END IF;
    FOR v_line IN SELECT sale_line_id, amount, tax_amount FROM refund_line WHERE refund_id = NEW.id ORDER BY sale_line_id LOOP
      -- RR-03, RR-24: one conditional increment holds the amount; it affects no row past the bound. The tax it carries
      -- keeps the line's refunded tax at the line's stored tax in proportion to its refunded amount (RR-06, RR-42).
      UPDATE sale_line
        SET refunded_amount = refunded_amount + v_line.amount,
            refunded_tax_amount = refunded_tax_amount + v_line.tax_amount
      WHERE id = v_line.sale_line_id
        AND refunded_amount + v_line.amount <= settled_amount
        AND refunded_tax_amount + v_line.tax_amount
            = round(tax_amount::numeric * (refunded_amount + v_line.amount) / NULLIF(settled_amount, 0));
      IF NOT FOUND THEN
        SELECT settled_amount - refunded_amount INTO v_left FROM sale_line WHERE id = v_line.sale_line_id;
        IF v_line.amount > v_left THEN
          RAISE EXCEPTION 'only % of that line can still be refunded', v_left USING ERRCODE = 'SS049', DETAIL = v_left::text;
        END IF;
        RAISE EXCEPTION 'refund tax must be the line''s stored tax in proportion to the amount refunded'
          USING ERRCODE = 'SS052';
      END IF;
    END LOOP;
  ELSIF NEW.status = 'Cancelled' AND OLD.status = 'Processing' THEN
    UPDATE sale_line l
      SET refunded_amount = l.refunded_amount - r.amount,
          refunded_tax_amount = l.refunded_tax_amount - r.tax_amount
    FROM refund_line r
    WHERE r.refund_id = NEW.id AND l.id = r.sale_line_id;
  END IF;
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION apply_refund_hold() IS
  'Cites: RR-03, RR-06, RR-24, RR-42, BI-10, SM-40, SM-41, PY-22, PY-23, RT-145, RT-155, RT-161, EC-02. Entering Processing holds the refund against each line''s settled amount with a conditional update, naming the remainder when it refuses, with the tax at the line''s stored tax in proportion; a refund for a return pays only for what that posted return took back. The hold stays through Failed and Completed and is released only by cancellation. The per-sale cap follows: the settled amounts sum to the total due (SS034).';

CREATE TRIGGER tg_refund_hold AFTER UPDATE OF status ON refund
  FOR EACH ROW EXECUTE FUNCTION apply_refund_hold();
COMMENT ON TRIGGER tg_refund_hold ON refund IS
  'Cites: RR-24, SM-40. Two refunds of the same money cannot both be in flight.';

-- ============================================================================ cash refunds out of the drawer (PY-27)

ALTER TABLE cash_transaction ADD COLUMN refund_id uuid;
ALTER TABLE cash_transaction DROP CONSTRAINT ck_cash_transaction_type;
ALTER TABLE cash_transaction ADD CONSTRAINT ck_cash_transaction_type
  CHECK (type IN ('OpeningFloat', 'ChangeDisbursed', 'ClosingFloat', 'RefundFromDrawer'));
ALTER TABLE cash_transaction ADD CONSTRAINT fk_cash_transaction_refund FOREIGN KEY (refund_id, cash_shift_id)
  REFERENCES refund (id, cash_shift_id);
ALTER TABLE cash_transaction ADD CONSTRAINT ck_cash_transaction_refund
  CHECK ((type = 'RefundFromDrawer') = (refund_id IS NOT NULL));
ALTER TABLE cash_transaction ADD CONSTRAINT uq_cash_transaction_refund UNIQUE (refund_id);

COMMENT ON TABLE cash_transaction IS
  'Cites: CD-11, CD-18, CD-19, PY-27, RT-135. The drawer''s ledger: every cash movement is a row, never a field update. v1 writes the opening float, change given, cash refunds and the closing float; the other types of cash-management s5 arrive with their flows.';
COMMENT ON CONSTRAINT ck_cash_transaction_type ON cash_transaction IS
  'Cites: CD-11, CD-18, CD-20, PY-27. The cash transaction types v1 writes (cash-management s5).';
COMMENT ON CONSTRAINT fk_cash_transaction_refund ON cash_transaction IS
  'Cites: PY-27, RT-156. A cash refund belongs to one refund, paid in that refund''s shift.';
COMMENT ON CONSTRAINT ck_cash_transaction_refund ON cash_transaction IS
  'Cites: PY-27. A cash refund, and only a cash refund, names its refund.';
COMMENT ON CONSTRAINT uq_cash_transaction_refund ON cash_transaction IS
  'Cites: PY-27, BI-28. A refund is paid out of the drawer once.';

CREATE FUNCTION assert_refund_payout_completes() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM refund WHERE id = NEW.refund_id AND status = 'Completed') THEN
    RAISE EXCEPTION 'cash left the drawer for refund %, which did not complete', NEW.refund_id USING ERRCODE = 'SS053';
  END IF;
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION assert_refund_payout_completes() IS
  'Cites: PY-27, BI-04, RT-156. At commit, cash paid out for a refund belongs to a refund that completed in the same transaction: the payout and the completion are one event.';

CREATE CONSTRAINT TRIGGER tg_cash_transaction_refund_completes AFTER INSERT ON cash_transaction
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.refund_id IS NOT NULL) EXECUTE FUNCTION assert_refund_payout_completes();
COMMENT ON TRIGGER tg_cash_transaction_refund_completes ON cash_transaction IS
  'Cites: PY-27, BI-04. Checked at commit.';

CREATE FUNCTION assert_refund_whole() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  v_lines  integer;
  v_amount bigint;
  v_tax    bigint;
BEGIN
  SELECT count(*), coalesce(sum(amount), 0), coalesce(sum(tax_amount), 0) INTO v_lines, v_amount, v_tax
  FROM refund_line WHERE refund_id = NEW.id;
  IF v_lines = 0 OR v_amount <> NEW.amount OR v_tax <> NEW.tax_amount THEN
    RAISE EXCEPTION 'refund % must equal the sum of its lines', NEW.id USING ERRCODE = 'SS053';
  END IF;
  IF NEW.status = 'Completed' AND NEW.disbursement = 'Drawer' AND NEW.amount IS DISTINCT FROM (
       SELECT amount FROM cash_transaction WHERE refund_id = NEW.id) THEN
    RAISE EXCEPTION 'cash refund % completed without being paid out of the drawer', NEW.id USING ERRCODE = 'SS053';
  END IF;
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION assert_refund_whole() IS
  'Cites: RR-43, PY-27, CD-19, BI-04, RT-156. At commit, a refund that has left Draft equals the sum of its lines, tax included, and a completed cash refund has left the drawer as a recorded disbursement of exactly its amount.';

CREATE CONSTRAINT TRIGGER tg_refund_whole AFTER UPDATE OF status ON refund
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_refund_whole();
COMMENT ON TRIGGER tg_refund_whole ON refund IS
  'Cites: RR-43, PY-27. Checked at commit.';

CREATE OR REPLACE FUNCTION shift_expected_cash(p_shift_id uuid) RETURNS bigint
  LANGUAGE sql STABLE
AS $$
  SELECT coalesce((SELECT sum(amount) FROM cash_transaction WHERE cash_shift_id = p_shift_id AND type = 'OpeningFloat'), 0)
       + coalesce((SELECT sum(p.amount) FROM payment p JOIN checkout c ON c.id = p.checkout_id
                   WHERE c.cash_shift_id = p_shift_id AND c.status = 'Completed'
                     AND p.status = 'Captured' AND p.method_type = 'Cash'), 0)
       - coalesce((SELECT sum(amount) FROM cash_transaction WHERE cash_shift_id = p_shift_id AND type = 'RefundFromDrawer'), 0)
$$;

COMMENT ON FUNCTION shift_expected_cash(uuid) IS
  'Cites: CD-06, CD-08, CD-09, PY-27, RT-135, RT-156. What should be in the drawer, derived and never stored: the opening float, plus the cash applied to the shift''s sales (net of change), minus cash refunded out of it. CD-06 writes the refund term with a plus; cash-management s5 gives RefundFromDrawer the direction Out, and PY-27 says an unrecorded refund leaves the count short, so it is subtracted (OQ-015).';

-- ============================================================================ the counters, rebuilt (SP-66, SM-35a)

CREATE FUNCTION sale_counter_drift()
  RETURNS TABLE (sale_id uuid, sale_line_id uuid, problem text, recorded numeric, expected numeric)
  LANGUAGE sql STABLE
AS $$
  WITH rebuilt AS (
    SELECT l.sale_id, l.id, l.quantity, l.returned_quantity, l.refunded_amount, l.refunded_tax_amount,
           coalesce((SELECT sum(r.quantity) FROM customer_return_line r JOIN customer_return c ON c.id = r.customer_return_id
                     WHERE r.sale_line_id = l.id AND c.status IN ('Posted', 'Settled', 'Closed')), 0) AS returned,
           coalesce(h.amount, 0) AS refunded,
           coalesce(h.tax, 0) AS refunded_tax
    FROM sale_line l
    LEFT JOIN LATERAL (SELECT sum(r.amount) AS amount, sum(r.tax_amount) AS tax
                       FROM refund_line r JOIN refund f ON f.id = r.refund_id
                       WHERE r.sale_line_id = l.id AND f.status IN ('Processing', 'Failed', 'Completed')) h ON true
  ), derived AS (
    SELECT rb.sale_id, CASE WHEN bool_and(rb.returned = rb.quantity) THEN 'Returned'
                            WHEN bool_or(rb.returned > 0) THEN 'PartiallyReturned' ELSE 'Completed' END AS status
    FROM rebuilt rb GROUP BY rb.sale_id
  )
  SELECT rb.sale_id, rb.id, 'returned quantity differs from the posted returns', rb.returned_quantity, rb.returned
  FROM rebuilt rb WHERE rb.returned_quantity <> rb.returned
  UNION ALL
  SELECT rb.sale_id, rb.id, 'refunded amount differs from the refunds holding it', rb.refunded_amount, rb.refunded
  FROM rebuilt rb WHERE rb.refunded_amount <> rb.refunded
  UNION ALL
  SELECT rb.sale_id, rb.id, 'refunded tax differs from the refunds holding it', rb.refunded_tax_amount, rb.refunded_tax
  FROM rebuilt rb WHERE rb.refunded_tax_amount <> rb.refunded_tax
  UNION ALL
  SELECT s.id, NULL, 'sale status is ' || s.status || ' but its returns make it ' || d.status, NULL, NULL
  FROM sale s JOIN derived d ON d.sale_id = s.id
  WHERE s.status <> d.status
$$;

COMMENT ON FUNCTION sale_counter_drift() IS
  'Cites: SP-66, SM-35a, RR-14, RR-24. Rebuilds every line''s returned and refunded counters from the returns and refunds, and every sale''s status from the rebuilt counters, and returns each disagreement. It never repairs; an empty result is the proof.';

-- ============================================================================ machines (s22.7)

INSERT INTO state_machine_state (machine, state, is_initial) VALUES
  ('CustomerReturn', 'Draft', true),
  ('CustomerReturn', 'Posted', false),
  ('CustomerReturn', 'Settled', false),
  ('CustomerReturn', 'Closed', false),
  ('CustomerReturn', 'Cancelled', false),
  ('Refund', 'Draft', true),
  ('Refund', 'PendingApproval', false),
  ('Refund', 'Approved', false),
  ('Refund', 'Processing', false),
  ('Refund', 'Completed', false),
  ('Refund', 'Failed', false),
  ('Refund', 'Cancelled', false);

INSERT INTO state_machine_edge (machine, from_state, to_state, event) VALUES
  ('CustomerReturn', 'Draft', 'Posted', 'post'),
  ('CustomerReturn', 'Draft', 'Cancelled', 'cancel'),
  ('Refund', 'Draft', 'PendingApproval', 'submit'),
  ('Refund', 'PendingApproval', 'Approved', 'approve'),
  ('Refund', 'Approved', 'Processing', 'submit to provider'),
  ('Refund', 'Processing', 'Completed', 'complete'),
  ('Refund', 'Processing', 'Failed', 'fail'),
  ('Refund', 'Failed', 'Processing', 'retry'),
  ('Refund', 'Approved', 'Cancelled', 'cancel'),
  ('Refund', 'Processing', 'Cancelled', 'cancel');
-- Not edges yet: CustomerReturn Posted -> Settled -> Closed. Settling needs a return's refundable remainder and a
-- written-off remainder, which the specification does not define (OQ-023). No skip past PendingApproval and no exit
-- from Draft or PendingApproval except forward: s22.7 contracts none (OQ-023, as OQ-013 for adjustments).

-- ============================================================================ runtime role grants (ADR-11, CONVENTIONS s10)

GRANT INSERT (return_window_days, default_return_disposition) ON store_setting_version TO smartstore_app;

GRANT SELECT ON customer_return TO smartstore_app;
GRANT INSERT (id, store_id, organization_id, sale_id, client_operation_id, created_by, late_approved_by,
              late_reason_code_id, status_changed_by, correlation_id)
  ON customer_return TO smartstore_app;
GRANT UPDATE (status, status_changed_by, posted_by, late_approved_by, late_reason_code_id, cancel_reason_code_id)
  ON customer_return TO smartstore_app;

GRANT SELECT, DELETE ON customer_return_line TO smartstore_app;
GRANT INSERT (id, customer_return_id, store_id, organization_id, sale_id, sale_line_id, variant_id, quantity,
              disposition, storage_location_id, client_operation_id)
  ON customer_return_line TO smartstore_app;

GRANT INSERT (customer_return_id, customer_return_line_id, disposition) ON inventory_movement TO smartstore_app;

GRANT SELECT ON refund TO smartstore_app;
GRANT INSERT (id, store_id, organization_id, sale_id, customer_return_id, client_operation_id, method, payment_id,
              pos_terminal_id, cash_drawer_id, cash_shift_id, amount, tax_amount, currency_code, reason_code_id,
              created_by, status_changed_by, correlation_id)
  ON refund TO smartstore_app;
GRANT UPDATE (status, status_changed_by, submitted_by, approved_by, cancel_reason_code_id,
              provider_transaction_reference, provider_outcome, provider_raw_code)
  ON refund TO smartstore_app;

GRANT SELECT, DELETE ON refund_line TO smartstore_app;
GRANT INSERT (id, refund_id, store_id, sale_id, sale_line_id, amount, tax_amount) ON refund_line TO smartstore_app;

GRANT INSERT (refund_id) ON cash_transaction TO smartstore_app;
-- The sale_line counters and the sale's status change only through the owner's posting and hold triggers (s9).

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'Migrations are forward-only and are never rolled back (docs/database/CONVENTIONS.md s14).'; END $$;
