-- migrate:up

-- Stock Transfer domain: two-step transit flow with TRANSFER_OUT/IN movement pairs
-- (IV-39..IV-45, SM-77, SM-77a, RT-078..RT-080, OQ-039).
-- Three edges (approve, close, reject) are OPEN DECISION (OQ-039): they are registered
-- as OpenDecision and refuse everyone until the owner names a permission key.

-- 1. stock_transfer header -------------------------------------------------------

CREATE TABLE stock_transfer (
  id                    uuid          DEFAULT gen_random_uuid() NOT NULL,
  store_id              uuid          NOT NULL,
  organization_id       uuid          NOT NULL,
  document_number       integer       GENERATED ALWAYS AS IDENTITY,
  from_location_id      uuid          NOT NULL,
  to_location_id        uuid          NOT NULL,
  transit_location_id   uuid          NOT NULL,
  status                text          NOT NULL DEFAULT 'Draft',
  note                  nonblank_text,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  created_by            uuid          NOT NULL,
  submitted_at          timestamptz,
  submitted_by          uuid,
  approved_at           timestamptz,
  approved_by           uuid,
  dispatched_at         timestamptz,
  dispatched_by         uuid,
  received_at           timestamptz,
  received_by           uuid,
  status_changed_at     timestamptz   NOT NULL DEFAULT now(),
  status_changed_by     uuid          NOT NULL,

  CONSTRAINT pk_stock_transfer PRIMARY KEY (id),
  CONSTRAINT uq_stock_transfer_doc_number UNIQUE (organization_id, document_number),
  CONSTRAINT ck_stock_transfer_status CHECK (status IN (
    'Draft','PendingApproval','Approved','InTransit','PartiallyReceived','Received','Closed','Rejected','Cancelled'
  )),
  CONSTRAINT ck_stock_transfer_from_ne_to CHECK (from_location_id <> to_location_id),
  CONSTRAINT ck_stock_transfer_from_ne_transit CHECK (from_location_id <> transit_location_id),
  CONSTRAINT ck_stock_transfer_to_ne_transit CHECK (to_location_id <> transit_location_id),
  CONSTRAINT ck_stock_transfer_submitted CHECK ((submitted_at IS NULL) = (submitted_by IS NULL)),
  CONSTRAINT ck_stock_transfer_submitted_when CHECK (
    status IN ('Draft','Cancelled') OR submitted_by IS NOT NULL),
  CONSTRAINT ck_stock_transfer_approved CHECK ((approved_at IS NULL) = (approved_by IS NULL)),
  CONSTRAINT ck_stock_transfer_approved_when CHECK (
    status IN ('Draft','PendingApproval','Cancelled','Rejected') OR approved_by IS NOT NULL),
  CONSTRAINT ck_stock_transfer_dispatched CHECK ((dispatched_at IS NULL) = (dispatched_by IS NULL)),
  CONSTRAINT ck_stock_transfer_dispatched_when CHECK (
    status IN ('Draft','PendingApproval','Approved','Cancelled','Rejected') OR dispatched_by IS NOT NULL),
  CONSTRAINT ck_stock_transfer_received CHECK ((received_at IS NULL) = (received_by IS NULL)),
  CONSTRAINT ck_stock_transfer_received_when CHECK (
    status IN ('Draft','PendingApproval','Approved','InTransit','PartiallyReceived','Cancelled','Rejected') OR received_by IS NOT NULL),
  CONSTRAINT ck_stock_transfer_sep_approve CHECK (
    approved_by IS NULL OR approved_by <> created_by),
  CONSTRAINT ck_stock_transfer_sep_dispatch_receive CHECK (
    dispatched_by IS NULL OR received_by IS NULL OR dispatched_by <> received_by),

  CONSTRAINT fk_stock_transfer_store FOREIGN KEY (store_id) REFERENCES store(id),
  CONSTRAINT fk_stock_transfer_org FOREIGN KEY (organization_id) REFERENCES organization(id),
  CONSTRAINT fk_stock_transfer_created_by FOREIGN KEY (created_by) REFERENCES employee(id),
  CONSTRAINT fk_stock_transfer_submitted_by FOREIGN KEY (submitted_by) REFERENCES employee(id),
  CONSTRAINT fk_stock_transfer_approved_by FOREIGN KEY (approved_by) REFERENCES employee(id),
  CONSTRAINT fk_stock_transfer_dispatched_by FOREIGN KEY (dispatched_by) REFERENCES employee(id),
  CONSTRAINT fk_stock_transfer_received_by FOREIGN KEY (received_by) REFERENCES employee(id),
  CONSTRAINT fk_stock_transfer_status_changed_by FOREIGN KEY (status_changed_by) REFERENCES employee(id),
  CONSTRAINT fk_stock_transfer_from_loc FOREIGN KEY (from_location_id) REFERENCES storage_location(id),
  CONSTRAINT fk_stock_transfer_to_loc FOREIGN KEY (to_location_id) REFERENCES storage_location(id),
  CONSTRAINT fk_stock_transfer_transit_loc FOREIGN KEY (transit_location_id) REFERENCES storage_location(id)
);

COMMENT ON TABLE stock_transfer IS
  'Cites: IV-39, IV-40, IV-41, IV-42, IV-43, IV-44, IV-45, RT-078, RT-079, RT-080, SM-77. '
  'Two-step stock transfer through a Transit location. '
  'Dispatch writes TRANSFER_OUT from source and TRANSFER_IN to Transit; receipt writes the inverse pair.';

COMMENT ON CONSTRAINT uq_stock_transfer_doc_number ON stock_transfer IS
  'Cites: IV-39. Transfer document numbers are unique within an organization.';
COMMENT ON CONSTRAINT ck_stock_transfer_status ON stock_transfer IS
  'Cites: SM-77. Only the states declared by the machine are valid.';
COMMENT ON CONSTRAINT ck_stock_transfer_from_ne_to ON stock_transfer IS
  'Cites: IV-39. A transfer moves stock between distinct locations.';
COMMENT ON CONSTRAINT ck_stock_transfer_from_ne_transit ON stock_transfer IS
  'Cites: IV-39. The source and transit locations must be different.';
COMMENT ON CONSTRAINT ck_stock_transfer_to_ne_transit ON stock_transfer IS
  'Cites: IV-39. The destination and transit locations must be different.';
COMMENT ON CONSTRAINT ck_stock_transfer_submitted ON stock_transfer IS
  'Cites: IV-43. submitted_at and submitted_by are set together on submission.';
COMMENT ON CONSTRAINT ck_stock_transfer_submitted_when ON stock_transfer IS
  'Cites: IV-43. A submitted_by actor is required once past Draft.';
COMMENT ON CONSTRAINT ck_stock_transfer_approved ON stock_transfer IS
  'Cites: IV-43. approved_at and approved_by are set together on approval.';
COMMENT ON CONSTRAINT ck_stock_transfer_approved_when ON stock_transfer IS
  'Cites: IV-43. An approved_by actor is required once past PendingApproval.';
COMMENT ON CONSTRAINT ck_stock_transfer_dispatched ON stock_transfer IS
  'Cites: IV-40. dispatched_at and dispatched_by are set together on dispatch.';
COMMENT ON CONSTRAINT ck_stock_transfer_dispatched_when ON stock_transfer IS
  'Cites: IV-40. A dispatched_by actor is required once the transfer is in transit.';
COMMENT ON CONSTRAINT ck_stock_transfer_received ON stock_transfer IS
  'Cites: IV-41. received_at and received_by are set together on receipt.';
COMMENT ON CONSTRAINT ck_stock_transfer_received_when ON stock_transfer IS
  'Cites: IV-41. A received_by actor is required once the transfer is received.';
COMMENT ON CONSTRAINT ck_stock_transfer_sep_approve ON stock_transfer IS
  'Cites: IV-42. Approver must be a different person than the creator.';
COMMENT ON CONSTRAINT ck_stock_transfer_sep_dispatch_receive ON stock_transfer IS
  'Cites: IV-42, RT-080. Dispatcher and receiver must be different people.';
COMMENT ON CONSTRAINT fk_stock_transfer_store ON stock_transfer IS
  'Cites: IV-39. Each transfer belongs to one store.';
COMMENT ON CONSTRAINT fk_stock_transfer_org ON stock_transfer IS
  'Cites: IV-39. Each transfer belongs to one organization.';
COMMENT ON CONSTRAINT fk_stock_transfer_created_by ON stock_transfer IS
  'Cites: IV-39. The employee who created the draft.';
COMMENT ON CONSTRAINT fk_stock_transfer_submitted_by ON stock_transfer IS
  'Cites: IV-43. The employee who submitted the transfer for approval.';
COMMENT ON CONSTRAINT fk_stock_transfer_approved_by ON stock_transfer IS
  'Cites: IV-43. The employee who approved the transfer.';
COMMENT ON CONSTRAINT fk_stock_transfer_dispatched_by ON stock_transfer IS
  'Cites: IV-40. The employee who dispatched the transfer.';
COMMENT ON CONSTRAINT fk_stock_transfer_received_by ON stock_transfer IS
  'Cites: IV-41. The employee who received the transfer.';
COMMENT ON CONSTRAINT fk_stock_transfer_status_changed_by ON stock_transfer IS
  'Cites: SM-77. The last employee to change this transfer''s status.';
COMMENT ON CONSTRAINT fk_stock_transfer_from_loc ON stock_transfer IS
  'Cites: IV-39. The source storage location.';
COMMENT ON CONSTRAINT fk_stock_transfer_to_loc ON stock_transfer IS
  'Cites: IV-39. The destination storage location.';
COMMENT ON CONSTRAINT fk_stock_transfer_transit_loc ON stock_transfer IS
  'Cites: IV-39. The transit location goods pass through.';


-- 2. stock_transfer_line ---------------------------------------------------------

CREATE TABLE stock_transfer_line (
  id                  uuid          DEFAULT gen_random_uuid() NOT NULL,
  stock_transfer_id   uuid          NOT NULL,
  store_id            uuid          NOT NULL,
  organization_id     uuid          NOT NULL,
  variant_id          uuid          NOT NULL,
  quantity            numeric(19,4) NOT NULL,
  received_quantity   numeric(19,4) NOT NULL DEFAULT 0,
  created_at          timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT pk_stock_transfer_line PRIMARY KEY (id),
  CONSTRAINT uq_stock_transfer_line UNIQUE (stock_transfer_id, variant_id),
  CONSTRAINT ck_stock_transfer_line_qty CHECK (quantity > 0),
  CONSTRAINT ck_stock_transfer_line_received CHECK (received_quantity >= 0 AND received_quantity <= quantity),
  CONSTRAINT fk_stock_transfer_line_doc FOREIGN KEY (stock_transfer_id) REFERENCES stock_transfer(id),
  CONSTRAINT fk_stock_transfer_line_store FOREIGN KEY (store_id) REFERENCES store(id),
  CONSTRAINT fk_stock_transfer_line_org FOREIGN KEY (organization_id) REFERENCES organization(id),
  CONSTRAINT fk_stock_transfer_line_variant FOREIGN KEY (variant_id) REFERENCES product_variant(id)
);

COMMENT ON TABLE stock_transfer_line IS
  'Cites: IV-39, IV-41, RT-078. One line per variant per transfer. received_quantity tracks cumulative receipt '
  'for partial-receive support; in v1 receipt is always all-at-once (receive_all).';
COMMENT ON CONSTRAINT ck_stock_transfer_line_qty ON stock_transfer_line IS
  'Cites: IV-39. A transfer line must move at least one unit.';
COMMENT ON CONSTRAINT uq_stock_transfer_line ON stock_transfer_line IS
  'Cites: IV-39. Each variant appears at most once per transfer document.';
COMMENT ON CONSTRAINT ck_stock_transfer_line_received ON stock_transfer_line IS
  'Cites: IV-41. The received quantity never exceeds the dispatched quantity.';
COMMENT ON CONSTRAINT fk_stock_transfer_line_doc ON stock_transfer_line IS
  'Cites: IV-39. Each line belongs to one transfer.';
COMMENT ON CONSTRAINT fk_stock_transfer_line_store ON stock_transfer_line IS
  'Cites: IV-39. Each line is attributed to the transfer''s store.';
COMMENT ON CONSTRAINT fk_stock_transfer_line_org ON stock_transfer_line IS
  'Cites: IV-39. Each line is attributed to the transfer''s organization.';
COMMENT ON CONSTRAINT fk_stock_transfer_line_variant ON stock_transfer_line IS
  'Cites: IV-39. The product variant being transferred.';

-- 3. State machine data (SM-77a, IV-43) -----------------------------------------
-- States: Draft (initial), PendingApproval, Approved, InTransit, PartiallyReceived,
--         Received, Closed (terminal), Rejected (terminal), Cancelled (terminal).
-- Note: state_machine_state has no is_terminal column; terminal states are
-- identified by having no outgoing edges with a decided permission_rule.

INSERT INTO state_machine_state (machine, state, is_initial) VALUES
  ('StockTransfer', 'Draft',              true),
  ('StockTransfer', 'PendingApproval',    false),
  ('StockTransfer', 'Approved',           false),
  ('StockTransfer', 'InTransit',          false),
  ('StockTransfer', 'PartiallyReceived',  false),
  ('StockTransfer', 'Received',           false),
  ('StockTransfer', 'Closed',             false),
  ('StockTransfer', 'Rejected',           false),
  ('StockTransfer', 'Cancelled',          false);

-- Creation event type and permission for the Draft state
UPDATE state_machine_state
SET creation_audit_event_type = 'Inventory.TransferStateChange',
    creation_permission_rule   = 'Key',
    creation_permission_key    = 'Inventory.Transfer.Create'
WHERE machine = 'StockTransfer' AND state = 'Draft';

-- Edges with decided permission keys (using from_state/to_state column names)
INSERT INTO state_machine_edge (machine, from_state, event, to_state, permission_rule, permission_key, requires_reason, audit_event_type) VALUES
  ('StockTransfer', 'Draft',             'submit',       'PendingApproval', 'Key',          'Inventory.Transfer.Create',   false, 'Approval.Decided'),
  ('StockTransfer', 'Approved',          'dispatch',     'InTransit',       'Key',          'Inventory.Transfer.Dispatch', false, 'Inventory.Movement'),
  ('StockTransfer', 'InTransit',         'receive_all',  'Received',        'Key',          'Inventory.Transfer.Receive',  false, 'Inventory.Movement'),
  ('StockTransfer', 'PartiallyReceived', 'receive_all',  'Received',        'Key',          'Inventory.Transfer.Receive',  false, 'Inventory.Movement'),
  ('StockTransfer', 'Draft',             'cancel',       'Cancelled',       'Key',          'Inventory.Transfer.Create',   false, 'Inventory.TransferStateChange');

-- Edges with OPEN DECISION keys (OQ-039 — refuse everyone until the owner names them)
INSERT INTO state_machine_edge (machine, from_state, event, to_state, permission_rule, permission_key, requires_reason, audit_event_type) VALUES
  ('StockTransfer', 'PendingApproval',   'approve',      'Approved',        'OpenDecision', NULL, false, 'Approval.Decided'),
  ('StockTransfer', 'Received',          'close',        'Closed',          'OpenDecision', NULL, false, 'Inventory.TransferStateChange'),
  ('StockTransfer', 'PartiallyReceived', 'close',        'Closed',          'OpenDecision', NULL, false, 'Inventory.TransferStateChange'),
  ('StockTransfer', 'PendingApproval',   'reject',       'Rejected',        'OpenDecision', NULL, false, 'Approval.Decided');

-- 4. inventory_movement extensions (BI-03, IV-39) --------------------------------

ALTER TABLE inventory_movement
  ADD COLUMN stock_transfer_id      uuid,
  ADD COLUMN stock_transfer_line_id uuid;

ALTER TABLE inventory_movement
  ADD CONSTRAINT ck_inventory_movement_transfer_pair
    CHECK ((stock_transfer_id IS NULL) = (stock_transfer_line_id IS NULL));

COMMENT ON CONSTRAINT ck_inventory_movement_transfer_pair ON inventory_movement IS
  'Cites: BI-03. A transfer movement names both the document and its line together.';

-- Drop and re-add the one-cause constraint to include the transfer line (BI-03, IV-39)
ALTER TABLE inventory_movement DROP CONSTRAINT ck_inventory_movement_one_cause;
ALTER TABLE inventory_movement ADD CONSTRAINT ck_inventory_movement_one_cause
  CHECK (num_nonnulls(stock_adjustment_line_id, sale_line_id, customer_return_line_id, stock_count_line_id, stock_transfer_line_id) = 1);

COMMENT ON CONSTRAINT ck_inventory_movement_one_cause ON inventory_movement IS
  'Cites: BI-03. Every movement has exactly one document-line cause.';

ALTER TABLE inventory_movement
  ADD CONSTRAINT fk_inventory_movement_transfer
    FOREIGN KEY (stock_transfer_id) REFERENCES stock_transfer(id),
  ADD CONSTRAINT fk_inventory_movement_transfer_line
    FOREIGN KEY (stock_transfer_line_id) REFERENCES stock_transfer_line(id);

COMMENT ON CONSTRAINT fk_inventory_movement_transfer ON inventory_movement IS
  'Cites: BI-03, IV-39. The transfer this movement was posted from.';
COMMENT ON CONSTRAINT fk_inventory_movement_transfer_line ON inventory_movement IS
  'Cites: BI-03, IV-39. The transfer line this movement was posted from.';

CREATE INDEX ix_inventory_movement_transfer ON inventory_movement (stock_transfer_id)
  WHERE stock_transfer_id IS NOT NULL;

COMMENT ON INDEX ix_inventory_movement_transfer IS
  'Cites: IV-39, RT-079. Finds all movements of a transfer (in-transit report, balance check).';

-- 5. Triggers --------------------------------------------------------------------

CREATE FUNCTION stamp_stock_transfer_dates() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    CASE NEW.status
      WHEN 'PendingApproval' THEN NEW.submitted_at  := now();
      WHEN 'Approved'        THEN NEW.approved_at   := now();
      WHEN 'InTransit'       THEN NEW.dispatched_at := now();
      WHEN 'Received'        THEN NEW.received_at   := now();
      ELSE NULL;
    END CASE;
  END IF;
  -- Freeze actor columns once set (SM-03, AU-05)
  IF OLD.submitted_by  IS NOT NULL AND NEW.submitted_by  IS DISTINCT FROM OLD.submitted_by  THEN
    RAISE EXCEPTION 'stock transfer submitter cannot be rewritten' USING ERRCODE = 'SS001';
  END IF;
  IF OLD.approved_by   IS NOT NULL AND NEW.approved_by   IS DISTINCT FROM OLD.approved_by   THEN
    RAISE EXCEPTION 'stock transfer approver cannot be rewritten' USING ERRCODE = 'SS001';
  END IF;
  IF OLD.dispatched_by IS NOT NULL AND NEW.dispatched_by IS DISTINCT FROM OLD.dispatched_by THEN
    RAISE EXCEPTION 'stock transfer dispatcher cannot be rewritten' USING ERRCODE = 'SS001';
  END IF;
  IF OLD.received_by   IS NOT NULL AND NEW.received_by   IS DISTINCT FROM OLD.received_by   THEN
    RAISE EXCEPTION 'stock transfer receiver cannot be rewritten' USING ERRCODE = 'SS001';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION stamp_stock_transfer_dates() IS
  'Cites: SM-03, IV-39, IV-42, AU-05. Stamps submitted_at/approved_at/dispatched_at/received_at on status '
  'change; freezes the corresponding _by columns once set.';

CREATE TRIGGER tg_stock_transfer_dates BEFORE UPDATE OF status ON stock_transfer
  FOR EACH ROW EXECUTE FUNCTION stamp_stock_transfer_dates();

COMMENT ON TRIGGER tg_stock_transfer_dates ON stock_transfer IS
  'Cites: SM-03, IV-42. Timestamps transition moments and prevents actor rewrites.';

CREATE TRIGGER tg_stock_transfer_status_stamp BEFORE UPDATE OF status ON stock_transfer
  FOR EACH ROW EXECUTE FUNCTION stamp_status_change();

COMMENT ON TRIGGER tg_stock_transfer_status_stamp ON stock_transfer IS
  'Cites: SM-03, RT-353. Server time for each status change.';

CREATE TRIGGER tg_stock_transfer_state_machine BEFORE INSERT OR UPDATE OF status ON stock_transfer
  FOR EACH ROW EXECUTE FUNCTION enforce_state_transition('StockTransfer', 'status');

COMMENT ON TRIGGER tg_stock_transfer_state_machine ON stock_transfer IS
  'Cites: SM-02, SM-06, IV-43, SM-77a. Only the edges in state_machine_edge are valid.';

CREATE TRIGGER tg_stock_transfer_audit AFTER INSERT OR UPDATE OF status ON stock_transfer
  FOR EACH ROW EXECUTE FUNCTION audit_state_transition('StockTransfer');

COMMENT ON TRIGGER tg_stock_transfer_audit ON stock_transfer IS
  'Cites: AU-01, AU-12, D-06. Records Inventory.TransferStateChange and Inventory.Movement (dispatch/receive).';

CREATE INDEX ix_stock_transfer_line_transfer ON stock_transfer_line (stock_transfer_id);

COMMENT ON INDEX ix_stock_transfer_line_transfer IS
  'Cites: IV-39. Finds all lines of a transfer for dispatch/receive.';

CREATE INDEX ix_stock_transfer_store ON stock_transfer (store_id, document_number DESC);

COMMENT ON INDEX ix_stock_transfer_store IS
  'Cites: IV-39. Transfer listing per store, newest first.';

-- 6. Runtime permissions for smartstore_app --------------------------------------

GRANT SELECT ON stock_transfer TO smartstore_app;
GRANT INSERT (id, store_id, organization_id, from_location_id, to_location_id, transit_location_id, note, created_by, status_changed_by)
  ON stock_transfer TO smartstore_app;
GRANT UPDATE (status, status_changed_by, submitted_by, approved_by, dispatched_by, received_by)
  ON stock_transfer TO smartstore_app;

GRANT SELECT ON stock_transfer_line TO smartstore_app;
GRANT INSERT (id, stock_transfer_id, store_id, organization_id, variant_id, quantity)
  ON stock_transfer_line TO smartstore_app;
GRANT UPDATE (received_quantity) ON stock_transfer_line TO smartstore_app;
GRANT DELETE ON stock_transfer_line TO smartstore_app;

-- Extend the existing column-level INSERT grant on inventory_movement (BI-03, IV-39)
GRANT INSERT (stock_transfer_id, stock_transfer_line_id) ON inventory_movement TO smartstore_app;

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'Migrations are forward-only and are never rolled back (docs/database/CONVENTIONS.md s14).'; END $$;
