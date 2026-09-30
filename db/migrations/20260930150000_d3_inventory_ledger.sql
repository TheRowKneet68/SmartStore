-- migrate:up

-- Domain 3: Inventory ledger (un-batched in v1; the batch extension is designed in the D3 document).
-- Design, citations and decisions: docs/database/D3-INVENTORY-LEDGER.md
-- Conventions: docs/database/CONVENTIONS.md

ALTER TABLE storage_location ADD CONSTRAINT uq_storage_location_id_organization UNIQUE (id, organization_id);
COMMENT ON CONSTRAINT uq_storage_location_id_organization ON storage_location IS
  'Cites: MS-17, RT-057. Lets a balance or movement prove, by foreign key, that its location is in its own organization.';

-- ============================================================================ reason codes (overview s3.8)

CREATE TABLE reason_code (
  id              uuid          NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid          NOT NULL,
  code            nonblank_text NOT NULL,
  name            nonblank_text NOT NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  archived_by     uuid,
  CONSTRAINT pk_reason_code PRIMARY KEY (id),
  CONSTRAINT fk_reason_code_organization FOREIGN KEY (organization_id) REFERENCES organization (id),
  CONSTRAINT uq_reason_code_code UNIQUE (organization_id, code),
  CONSTRAINT uq_reason_code_id_organization UNIQUE (id, organization_id),
  CONSTRAINT ck_reason_code_archival CHECK ((archived_at IS NULL) = (archived_by IS NULL))
);

COMMENT ON TABLE reason_code IS
  'Cites: BI-25, IV-33, RT-074. The server-defined, per-organization reason list. Free text may add to a reason, never replace one (overview s3.8). None is seeded: the list is the organization''s.';
COMMENT ON CONSTRAINT fk_reason_code_organization ON reason_code IS
  'Cites: BI-25. Reason codes are per organization.';
COMMENT ON CONSTRAINT uq_reason_code_code ON reason_code IS
  'Cites: RT-074. A reason code is unique within its organization.';
COMMENT ON CONSTRAINT uq_reason_code_id_organization ON reason_code IS
  'Cites: RT-001, BI-14. Lets a document prove, by foreign key, that its reason is in its own organization.';
COMMENT ON CONSTRAINT ck_reason_code_archival ON reason_code IS
  'Cites: BI-40. An archival records who and when together.';

CREATE TRIGGER tg_reason_code_archival BEFORE UPDATE ON reason_code
  FOR EACH ROW EXECUTE FUNCTION record_archival();
COMMENT ON TRIGGER tg_reason_code_archival ON reason_code IS
  'Cites: BI-40. Records a reason code''s archival once, with server time; an archived code takes no new documents.';

-- ============================================================================ movement types (inventory-domain s4)

CREATE TABLE inventory_movement_type (
  code        nonblank_text NOT NULL,
  direction   text          NOT NULL,
  stock_class text,
  CONSTRAINT pk_inventory_movement_type PRIMARY KEY (code, direction),
  CONSTRAINT ck_inventory_movement_type_direction CHECK (direction IN ('In', 'Out')),
  CONSTRAINT ck_inventory_movement_type_class CHECK (
    (code = 'REVERSAL' AND stock_class IS NULL)
    OR (code <> 'REVERSAL' AND stock_class IN ('Creates', 'Destroys', 'Conserves')))
);

COMMENT ON TABLE inventory_movement_type IS
  'Cites: RT-058, IV-11, IV-12, IV-13, BI-12. The closed movement-type enumeration with each type''s direction and whether it creates, destroys or conserves total stock. REVERSAL takes either direction and inherits the inverted class of what it reverses. There is no set-stock type (IV-13) and no reservation type (IV-11).';
COMMENT ON CONSTRAINT ck_inventory_movement_type_direction ON inventory_movement_type IS
  'Cites: BI-05. Direction is explicit; a quantity is never signed.';
COMMENT ON CONSTRAINT ck_inventory_movement_type_class ON inventory_movement_type IS
  'Cites: BI-12. Every type but REVERSAL is classified as creating, destroying or conserving stock.';

INSERT INTO inventory_movement_type (code, direction, stock_class) VALUES
  ('PURCHASE_RECEIPT', 'In', 'Creates'),
  ('PURCHASE_RETURN', 'Out', 'Destroys'),
  ('SALE', 'Out', 'Destroys'),
  ('SALE_RETURN', 'In', 'Creates'),
  ('ADJUSTMENT_IN', 'In', 'Creates'),
  ('ADJUSTMENT_OUT', 'Out', 'Destroys'),
  ('TRANSFER_OUT', 'Out', 'Conserves'),
  ('TRANSFER_IN', 'In', 'Conserves'),
  ('DAMAGE', 'Out', 'Destroys'),
  ('EXPIRY', 'Out', 'Destroys'),
  ('LOSS', 'Out', 'Destroys'),
  ('FOUND', 'In', 'Creates'),
  ('OPENING_BALANCE', 'In', 'Creates'),
  ('COUNT_VARIANCE_IN', 'In', 'Creates'),
  ('COUNT_VARIANCE_OUT', 'Out', 'Destroys'),
  ('REVERSAL', 'In', NULL),
  ('REVERSAL', 'Out', NULL);

-- ============================================================================ stock adjustment (IV-32..IV-37, s22.17)

CREATE TABLE stock_adjustment (
  id                uuid          NOT NULL DEFAULT gen_random_uuid(),
  store_id          uuid          NOT NULL,
  organization_id   uuid          NOT NULL,
  document_number   bigint        NOT NULL,
  kind              text          NOT NULL,
  reason_code_id    uuid          NOT NULL,
  note              nonblank_text,
  status            text          NOT NULL DEFAULT 'Draft',
  created_at        timestamptz   NOT NULL DEFAULT now(),
  created_by        uuid          NOT NULL,
  submitted_at      timestamptz,
  submitted_by      uuid,
  approved_at       timestamptz,
  approved_by       uuid,
  status_changed_at timestamptz   NOT NULL DEFAULT now(),
  status_changed_by uuid          NOT NULL,
  CONSTRAINT pk_stock_adjustment PRIMARY KEY (id),
  CONSTRAINT fk_stock_adjustment_store FOREIGN KEY (store_id, organization_id) REFERENCES store (id, organization_id),
  CONSTRAINT fk_stock_adjustment_reason FOREIGN KEY (reason_code_id, organization_id)
    REFERENCES reason_code (id, organization_id),
  CONSTRAINT uq_stock_adjustment_number UNIQUE (store_id, document_number),
  CONSTRAINT uq_stock_adjustment_id_store UNIQUE (id, store_id),
  CONSTRAINT uq_stock_adjustment_id_kind UNIQUE (id, kind),
  CONSTRAINT uq_stock_adjustment_id_organization UNIQUE (id, organization_id),
  CONSTRAINT ck_stock_adjustment_kind CHECK (kind IN ('Adjustment', 'OpeningBalance')),
  CONSTRAINT ck_stock_adjustment_status
    CHECK (status IN ('Draft', 'PendingApproval', 'Approved', 'Posted', 'Cancelled', 'Reversed')),
  CONSTRAINT ck_stock_adjustment_submitted CHECK ((submitted_at IS NULL) = (submitted_by IS NULL)),
  CONSTRAINT ck_stock_adjustment_approved CHECK ((approved_at IS NULL) = (approved_by IS NULL)),
  CONSTRAINT ck_stock_adjustment_submitted_when CHECK (status IN ('Draft', 'Cancelled') OR submitted_by IS NOT NULL),
  CONSTRAINT ck_stock_adjustment_approved_when
    CHECK (status NOT IN ('Approved', 'Posted', 'Reversed') OR approved_by IS NOT NULL),
  CONSTRAINT ck_stock_adjustment_separation CHECK (approved_by IS NULL OR approved_by <> submitted_by)
);

COMMENT ON TABLE stock_adjustment IS
  'Cites: IV-32, IV-33, RT-486, BI-27. A stock adjustment is a document with a state machine and moves no stock until posted. Kind OpeningBalance carries the initial load (OPENING_BALANCE) until import jobs exist.';
COMMENT ON CONSTRAINT fk_stock_adjustment_store ON stock_adjustment IS
  'Cites: RT-001, MS-01. An adjustment belongs to one store.';
COMMENT ON CONSTRAINT fk_stock_adjustment_reason ON stock_adjustment IS
  'Cites: IV-33, RT-074, BI-25. An adjustment always carries a reason code from its organization''s list.';
COMMENT ON CONSTRAINT uq_stock_adjustment_number ON stock_adjustment IS
  'Cites: BI-42, RT-479. The document number is unique per store for this document type and never reused.';
COMMENT ON CONSTRAINT uq_stock_adjustment_id_store ON stock_adjustment IS
  'Cites: RT-001, BI-14. Lets a movement prove, by foreign key, that it is attributed to the adjustment''s store.';
COMMENT ON CONSTRAINT uq_stock_adjustment_id_kind ON stock_adjustment IS
  'Cites: IV-13. Lets a line prove, by foreign key, which kind of adjustment it belongs to.';
COMMENT ON CONSTRAINT uq_stock_adjustment_id_organization ON stock_adjustment IS
  'Cites: RT-001, BI-14. Lets a line prove, by foreign key, that it is in the adjustment''s organization.';
COMMENT ON CONSTRAINT ck_stock_adjustment_kind ON stock_adjustment IS
  'Cites: IV-13, RT-486. A correction, or an opening balance; there is no set-stock document.';
COMMENT ON CONSTRAINT ck_stock_adjustment_status ON stock_adjustment IS
  'Cites: IV-32, SM-07. The states of the StockAdjustment machine (state-machines s22.17).';
COMMENT ON CONSTRAINT ck_stock_adjustment_submitted ON stock_adjustment IS
  'Cites: SM-03. A submission records who and when together.';
COMMENT ON CONSTRAINT ck_stock_adjustment_approved ON stock_adjustment IS
  'Cites: SM-03, BI-26. An approval records who and when together.';
COMMENT ON CONSTRAINT ck_stock_adjustment_submitted_when ON stock_adjustment IS
  'Cites: IV-32, SM-03. Every adjustment past Draft (other than a cancelled draft) records who submitted it.';
COMMENT ON CONSTRAINT ck_stock_adjustment_approved_when ON stock_adjustment IS
  'Cites: IV-35, RT-075, BI-27. An approved, posted or reversed adjustment records who approved it.';
COMMENT ON CONSTRAINT ck_stock_adjustment_separation ON stock_adjustment IS
  'Cites: BI-26, RT-075, IV-35. The requester cannot approve their own adjustment; a data constraint, not a UI affordance (architecture s8.6).';

CREATE FUNCTION stock_adjustment_before_write() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM reason_code WHERE id = NEW.reason_code_id AND archived_at IS NOT NULL) THEN
      RAISE EXCEPTION 'reason code % is archived and takes no new documents', NEW.reason_code_id USING ERRCODE = 'SS024';
    END IF;
    NEW.document_number := allocate_document_number(NEW.store_id, 'StockAdjustment');
    RETURN NEW;
  END IF;
  IF (OLD.submitted_by IS NOT NULL AND NEW.submitted_by IS DISTINCT FROM OLD.submitted_by)
     OR (OLD.approved_by IS NOT NULL AND NEW.approved_by IS DISTINCT FROM OLD.approved_by) THEN
    RAISE EXCEPTION 'who submitted or approved adjustment % cannot be changed', OLD.id USING ERRCODE = 'SS001';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
    IF NEW.status = 'PendingApproval' THEN NEW.submitted_at := now(); END IF;
    IF NEW.status = 'Approved' THEN NEW.approved_at := now(); END IF;
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION stock_adjustment_before_write() IS
  'Cites: BI-42, SM-03, BI-25, RT-353. Allocates the document number in the creating transaction, refuses an archived reason, stamps each transition with server time, and keeps who submitted and approved unchangeable.';

CREATE TRIGGER tg_stock_adjustment_before_write BEFORE INSERT OR UPDATE ON stock_adjustment
  FOR EACH ROW EXECUTE FUNCTION stock_adjustment_before_write();
COMMENT ON TRIGGER tg_stock_adjustment_before_write ON stock_adjustment IS
  'Cites: BI-42, SM-03. Numbering, reason check and transition stamps for stock adjustments.';

CREATE TRIGGER tg_stock_adjustment_state_machine BEFORE INSERT OR UPDATE OF status ON stock_adjustment
  FOR EACH ROW EXECUTE FUNCTION enforce_state_transition('StockAdjustment', 'status');
COMMENT ON TRIGGER tg_stock_adjustment_state_machine ON stock_adjustment IS
  'Cites: IV-32, SM-02, RT-486. An adjustment is created Draft and moves only along the edges of state-machines s22.17.';

CREATE TABLE stock_adjustment_line (
  id                  uuid          NOT NULL DEFAULT gen_random_uuid(),
  stock_adjustment_id uuid          NOT NULL,
  adjustment_kind     text          NOT NULL,
  store_id            uuid          NOT NULL,
  organization_id     uuid          NOT NULL,
  variant_id          uuid          NOT NULL,
  storage_location_id uuid          NOT NULL,
  movement_type       text          NOT NULL,
  direction           text          NOT NULL,
  quantity            numeric(18,4) NOT NULL,
  counted_quantity    numeric(18,4),
  system_quantity     numeric(18,4),
  created_at          timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT pk_stock_adjustment_line PRIMARY KEY (id),
  CONSTRAINT fk_stock_adjustment_line_document FOREIGN KEY (stock_adjustment_id, adjustment_kind)
    REFERENCES stock_adjustment (id, kind),
  CONSTRAINT fk_stock_adjustment_line_organization FOREIGN KEY (stock_adjustment_id, organization_id)
    REFERENCES stock_adjustment (id, organization_id),
  CONSTRAINT fk_stock_adjustment_line_store FOREIGN KEY (stock_adjustment_id, store_id)
    REFERENCES stock_adjustment (id, store_id),
  CONSTRAINT fk_stock_adjustment_line_variant FOREIGN KEY (variant_id, organization_id)
    REFERENCES product_variant (id, organization_id),
  CONSTRAINT fk_stock_adjustment_line_location FOREIGN KEY (storage_location_id, organization_id)
    REFERENCES storage_location (id, organization_id),
  CONSTRAINT fk_stock_adjustment_line_type FOREIGN KEY (movement_type, direction)
    REFERENCES inventory_movement_type (code, direction),
  CONSTRAINT uq_stock_adjustment_line_identity UNIQUE (id, stock_adjustment_id, variant_id, storage_location_id),
  CONSTRAINT ck_stock_adjustment_line_type CHECK (
    (adjustment_kind = 'OpeningBalance' AND movement_type = 'OPENING_BALANCE')
    OR (adjustment_kind = 'Adjustment'
        AND movement_type IN ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'DAMAGE', 'EXPIRY', 'LOSS', 'FOUND'))),
  CONSTRAINT ck_stock_adjustment_line_positive CHECK (quantity > 0),
  CONSTRAINT ck_stock_adjustment_line_count CHECK (
    (counted_quantity IS NULL AND system_quantity IS NULL)
    OR (counted_quantity >= 0 AND system_quantity IS NOT NULL AND counted_quantity <> system_quantity
        AND quantity = abs(counted_quantity - system_quantity)
        AND direction = CASE WHEN counted_quantity > system_quantity THEN 'In' ELSE 'Out' END))
);

CREATE INDEX ix_stock_adjustment_line_document ON stock_adjustment_line (stock_adjustment_id);

COMMENT ON TABLE stock_adjustment_line IS
  'Cites: IV-34, BI-05, UX-36, UX-37. One directional line per effect with a positive quantity in base units. Where the line was entered as a count, the counted and system quantities are kept as the evidence.';
COMMENT ON CONSTRAINT fk_stock_adjustment_line_document ON stock_adjustment_line IS
  'Cites: IV-32. A line belongs to one adjustment, and knows its kind.';
COMMENT ON CONSTRAINT fk_stock_adjustment_line_organization ON stock_adjustment_line IS
  'Cites: RT-001, BI-14. A line is in its adjustment''s organization.';
COMMENT ON CONSTRAINT fk_stock_adjustment_line_store ON stock_adjustment_line IS
  'Cites: RT-001, MS-01, MS-04. A line carries its adjustment''s store, so the store predicate applies to lines directly.';
COMMENT ON CONSTRAINT fk_stock_adjustment_line_variant ON stock_adjustment_line IS
  'Cites: PR-01, RT-021. Only a variant is adjusted, never a product.';
COMMENT ON CONSTRAINT fk_stock_adjustment_line_location ON stock_adjustment_line IS
  'Cites: IV-01, MS-17. Stock is adjusted at a location.';
COMMENT ON CONSTRAINT fk_stock_adjustment_line_type ON stock_adjustment_line IS
  'Cites: RT-058, BI-05. The line''s movement type and its fixed direction.';
COMMENT ON CONSTRAINT uq_stock_adjustment_line_identity ON stock_adjustment_line IS
  'Cites: BI-03, RT-060. Lets a movement prove, by foreign key, that it applies this line''s variant at this line''s location.';
COMMENT ON CONSTRAINT ck_stock_adjustment_line_type ON stock_adjustment_line IS
  'Cites: IV-13, RT-486. An opening balance writes OPENING_BALANCE; an adjustment writes adjustment, damage, expiry, loss or found movements (inventory-domain s5).';
COMMENT ON CONSTRAINT ck_stock_adjustment_line_positive ON stock_adjustment_line IS
  'Cites: IV-34, BI-05. A line quantity is positive; direction comes from the movement type.';
COMMENT ON CONSTRAINT ck_stock_adjustment_line_count ON stock_adjustment_line IS
  'Cites: UX-36, UX-37, IV-29, IV-34. A line entered as a count carries a non-negative counted quantity and the system quantity beside it, and its directional quantity is exactly their difference.';
COMMENT ON INDEX ix_stock_adjustment_line_document IS
  'Cites: IV-32. Finds an adjustment''s lines.';

CREATE FUNCTION stock_adjustment_line_draft_only() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
BEGIN
  -- FOR SHARE waits for a concurrent submit to commit, so a line cannot slip into a submitted adjustment.
  SELECT status INTO v_status FROM stock_adjustment
  WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.stock_adjustment_id ELSE NEW.stock_adjustment_id END
  FOR SHARE;
  IF v_status IS DISTINCT FROM 'Draft' THEN
    RAISE EXCEPTION 'adjustment lines change only while the adjustment is a draft (it is %)', v_status
      USING ERRCODE = 'SS018';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

COMMENT ON FUNCTION stock_adjustment_line_draft_only() IS
  'Cites: IV-32, BI-08, RT-486. Lines are written, and never-submitted lines deleted, only while the adjustment is a draft (overview s3.6); after submission they are part of the document.';

CREATE TRIGGER tg_stock_adjustment_line_draft_only BEFORE INSERT OR UPDATE OR DELETE ON stock_adjustment_line
  FOR EACH ROW EXECUTE FUNCTION stock_adjustment_line_draft_only();
COMMENT ON TRIGGER tg_stock_adjustment_line_draft_only ON stock_adjustment_line IS
  'Cites: IV-32, BI-08. Freezes an adjustment''s lines once it leaves Draft.';

-- ============================================================================ ledger: transaction, movement, balance

CREATE TABLE inventory_transaction (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  store_id       uuid        NOT NULL,
  business_date  date        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  correlation_id uuid,
  CONSTRAINT pk_inventory_transaction PRIMARY KEY (id),
  CONSTRAINT fk_inventory_transaction_store FOREIGN KEY (store_id) REFERENCES store (id),
  CONSTRAINT uq_inventory_transaction_id_store UNIQUE (id, store_id)
);

COMMENT ON TABLE inventory_transaction IS
  'Cites: IV-05, BI-03, RT-060, AU-10. The business event that moved stock: one row per posting, with its store, actor, server time, business date and correlation id. Its movements name the document lines.';
COMMENT ON CONSTRAINT fk_inventory_transaction_store ON inventory_transaction IS
  'Cites: MS-16, RT-001. The store the event is attributed to: the store is the reason stock moved.';
COMMENT ON CONSTRAINT uq_inventory_transaction_id_store ON inventory_transaction IS
  'Cites: MS-16, BI-14. Lets a movement prove, by foreign key, that it is attributed to its transaction''s store.';

CREATE FUNCTION inventory_transaction_business_date() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  SELECT (now() AT TIME ZONE s.time_zone)::date INTO NEW.business_date FROM store s WHERE s.id = NEW.store_id;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION inventory_transaction_business_date() IS
  'Cites: RT-234, RT-353, EC-68. The business date is computed by the server from its own clock in the store''s time zone (overview s3.3; OQ-007), never supplied by a client.';

CREATE TRIGGER tg_inventory_transaction_business_date BEFORE INSERT ON inventory_transaction
  FOR EACH ROW EXECUTE FUNCTION inventory_transaction_business_date();
COMMENT ON TRIGGER tg_inventory_transaction_business_date ON inventory_transaction IS
  'Cites: RT-234, RT-353. Stamps the business date from the server clock.';

CREATE TABLE stock_balance (
  organization_id     uuid          NOT NULL,
  variant_id          uuid          NOT NULL,
  storage_location_id uuid          NOT NULL,
  on_hand             numeric(18,4) NOT NULL,
  movement_count      bigint        NOT NULL,
  last_movement_at    timestamptz   NOT NULL,
  CONSTRAINT pk_stock_balance PRIMARY KEY (variant_id, storage_location_id),
  CONSTRAINT fk_stock_balance_variant FOREIGN KEY (variant_id, organization_id)
    REFERENCES product_variant (id, organization_id),
  CONSTRAINT fk_stock_balance_location FOREIGN KEY (storage_location_id, organization_id)
    REFERENCES storage_location (id, organization_id),
  CONSTRAINT ck_stock_balance_count CHECK (movement_count >= 1)
);

CREATE INDEX ix_stock_balance_location ON stock_balance (storage_location_id);

COMMENT ON TABLE stock_balance IS
  'Cites: BI-02, IV-08, RT-056, RT-057, MS-17, ADR-05. The stock item: one variant at one location, identified by those two and never by a store (MS-17, D-03). A cache of the ledger written only by the movement trigger; the application can read it and nothing else.';
COMMENT ON CONSTRAINT fk_stock_balance_variant ON stock_balance IS
  'Cites: PR-01, RT-021. Only a variant is stocked.';
COMMENT ON CONSTRAINT fk_stock_balance_location ON stock_balance IS
  'Cites: IV-01, RT-057. Stock exists only at a location.';
COMMENT ON CONSTRAINT ck_stock_balance_count ON stock_balance IS
  'Cites: IV-02. A stock item exists only because a movement created it.';
COMMENT ON INDEX ix_stock_balance_location IS
  'Cites: IV-20, RT-068. Reads stock per location, for the per-location negative-stock report.';

CREATE TABLE inventory_movement (
  seq                      bigint        GENERATED ALWAYS AS IDENTITY,
  id                       uuid          NOT NULL DEFAULT gen_random_uuid(),
  inventory_transaction_id uuid          NOT NULL,
  store_id                 uuid          NOT NULL,
  organization_id          uuid          NOT NULL,
  variant_id               uuid          NOT NULL,
  storage_location_id      uuid          NOT NULL,
  movement_type            text          NOT NULL,
  direction                text          NOT NULL,
  quantity                 numeric(18,4) NOT NULL,
  delta                    numeric(18,4) GENERATED ALWAYS AS
                             (CASE direction WHEN 'In' THEN quantity ELSE -quantity END) STORED,
  resulting_balance        numeric(18,4) NOT NULL,
  balance_sequence         bigint        NOT NULL,
  reverses_movement_id     uuid,
  stock_adjustment_id      uuid,
  stock_adjustment_line_id uuid,
  created_at               timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT pk_inventory_movement PRIMARY KEY (id),
  CONSTRAINT uq_inventory_movement_seq UNIQUE (seq),
  CONSTRAINT uq_inventory_movement_balance_sequence UNIQUE (variant_id, storage_location_id, balance_sequence),
  CONSTRAINT uq_inventory_movement_reverses UNIQUE (reverses_movement_id),
  CONSTRAINT uq_inventory_movement_id_adjustment_line UNIQUE (id, stock_adjustment_line_id),
  CONSTRAINT fk_inventory_movement_transaction FOREIGN KEY (inventory_transaction_id, store_id)
    REFERENCES inventory_transaction (id, store_id),
  CONSTRAINT fk_inventory_movement_store FOREIGN KEY (store_id, organization_id) REFERENCES store (id, organization_id),
  CONSTRAINT fk_inventory_movement_variant FOREIGN KEY (variant_id, organization_id)
    REFERENCES product_variant (id, organization_id),
  CONSTRAINT fk_inventory_movement_location FOREIGN KEY (storage_location_id, organization_id)
    REFERENCES storage_location (id, organization_id),
  CONSTRAINT fk_inventory_movement_type FOREIGN KEY (movement_type, direction)
    REFERENCES inventory_movement_type (code, direction),
  CONSTRAINT fk_inventory_movement_reverses FOREIGN KEY (reverses_movement_id) REFERENCES inventory_movement (id),
  CONSTRAINT fk_inventory_movement_reverses_same_adjustment_line FOREIGN KEY (reverses_movement_id, stock_adjustment_line_id)
    REFERENCES inventory_movement (id, stock_adjustment_line_id),
  CONSTRAINT fk_inventory_movement_adjustment_line
    FOREIGN KEY (stock_adjustment_line_id, stock_adjustment_id, variant_id, storage_location_id)
    REFERENCES stock_adjustment_line (id, stock_adjustment_id, variant_id, storage_location_id),
  CONSTRAINT fk_inventory_movement_adjustment_store FOREIGN KEY (stock_adjustment_id, store_id)
    REFERENCES stock_adjustment (id, store_id),
  CONSTRAINT ck_inventory_movement_positive CHECK (quantity > 0),
  CONSTRAINT ck_inventory_movement_reversal CHECK ((movement_type = 'REVERSAL') = (reverses_movement_id IS NOT NULL)),
  CONSTRAINT ck_inventory_movement_adjustment_pair CHECK ((stock_adjustment_id IS NULL) = (stock_adjustment_line_id IS NULL)),
  CONSTRAINT ck_inventory_movement_one_cause CHECK (num_nonnulls(stock_adjustment_line_id) = 1)
);

CREATE UNIQUE INDEX uq_inventory_movement_adjustment_line_once ON inventory_movement (stock_adjustment_line_id)
  WHERE movement_type <> 'REVERSAL';

COMMENT ON TABLE inventory_movement IS
  'Cites: ADR-05, BI-02, BI-03, BI-12, BI-15, IV-05, IV-06, IV-07, RT-056, RT-059, RT-060. The append-only ledger and the source of truth for stock. Each row names its transaction and the document line that caused it, has a positive quantity and an explicit direction, and records the balance it produced.';
COMMENT ON COLUMN inventory_movement.balance_sequence IS
  'Position of this movement in its stock item''s history, assigned under the balance row lock, so it is the true application order even when concurrent transactions draw seq out of order (IV-06).';
COMMENT ON CONSTRAINT uq_inventory_movement_seq ON inventory_movement IS
  'Cites: IV-09. A total order over the whole ledger, for rebuilds and range scans; never returned by an API.';
COMMENT ON CONSTRAINT uq_inventory_movement_balance_sequence ON inventory_movement IS
  'Cites: IV-06, IV-09. Each stock item''s history is one gapless sequence, so the ledger can check itself movement by movement.';
COMMENT ON CONSTRAINT uq_inventory_movement_reverses ON inventory_movement IS
  'Cites: BI-15, IV-12, RT-062. A movement is reversed at most once; reversing an already-reversed movement is refused.';
COMMENT ON CONSTRAINT uq_inventory_movement_id_adjustment_line ON inventory_movement IS
  'Cites: BI-03. Lets a reversal prove, by foreign key, that it answers to the same adjustment line as the movement it reverses.';
COMMENT ON CONSTRAINT fk_inventory_movement_transaction ON inventory_movement IS
  'Cites: BI-03, IV-05, RT-060. Every movement belongs to exactly one inventory transaction, attributed to the same store.';
COMMENT ON CONSTRAINT fk_inventory_movement_store ON inventory_movement IS
  'Cites: MS-16, RT-001. Every movement is attributed to a store of its organization: the store is the reason it happened.';
COMMENT ON CONSTRAINT fk_inventory_movement_variant ON inventory_movement IS
  'Cites: PR-01, RT-021. Only a variant moves.';
COMMENT ON CONSTRAINT fk_inventory_movement_location ON inventory_movement IS
  'Cites: IV-01, MS-17. Stock moves at a location.';
COMMENT ON CONSTRAINT fk_inventory_movement_type ON inventory_movement IS
  'Cites: RT-058, IV-11, IV-12, IV-13. The type is from the closed enumeration, in a direction that type allows.';
COMMENT ON CONSTRAINT fk_inventory_movement_reverses ON inventory_movement IS
  'Cites: IV-12, RT-062. A reversal references the movement it compensates.';
COMMENT ON CONSTRAINT fk_inventory_movement_reverses_same_adjustment_line ON inventory_movement IS
  'Cites: BI-03, IV-12. A reversal names the same adjustment line as what it reverses.';
COMMENT ON CONSTRAINT fk_inventory_movement_adjustment_line ON inventory_movement IS
  'Cites: BI-03, RT-060, IV-14. The causing adjustment line, with its variant and location proven to match.';
COMMENT ON CONSTRAINT fk_inventory_movement_adjustment_store ON inventory_movement IS
  'Cites: MS-16, BI-14. An adjustment''s movements are attributed to the adjustment''s store.';
COMMENT ON CONSTRAINT ck_inventory_movement_positive ON inventory_movement IS
  'Cites: BI-05. A movement quantity is positive; its effect''s sign comes from its direction.';
COMMENT ON CONSTRAINT ck_inventory_movement_reversal ON inventory_movement IS
  'Cites: IV-12, BI-15. A REVERSAL, and only a REVERSAL, references the movement it reverses.';
COMMENT ON CONSTRAINT ck_inventory_movement_adjustment_pair ON inventory_movement IS
  'Cites: BI-03. An adjustment line is always named with its adjustment.';
COMMENT ON CONSTRAINT ck_inventory_movement_one_cause ON inventory_movement IS
  'Cites: BI-03, RT-060, IV-14. Exactly one causing document line. Later domains add their line columns to this count.';
COMMENT ON INDEX uq_inventory_movement_adjustment_line_once IS
  'Cites: BI-28, RT-486. An adjustment line is applied at most once; posting cannot be repeated.';

CREATE FUNCTION apply_inventory_movement() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  v_delta     numeric(18,4);
  v_kind      text;
  v_owner     uuid;
  v_loc_type  text;
  v_qty_kind  text;
  v_scale     smallint;
  v_policy    text;
  v_balance   numeric(18,4);
  v_count     bigint;
  v_reversed  record;
BEGIN
  SELECT w.kind, w.store_id, l.location_type INTO v_kind, v_owner, v_loc_type
  FROM storage_location l JOIN warehouse w ON w.id = l.warehouse_id
  WHERE l.id = NEW.storage_location_id;

  SELECT u.quantity_kind, u.scale INTO v_qty_kind, v_scale
  FROM product_variant v JOIN unit u ON u.id = v.base_unit_id
  WHERE v.id = NEW.variant_id;

  IF v_qty_kind = 'Service' THEN
    RAISE EXCEPTION 'variant % is a service and cannot be stocked', NEW.variant_id USING ERRCODE = 'SS012';
  END IF;
  IF NEW.quantity <> round(NEW.quantity, v_scale) THEN
    RAISE EXCEPTION 'quantity % has more decimals than its unit allows (%)', NEW.quantity, v_scale
      USING ERRCODE = 'SS013';
  END IF;
  IF v_loc_type = 'Transit' AND NEW.movement_type NOT IN ('TRANSFER_OUT', 'TRANSFER_IN', 'REVERSAL') THEN
    RAISE EXCEPTION 'a Transit location is reached only by transfer movements' USING ERRCODE = 'SS023';
  END IF;

  -- The store is the reason the movement happened (MS-16): the location's own store, or a store the central
  -- location is attributed to (D-03).
  IF (v_kind = 'StoreAttached' AND v_owner IS DISTINCT FROM NEW.store_id)
     OR (v_kind = 'Central' AND NOT EXISTS (SELECT 1 FROM storage_location_attribution
                                            WHERE storage_location_id = NEW.storage_location_id
                                              AND store_id = NEW.store_id)) THEN
    RAISE EXCEPTION 'store % may not move stock at location %', NEW.store_id, NEW.storage_location_id
      USING ERRCODE = 'SS014';
  END IF;

  IF EXISTS (SELECT 1 FROM store WHERE id = NEW.store_id AND deactivated_at IS NOT NULL) THEN
    RAISE EXCEPTION 'store % is deactivated and moves no stock', NEW.store_id USING ERRCODE = 'SS020';
  END IF;

  IF NEW.movement_type = 'REVERSAL' THEN
    SELECT store_id, variant_id, storage_location_id, direction, quantity INTO v_reversed
    FROM inventory_movement WHERE id = NEW.reverses_movement_id;
    IF v_reversed.direction = NEW.direction OR v_reversed.quantity <> NEW.quantity
       OR v_reversed.variant_id <> NEW.variant_id OR v_reversed.storage_location_id <> NEW.storage_location_id
       OR v_reversed.store_id <> NEW.store_id THEN
      RAISE EXCEPTION 'a reversal must mirror movement %: same store, variant, location and quantity, opposite direction',
        NEW.reverses_movement_id USING ERRCODE = 'SS015';
    END IF;
  END IF;

  IF v_kind = 'Central' THEN
    v_policy := 'BlockNegative';  -- WH-02: a central warehouse never allows a negative balance
  ELSE
    SELECT negative_stock_policy INTO v_policy FROM store_setting_version
    WHERE store_id = NEW.store_id AND effective_from <= now()
    ORDER BY effective_from DESC LIMIT 1;
    IF v_policy IS NULL THEN
      RAISE EXCEPTION 'store % has no settings in force', NEW.store_id USING ERRCODE = 'SS017';
    END IF;
  END IF;

  v_delta := CASE NEW.direction WHEN 'In' THEN NEW.quantity ELSE -NEW.quantity END;

  -- IV-21: one atomic statement applies the delta and returns the result; the balance row stays locked until commit.
  INSERT INTO stock_balance AS b (organization_id, variant_id, storage_location_id, on_hand, movement_count, last_movement_at)
  VALUES (NEW.organization_id, NEW.variant_id, NEW.storage_location_id, v_delta, 1, now())
  ON CONFLICT (variant_id, storage_location_id) DO UPDATE
    SET on_hand = b.on_hand + EXCLUDED.on_hand,
        movement_count = b.movement_count + 1,
        last_movement_at = EXCLUDED.last_movement_at
  RETURNING b.on_hand, b.movement_count INTO v_balance, v_count;

  -- IV-16, IV-22, BI-36: the policy is judged on the resulting balance, inside the same transaction.
  IF v_policy = 'BlockNegative' AND NEW.direction = 'Out' AND v_balance < 0 THEN
    RAISE EXCEPTION 'only % available at location %; % requested', v_balance + NEW.quantity, NEW.storage_location_id,
      NEW.quantity
      USING ERRCODE = 'SS011';
  END IF;

  NEW.resulting_balance := v_balance;
  NEW.balance_sequence := v_count;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION apply_inventory_movement() IS
  'Cites: BI-02, BI-36, IV-06, IV-08, IV-16, IV-17, IV-21, IV-22, WH-02, MS-16, D-03, PR-22, RT-056, RT-483, RT-484. The only writer of stock balances. It validates the movement, applies it to the balance in one atomic statement, judges the negative-stock policy on the result in the same transaction, and stamps the resulting balance. Under AllowNegative the negative is written in full, never clamped (IV-17).';

CREATE TRIGGER tg_inventory_movement_apply BEFORE INSERT ON inventory_movement
  FOR EACH ROW EXECUTE FUNCTION apply_inventory_movement();
COMMENT ON TRIGGER tg_inventory_movement_apply ON inventory_movement IS
  'Cites: BI-02, IV-08, RT-061. A movement and its balance update are one statement: both happen or neither does.';

CREATE FUNCTION assert_movement_adjustment_state() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
BEGIN
  IF NEW.stock_adjustment_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT status INTO v_status FROM stock_adjustment WHERE id = NEW.stock_adjustment_id;
  IF (NEW.movement_type = 'REVERSAL' AND v_status IS DISTINCT FROM 'Reversed')
     OR (NEW.movement_type <> 'REVERSAL' AND v_status IS DISTINCT FROM 'Posted') THEN
    RAISE EXCEPTION 'adjustment % is % and does not move stock that way', NEW.stock_adjustment_id, v_status
      USING ERRCODE = 'SS016';
  END IF;
  IF NEW.movement_type <> 'REVERSAL' AND NOT EXISTS (
       SELECT 1 FROM stock_adjustment_line
       WHERE id = NEW.stock_adjustment_line_id AND movement_type = NEW.movement_type AND direction = NEW.direction) THEN
    RAISE EXCEPTION 'a movement must carry its adjustment line''s type' USING ERRCODE = 'SS016';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION assert_movement_adjustment_state() IS
  'Cites: BI-27, IV-32, RT-486. An adjustment moves stock only when it is Posted, and its reversal only when it is Reversed; a movement carries its line''s type.';

CREATE TRIGGER tg_inventory_movement_adjustment_state BEFORE INSERT ON inventory_movement
  FOR EACH ROW EXECUTE FUNCTION assert_movement_adjustment_state();
COMMENT ON TRIGGER tg_inventory_movement_adjustment_state ON inventory_movement IS
  'Cites: BI-27, RT-486. Only a posted adjustment moves stock.';

CREATE FUNCTION forbid_ledger_rewrite() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is refused for every role', TG_TABLE_NAME, TG_OP USING ERRCODE = 'SS010';
END
$$;

COMMENT ON FUNCTION forbid_ledger_rewrite() IS
  'Cites: BI-15, RT-059, AU-32. Refuses UPDATE, DELETE and TRUNCATE on an append-only ledger whatever the role, including the schema owner.';

CREATE TRIGGER tg_inventory_movement_immutable BEFORE UPDATE OR DELETE ON inventory_movement
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_rewrite();
COMMENT ON TRIGGER tg_inventory_movement_immutable ON inventory_movement IS
  'Cites: BI-15, RT-059. A movement is never updated or deleted, at every privilege.';

CREATE TRIGGER tg_inventory_movement_no_truncate BEFORE TRUNCATE ON inventory_movement
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_ledger_rewrite();
COMMENT ON TRIGGER tg_inventory_movement_no_truncate ON inventory_movement IS
  'Cites: BI-15, RT-059, AU-32. The ledger cannot be emptied in bulk.';

CREATE TRIGGER tg_inventory_transaction_immutable BEFORE UPDATE OR DELETE ON inventory_transaction
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_rewrite();
COMMENT ON TRIGGER tg_inventory_transaction_immutable ON inventory_transaction IS
  'Cites: IV-05, BI-15, RT-059. The event a movement belongs to is part of the ledger and is never rewritten.';

CREATE TRIGGER tg_inventory_transaction_no_truncate BEFORE TRUNCATE ON inventory_transaction
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_ledger_rewrite();
COMMENT ON TRIGGER tg_inventory_transaction_no_truncate ON inventory_transaction IS
  'Cites: IV-05, AU-32. The ledger''s events cannot be emptied in bulk.';

-- ============================================================================ posting completeness (RT-486)

CREATE FUNCTION assert_adjustment_posting_complete() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'Posted' AND EXISTS (
       SELECT 1 FROM stock_adjustment_line l
       WHERE l.stock_adjustment_id = NEW.id
         AND l.quantity IS DISTINCT FROM (SELECT sum(m.quantity) FROM inventory_movement m
                                          WHERE m.stock_adjustment_line_id = l.id AND m.movement_type <> 'REVERSAL')) THEN
    RAISE EXCEPTION 'adjustment % was posted without exactly one movement per line', NEW.id USING ERRCODE = 'SS022';
  END IF;
  IF NEW.status = 'Reversed' AND EXISTS (
       SELECT 1 FROM inventory_movement m
       WHERE m.stock_adjustment_id = NEW.id AND m.movement_type <> 'REVERSAL'
         AND NOT EXISTS (SELECT 1 FROM inventory_movement r WHERE r.reverses_movement_id = m.id)) THEN
    RAISE EXCEPTION 'adjustment % was reversed without reversing every movement', NEW.id USING ERRCODE = 'SS022';
  END IF;
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION assert_adjustment_posting_complete() IS
  'Cites: RT-486, BI-04, BI-15. At commit, a posted adjustment has written exactly its lines, and a reversed one has compensated every movement.';

CREATE CONSTRAINT TRIGGER tg_stock_adjustment_posting AFTER UPDATE OF status ON stock_adjustment
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_adjustment_posting_complete();
COMMENT ON TRIGGER tg_stock_adjustment_posting ON stock_adjustment IS
  'Cites: RT-486, BI-04. Posting and reversal are all or nothing, checked at commit.';

-- ============================================================================ reconciliation (IV-09, ADR-22)

CREATE FUNCTION inventory_ledger_drift()
  RETURNS TABLE (variant_id uuid, storage_location_id uuid, problem text, recorded numeric, expected numeric)
  LANGUAGE sql STABLE
AS $$
  WITH ledger AS (
    SELECT m.variant_id, m.storage_location_id, sum(m.delta) AS on_hand, count(*) AS movements
    FROM inventory_movement m GROUP BY m.variant_id, m.storage_location_id
  ), chain AS (
    SELECT m.variant_id, m.storage_location_id, m.id, m.resulting_balance, m.balance_sequence,
           sum(m.delta) OVER w AS running, row_number() OVER w AS position
    FROM inventory_movement m
    WINDOW w AS (PARTITION BY m.variant_id, m.storage_location_id ORDER BY m.balance_sequence)
  )
  SELECT coalesce(b.variant_id, l.variant_id), coalesce(b.storage_location_id, l.storage_location_id),
         'balance differs from the sum of its movements', b.on_hand, coalesce(l.on_hand, 0)
  FROM stock_balance b FULL JOIN ledger l
    ON l.variant_id = b.variant_id AND l.storage_location_id = b.storage_location_id
  WHERE b.on_hand IS DISTINCT FROM l.on_hand
  UNION ALL
  SELECT b.variant_id, b.storage_location_id, 'movement count differs from the ledger', b.movement_count, l.movements
  FROM stock_balance b JOIN ledger l ON l.variant_id = b.variant_id AND l.storage_location_id = b.storage_location_id
  WHERE b.movement_count <> l.movements
  UNION ALL
  SELECT c.variant_id, c.storage_location_id, 'resulting balance breaks the chain at movement ' || c.id,
         c.resulting_balance, c.running
  FROM chain c
  WHERE c.resulting_balance <> c.running OR c.balance_sequence <> c.position
$$;

COMMENT ON FUNCTION inventory_ledger_drift() IS
  'Cites: IV-06, IV-09, BI-02, ADR-22, RT-056. Rebuilds every balance from the ledger and walks every resulting balance; returns each disagreement. It never repairs: an empty result is the proof, and anything else is an alert.';

-- ============================================================================ guards closed from domains 1 and 2

CREATE FUNCTION forbid_store_deactivation_with_stock() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.deactivated_by IS NULL AND NEW.deactivated_by IS NOT NULL AND EXISTS (
       SELECT 1 FROM stock_balance b
       JOIN storage_location l ON l.id = b.storage_location_id
       JOIN warehouse w ON w.id = l.warehouse_id
       WHERE w.store_id = NEW.id AND b.on_hand <> 0) THEN
    RAISE EXCEPTION 'store % holds stock; transfer it out or adjust it to zero with a reason first', NEW.id
      USING ERRCODE = 'SS019';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION forbid_store_deactivation_with_stock() IS
  'Cites: ORG-05, RT-445, RT-508, EC-39. A store is not deactivated while its own locations hold stock.';

CREATE TRIGGER tg_store_deactivation_stock BEFORE UPDATE OF deactivated_by ON store
  FOR EACH ROW EXECUTE FUNCTION forbid_store_deactivation_with_stock();
COMMENT ON TRIGGER tg_store_deactivation_stock ON store IS
  'Cites: ORG-05, RT-445. Closes the domain 1 pending guard for stock.';

CREATE FUNCTION freeze_used_quantity_kind() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  v_first uuid;
BEGIN
  IF NEW.quantity_kind IS DISTINCT FROM OLD.quantity_kind THEN
    SELECT m.id INTO v_first FROM inventory_movement m JOIN product_variant v ON v.id = m.variant_id
    WHERE v.base_unit_id = OLD.id ORDER BY m.seq LIMIT 1;
    IF v_first IS NULL THEN
      SELECT l.id INTO v_first FROM stock_adjustment_line l JOIN product_variant v ON v.id = l.variant_id
      WHERE v.base_unit_id = OLD.id LIMIT 1;
    END IF;
    IF v_first IS NOT NULL THEN
      RAISE EXCEPTION 'unit % is already used (first use: %); its quantity kind cannot change', OLD.id, v_first
        USING ERRCODE = 'SS021';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION freeze_used_quantity_kind() IS
  'Cites: PR-14, RT-491. A unit''s quantity kind is frozen once any movement or document line uses it; the refusal names the first use.';

CREATE TRIGGER tg_unit_quantity_kind BEFORE UPDATE OF quantity_kind ON unit
  FOR EACH ROW EXECUTE FUNCTION freeze_used_quantity_kind();
COMMENT ON TRIGGER tg_unit_quantity_kind ON unit IS
  'Cites: PR-14, RT-491. Closes the domain 2 pending guard.';

-- ============================================================================ the StockAdjustment machine (s22.17)

INSERT INTO state_machine_state (machine, state, is_initial) VALUES
  ('StockAdjustment', 'Draft', true),
  ('StockAdjustment', 'PendingApproval', false),
  ('StockAdjustment', 'Approved', false),
  ('StockAdjustment', 'Posted', false),
  ('StockAdjustment', 'Cancelled', false),
  ('StockAdjustment', 'Reversed', false);

INSERT INTO state_machine_edge (machine, from_state, to_state, event) VALUES
  ('StockAdjustment', 'Draft', 'PendingApproval', 'submit'),
  ('StockAdjustment', 'PendingApproval', 'Approved', 'approve'),
  ('StockAdjustment', 'Approved', 'Posted', 'post'),
  ('StockAdjustment', 'Draft', 'Cancelled', 'cancel'),
  ('StockAdjustment', 'Posted', 'Reversed', 'reverse');
-- Not edges (OQ-013): Draft -> Posted without approval, and any exit from PendingApproval or Approved other than
-- forward. Cancelled and Reversed are terminal.

INSERT INTO document_type (code) VALUES ('StockAdjustment');

-- ============================================================================ runtime role grants (ADR-11, CONVENTIONS s10)

GRANT SELECT ON reason_code TO smartstore_app;
GRANT INSERT (id, organization_id, code, name) ON reason_code TO smartstore_app;
GRANT UPDATE (name, archived_by) ON reason_code TO smartstore_app;

GRANT SELECT ON inventory_movement_type TO smartstore_app;

GRANT SELECT ON stock_adjustment TO smartstore_app;
GRANT INSERT (id, store_id, organization_id, kind, reason_code_id, note, created_by, status_changed_by)
  ON stock_adjustment TO smartstore_app;
GRANT UPDATE (status, status_changed_by, submitted_by, approved_by) ON stock_adjustment TO smartstore_app;
-- document_number is allocated by the database; kind, reason and note are fixed at creation (BI-08).

GRANT SELECT, DELETE ON stock_adjustment_line TO smartstore_app;
GRANT INSERT (id, stock_adjustment_id, adjustment_kind, store_id, organization_id, variant_id, storage_location_id,
              movement_type, direction, quantity, counted_quantity, system_quantity)
  ON stock_adjustment_line TO smartstore_app;
-- DELETE is the one delete in the schema: a never-submitted draft line (overview s3.6), enforced by the Draft-only
-- trigger. A line is changed by deleting and re-adding it while the adjustment is a draft.

GRANT SELECT ON inventory_transaction TO smartstore_app;
GRANT INSERT (id, store_id, created_by, correlation_id) ON inventory_transaction TO smartstore_app;

GRANT SELECT ON inventory_movement TO smartstore_app;
GRANT INSERT (id, inventory_transaction_id, store_id, organization_id, variant_id, storage_location_id, movement_type,
              direction, quantity, reverses_movement_id, stock_adjustment_id, stock_adjustment_line_id)
  ON inventory_movement TO smartstore_app;
-- resulting_balance, balance_sequence, seq and created_at are the database's to write.

GRANT SELECT ON stock_balance TO smartstore_app;
-- No write of any kind: a balance changes only by inserting a movement (BI-02, RT-056).

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'Migrations are forward-only and are never rolled back (docs/database/CONVENTIONS.md s14).'; END $$;
