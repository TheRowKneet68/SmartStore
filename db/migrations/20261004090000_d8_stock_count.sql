-- migrate:up

-- Stock Counts domain (IV-25, IV-26, IV-27, IV-28, IV-29, IV-30, SM-81, SM-82, SM-83, SM-84, RT-071, RT-436, D-09).
-- A stock count is a document: lines are entered while Open; posting writes COUNT_VARIANCE_IN /
-- COUNT_VARIANCE_OUT movements; the sheet is immutable after posting (IV-30); a wrong posted count
-- is reversed, never edited (SM-82). Expected quantity is frozen at creation (IV-26). Movements
-- during an open count are flagged on the sheet, not blocked (IV-27, SM-83). Counted quantity is
-- never negative (IV-29).

-- 1. stock_count ------------------------------------------------------------------

CREATE TABLE stock_count (
  id                  uuid          NOT NULL DEFAULT gen_random_uuid(),
  store_id            uuid          NOT NULL REFERENCES store(id),
  organization_id     uuid          NOT NULL REFERENCES organization(id),
  document_number     bigint        NOT NULL GENERATED ALWAYS AS IDENTITY,
  scope               text          NOT NULL,
  status              text          NOT NULL DEFAULT 'Open',
  note                nonblank_text,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  created_by          uuid          NOT NULL REFERENCES employee(id),
  snapshot_at         timestamptz   NOT NULL DEFAULT now(),
  posted_at           timestamptz,
  posted_by           uuid          REFERENCES employee(id),
  cancelled_at        timestamptz,
  cancelled_by        uuid          REFERENCES employee(id),
  status_changed_at   timestamptz   NOT NULL DEFAULT now(),
  status_changed_by   uuid          NOT NULL REFERENCES employee(id),

  CONSTRAINT pk_stock_count PRIMARY KEY (id),
  CONSTRAINT uq_stock_count_number UNIQUE (store_id, document_number),
  CONSTRAINT ck_stock_count_status CHECK (status IN ('Open', 'Posted', 'Cancelled', 'Reversed')),
  CONSTRAINT ck_stock_count_scope  CHECK (scope IN ('Location', 'MultiLocation')),
  CONSTRAINT ck_stock_count_posted CHECK ((posted_at IS NULL) = (posted_by IS NULL)),
  CONSTRAINT ck_stock_count_cancelled CHECK ((cancelled_at IS NULL) = (cancelled_by IS NULL)),
  CONSTRAINT ck_stock_count_posted_when CHECK (
    status NOT IN ('Posted', 'Reversed') OR posted_by IS NOT NULL
  )
);

COMMENT ON TABLE stock_count IS
  'Cites: IV-25, IV-26, IV-27, IV-28, IV-29, IV-30, SM-81, SM-82, SM-83, SM-84, RT-071, D-09. '
  'A count document. Lines are entered while Open; posting writes COUNT_VARIANCE movements; '
  'the sheet is immutable after posting. snapshot_at is frozen at creation (IV-26).';

COMMENT ON CONSTRAINT uq_stock_count_number ON stock_count IS
  'Cites: RT-071, BI-42. The document number is unique per store and never reused.';

COMMENT ON CONSTRAINT ck_stock_count_status ON stock_count IS
  'Cites: D-09, IV-25. Exactly four states owned by inventory-domain section 8.3.';

COMMENT ON CONSTRAINT ck_stock_count_scope ON stock_count IS
  'Cites: IV-25, RT-071. A count covers a single location or a named set of locations.';

COMMENT ON CONSTRAINT ck_stock_count_posted ON stock_count IS
  'Cites: SM-03, IV-28. A posting records who posted and when, together.';

COMMENT ON CONSTRAINT ck_stock_count_cancelled ON stock_count IS
  'Cites: SM-03, IV-25. A cancellation records who cancelled and when, together.';

COMMENT ON CONSTRAINT ck_stock_count_posted_when ON stock_count IS
  'Cites: IV-28. A Posted or Reversed count records who posted it.';

COMMENT ON CONSTRAINT stock_count_store_id_fkey ON stock_count IS
  'Cites: RT-001, MS-01. A stock count belongs to one store.';

COMMENT ON CONSTRAINT stock_count_organization_id_fkey ON stock_count IS
  'Cites: RT-001, MS-01. A stock count belongs to one organization.';

COMMENT ON CONSTRAINT stock_count_created_by_fkey ON stock_count IS
  'Cites: BI-23, EM-11, AU-05. Who created it is an employee of record.';

COMMENT ON CONSTRAINT stock_count_posted_by_fkey ON stock_count IS
  'Cites: BI-23, EM-11, AU-05. Who posted it is an employee of record.';

COMMENT ON CONSTRAINT stock_count_cancelled_by_fkey ON stock_count IS
  'Cites: BI-23, EM-11, AU-05. Who cancelled it is an employee of record.';

COMMENT ON CONSTRAINT stock_count_status_changed_by_fkey ON stock_count IS
  'Cites: BI-23, EM-11, AU-05. Who last changed status is an employee of record.';

CREATE INDEX ix_stock_count_store_status ON stock_count (store_id, status, created_at DESC);

COMMENT ON INDEX ix_stock_count_store_status IS
  'Cites: RT-071, IV-25. Supports listing counts by store and status.';

-- 2. stock_count_line -------------------------------------------------------------

CREATE TABLE stock_count_line (
  id                    uuid          NOT NULL DEFAULT gen_random_uuid(),
  stock_count_id        uuid          NOT NULL REFERENCES stock_count(id),
  store_id              uuid          NOT NULL REFERENCES store(id),
  organization_id       uuid          NOT NULL REFERENCES organization(id),
  variant_id            uuid          NOT NULL REFERENCES product_variant(id),
  storage_location_id   uuid          NOT NULL REFERENCES storage_location(id),
  expected_quantity     numeric(18,4) NOT NULL,
  counted_quantity      numeric(18,4),
  reason_code_id        uuid          REFERENCES reason_code(id),
  movement_type         text,
  direction             text,
  created_at            timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT pk_stock_count_line PRIMARY KEY (id),
  CONSTRAINT uq_stock_count_line UNIQUE (stock_count_id, variant_id, storage_location_id),
  CONSTRAINT ck_stock_count_line_counted_positive CHECK (counted_quantity IS NULL OR counted_quantity >= 0),
  CONSTRAINT ck_stock_count_line_reason CHECK (
    counted_quantity IS NULL
    OR counted_quantity = expected_quantity
    OR reason_code_id IS NOT NULL
  ),
  CONSTRAINT ck_stock_count_line_movement CHECK (
    (movement_type IS NULL) = (direction IS NULL)
  ),
  CONSTRAINT ck_stock_count_line_movement_type CHECK (
    movement_type IS NULL
    OR movement_type IN ('COUNT_VARIANCE_IN', 'COUNT_VARIANCE_OUT')
  )
);

COMMENT ON TABLE stock_count_line IS
  'Cites: IV-25, IV-26, IV-27, IV-28, IV-29, SM-81. One line per (variant, location). '
  'expected_quantity is frozen at creation. counted_quantity is NULL until the counter enters it. '
  'Variance lines require a reason_code_id (IV-28). Counted quantity is never negative (IV-29).';

COMMENT ON CONSTRAINT uq_stock_count_line ON stock_count_line IS
  'Cites: IV-25, IV-26. One line per variant and location per count sheet.';

COMMENT ON CONSTRAINT ck_stock_count_line_counted_positive ON stock_count_line IS
  'Cites: IV-29, BI-05. A count is an observation and is never negative.';

COMMENT ON CONSTRAINT ck_stock_count_line_reason ON stock_count_line IS
  'Cites: IV-28. Every variance line carries a reason code; zero-variance lines do not.';

COMMENT ON CONSTRAINT ck_stock_count_line_movement ON stock_count_line IS
  'Cites: IV-25, SM-81. movement_type and direction travel together; both null or both set.';

COMMENT ON CONSTRAINT ck_stock_count_line_movement_type ON stock_count_line IS
  'Cites: IV-28, SM-81. A posted variance uses COUNT_VARIANCE_IN or COUNT_VARIANCE_OUT.';

COMMENT ON CONSTRAINT stock_count_line_stock_count_id_fkey ON stock_count_line IS
  'Cites: IV-25, RT-071. A line belongs to exactly one count sheet.';

COMMENT ON CONSTRAINT stock_count_line_store_id_fkey ON stock_count_line IS
  'Cites: RT-001, MS-16. A count line carries its store for movement attribution.';

COMMENT ON CONSTRAINT stock_count_line_organization_id_fkey ON stock_count_line IS
  'Cites: RT-001, MS-01. A count line belongs to one organization.';

COMMENT ON CONSTRAINT stock_count_line_variant_id_fkey ON stock_count_line IS
  'Cites: IV-25, RT-071. A count line targets one product variant.';

COMMENT ON CONSTRAINT stock_count_line_storage_location_id_fkey ON stock_count_line IS
  'Cites: IV-25, RT-071. A count line targets one storage location.';

COMMENT ON CONSTRAINT stock_count_line_reason_code_id_fkey ON stock_count_line IS
  'Cites: IV-28, RT-071. A variance line names the reason from the configured list.';

CREATE INDEX ix_stock_count_line_count ON stock_count_line (stock_count_id);

COMMENT ON INDEX ix_stock_count_line_count IS
  'Cites: IV-25, IV-27. Supports reading all lines of a count sheet.';

CREATE INDEX ix_stock_count_line_variant ON stock_count_line (variant_id, storage_location_id);

COMMENT ON INDEX ix_stock_count_line_variant IS
  'Cites: IV-27, SM-83. Supports flagging counts that contain a recently moved variant.';

-- 3. COUNT_VARIANCE_REVERSAL movement type ----------------------------------------

INSERT INTO inventory_movement_type (code, direction, stock_class)
VALUES ('COUNT_VARIANCE_REVERSAL', 'Out', 'Destroys');

COMMENT ON TABLE inventory_movement_type IS
  'Cites: IV-06, IV-07, RT-056. Movement vocabulary.';

-- 4. Extend inventory_movement to allow count-line cause --------------------------

ALTER TABLE inventory_movement
  ADD COLUMN stock_count_id      uuid REFERENCES stock_count(id),
  ADD COLUMN stock_count_line_id uuid REFERENCES stock_count_line(id);

-- Paired: both null or both non-null.
ALTER TABLE inventory_movement
  ADD CONSTRAINT ck_inventory_movement_count_pair
    CHECK ((stock_count_id IS NULL) = (stock_count_line_id IS NULL));

COMMENT ON CONSTRAINT ck_inventory_movement_count_pair ON inventory_movement IS
  'Cites: BI-03, IV-28. A count movement always names both the count and the line.';

COMMENT ON CONSTRAINT inventory_movement_stock_count_id_fkey ON inventory_movement IS
  'Cites: BI-03, IV-28. The count this movement was posted from.';

COMMENT ON CONSTRAINT inventory_movement_stock_count_line_id_fkey ON inventory_movement IS
  'Cites: BI-03, IV-28. The count line this movement was posted from.';

-- The one-cause constraint must include the new cause.
-- Drop old constraint and re-add with four-way check.
ALTER TABLE inventory_movement DROP CONSTRAINT ck_inventory_movement_one_cause;

ALTER TABLE inventory_movement
  ADD CONSTRAINT ck_inventory_movement_one_cause
    CHECK (num_nonnulls(stock_adjustment_line_id, sale_line_id, customer_return_line_id, stock_count_line_id) = 1);

COMMENT ON CONSTRAINT ck_inventory_movement_one_cause ON inventory_movement IS
  'Cites: BI-03. Every movement has exactly one document-line cause.';

-- 5. StockCount state-machine states and edges -----------------------------------

INSERT INTO state_machine_state
  (machine, state, is_initial, creation_audit_event_type, creation_permission_rule, creation_permission_key)
VALUES
  ('StockCount', 'Open',      true,  'Inventory.CountStateChange', 'Key', 'Inventory.Count.Create'),
  ('StockCount', 'Posted',    false, NULL, NULL, NULL),
  ('StockCount', 'Cancelled', false, NULL, NULL, NULL),
  ('StockCount', 'Reversed',  false, NULL, NULL, NULL);

INSERT INTO state_machine_edge
  (machine, from_state, event, to_state, permission_rule, permission_key, requires_reason, audit_event_type)
VALUES
  ('StockCount', 'Open',   'post',    'Posted',    'Key', 'Inventory.Count.Post',   true,  'Inventory.Adjustment'),
  ('StockCount', 'Posted', 'reverse', 'Reversed',  'Key', 'Inventory.Count.Post',   true,  'Inventory.Adjustment'),
  ('StockCount', 'Open',   'cancel',  'Cancelled', 'Key', 'Inventory.Count.Create', true,  'Inventory.CountStateChange');

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'Migrations are forward-only and are never rolled back (docs/database/CONVENTIONS.md s14).'; END $$;
