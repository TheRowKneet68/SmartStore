-- migrate:up

-- Domain 6: Audit.
-- Design, citations and decisions: docs/database/D6-AUDIT.md

-- ============================================================================ the closed vocabulary (AU-11, AU-12, D-06)

CREATE TABLE audit_event_type (
  code       nonblank_text NOT NULL,
  origin     text          NOT NULL,
  created_at timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT pk_audit_event_type PRIMARY KEY (code),
  CONSTRAINT ck_audit_event_type_origin CHECK (origin IN ('Database', 'Application'))
);

COMMENT ON TABLE audit_event_type IS
  'Cites: AU-11, AU-12, AU-12b, AU-12c, AU-13, D-06, RT-465. The closed, versioned event vocabulary. A type is added only by a migration, and only when a rule requires the event. Database types are written by the schema''s own triggers as part of the change; Application types (sign-in, export and the like) are recorded by the application through record_audit_event().';
COMMENT ON CONSTRAINT ck_audit_event_type_origin ON audit_event_type IS
  'Cites: AU-01, AU-05. Whether the database writes the event itself, in the transaction of the change, or the application records it.';

INSERT INTO audit_event_type (code, origin) VALUES
  -- AU-12
  ('Inventory.Movement', 'Database'),
  ('Inventory.Adjustment', 'Database'),
  ('Inventory.FEFOOverride', 'Database'),
  ('Payment.Capture', 'Database'),
  ('Payment.Refund', 'Database'),
  ('Payment.Provider.Configure', 'Application'),
  ('Cash.PayOut', 'Database'),
  ('Sale.Void', 'Database'),
  ('Shift.Close', 'Database'),
  ('Price.Change', 'Database'),
  ('Security.Login', 'Application'),
  ('Security.Logout', 'Application'),
  ('Security.SessionEnded', 'Application'),
  ('Security.LoginFailed', 'Application'),
  ('Security.PermissionDenied', 'Application'),
  ('Security.Role.Assign', 'Application'),
  ('Security.Impersonate', 'Application'),
  ('Data.Export', 'Application'),
  ('Offline.SyncApplied', 'Application'),
  ('Offline.SyncAppliedWithAdjustment', 'Application'),
  ('Offline.SyncRejected', 'Application'),
  ('Approval.Decided', 'Database'),
  ('Notification.Sent', 'Application'),
  ('Product.Archive', 'Database'),
  ('Employee.Terminate', 'Database'),
  ('Audit.EventExpired', 'Application'),
  -- D-06
  ('Product.StateChange', 'Database'),
  ('Inventory.BatchStateChange', 'Database'),
  ('Purchase.OrderStateChange', 'Database'),
  ('Purchase.ReceiptStateChange', 'Database'),
  ('Purchase.InvoiceStateChange', 'Database'),
  ('Purchase.PayableCreated', 'Database'),
  ('Purchase.PayableSettled', 'Database'),
  ('Sale.Completed', 'Database'),
  ('Return.StateChange', 'Database'),
  ('Refund.StateChange', 'Database'),
  ('Customer.StateChange', 'Database'),
  ('Employee.StateChange', 'Database'),
  ('Payment.StateChange', 'Database'),
  ('Shift.StateChange', 'Database'),
  ('Shift.Reopened', 'Database'),
  ('Device.ModeChange', 'Database'),
  ('Device.StateChange', 'Database'),
  ('Inventory.CountStateChange', 'Database'),
  ('Inventory.TransferStateChange', 'Database'),
  ('Rfid.Credential.StateChange', 'Database'),
  -- state-machines s22.11: opening a shift records Cash.In (OQ-024: AU-12 omits it)
  ('Cash.In', 'Database');

-- ============================================================================ the event (audit-domain s2)

CREATE TABLE audit_event (
  seq                 bigint        GENERATED ALWAYS AS IDENTITY,
  id                  uuid          NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid          NOT NULL,
  store_id            uuid,
  occurred_at         timestamptz   NOT NULL DEFAULT now(),
  event_type          text          NOT NULL,
  entity_type         nonblank_text NOT NULL,
  entity_id           uuid,
  actor_id            uuid,
  effective_actor_id  uuid,
  role_used           nonblank_text,
  source              text          NOT NULL,
  terminal_id         uuid,
  correlation_id      uuid          NOT NULL,
  client_operation_id uuid,
  ip_address          inet,
  reason_code_id      uuid,
  before              jsonb,
  after               jsonb,
  CONSTRAINT pk_audit_event PRIMARY KEY (id),
  CONSTRAINT uq_audit_event_seq UNIQUE (seq),
  CONSTRAINT fk_audit_event_organization FOREIGN KEY (organization_id) REFERENCES organization (id),
  CONSTRAINT fk_audit_event_store FOREIGN KEY (store_id, organization_id) REFERENCES store (id, organization_id),
  CONSTRAINT fk_audit_event_type FOREIGN KEY (event_type) REFERENCES audit_event_type (code),
  CONSTRAINT fk_audit_event_reason FOREIGN KEY (reason_code_id, organization_id) REFERENCES reason_code (id, organization_id),
  CONSTRAINT ck_audit_event_actor CHECK (actor_id IS NOT NULL OR event_type = 'Security.LoginFailed'),
  CONSTRAINT ck_audit_event_impersonation CHECK (effective_actor_id IS NULL OR effective_actor_id <> actor_id),
  CONSTRAINT ck_audit_event_source CHECK (source IN ('UI', 'API', 'Job', 'Device', 'OfflineSync', 'Terminal'))
);

CREATE INDEX ix_audit_event_store_time ON audit_event (organization_id, store_id, occurred_at);
CREATE INDEX ix_audit_event_entity ON audit_event (entity_id);

COMMENT ON TABLE audit_event IS
  'Cites: AU-01, AU-02, AU-04, AU-07, AU-08, AU-10, BI-24, RT-290, RT-291, RT-464. One audit event, written in the same transaction as the change it records and never updated or deleted by any role. Organization-global with the store on it when the entity has one (MS-29).';
COMMENT ON CONSTRAINT uq_audit_event_seq ON audit_event IS
  'Cites: AU-01. The order events were written in.';
COMMENT ON CONSTRAINT fk_audit_event_organization ON audit_event IS
  'Cites: MS-29. The log is global within the organization.';
COMMENT ON CONSTRAINT fk_audit_event_store ON audit_event IS
  'Cites: AU-07, MS-29. The store of the affected entity, in the same organization, so the log filters by store without a join.';
COMMENT ON CONSTRAINT fk_audit_event_type ON audit_event IS
  'Cites: AU-11, RT-465. A free-text or placeholder event type is refused.';
COMMENT ON CONSTRAINT fk_audit_event_reason ON audit_event IS
  'Cites: BI-25. A reason is a reason code of the organization.';
COMMENT ON CONSTRAINT ck_audit_event_actor ON audit_event IS
  'Cites: AU-05, RT-293. Every event names the authenticated actor; only a failed sign-in, which by definition has none, may not.';
COMMENT ON CONSTRAINT ck_audit_event_impersonation ON audit_event IS
  'Cites: AU-06, RT-294. Under impersonation both principals are recorded, and they differ.';
COMMENT ON CONSTRAINT ck_audit_event_source ON audit_event IS
  'Cites: AU-10. Where the change came from: UI, API, job, device, offline sync, or terminal (audit-domain s2).';
COMMENT ON INDEX ix_audit_event_store_time IS
  'Cites: MS-29, AU-27. The store-filtered, time-ordered read an investigation starts from.';
COMMENT ON INDEX ix_audit_event_entity IS
  'Cites: AU-10, AU-28. Everything that happened to one entity.';

CREATE TRIGGER tg_audit_event_immutable BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_rewrite();
COMMENT ON TRIGGER tg_audit_event_immutable ON audit_event IS
  'Cites: AU-02, BI-24, RT-291. No update and no delete on an audit event, at any privilege.';

CREATE TRIGGER tg_audit_event_no_truncate BEFORE TRUNCATE ON audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_ledger_rewrite();
COMMENT ON TRIGGER tg_audit_event_no_truncate ON audit_event IS
  'Cites: AU-32, RT-291. The log cannot be emptied in bulk.';

-- ============================================================================ the authenticated context (AU-05, AU-06, AU-10)

-- The application sets these per transaction with set_config(name, value, true), from the authenticated session:
--   smartstore.actor_id (required), smartstore.source (required), smartstore.correlation_id (required),
--   smartstore.effective_actor_id, smartstore.role, smartstore.terminal_id, smartstore.client_operation_id,
--   smartstore.ip_address, smartstore.reason_code_id.
CREATE FUNCTION audit_setting(p_name text) RETURNS text
  LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('smartstore.' || p_name, true), '')
$$;

COMMENT ON FUNCTION audit_setting(text) IS
  'Cites: AU-05, AU-10. One value of the request context the application set for this transaction, or null.';

CREATE FUNCTION write_audit_event(
  p_event_type  text,
  p_entity_type text,
  p_old         jsonb,
  p_new         jsonb,
  p_needs_reason boolean
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor  uuid := audit_setting('actor_id')::uuid;
  v_source text := audit_setting('source');
  v_corr   uuid := audit_setting('correlation_id')::uuid;
  v_store  uuid := (p_new ->> 'store_id')::uuid;
  v_org    uuid := (p_new ->> 'organization_id')::uuid;
  v_reason uuid;
  v_before jsonb;
  v_after  jsonb;
BEGIN
  IF v_actor IS NULL OR v_source IS NULL OR v_corr IS NULL THEN
    RAISE EXCEPTION 'an audited change needs the authenticated actor, the source and the correlation id'
      USING ERRCODE = 'SS054';
  END IF;
  IF v_org IS NULL THEN
    SELECT organization_id INTO v_org FROM store WHERE id = v_store;
  END IF;

  v_reason := coalesce((p_new ->> 'cancel_reason_code_id')::uuid, (p_new ->> 'late_reason_code_id')::uuid,
                       (p_new ->> 'reason_code_id')::uuid);
  IF v_reason IS NULL AND p_needs_reason THEN
    v_reason := audit_setting('reason_code_id')::uuid;
    IF v_reason IS NULL THEN
      RAISE EXCEPTION '% needs a reason', p_event_type USING ERRCODE = 'SS055';
    END IF;
    PERFORM assert_reason_code_live(v_reason);
  END IF;

  IF p_old IS NULL THEN
    v_after := p_new;
  ELSE
    SELECT jsonb_object_agg(k, p_old -> k), jsonb_object_agg(k, p_new -> k) INTO v_before, v_after
    FROM jsonb_object_keys(p_new) AS k WHERE p_old -> k IS DISTINCT FROM p_new -> k;
  END IF;

  INSERT INTO audit_event (organization_id, store_id, event_type, entity_type, entity_id, actor_id, effective_actor_id,
                           role_used, source, terminal_id, correlation_id, client_operation_id, ip_address,
                           reason_code_id, before, after)
  VALUES (v_org, v_store, p_event_type, p_entity_type, (p_new ->> 'id')::uuid, v_actor,
          audit_setting('effective_actor_id')::uuid, audit_setting('role'), v_source, audit_setting('terminal_id')::uuid,
          v_corr, audit_setting('client_operation_id')::uuid, audit_setting('ip_address')::inet, v_reason, v_before,
          v_after);
END
$$;

COMMENT ON FUNCTION write_audit_event(text, text, jsonb, jsonb, boolean) IS
  'Cites: AU-01, AU-04, AU-05, AU-06, AU-07, AU-08, AU-10, RT-290, RT-293, RT-464. Writes one event in the transaction of the change: the actor, source and correlation id from the authenticated context, refusing the change without them; the store and organization from the entity; the reason from the entity or the context, refusing a transition that needs one without it; the whole created row, or only the fields that changed.';

REVOKE EXECUTE ON FUNCTION write_audit_event(text, text, jsonb, jsonb, boolean) FROM PUBLIC;

-- ============================================================================ state transitions (state-machines s22, Audit column)

ALTER TABLE state_machine_state ADD COLUMN creation_audit_event_type text;
ALTER TABLE state_machine_state ADD CONSTRAINT fk_state_machine_state_audit_type
  FOREIGN KEY (creation_audit_event_type) REFERENCES audit_event_type (code);
ALTER TABLE state_machine_edge ADD COLUMN audit_event_type text;
ALTER TABLE state_machine_edge ADD COLUMN requires_reason boolean NOT NULL DEFAULT false;
ALTER TABLE state_machine_edge ADD CONSTRAINT fk_state_machine_edge_audit_type
  FOREIGN KEY (audit_event_type) REFERENCES audit_event_type (code);

COMMENT ON CONSTRAINT fk_state_machine_state_audit_type ON state_machine_state IS
  'Cites: AU-12, D-06. The event a creation records, from the s22 Audit column; null where the contract records none.';
COMMENT ON CONSTRAINT fk_state_machine_edge_audit_type ON state_machine_edge IS
  'Cites: AU-12, D-06, SM-02. The event an edge records, from the s22 Audit column; null where the contract records none or another row records it.';

UPDATE state_machine_edge SET audit_event_type = 'Product.StateChange' WHERE machine = 'Product' AND event = 'activate';
UPDATE state_machine_edge SET audit_event_type = 'Product.StateChange', requires_reason = true
  WHERE machine = 'Product' AND event IN ('discontinue', 'reactivate', 'hide', 'unhide');
UPDATE state_machine_edge SET audit_event_type = 'Product.Archive', requires_reason = true
  WHERE machine = 'Product' AND event = 'archive';

UPDATE state_machine_edge SET audit_event_type = 'Approval.Decided' WHERE machine = 'StockAdjustment' AND event = 'approve';
UPDATE state_machine_edge SET audit_event_type = 'Inventory.Adjustment', requires_reason = true
  WHERE machine = 'StockAdjustment' AND event IN ('post', 'cancel', 'reverse');

UPDATE state_machine_state SET creation_audit_event_type = 'Sale.Completed' WHERE machine = 'Sale' AND state = 'Completed';
UPDATE state_machine_edge SET audit_event_type = 'Sale.Void', requires_reason = true WHERE machine = 'Sale' AND event = 'void';

UPDATE state_machine_state SET creation_audit_event_type = 'Payment.StateChange' WHERE machine = 'Payment' AND state = 'Pending';
UPDATE state_machine_edge SET audit_event_type = 'Payment.StateChange'
  WHERE machine = 'Payment' AND event IN ('authorize', 'void', 'decline', 'fail');
UPDATE state_machine_edge SET audit_event_type = 'Payment.Capture' WHERE machine = 'Payment' AND event = 'capture';

UPDATE state_machine_edge SET audit_event_type = 'Shift.StateChange' WHERE machine = 'Shift' AND event = 'begin count';
UPDATE state_machine_edge SET audit_event_type = 'Shift.Close' WHERE machine = 'Shift' AND event IN ('close', 'recount');

UPDATE state_machine_state SET creation_audit_event_type = 'Device.StateChange' WHERE machine = 'Device' AND state = 'Registered';
UPDATE state_machine_edge SET audit_event_type = 'Device.StateChange'
  WHERE machine = 'Device' AND from_state = 'Registered' AND to_state = 'Active';
UPDATE state_machine_edge SET audit_event_type = 'Device.StateChange', requires_reason = true
  WHERE machine = 'Device' AND (event IN ('disable', 'retire') OR (from_state = 'Disabled' AND to_state = 'Active'));

UPDATE state_machine_edge SET audit_event_type = 'Return.StateChange', requires_reason = true
  WHERE machine = 'CustomerReturn' AND event = 'cancel';

UPDATE state_machine_edge SET audit_event_type = 'Approval.Decided' WHERE machine = 'Refund' AND event = 'approve';
UPDATE state_machine_edge SET audit_event_type = 'Payment.Refund' WHERE machine = 'Refund' AND event IN ('complete', 'fail');
UPDATE state_machine_edge SET audit_event_type = 'Refund.StateChange', requires_reason = true
  WHERE machine = 'Refund' AND event = 'cancel';
-- Recorded by other rows: the Sale return edges and the CustomerReturn post by their Inventory.Movement events; the
-- Shift creation by its opening float's Cash.In; submits and the refund's submit to provider when their state is left
-- ("on exit", s22.7, s22.17).

CREATE FUNCTION audit_state_transition() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  v_machine text := TG_ARGV[0];
  v_new     jsonb := to_jsonb(NEW);
  v_old     jsonb;
  v_type    text;
  v_reason  boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT creation_audit_event_type INTO v_type
    FROM state_machine_state WHERE machine = v_machine AND state = v_new ->> 'status';
  ELSE
    v_old := to_jsonb(OLD);
    IF v_old ->> 'status' IS NOT DISTINCT FROM v_new ->> 'status' THEN
      RETURN NULL;
    END IF;
    SELECT audit_event_type, requires_reason INTO v_type, v_reason
    FROM state_machine_edge WHERE machine = v_machine AND from_state = v_old ->> 'status' AND to_state = v_new ->> 'status';
  END IF;
  IF v_type IS NOT NULL THEN
    PERFORM write_audit_event(v_type, TG_TABLE_NAME, v_old, v_new, v_reason);
  END IF;
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION audit_state_transition() IS
  'Cites: AU-01, AU-03, AU-12, D-06, SM-02, RT-290, RT-292. Records the event the s22 contract names for a creation or an edge, in the same transaction; the event of an edge that needs a reason carries one or the change is refused.';

CREATE TRIGGER tg_product_audit AFTER INSERT OR UPDATE OF status ON product
  FOR EACH ROW EXECUTE FUNCTION audit_state_transition('Product');
CREATE TRIGGER tg_stock_adjustment_audit AFTER INSERT OR UPDATE OF status ON stock_adjustment
  FOR EACH ROW EXECUTE FUNCTION audit_state_transition('StockAdjustment');
CREATE TRIGGER tg_sale_audit AFTER INSERT OR UPDATE OF status ON sale
  FOR EACH ROW EXECUTE FUNCTION audit_state_transition('Sale');
CREATE TRIGGER tg_payment_audit AFTER INSERT OR UPDATE OF status ON payment
  FOR EACH ROW EXECUTE FUNCTION audit_state_transition('Payment');
CREATE TRIGGER tg_cash_shift_audit AFTER INSERT OR UPDATE OF status ON cash_shift
  FOR EACH ROW EXECUTE FUNCTION audit_state_transition('Shift');
CREATE TRIGGER tg_pos_terminal_audit AFTER INSERT OR UPDATE OF status ON pos_terminal
  FOR EACH ROW EXECUTE FUNCTION audit_state_transition('Device');
CREATE TRIGGER tg_customer_return_audit AFTER INSERT OR UPDATE OF status ON customer_return
  FOR EACH ROW EXECUTE FUNCTION audit_state_transition('CustomerReturn');
CREATE TRIGGER tg_refund_audit AFTER INSERT OR UPDATE OF status ON refund
  FOR EACH ROW EXECUTE FUNCTION audit_state_transition('Refund');

COMMENT ON TRIGGER tg_product_audit ON product IS
  'Cites: D-06, PR-47. Product.StateChange and Product.Archive (s22.1).';
COMMENT ON TRIGGER tg_stock_adjustment_audit ON stock_adjustment IS
  'Cites: AU-03, IV-33. Approval.Decided and Inventory.Adjustment (s22.17).';
COMMENT ON TRIGGER tg_sale_audit ON sale IS
  'Cites: SP-02, D-06. Sale.Completed at completion (s22.6).';
COMMENT ON TRIGGER tg_payment_audit ON payment IS
  'Cites: AU-03, PY-13, PY-54. Every payment state change: Payment.StateChange and Payment.Capture (s22.10).';
COMMENT ON TRIGGER tg_cash_shift_audit ON cash_shift IS
  'Cites: CD-21, SM-55. Shift.StateChange and Shift.Close (s22.11).';
COMMENT ON TRIGGER tg_pos_terminal_audit ON pos_terminal IS
  'Cites: SM-60b, HD-08. Device.StateChange (s22.12).';
COMMENT ON TRIGGER tg_customer_return_audit ON customer_return IS
  'Cites: SM-42, D-06. Return.StateChange (s22.7).';
COMMENT ON TRIGGER tg_refund_audit ON refund IS
  'Cites: AU-03, SM-40, RR-24. Approval.Decided, Payment.Refund and Refund.StateChange: every refund (s22.7).';

CREATE FUNCTION audit_device_mode() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM write_audit_event('Device.ModeChange', TG_TABLE_NAME, to_jsonb(OLD), to_jsonb(NEW), NEW.mode <> 'Training');
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION audit_device_mode() IS
  'Cites: PT-03, SM-59, D-06. A mode change records Device.ModeChange; setting Maintenance or restoring Standard needs a reason (s22.12).';

CREATE TRIGGER tg_pos_terminal_mode_audit AFTER UPDATE OF mode ON pos_terminal
  FOR EACH ROW WHEN (OLD.mode IS DISTINCT FROM NEW.mode) EXECUTE FUNCTION audit_device_mode();
COMMENT ON TRIGGER tg_pos_terminal_mode_audit ON pos_terminal IS
  'Cites: SM-59. Changing a till''s mode is audited.';

-- ============================================================================ ledger rows (the AU-03 floor)

CREATE FUNCTION audit_ledger_row() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  v_new jsonb := to_jsonb(NEW);
BEGIN
  PERFORM write_audit_event(
    CASE TG_TABLE_NAME
      WHEN 'inventory_movement' THEN 'Inventory.Movement'
      WHEN 'cash_transaction' THEN CASE v_new ->> 'direction' WHEN 'In' THEN 'Cash.In' ELSE 'Cash.PayOut' END
      ELSE 'Price.Change'
    END,
    TG_TABLE_NAME, NULL, v_new, false);
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION audit_ledger_row() IS
  'Cites: AU-03, AU-04, RT-292. Every stock movement records Inventory.Movement with its resulting balance; every cash transaction records Cash.In or Cash.PayOut by its direction; every price records Price.Change.';

CREATE TRIGGER tg_inventory_movement_audit AFTER INSERT ON inventory_movement
  FOR EACH ROW EXECUTE FUNCTION audit_ledger_row();
CREATE TRIGGER tg_cash_transaction_audit AFTER INSERT ON cash_transaction
  FOR EACH ROW EXECUTE FUNCTION audit_ledger_row();
CREATE TRIGGER tg_variant_price_audit AFTER INSERT ON variant_price
  FOR EACH ROW EXECUTE FUNCTION audit_ledger_row();
CREATE TRIGGER tg_store_variant_price_audit AFTER INSERT ON store_variant_price
  FOR EACH ROW EXECUTE FUNCTION audit_ledger_row();

COMMENT ON TRIGGER tg_inventory_movement_audit ON inventory_movement IS
  'Cites: AU-03, IV-08. Every stock movement is audited.';
COMMENT ON TRIGGER tg_cash_transaction_audit ON cash_transaction IS
  'Cites: AU-03, CD-19. Every cash transaction is audited.';
COMMENT ON TRIGGER tg_variant_price_audit ON variant_price IS
  'Cites: AU-03, PR-30. Every price change is audited.';
COMMENT ON TRIGGER tg_store_variant_price_audit ON store_variant_price IS
  'Cites: AU-03, PR-30. Every store price change is audited.';

-- ============================================================================ events the application records

CREATE FUNCTION record_audit_event(
  p_event_type      text,
  p_organization_id uuid,
  p_store_id        uuid,
  p_entity_type     text,
  p_entity_id       uuid,
  p_after           jsonb
) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := audit_setting('actor_id')::uuid;
  v_id    uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM audit_event_type WHERE code = p_event_type AND origin <> 'Application') THEN
    RAISE EXCEPTION '% is written by the database with the change it records, never by the application', p_event_type
      USING ERRCODE = 'SS056';
  END IF;
  IF (v_actor IS NULL AND p_event_type <> 'Security.LoginFailed') OR audit_setting('source') IS NULL
     OR audit_setting('correlation_id') IS NULL THEN
    RAISE EXCEPTION 'an audit event needs the authenticated actor, the source and the correlation id' USING ERRCODE = 'SS054';
  END IF;
  INSERT INTO audit_event (organization_id, store_id, event_type, entity_type, entity_id, actor_id, effective_actor_id,
                           role_used, source, terminal_id, correlation_id, client_operation_id, ip_address, after)
  VALUES (p_organization_id, p_store_id, p_event_type, p_entity_type, p_entity_id, v_actor,
          audit_setting('effective_actor_id')::uuid, audit_setting('role'), audit_setting('source'),
          audit_setting('terminal_id')::uuid, audit_setting('correlation_id')::uuid,
          audit_setting('client_operation_id')::uuid, audit_setting('ip_address')::inet, p_after)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

COMMENT ON FUNCTION record_audit_event(text, uuid, uuid, text, uuid, jsonb) IS
  'Cites: AU-03, AU-05, AU-12a, AU-14, AU-15, RT-296. The application''s only way to write an event: an Application type (sign-in, sign-out, session end, failed sign-in, denial, export and the like), with the actor and request context from the authenticated session, never from its arguments.';

-- ============================================================================ the per-organization chain (AU-29, AU-30)

CREATE TABLE audit_chain_head (
  organization_id uuid   NOT NULL,
  last_seq        bigint NOT NULL,
  last_hash       bytea  NOT NULL,
  CONSTRAINT pk_audit_chain_head PRIMARY KEY (organization_id),
  CONSTRAINT fk_audit_chain_head_organization FOREIGN KEY (organization_id) REFERENCES organization (id)
);

COMMENT ON TABLE audit_chain_head IS
  'Cites: AU-29, RT-302. The tip of an organization''s audit chain, so a removal at the end is detectable too. Written only by the linking trigger.';
COMMENT ON CONSTRAINT fk_audit_chain_head_organization ON audit_chain_head IS
  'Cites: AU-29. One chain per organization.';

CREATE TABLE audit_chain_link (
  organization_id uuid   NOT NULL,
  chain_seq       bigint NOT NULL,
  audit_event_id  uuid   NOT NULL,
  prev_hash       bytea  NOT NULL,
  hash            bytea  NOT NULL,
  CONSTRAINT pk_audit_chain_link PRIMARY KEY (organization_id, chain_seq),
  CONSTRAINT uq_audit_chain_link_event UNIQUE (audit_event_id),
  CONSTRAINT fk_audit_chain_link_organization FOREIGN KEY (organization_id) REFERENCES organization (id),
  CONSTRAINT fk_audit_chain_link_event FOREIGN KEY (audit_event_id) REFERENCES audit_event (id)
);

COMMENT ON TABLE audit_chain_link IS
  'Cites: AU-29, AU-31, RT-302, RT-467. Each event''s place in its organization''s hash chain: the previous link''s hash and the hash of that with the event''s canonical content. Append-only at every privilege.';
COMMENT ON CONSTRAINT uq_audit_chain_link_event ON audit_chain_link IS
  'Cites: AU-29. An event is linked once.';
COMMENT ON CONSTRAINT fk_audit_chain_link_organization ON audit_chain_link IS
  'Cites: AU-29. A chain is per organization.';
COMMENT ON CONSTRAINT fk_audit_chain_link_event ON audit_chain_link IS
  'Cites: AU-29, AU-32. A link names an event that exists.';

CREATE TRIGGER tg_audit_chain_link_immutable BEFORE UPDATE OR DELETE ON audit_chain_link
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_rewrite();
COMMENT ON TRIGGER tg_audit_chain_link_immutable ON audit_chain_link IS
  'Cites: AU-29, BI-24. The chain is append-only at every privilege.';

CREATE TRIGGER tg_audit_chain_link_no_truncate BEFORE TRUNCATE ON audit_chain_link
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_ledger_rewrite();
COMMENT ON TRIGGER tg_audit_chain_link_no_truncate ON audit_chain_link IS
  'Cites: AU-32. The chain cannot be emptied in bulk.';

CREATE FUNCTION audit_chain_genesis(p_organization_id uuid) RETURNS bytea
  LANGUAGE sql IMMUTABLE
AS $$
  SELECT sha256(convert_to('smartstore-audit-chain:' || p_organization_id::text, 'UTF8'))
$$;

COMMENT ON FUNCTION audit_chain_genesis(uuid) IS
  'Cites: AU-29. The hash an organization''s chain starts from.';

CREATE FUNCTION audit_event_canonical(e audit_event) RETURNS bytea
  LANGUAGE sql STABLE
AS $$
  SELECT convert_to(jsonb_build_array(
    e.id, e.organization_id, e.store_id, to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    e.event_type, e.entity_type, e.entity_id, e.actor_id, e.effective_actor_id, e.role_used, e.source, e.terminal_id,
    e.correlation_id, e.client_operation_id, host(e.ip_address), e.reason_code_id, e.before, e.after)::text, 'UTF8')
$$;

COMMENT ON FUNCTION audit_event_canonical(audit_event) IS
  'Cites: AU-29. The event''s content in one fixed, unambiguous form, independent of the session''s time zone, for hashing.';

CREATE FUNCTION link_audit_event() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  v_seq  bigint;
  v_prev bytea;
  v_hash bytea;
BEGIN
  INSERT INTO audit_chain_head (organization_id, last_seq, last_hash)
  VALUES (NEW.organization_id, 0, audit_chain_genesis(NEW.organization_id))
  ON CONFLICT (organization_id) DO NOTHING;
  SELECT last_seq, last_hash INTO v_seq, v_prev FROM audit_chain_head WHERE organization_id = NEW.organization_id FOR UPDATE;
  v_hash := sha256(v_prev || audit_event_canonical(NEW));
  INSERT INTO audit_chain_link (organization_id, chain_seq, audit_event_id, prev_hash, hash)
  VALUES (NEW.organization_id, v_seq + 1, NEW.id, v_prev, v_hash);
  UPDATE audit_chain_head SET last_seq = v_seq + 1, last_hash = v_hash WHERE organization_id = NEW.organization_id;
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION link_audit_event() IS
  'Cites: AU-29, RT-302. Links each event into its organization''s chain at commit. Linking last, after every business lock is held, means the chain head is never waited for while holding it, so it cannot deadlock with the business rows; it serialises the organization''s commits for the moment of linking.';

-- ponytail: one chain head per organization serialises that organization's commits while they link; shard the chain
-- per store if a single organization's commit rate ever needs it.
CREATE CONSTRAINT TRIGGER tg_audit_event_chain AFTER INSERT ON audit_event
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION link_audit_event();
COMMENT ON TRIGGER tg_audit_event_chain ON audit_event IS
  'Cites: AU-29. Every event is linked into the chain when its transaction commits.';

CREATE FUNCTION audit_chain_breaks(p_organization_id uuid)
  RETURNS TABLE (chain_seq bigint, audit_event_id uuid, problem text)
  LANGUAGE sql STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  WITH link AS (
    SELECT l.chain_seq, l.audit_event_id, l.prev_hash, l.hash,
           lag(l.chain_seq) OVER w AS previous_seq, lag(l.hash) OVER w AS previous_hash
    FROM audit_chain_link l
    WHERE l.organization_id = p_organization_id
    WINDOW w AS (ORDER BY l.chain_seq)
  )
  SELECT k.chain_seq, k.audit_event_id, 'a link is missing before this one'
  FROM link k WHERE k.chain_seq <> coalesce(k.previous_seq, 0) + 1
  UNION ALL
  SELECT k.chain_seq, k.audit_event_id, 'does not continue from the link before it'
  FROM link k WHERE k.prev_hash <> coalesce(k.previous_hash, audit_chain_genesis(p_organization_id))
  UNION ALL
  SELECT k.chain_seq, k.audit_event_id, 'the event was altered'
  FROM link k JOIN audit_event e ON e.id = k.audit_event_id
  WHERE k.hash <> sha256(k.prev_hash || audit_event_canonical(e))
  UNION ALL
  SELECT NULL, e.id, 'the event is not in the chain'
  FROM audit_event e
  WHERE e.organization_id = p_organization_id
    AND NOT EXISTS (SELECT 1 FROM audit_chain_link k WHERE k.audit_event_id = e.id)
  UNION ALL
  SELECT h.last_seq, NULL, 'the chain ends before its recorded head'
  FROM audit_chain_head h
  WHERE h.organization_id = p_organization_id
    AND NOT EXISTS (SELECT 1 FROM audit_chain_link l
                    WHERE l.organization_id = p_organization_id AND l.chain_seq = h.last_seq AND l.hash = h.last_hash)
$$;

COMMENT ON FUNCTION audit_chain_breaks(uuid) IS
  'Cites: AU-29, AU-30, EC-76, RT-302. Walks an organization''s chain and returns every break: a missing link, a link that does not continue from its predecessor, an altered event, an unlinked event, or an end short of the recorded head. It never repairs; an empty result is the proof, and anything else is an incident.';

-- ============================================================================ runtime role grants (ADR-11, CONVENTIONS s10)

GRANT SELECT ON audit_event_type TO smartstore_app;
GRANT SELECT ON audit_event TO smartstore_app;
-- No INSERT: events are written by the database with the change, or through record_audit_event(). No UPDATE or DELETE
-- for any role (AU-02). The chain tables are the owner's; audit_chain_breaks() reads them for the check job.

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'Migrations are forward-only and are never rolled back (docs/database/CONVENTIONS.md s14).'; END $$;
