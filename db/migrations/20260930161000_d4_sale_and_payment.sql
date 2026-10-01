-- migrate:up

-- Domain 4, part 2 of 2: checkout, payment, sale, sale lines, the sale's stock movements, shift counting and close.
-- Design, citations and decisions: docs/database/D4-SALE-PAYMENT.md

-- ============================================================================ keys later tables prove against

ALTER TABLE store_setting_version ADD CONSTRAINT uq_store_setting_version_id_store UNIQUE (id, store_id);
COMMENT ON CONSTRAINT uq_store_setting_version_id_store ON store_setting_version IS
  'Cites: REQ-AU-06, SP-33. Lets a sale prove, by foreign key, that its settings snapshot is its own store''s.';

ALTER TABLE tax_rate ADD CONSTRAINT uq_tax_rate_id_organization UNIQUE (id, organization_id);
COMMENT ON CONSTRAINT uq_tax_rate_id_organization ON tax_rate IS
  'Cites: BI-18, RT-001. Lets a sale line prove, by foreign key, that its tax rate is in its own organization.';

ALTER TABLE payment_method ADD CONSTRAINT uq_payment_method_id_organization UNIQUE (id, organization_id);
COMMENT ON CONSTRAINT uq_payment_method_id_organization ON payment_method IS
  'Cites: PY-03, BI-14. Lets a payment prove, by foreign key, that its method is in its own organization.';

ALTER TABLE cash_shift ADD CONSTRAINT uq_cash_shift_id_store UNIQUE (id, store_id);
COMMENT ON CONSTRAINT uq_cash_shift_id_store ON cash_shift IS
  'Cites: CD-20, BI-14. Lets a count prove, by foreign key, that it counts a shift of its own store.';

-- ============================================================================ price resolution (PR-30)

CREATE FUNCTION resolve_price(p_store_id uuid, p_variant_id uuid, p_at timestamptz) RETURNS bigint
  LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    (SELECT sp.amount FROM store_variant_price sp
     WHERE sp.store_id = p_store_id AND sp.variant_id = p_variant_id AND sp.effective_from <= p_at
     ORDER BY sp.effective_from DESC LIMIT 1),
    (SELECT CASE WHEN vp.currency_code = s.currency_code THEN vp.amount END
     FROM variant_price vp, store s
     WHERE s.id = p_store_id AND vp.variant_id = p_variant_id AND vp.effective_from <= p_at
     ORDER BY vp.effective_from DESC LIMIT 1))
$$;

COMMENT ON FUNCTION resolve_price(uuid, uuid, timestamptz) IS
  'Cites: PR-30, PR-31, BI-30, RT-040, RT-041. The price of a variant at a store at an instant: the store price in force, else the organization default in force if it is in the store''s currency. The one resolution rule, used by the till''s scan and by the sale line''s check.';

-- ============================================================================ checkout: settling one cart (PY-37, PY-38)

CREATE TABLE checkout (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  store_id            uuid        NOT NULL,
  pos_terminal_id     uuid        NOT NULL,
  cash_drawer_id      uuid        NOT NULL,
  cash_shift_id       uuid        NOT NULL,
  client_operation_id uuid        NOT NULL,
  currency_code       text        NOT NULL,
  status              text        NOT NULL DEFAULT 'Open',
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NOT NULL,
  closed_at           timestamptz,
  correlation_id      uuid,
  CONSTRAINT pk_checkout PRIMARY KEY (id),
  CONSTRAINT fk_checkout_shift FOREIGN KEY (cash_shift_id, cash_drawer_id, pos_terminal_id, store_id)
    REFERENCES cash_shift (id, cash_drawer_id, pos_terminal_id, store_id),
  CONSTRAINT fk_checkout_currency FOREIGN KEY (store_id, currency_code) REFERENCES store (id, currency_code),
  CONSTRAINT uq_checkout_operation UNIQUE (pos_terminal_id, client_operation_id),
  CONSTRAINT uq_checkout_id_store UNIQUE (id, store_id),
  CONSTRAINT uq_checkout_identity UNIQUE (id, cash_shift_id, cash_drawer_id, pos_terminal_id, store_id, client_operation_id),
  CONSTRAINT ck_checkout_status CHECK (status IN ('Open', 'Completed', 'Abandoned')),
  CONSTRAINT ck_checkout_closed CHECK ((status = 'Open') = (closed_at IS NULL))
);

COMMENT ON TABLE checkout IS
  'Cites: PY-37, PY-38, PY-42, PY-54, SP-43, SP-01. The settlement of one cart at one till: it holds every payment attempt, which PY-38 takes before the sale commits, and completes into at most one sale. It is not a sale: it has no number, no lines and no ledger effect (SP-01). An abandoned checkout''s captured payments are money taken for nothing and are reconciled (PY-37, PY-40).';
COMMENT ON CONSTRAINT fk_checkout_shift ON checkout IS
  'Cites: PY-46, RT-122, BI-39. A checkout happens in one open shift, whose drawer, terminal and store it shares.';
COMMENT ON CONSTRAINT fk_checkout_currency ON checkout IS
  'Cites: PY-52, BI-01. A checkout settles in the store''s single currency.';
COMMENT ON CONSTRAINT uq_checkout_operation ON checkout IS
  'Cites: BI-28, PY-39, RT-121, SM-04. The cart''s client operation id is unique per terminal, so a retried commit finds the same checkout.';
COMMENT ON CONSTRAINT uq_checkout_id_store ON checkout IS
  'Cites: RT-001, BI-14. Lets a payment prove, by foreign key, that it settles a checkout of its own store.';
COMMENT ON CONSTRAINT uq_checkout_identity ON checkout IS
  'Cites: RT-122, RT-123. Lets a sale prove, by foreign key, that its shift, drawer, terminal, store and operation id are its checkout''s.';
COMMENT ON CONSTRAINT ck_checkout_status ON checkout IS
  'Cites: SP-43, PY-17. A checkout is open until it completes into a sale or is abandoned with the cart.';
COMMENT ON CONSTRAINT ck_checkout_closed ON checkout IS
  'Cites: SM-03, RT-353. A checkout records when it closed, exactly when it closed.';

CREATE FUNCTION checkout_before_write() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM pos_terminal WHERE id = NEW.pos_terminal_id AND status = 'Active' AND mode <> 'Training') THEN
      RAISE EXCEPTION 'terminal % is not in service for real sales', NEW.pos_terminal_id USING ERRCODE = 'SS025';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM cash_shift WHERE id = NEW.cash_shift_id AND status = 'Open') THEN
      RAISE EXCEPTION 'shift % is not open', NEW.cash_shift_id USING ERRCODE = 'SS026';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status <> 'Open' THEN
      RAISE EXCEPTION 'checkout % is % and cannot change', OLD.id, OLD.status USING ERRCODE = 'SS043';
    END IF;
    NEW.closed_at := now();
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION checkout_before_write() IS
  'Cites: PT-03, BI-39, SP-43, RT-353. A checkout starts only on a till in service and not in training, inside an open shift; once completed or abandoned it never changes.';

CREATE TRIGGER tg_checkout_before_write BEFORE INSERT OR UPDATE ON checkout
  FOR EACH ROW EXECUTE FUNCTION checkout_before_write();
COMMENT ON TRIGGER tg_checkout_before_write ON checkout IS
  'Cites: PT-03, BI-39. Checkout start conditions and one-way closing.';

-- ============================================================================ payment (payment-domain s4, s22.10, D-14)

CREATE TABLE payment (
  id                             uuid        NOT NULL DEFAULT gen_random_uuid(),
  checkout_id                    uuid        NOT NULL,
  store_id                       uuid        NOT NULL,
  organization_id                uuid        NOT NULL,
  payment_method_id              uuid        NOT NULL,
  method_type                    text        NOT NULL,
  currency_code                  text        NOT NULL,
  amount                         bigint      NOT NULL,
  tendered_amount                bigint,
  sequence_number                integer     NOT NULL,
  status                         text        NOT NULL DEFAULT 'Pending',
  provider_transaction_reference text,
  provider_outcome               text,
  provider_raw_code              text,
  created_at                     timestamptz NOT NULL DEFAULT now(),
  created_by                     uuid        NOT NULL,
  status_changed_at              timestamptz NOT NULL DEFAULT now(),
  status_changed_by              uuid        NOT NULL,
  correlation_id                 uuid,
  CONSTRAINT pk_payment PRIMARY KEY (id),
  CONSTRAINT fk_payment_checkout FOREIGN KEY (checkout_id, store_id) REFERENCES checkout (id, store_id),
  CONSTRAINT fk_payment_store FOREIGN KEY (store_id, organization_id) REFERENCES store (id, organization_id),
  CONSTRAINT fk_payment_method FOREIGN KEY (payment_method_id, organization_id)
    REFERENCES payment_method (id, organization_id),
  CONSTRAINT fk_payment_method_type FOREIGN KEY (payment_method_id, method_type) REFERENCES payment_method (id, method_type),
  CONSTRAINT fk_payment_currency FOREIGN KEY (store_id, currency_code) REFERENCES store (id, currency_code),
  CONSTRAINT uq_payment_sequence UNIQUE (checkout_id, sequence_number),
  CONSTRAINT uq_payment_provider_reference UNIQUE (provider_transaction_reference),
  CONSTRAINT ck_payment_positive CHECK (amount > 0),
  CONSTRAINT ck_payment_tendered CHECK (
    (method_type = 'Cash' AND tendered_amount IS NOT NULL AND tendered_amount >= amount)
    OR (method_type <> 'Cash' AND tendered_amount IS NULL)),
  CONSTRAINT ck_payment_sequence CHECK (sequence_number >= 1),
  CONSTRAINT ck_payment_status CHECK (status IN ('Pending', 'Authorized', 'Captured', 'Declined', 'Voided', 'Failed')),
  CONSTRAINT ck_payment_provider_outcome
    CHECK (provider_outcome IN ('Approved', 'Declined', 'Pending', 'Failed', 'Errored', 'Timeout'))
);

CREATE INDEX ix_payment_checkout ON payment (checkout_id);

COMMENT ON TABLE payment IS
  'Cites: PY-02, PY-12, PY-42, PY-46, PY-54, D-14, ADR-09. One payment attempt: the amount applied to the sale, never the amount handed over. Every attempt is its own row; a retry is a new row, and Captured, Declined, Voided and Failed are terminal for the row.';
COMMENT ON CONSTRAINT fk_payment_checkout ON payment IS
  'Cites: PY-46, PY-54, RT-122. An attempt belongs to one checkout, so to its terminal, drawer, shift and store.';
COMMENT ON CONSTRAINT fk_payment_store ON payment IS
  'Cites: RT-001, BI-14. A payment is in its store''s organization.';
COMMENT ON CONSTRAINT fk_payment_method ON payment IS
  'Cites: PY-03, PY-04. A payment uses a method of its own organization.';
COMMENT ON CONSTRAINT fk_payment_method_type ON payment IS
  'Cites: PY-03, CD-09. The payment carries its method''s type, proven by foreign key, so cash is recognisable without a join.';
COMMENT ON CONSTRAINT fk_payment_currency ON payment IS
  'Cites: PY-52, BI-01. A payment is in the store''s currency, as integer minor units.';
COMMENT ON CONSTRAINT uq_payment_sequence ON payment IS
  'Cites: PY-20. Payments on a checkout settle in a recorded, deterministic order.';
COMMENT ON CONSTRAINT uq_payment_provider_reference ON payment IS
  'Cites: PY-15, RT-480. A provider transaction is recorded once, so a duplicate callback is idempotent.';
COMMENT ON CONSTRAINT ck_payment_positive ON payment IS
  'Cites: PY-02, SP-39. A tender applies a positive amount. The zero-value payment of a credit sale (PY-01) arrives with credit.';
COMMENT ON CONSTRAINT ck_payment_tendered ON payment IS
  'Cites: PY-19, CD-07, RT-132. Cash records what was handed over beside what was applied, and the difference is change; any other method is never overpaid.';
COMMENT ON CONSTRAINT ck_payment_sequence ON payment IS
  'Cites: PY-20. Settlement order starts at 1.';
COMMENT ON CONSTRAINT ck_payment_status ON payment IS
  'Cites: SM-51, SM-52, SM-53, PY-54. The payment states of payment-domain s4. Timeout is not a state; Refunded belongs to the refund.';
COMMENT ON CONSTRAINT ck_payment_provider_outcome ON payment IS
  'Cites: PY-10, PY-11. The provider''s response normalised to six outcomes; the raw code is kept beside it.';
COMMENT ON INDEX ix_payment_checkout IS
  'Cites: PY-16, SP-40. Finds a checkout''s tenders when completing and reconciling.';

CREATE FUNCTION payment_before_write() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM checkout WHERE id = NEW.checkout_id AND status = 'Open') THEN
      RAISE EXCEPTION 'checkout % is not open for payment', NEW.checkout_id USING ERRCODE = 'SS027';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM store_payment_method
                   WHERE store_id = NEW.store_id AND payment_method_id = NEW.payment_method_id AND is_enabled) THEN
      RAISE EXCEPTION 'payment method % is not enabled at store %', NEW.payment_method_id, NEW.store_id
        USING ERRCODE = 'SS045';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('Captured', 'Declined', 'Voided', 'Failed') THEN
    RAISE EXCEPTION 'payment % is % and is never changed; a retry is a new payment', OLD.id, OLD.status
      USING ERRCODE = 'SS035';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION payment_before_write() IS
  'Cites: PY-04, PY-12, PY-54, D-14, BI-09. An attempt is added only to an open checkout with a method enabled at the store; a payment in a terminal state is never modified again.';

CREATE TRIGGER tg_payment_before_write BEFORE INSERT OR UPDATE ON payment
  FOR EACH ROW EXECUTE FUNCTION payment_before_write();
COMMENT ON TRIGGER tg_payment_before_write ON payment IS
  'Cites: PY-12, PY-54, D-14. Terminal payments are frozen.';

CREATE TRIGGER tg_payment_state_machine BEFORE INSERT OR UPDATE OF status ON payment
  FOR EACH ROW EXECUTE FUNCTION enforce_state_transition('Payment', 'status');
COMMENT ON TRIGGER tg_payment_state_machine ON payment IS
  'Cites: PY-12, PY-13, PY-54, SM-51. A payment is created Pending and moves only along the edges of state-machines s22.10.';

-- ============================================================================ sale (sales-pos-domain s3, s22.6)

CREATE TABLE sale (
  id                       uuid        NOT NULL DEFAULT gen_random_uuid(),
  store_id                 uuid        NOT NULL,
  organization_id          uuid        NOT NULL,
  checkout_id              uuid        NOT NULL,
  pos_terminal_id          uuid        NOT NULL,
  cash_drawer_id           uuid        NOT NULL,
  cash_shift_id            uuid        NOT NULL,
  client_operation_id      uuid        NOT NULL,
  employee_id              uuid        NOT NULL,
  customer_id              uuid        NOT NULL,
  document_number          bigint      NOT NULL,
  business_date            date        NOT NULL,
  completed_at             timestamptz NOT NULL DEFAULT now(),
  status                   text        NOT NULL DEFAULT 'Completed',
  store_setting_version_id uuid        NOT NULL,
  tax_mode                 text        NOT NULL,
  currency_code            text        NOT NULL,
  subtotal                 bigint      NOT NULL,
  tax_total                bigint      NOT NULL,
  total_due                bigint      NOT NULL,
  total_tendered           bigint      NOT NULL,
  change_given             bigint      NOT NULL,
  receipt_status           text,
  correlation_id           uuid,
  CONSTRAINT pk_sale PRIMARY KEY (id),
  CONSTRAINT fk_sale_checkout
    FOREIGN KEY (checkout_id, cash_shift_id, cash_drawer_id, pos_terminal_id, store_id, client_operation_id)
    REFERENCES checkout (id, cash_shift_id, cash_drawer_id, pos_terminal_id, store_id, client_operation_id),
  CONSTRAINT fk_sale_store FOREIGN KEY (store_id, organization_id) REFERENCES store (id, organization_id),
  CONSTRAINT fk_sale_customer FOREIGN KEY (customer_id, organization_id) REFERENCES customer (id, organization_id),
  CONSTRAINT fk_sale_settings FOREIGN KEY (store_setting_version_id, store_id)
    REFERENCES store_setting_version (id, store_id),
  CONSTRAINT fk_sale_currency FOREIGN KEY (store_id, currency_code) REFERENCES store (id, currency_code),
  CONSTRAINT uq_sale_checkout UNIQUE (checkout_id),
  CONSTRAINT uq_sale_number UNIQUE (store_id, document_number),
  CONSTRAINT uq_sale_operation UNIQUE (pos_terminal_id, client_operation_id),
  CONSTRAINT uq_sale_id_store UNIQUE (id, store_id),
  CONSTRAINT uq_sale_id_shift UNIQUE (id, cash_shift_id),
  CONSTRAINT ck_sale_status CHECK (status IN ('Completed', 'PartiallyReturned', 'Returned', 'Voided')),
  CONSTRAINT ck_sale_tax_mode CHECK (tax_mode IN ('Inclusive', 'Exclusive')),
  CONSTRAINT ck_sale_amounts CHECK (subtotal >= 0 AND tax_total >= 0 AND total_due >= 0 AND change_given >= 0),
  CONSTRAINT ck_sale_tendered CHECK (total_tendered = total_due),
  CONSTRAINT ck_sale_receipt CHECK (receipt_status IN ('Printed', 'Failed', 'Reprinted'))
);

CREATE INDEX ix_sale_shift ON sale (cash_shift_id);
CREATE INDEX ix_sale_business_date ON sale (store_id, business_date);

COMMENT ON TABLE sale IS
  'Cites: SP-01, SP-02, RT-118, RT-119, RT-122, RT-123, BI-08. A completed customer transaction. It is created Completed by the completion transaction, never exists as a draft, and is never edited; later changes are compensating documents.';
COMMENT ON CONSTRAINT fk_sale_checkout ON sale IS
  'Cites: RT-122, RT-123, PT-01, BI-39. A sale is its checkout completed: the same shift, drawer, terminal, store and client operation id.';
COMMENT ON CONSTRAINT fk_sale_store ON sale IS
  'Cites: RT-001, ORG-04, RT-507. A sale belongs to a store; there is no sale without one.';
COMMENT ON CONSTRAINT fk_sale_customer ON sale IS
  'Cites: CU-01. Never null: a walk-in is a customer record of the same organization.';
COMMENT ON CONSTRAINT fk_sale_settings ON sale IS
  'Cites: REQ-AU-06, SP-33. The store settings version the totals were computed under; versions are immutable, so the reference is the snapshot.';
COMMENT ON CONSTRAINT fk_sale_currency ON sale IS
  'Cites: BI-01, PY-52. A sale is in the store''s currency, as integer minor units.';
COMMENT ON CONSTRAINT uq_sale_checkout ON sale IS
  'Cites: BI-28, PY-39. A checkout completes into at most one sale.';
COMMENT ON CONSTRAINT uq_sale_number ON sale IS
  'Cites: BI-42, RT-479, SP-05. The sale number is unique per store and never reused.';
COMMENT ON CONSTRAINT uq_sale_operation ON sale IS
  'Cites: BI-28, PY-39, RT-121, EC-05. A commit retried with the same operation id creates no second sale.';
COMMENT ON CONSTRAINT uq_sale_id_store ON sale IS
  'Cites: RT-001, BI-14. Lets a line or movement prove, by foreign key, that it belongs to the sale''s store.';
COMMENT ON CONSTRAINT uq_sale_id_shift ON sale IS
  'Cites: CD-18, CD-19. Lets the change disbursement prove, by foreign key, that it is in the sale''s shift.';
COMMENT ON CONSTRAINT ck_sale_status ON sale IS
  'Cites: SM-32, SM-35, SM-36. The sale states of sales-pos-domain s13; there is no draft, pending or cancelled sale.';
COMMENT ON CONSTRAINT ck_sale_tax_mode ON sale IS
  'Cites: SP-33, PR-38. The tax mode the sale was computed in, snapshotted (TaxModeAtSale).';
COMMENT ON CONSTRAINT ck_sale_amounts ON sale IS
  'Cites: RT-131, BI-19. No total of a sale is negative.';
COMMENT ON CONSTRAINT ck_sale_tendered ON sale IS
  'Cites: SP-40, PY-16, RT-133. The applied tenders equal the total due; an underpaid credit sale (SP-41) arrives with credit.';
COMMENT ON CONSTRAINT ck_sale_receipt ON sale IS
  'Cites: SP-58, RT-140. Whether the receipt printed, failed and was queued, or was reprinted.';
COMMENT ON INDEX ix_sale_shift IS
  'Cites: CD-06, RT-135. Finds a shift''s sales to compute its expected cash.';
COMMENT ON INDEX ix_sale_business_date IS
  'Cites: RP-14, MS-04. Store-scoped sales by business date, for lists and reports.';

CREATE FUNCTION sale_before_insert() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  v_version  record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pos_terminal WHERE id = NEW.pos_terminal_id AND status = 'Active' AND mode <> 'Training') THEN
    RAISE EXCEPTION 'terminal % may not complete a real sale', NEW.pos_terminal_id USING ERRCODE = 'SS025';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cash_shift WHERE id = NEW.cash_shift_id AND status = 'Open') THEN
    RAISE EXCEPTION 'shift % is not open', NEW.cash_shift_id USING ERRCODE = 'SS026';
  END IF;

  SELECT id, tax_mode INTO v_version FROM store_setting_version
  WHERE store_id = NEW.store_id AND effective_from <= now() ORDER BY effective_from DESC LIMIT 1;
  IF v_version.id IS DISTINCT FROM NEW.store_setting_version_id OR v_version.tax_mode IS DISTINCT FROM NEW.tax_mode THEN
    RAISE EXCEPTION 'a sale is computed under the settings in force (%)', v_version.id USING ERRCODE = 'SS038';
  END IF;
  IF EXISTS (SELECT 1 FROM store_setting_version
             WHERE store_id = NEW.store_id AND effective_from > now() AND tax_mode <> NEW.tax_mode) THEN
    RAISE EXCEPTION 'store % has a tax-mode change scheduled; it cannot trade until that takes effect', NEW.store_id
      USING ERRCODE = 'SS038';
  END IF;

  UPDATE checkout SET status = 'Completed' WHERE id = NEW.checkout_id AND status = 'Open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'checkout % is not open', NEW.checkout_id USING ERRCODE = 'SS027';
  END IF;

  NEW.document_number := allocate_document_number(NEW.store_id, 'Sale');
  SELECT (now() AT TIME ZONE s.time_zone)::date INTO NEW.business_date FROM store s WHERE s.id = NEW.store_id;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION sale_before_insert() IS
  'Cites: SP-02, SP-05, PT-03, BI-39, BI-42, SP-33, REQ-AU-06, RT-234. The completion transaction''s header: a till in service and not in training, an open shift, the settings in force and never under a scheduled tax-mode change, the checkout closed into this sale, the number allocated and the business date computed by the server.';

CREATE TRIGGER tg_sale_before_insert BEFORE INSERT ON sale
  FOR EACH ROW EXECUTE FUNCTION sale_before_insert();
COMMENT ON TRIGGER tg_sale_before_insert ON sale IS
  'Cites: SP-02, RT-118. Completion checks and server-assigned fields.';

CREATE TRIGGER tg_sale_state_machine BEFORE INSERT OR UPDATE OF status ON sale
  FOR EACH ROW EXECUTE FUNCTION enforce_state_transition('Sale', 'status');
COMMENT ON TRIGGER tg_sale_state_machine ON sale IS
  'Cites: SP-01, SM-33, RT-118. A sale is created Completed, and only Completed.';

-- ============================================================================ sale line (sales-pos-domain s3)

CREATE TABLE sale_line (
  id                  uuid          NOT NULL DEFAULT gen_random_uuid(),
  sale_id             uuid          NOT NULL,
  store_id            uuid          NOT NULL,
  organization_id     uuid          NOT NULL,
  line_number         integer       NOT NULL,
  variant_id          uuid          NOT NULL,
  description         nonblank_text NOT NULL,
  unit_name           nonblank_text NOT NULL,
  quantity            numeric(18,4) NOT NULL,
  unit_price          bigint        NOT NULL,
  price_quoted_at     timestamptz   NOT NULL,
  gross_amount        bigint        NOT NULL,
  tax_rate_id         uuid          NOT NULL,
  tax_amount          bigint        NOT NULL,
  line_total          bigint        NOT NULL,
  settled_amount      bigint        NOT NULL,
  unit_cost           bigint,
  storage_location_id uuid          NOT NULL,
  entry_method        text          NOT NULL,
  scanned_barcode     text,
  returned_quantity   numeric(18,4) NOT NULL DEFAULT 0,
  refunded_amount     bigint        NOT NULL DEFAULT 0,
  CONSTRAINT pk_sale_line PRIMARY KEY (id),
  CONSTRAINT fk_sale_line_sale FOREIGN KEY (sale_id, store_id) REFERENCES sale (id, store_id),
  CONSTRAINT fk_sale_line_variant FOREIGN KEY (variant_id, organization_id) REFERENCES product_variant (id, organization_id),
  CONSTRAINT fk_sale_line_tax_rate FOREIGN KEY (tax_rate_id, organization_id) REFERENCES tax_rate (id, organization_id),
  CONSTRAINT fk_sale_line_location FOREIGN KEY (storage_location_id, organization_id)
    REFERENCES storage_location (id, organization_id),
  CONSTRAINT uq_sale_line_number UNIQUE (sale_id, line_number),
  CONSTRAINT uq_sale_line_identity UNIQUE (id, sale_id, variant_id, storage_location_id),
  CONSTRAINT ck_sale_line_number CHECK (line_number >= 1),
  CONSTRAINT ck_sale_line_quantity CHECK (quantity > 0),
  CONSTRAINT ck_sale_line_price CHECK (unit_price > 0),
  CONSTRAINT ck_sale_line_gross CHECK (gross_amount = round(quantity * unit_price)),
  CONSTRAINT ck_sale_line_tax CHECK (tax_amount >= 0 AND line_total >= 0),
  CONSTRAINT ck_sale_line_settled CHECK (settled_amount BETWEEN 0 AND line_total),
  CONSTRAINT ck_sale_line_cost CHECK (unit_cost >= 0),
  CONSTRAINT ck_sale_line_entry CHECK (
    (entry_method = 'Scanned' AND scanned_barcode IS NOT NULL)
    OR (entry_method = 'Selected' AND scanned_barcode IS NULL)),
  CONSTRAINT ck_sale_line_returned CHECK (returned_quantity BETWEEN 0 AND quantity),
  CONSTRAINT ck_sale_line_refunded CHECK (refunded_amount BETWEEN 0 AND settled_amount)
);

COMMENT ON TABLE sale_line IS
  'Cites: SP-06, SP-07, SP-13, RT-021, RT-124, RT-146, BE-43. One line of a sale, every display value and money figure snapshotted: description, unit, quoted price, tax rate and tax, cost at sale, and the settled amount. The returned and refunded counters are the truth the sale''s status caches (SP-66).';
COMMENT ON CONSTRAINT fk_sale_line_sale ON sale_line IS
  'Cites: RT-001, SP-02. A line belongs to one sale and carries its store.';
COMMENT ON CONSTRAINT fk_sale_line_variant ON sale_line IS
  'Cites: PR-01, RT-021. Only a variant is sold, never a product.';
COMMENT ON CONSTRAINT fk_sale_line_tax_rate ON sale_line IS
  'Cites: BI-18, RT-130. The tax rate version the line was taxed at; rate versions are immutable, so this is the snapshot.';
COMMENT ON CONSTRAINT fk_sale_line_location ON sale_line IS
  'Cites: WH-01, IV-01. The location the stock is sold from.';
COMMENT ON CONSTRAINT uq_sale_line_number ON sale_line IS
  'Cites: SP-06. Line numbers are unique within a sale.';
COMMENT ON CONSTRAINT uq_sale_line_identity ON sale_line IS
  'Cites: BI-03, RT-060. Lets a movement prove, by foreign key, that it applies this line''s variant at this line''s location.';
COMMENT ON CONSTRAINT ck_sale_line_number ON sale_line IS
  'Cites: SP-06. Lines are numbered from 1.';
COMMENT ON CONSTRAINT ck_sale_line_quantity ON sale_line IS
  'Cites: SP-15, BI-05. A sale quantity is positive; minus one is a return, never a negative line.';
COMMENT ON CONSTRAINT ck_sale_line_price ON sale_line IS
  'Cites: PR-34, RT-042. A price is positive.';
COMMENT ON CONSTRAINT ck_sale_line_gross ON sale_line IS
  'Cites: BI-01, BI-11. The line amount is quantity times price, computed at full precision and rounded half-up once (overview s3.1).';
COMMENT ON CONSTRAINT ck_sale_line_tax ON sale_line IS
  'Cites: RT-131, BI-19. A line''s tax and total are never negative.';
COMMENT ON CONSTRAINT ck_sale_line_settled ON sale_line IS
  'Cites: RT-146, RT-147. The settled amount, stored at completion, is at most the line total; refunds are bounded by it.';
COMMENT ON CONSTRAINT ck_sale_line_cost ON sale_line IS
  'Cites: SP-07, BI-01. A recorded cost is never negative; null means no standard cost was defined.';
COMMENT ON CONSTRAINT ck_sale_line_entry ON sale_line IS
  'Cites: RT-489, PR-11. A scanned line keeps the barcode read; a search-only selection is recorded as explicit.';
COMMENT ON CONSTRAINT ck_sale_line_returned ON sale_line IS
  'Cites: BI-06, BI-16, RT-148. The returned quantity never exceeds the sold quantity: the bound is the counter itself.';
COMMENT ON CONSTRAINT ck_sale_line_refunded ON sale_line IS
  'Cites: BI-10, RT-145, RT-147. The refunded amount never exceeds what the line settled.';

CREATE FUNCTION sale_line_before_insert() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  v_completed_at timestamptz;
  v_product      text;
  v_archived     timestamptz;
  v_category     uuid;
  v_rate         uuid;
  v_cost         bigint;
BEGIN
  SELECT completed_at INTO v_completed_at FROM sale WHERE id = NEW.sale_id;
  IF v_completed_at IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'lines are written only in the sale''s completion transaction' USING ERRCODE = 'SS036';
  END IF;

  SELECT p.status, v.archived_at, v.tax_category_id INTO v_product, v_archived, v_category
  FROM product_variant v JOIN product p ON p.id = v.product_id WHERE v.id = NEW.variant_id;
  IF v_product NOT IN ('Active', 'Discontinued') OR v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'variant % is not sellable (product %, archived %)', NEW.variant_id, v_product, v_archived IS NOT NULL
      USING ERRCODE = 'SS028';
  END IF;

  SELECT id INTO v_rate FROM tax_rate
  WHERE tax_category_id = v_category AND effective_from <= now() ORDER BY effective_from DESC LIMIT 1;
  IF v_category IS NULL OR v_rate IS DISTINCT FROM NEW.tax_rate_id THEN
    RAISE EXCEPTION 'variant % is unclassified for tax or not taxed at the rate in force', NEW.variant_id
      USING ERRCODE = 'SS029';
  END IF;

  IF NEW.price_quoted_at > now()
     OR resolve_price(NEW.store_id, NEW.variant_id, NEW.price_quoted_at) IS DISTINCT FROM NEW.unit_price THEN
    RAISE EXCEPTION 'line price % is not the price in force when it was quoted', NEW.unit_price USING ERRCODE = 'SS030';
  END IF;

  SELECT amount INTO v_cost FROM variant_standard_cost
  WHERE variant_id = NEW.variant_id AND effective_from <= now() ORDER BY effective_from DESC LIMIT 1;
  IF v_cost IS DISTINCT FROM NEW.unit_cost THEN
    RAISE EXCEPTION 'line cost must be the standard cost in force' USING ERRCODE = 'SS031';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM storage_location l JOIN warehouse w ON w.id = l.warehouse_id
                 WHERE l.id = NEW.storage_location_id AND l.is_sellable AND w.store_id = NEW.store_id) THEN
    RAISE EXCEPTION 'location % is not a sellable location of this store', NEW.storage_location_id USING ERRCODE = 'SS032';
  END IF;

  IF NEW.entry_method = 'Scanned' AND NOT EXISTS (
       SELECT 1 FROM product_barcode
       WHERE organization_id = NEW.organization_id AND lookup_key = barcode_lookup_key(NEW.scanned_barcode)
         AND archived_at IS NULL AND variant_id = NEW.variant_id) THEN
    RAISE EXCEPTION 'barcode % does not identify variant %', NEW.scanned_barcode, NEW.variant_id USING ERRCODE = 'SS033';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION sale_line_before_insert() IS
  'Cites: SP-06, SP-07, SP-09, BI-30, RT-124, RT-130, RT-489, RT-493, WH-01, RT-004, PR-48. The server''s authority over a line: written only in the completion transaction; the variant sellable; the tax rate the one in force for its category; the price the one in force when the server quoted it; the cost the standard cost in force; the location sellable and the store''s own; a scanned barcode that identifies the variant.';

CREATE TRIGGER tg_sale_line_before_insert BEFORE INSERT ON sale_line
  FOR EACH ROW EXECUTE FUNCTION sale_line_before_insert();
COMMENT ON TRIGGER tg_sale_line_before_insert ON sale_line IS
  'Cites: BI-30, RT-040. A client-supplied price, cost or rate is checked against the server''s own records; a client price is never taken on trust.';

-- ============================================================================ the sale's stock movements (IV-15)

ALTER TABLE inventory_movement ADD COLUMN sale_id uuid;
ALTER TABLE inventory_movement ADD COLUMN sale_line_id uuid;

ALTER TABLE inventory_movement ADD CONSTRAINT uq_inventory_movement_id_sale_line UNIQUE (id, sale_line_id);
ALTER TABLE inventory_movement ADD CONSTRAINT fk_inventory_movement_sale_line
  FOREIGN KEY (sale_line_id, sale_id, variant_id, storage_location_id)
  REFERENCES sale_line (id, sale_id, variant_id, storage_location_id);
ALTER TABLE inventory_movement ADD CONSTRAINT fk_inventory_movement_sale_store
  FOREIGN KEY (sale_id, store_id) REFERENCES sale (id, store_id);
ALTER TABLE inventory_movement ADD CONSTRAINT fk_inventory_movement_reverses_same_sale_line
  FOREIGN KEY (reverses_movement_id, sale_line_id) REFERENCES inventory_movement (id, sale_line_id);
ALTER TABLE inventory_movement ADD CONSTRAINT ck_inventory_movement_sale_pair
  CHECK ((sale_id IS NULL) = (sale_line_id IS NULL));
ALTER TABLE inventory_movement DROP CONSTRAINT ck_inventory_movement_one_cause;
ALTER TABLE inventory_movement ADD CONSTRAINT ck_inventory_movement_one_cause
  CHECK (num_nonnulls(stock_adjustment_line_id, sale_line_id) = 1);

CREATE UNIQUE INDEX uq_inventory_movement_sale_line_once ON inventory_movement (sale_line_id)
  WHERE movement_type <> 'REVERSAL';

COMMENT ON CONSTRAINT uq_inventory_movement_id_sale_line ON inventory_movement IS
  'Cites: BI-03. Lets a reversal prove, by foreign key, that it answers to the same sale line as the movement it reverses.';
COMMENT ON CONSTRAINT fk_inventory_movement_sale_line ON inventory_movement IS
  'Cites: BI-03, RT-060, IV-15. The causing sale line, with its variant and location proven to match.';
COMMENT ON CONSTRAINT fk_inventory_movement_sale_store ON inventory_movement IS
  'Cites: MS-16, BI-14. A sale''s movements are attributed to the sale''s store.';
COMMENT ON CONSTRAINT fk_inventory_movement_reverses_same_sale_line ON inventory_movement IS
  'Cites: BI-03, IV-12, SP-53. A reversal of a sale movement names the same sale line.';
COMMENT ON CONSTRAINT ck_inventory_movement_sale_pair ON inventory_movement IS
  'Cites: BI-03. A sale line is always named with its sale.';
COMMENT ON CONSTRAINT ck_inventory_movement_one_cause ON inventory_movement IS
  'Cites: BI-03, RT-060, IV-14. Exactly one causing document line: an adjustment line or a sale line. Later domains add their line columns to this count.';
COMMENT ON INDEX uq_inventory_movement_sale_line_once IS
  'Cites: BI-28, RT-121. A sale line moves its stock at most once.';

CREATE FUNCTION assert_movement_sale_state() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  v_completed_at timestamptz;
  v_product      text;
BEGIN
  IF NEW.sale_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.movement_type = 'REVERSAL' THEN
    RAISE EXCEPTION 'reversing a sale (a void) is not built in v1 (OQ-017)' USING ERRCODE = 'SS044';
  END IF;
  IF NEW.movement_type <> 'SALE' THEN
    RAISE EXCEPTION 'a sale writes only SALE movements' USING ERRCODE = 'SS016';
  END IF;
  SELECT completed_at INTO v_completed_at FROM sale WHERE id = NEW.sale_id;
  IF v_completed_at IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'a sale moves stock only in its completion transaction' USING ERRCODE = 'SS036';
  END IF;
  -- Runs after tg_inventory_movement_apply (triggers fire in name order), so the resulting balance is known.
  SELECT p.status INTO v_product FROM product_variant v JOIN product p ON p.id = v.product_id WHERE v.id = NEW.variant_id;
  IF v_product = 'Discontinued' AND NEW.resulting_balance < 0 THEN
    RAISE EXCEPTION 'a discontinued product sells only from stock on hand' USING ERRCODE = 'SS041';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION assert_movement_sale_state() IS
  'Cites: IV-15, SP-02, SM-11, PR-46, RT-031. A sale writes SALE movements only in its completion transaction, and a discontinued product only from stock actually on hand.';

CREATE TRIGGER tg_inventory_movement_sale_state BEFORE INSERT ON inventory_movement
  FOR EACH ROW EXECUTE FUNCTION assert_movement_sale_state();
COMMENT ON TRIGGER tg_inventory_movement_sale_state ON inventory_movement IS
  'Cites: IV-15, SM-11. Fires after the apply trigger, by name order.';

-- ============================================================================ change as a drawer disbursement (CD-18)

ALTER TABLE cash_transaction ADD COLUMN sale_id uuid;
ALTER TABLE cash_transaction ADD CONSTRAINT fk_cash_transaction_sale FOREIGN KEY (sale_id, cash_shift_id)
  REFERENCES sale (id, cash_shift_id);
ALTER TABLE cash_transaction ADD CONSTRAINT ck_cash_transaction_sale CHECK ((type = 'ChangeDisbursed') = (sale_id IS NOT NULL));
CREATE UNIQUE INDEX uq_cash_transaction_change_once ON cash_transaction (sale_id) WHERE type = 'ChangeDisbursed';

COMMENT ON CONSTRAINT fk_cash_transaction_sale ON cash_transaction IS
  'Cites: CD-18, RT-135. Change given belongs to one sale in the same shift.';
COMMENT ON CONSTRAINT ck_cash_transaction_sale ON cash_transaction IS
  'Cites: CD-18. Change given, and only change given, names its sale.';
COMMENT ON INDEX uq_cash_transaction_change_once IS
  'Cites: CD-18, BI-28. A sale disburses its change once.';

-- ============================================================================ completion, all at once (SP-02, RT-119)

CREATE FUNCTION assert_sale_complete() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  s          record;
  v_lines    integer;
  v_gross    bigint;
  v_tax      bigint;
  v_total    bigint;
  v_settled  bigint;
  v_unsettled integer;
  v_captured bigint;
  v_change   bigint;
  v_disbursed bigint;
BEGIN
  SELECT * INTO s FROM sale WHERE id = NEW.id;

  SELECT count(*), coalesce(sum(gross_amount), 0), coalesce(sum(tax_amount), 0), coalesce(sum(line_total), 0),
         coalesce(sum(settled_amount), 0)
    INTO v_lines, v_gross, v_tax, v_total, v_settled
  FROM sale_line WHERE sale_id = s.id;
  IF v_lines = 0 THEN
    RAISE EXCEPTION 'sale % has no lines', s.id USING ERRCODE = 'SS034';
  END IF;
  IF EXISTS (SELECT 1 FROM sale_line WHERE sale_id = s.id AND line_total <>
               CASE s.tax_mode WHEN 'Inclusive' THEN gross_amount ELSE gross_amount + tax_amount END) THEN
    RAISE EXCEPTION 'a line total of sale % does not follow its tax mode', s.id USING ERRCODE = 'SS034';
  END IF;
  IF s.subtotal <> v_gross OR s.tax_total <> v_tax OR s.total_due <> v_total OR v_settled <> s.total_due THEN
    RAISE EXCEPTION 'the totals of sale % are not the sums of its lines', s.id USING ERRCODE = 'SS034';
  END IF;

  SELECT count(*) FILTER (WHERE status IN ('Pending', 'Authorized')),
         coalesce(sum(amount) FILTER (WHERE status = 'Captured'), 0),
         coalesce(sum(tendered_amount - amount) FILTER (WHERE status = 'Captured' AND method_type = 'Cash'), 0)
    INTO v_unsettled, v_captured, v_change
  FROM payment WHERE checkout_id = s.checkout_id;
  IF v_unsettled > 0 THEN
    RAISE EXCEPTION 'sale % has a payment still pending or authorized', s.id USING ERRCODE = 'SS034';
  END IF;
  IF v_captured <> s.total_due OR s.change_given <> v_change THEN
    RAISE EXCEPTION 'the captured payments of sale % do not settle it exactly', s.id USING ERRCODE = 'SS034';
  END IF;

  SELECT coalesce(sum(amount), 0) INTO v_disbursed FROM cash_transaction WHERE sale_id = s.id AND type = 'ChangeDisbursed';
  IF v_disbursed <> s.change_given THEN
    RAISE EXCEPTION 'the change of sale % is not recorded as a drawer disbursement', s.id USING ERRCODE = 'SS034';
  END IF;

  IF EXISTS (
       SELECT 1 FROM sale_line l JOIN product_variant v ON v.id = l.variant_id JOIN unit u ON u.id = v.base_unit_id
       WHERE l.sale_id = s.id AND u.quantity_kind <> 'Service'
         AND l.quantity IS DISTINCT FROM (SELECT sum(m.quantity) FROM inventory_movement m
                                          WHERE m.sale_line_id = l.id AND m.movement_type = 'SALE')) THEN
    RAISE EXCEPTION 'a line of sale % did not move its stock', s.id USING ERRCODE = 'SS034';
  END IF;
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION assert_sale_complete() IS
  'Cites: SP-02, SP-36, SP-40, BI-04, BI-18, RT-119, RT-133, RT-135, RT-136, RT-146, IV-15. At commit, a sale is whole: at least one line; totals are the sums of its lines and follow the tax mode; the settled amounts sum to the total due; no tender is left pending; captured tenders equal the total due; change equals cash tendered beyond cash applied and is disbursed from the drawer; and every stocked line moved exactly its quantity.';

CREATE CONSTRAINT TRIGGER tg_sale_complete AFTER INSERT ON sale
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_sale_complete();
COMMENT ON TRIGGER tg_sale_complete ON sale IS
  'Cites: SP-02, RT-119. The completion transaction is checked whole, at commit.';

CREATE FUNCTION assert_checkout_outcome() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'Completed' AND NOT EXISTS (SELECT 1 FROM sale WHERE checkout_id = NEW.id) THEN
    RAISE EXCEPTION 'checkout % cannot complete without its sale', NEW.id USING ERRCODE = 'SS043';
  END IF;
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION assert_checkout_outcome() IS
  'Cites: SP-01, PY-37. A checkout is Completed only by the sale that completes it.';

CREATE CONSTRAINT TRIGGER tg_checkout_outcome AFTER UPDATE OF status ON checkout
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_checkout_outcome();
COMMENT ON TRIGGER tg_checkout_outcome ON checkout IS
  'Cites: SP-01. Checked at commit.';

-- ============================================================================ shift counting and close (CD-20..CD-25)

CREATE FUNCTION shift_expected_cash(p_shift_id uuid) RETURNS bigint
  LANGUAGE sql STABLE
AS $$
  SELECT coalesce((SELECT sum(amount) FROM cash_transaction WHERE cash_shift_id = p_shift_id AND type = 'OpeningFloat'), 0)
       + coalesce((SELECT sum(p.amount) FROM payment p JOIN checkout c ON c.id = p.checkout_id
                   WHERE c.cash_shift_id = p_shift_id AND c.status = 'Completed'
                     AND p.status = 'Captured' AND p.method_type = 'Cash'), 0)
$$;

COMMENT ON FUNCTION shift_expected_cash(uuid) IS
  'Cites: CD-06, CD-08, CD-09, RT-135. What should be in the drawer, derived and never stored: the opening float plus the cash applied to the shift''s sales (net of change, which is why change is not subtracted again; OQ-015). Card is never in the drawer.';

CREATE TABLE shift_count (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  cash_shift_id   uuid        NOT NULL,
  store_id        uuid        NOT NULL,
  organization_id uuid        NOT NULL,
  pass_number     integer     NOT NULL,
  counted_amount  bigint      NOT NULL,
  expected_amount bigint      NOT NULL,
  variance        bigint      GENERATED ALWAYS AS (counted_amount - expected_amount) STORED,
  counted_at      timestamptz NOT NULL DEFAULT now(),
  counted_by      uuid        NOT NULL,
  reason_code_id  uuid,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  CONSTRAINT pk_shift_count PRIMARY KEY (id),
  CONSTRAINT fk_shift_count_shift FOREIGN KEY (cash_shift_id, store_id) REFERENCES cash_shift (id, store_id),
  CONSTRAINT fk_shift_count_store FOREIGN KEY (store_id, organization_id) REFERENCES store (id, organization_id),
  CONSTRAINT fk_shift_count_reason FOREIGN KEY (reason_code_id, organization_id) REFERENCES reason_code (id, organization_id),
  CONSTRAINT uq_shift_count_pass UNIQUE (cash_shift_id, pass_number),
  CONSTRAINT ck_shift_count_counted CHECK (counted_amount >= 0),
  CONSTRAINT ck_shift_count_acknowledgement CHECK (
    (acknowledged_by IS NULL AND acknowledged_at IS NULL AND reason_code_id IS NULL)
    OR (acknowledged_by IS NOT NULL AND acknowledged_at IS NOT NULL AND reason_code_id IS NOT NULL))
);

COMMENT ON TABLE shift_count IS
  'Cites: CD-20, CD-21, CD-22, CD-23, SM-57. One blind counting pass of a reconciling shift. The expected amount is computed by the server at the count, and the variance is derived; neither is entered. A recount is a new pass, and earlier passes stand as history.';
COMMENT ON CONSTRAINT fk_shift_count_shift ON shift_count IS
  'Cites: CD-20. A count counts one shift of its store.';
COMMENT ON CONSTRAINT fk_shift_count_store ON shift_count IS
  'Cites: RT-001. A count is in its store''s organization.';
COMMENT ON CONSTRAINT fk_shift_count_reason ON shift_count IS
  'Cites: CD-23, BI-25. An acknowledged variance carries a reason code of the organization.';
COMMENT ON CONSTRAINT uq_shift_count_pass ON shift_count IS
  'Cites: SM-57. Passes are numbered; a new count never overwrites an old one.';
COMMENT ON CONSTRAINT ck_shift_count_counted ON shift_count IS
  'Cites: CD-04. A counted amount is an observation of cash, never negative.';
COMMENT ON CONSTRAINT ck_shift_count_acknowledgement ON shift_count IS
  'Cites: CD-23, CD-24. An acknowledgement records who, when and why together; a variance is acknowledged, never adjusted away.';

CREATE FUNCTION shift_count_before_write() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cash_shift WHERE id = NEW.cash_shift_id AND status = 'Reconciling') THEN
    RAISE EXCEPTION 'shift % is not being counted', NEW.cash_shift_id USING ERRCODE = 'SS042';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.pass_number := coalesce((SELECT max(pass_number) FROM shift_count WHERE cash_shift_id = NEW.cash_shift_id), 0) + 1;
    NEW.expected_amount := shift_expected_cash(NEW.cash_shift_id);
    RETURN NEW;
  END IF;
  IF OLD.acknowledged_by IS NOT NULL THEN
    RAISE EXCEPTION 'count % is already acknowledged', OLD.id USING ERRCODE = 'SS001';
  END IF;
  IF NEW.acknowledged_by IS NOT NULL THEN
    NEW.acknowledged_at := now();
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION shift_count_before_write() IS
  'Cites: CD-21, CD-22, CD-23, RT-353. A count is taken only while the shift is reconciling; the server numbers the pass and computes the expected amount; an acknowledgement is written once, with server time.';

CREATE TRIGGER tg_shift_count_before_write BEFORE INSERT OR UPDATE ON shift_count
  FOR EACH ROW EXECUTE FUNCTION shift_count_before_write();
COMMENT ON TRIGGER tg_shift_count_before_write ON shift_count IS
  'Cites: CD-21, CD-22. Server-computed expected amount and pass number.';

CREATE FUNCTION assert_shift_close_ready() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  v_count record;
BEGIN
  IF NEW.status = 'Closed' AND OLD.status IS DISTINCT FROM 'Closed' THEN
    SELECT variance, acknowledged_by INTO v_count FROM shift_count
    WHERE cash_shift_id = NEW.id ORDER BY pass_number DESC LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'shift % cannot close without a count', NEW.id USING ERRCODE = 'SS042';
    END IF;
    IF v_count.variance <> 0 AND v_count.acknowledged_by IS NULL THEN
      RAISE EXCEPTION 'shift % has an unacknowledged variance of %', NEW.id, v_count.variance USING ERRCODE = 'SS042';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM cash_transaction WHERE cash_shift_id = NEW.id AND type = 'ClosingFloat') THEN
      RAISE EXCEPTION 'shift % cannot close without a declared closing float', NEW.id USING ERRCODE = 'SS042';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION assert_shift_close_ready() IS
  'Cites: CD-20, CD-23, CD-25, SM-55. A shift closes only from its latest count, with a zero or acknowledged variance, and with the closing float declared.';

CREATE TRIGGER tg_cash_shift_close_ready BEFORE UPDATE OF status ON cash_shift
  FOR EACH ROW EXECUTE FUNCTION assert_shift_close_ready();
COMMENT ON TRIGGER tg_cash_shift_close_ready ON cash_shift IS
  'Cites: CD-25. A non-zero variance blocks the close until acknowledged.';

-- ============================================================================ guards closed from earlier domains

CREATE FUNCTION freeze_organization_money_settings() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  v_first uuid;
BEGIN
  IF NEW.currency_code IS DISTINCT FROM OLD.currency_code OR NEW.time_zone IS DISTINCT FROM OLD.time_zone THEN
    SELECT s.id INTO v_first FROM sale s JOIN store st ON st.id = s.store_id
    WHERE st.organization_id = OLD.id ORDER BY s.completed_at LIMIT 1;
    IF v_first IS NULL THEN
      SELECT p.id INTO v_first FROM payment p WHERE p.organization_id = OLD.id ORDER BY p.created_at LIMIT 1;
    END IF;
    IF v_first IS NOT NULL THEN
      RAISE EXCEPTION 'organization % has financial documents (first: %); its currency and business time zone are fixed',
        OLD.id, v_first USING ERRCODE = 'SS037';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION freeze_organization_money_settings() IS
  'Cites: ORG-01, ORG-02, RT-504, RT-505. Once a financial document exists, the organization''s currency and business time zone cannot change; the refusal names the first document.';

CREATE TRIGGER tg_organization_money_settings BEFORE UPDATE OF currency_code, time_zone ON organization
  FOR EACH ROW EXECUTE FUNCTION freeze_organization_money_settings();
COMMENT ON TRIGGER tg_organization_money_settings ON organization IS
  'Cites: ORG-01, ORG-02. Closes the domain 1 pending guard.';

CREATE FUNCTION freeze_tax_mode_after_sale() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  v_current text;
BEGIN
  IF EXISTS (SELECT 1 FROM sale WHERE store_id = NEW.store_id) THEN
    SELECT tax_mode INTO v_current FROM store_setting_version
    WHERE store_id = NEW.store_id ORDER BY effective_from DESC LIMIT 1;
    IF NEW.tax_mode IS DISTINCT FROM v_current THEN
      RAISE EXCEPTION 'store % has sales; its tax mode is fixed at %', NEW.store_id, v_current USING ERRCODE = 'SS038';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION freeze_tax_mode_after_sale() IS
  'Cites: SP-33, PR-38, RT-046. Once a store has a sale, no settings version may change its tax mode.';

CREATE TRIGGER tg_store_setting_version_tax_mode BEFORE INSERT ON store_setting_version
  FOR EACH ROW EXECUTE FUNCTION freeze_tax_mode_after_sale();
COMMENT ON TRIGGER tg_store_setting_version_tax_mode ON store_setting_version IS
  'Cites: SP-33, PR-38. Closes the domain 1 pending guard.';

CREATE FUNCTION forbid_store_deactivation_with_open_shift() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.deactivated_by IS NULL AND NEW.deactivated_by IS NOT NULL
     AND EXISTS (SELECT 1 FROM cash_shift WHERE store_id = NEW.id AND status <> 'Closed') THEN
    RAISE EXCEPTION 'store % has an open shift; close it first', NEW.id USING ERRCODE = 'SS039';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION forbid_store_deactivation_with_open_shift() IS
  'Cites: ORG-05, RT-445, EC-89. A store is not deactivated while any of its shifts is not closed.';

CREATE TRIGGER tg_store_deactivation_open_shift BEFORE UPDATE OF deactivated_by ON store
  FOR EACH ROW EXECUTE FUNCTION forbid_store_deactivation_with_open_shift();
COMMENT ON TRIGGER tg_store_deactivation_open_shift ON store IS
  'Cites: ORG-05, EC-89. Closes the domain 1 pending guard for shifts.';

CREATE FUNCTION freeze_referenced_variant_name() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name AND EXISTS (SELECT 1 FROM sale_line WHERE variant_id = OLD.id) THEN
    RAISE EXCEPTION 'variant % has been sold; a different variant is a new variant', OLD.id USING ERRCODE = 'SS040';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION freeze_referenced_variant_name() IS
  'Cites: PR-03, RT-030. A variant''s identity (its name, standing in for its option values) is fixed once a document references it; a new colour is a new variant.';

CREATE TRIGGER tg_product_variant_name BEFORE UPDATE OF name ON product_variant
  FOR EACH ROW EXECUTE FUNCTION freeze_referenced_variant_name();
COMMENT ON TRIGGER tg_product_variant_name ON product_variant IS
  'Cites: PR-03. Closes the domain 2 pending guard.';

-- ============================================================================ machines (s22.6, s22.10) and numbering

INSERT INTO state_machine_state (machine, state, is_initial) VALUES
  ('Sale', 'Completed', true),
  ('Sale', 'PartiallyReturned', false),
  ('Sale', 'Returned', false),
  ('Sale', 'Voided', false),
  ('Payment', 'Pending', true),
  ('Payment', 'Authorized', false),
  ('Payment', 'Captured', false),
  ('Payment', 'Declined', false),
  ('Payment', 'Voided', false),
  ('Payment', 'Failed', false);

INSERT INTO state_machine_edge (machine, from_state, to_state, event) VALUES
  ('Sale', 'Completed', 'Voided', 'void'),
  ('Sale', 'Completed', 'PartiallyReturned', 'return part'),
  ('Sale', 'PartiallyReturned', 'Returned', 'return rest'),
  ('Payment', 'Pending', 'Authorized', 'authorize'),
  ('Payment', 'Authorized', 'Captured', 'capture'),
  ('Payment', 'Pending', 'Voided', 'void'),
  ('Payment', 'Authorized', 'Voided', 'void'),
  ('Payment', 'Pending', 'Declined', 'decline'),
  ('Payment', 'Pending', 'Failed', 'fail');
-- No edge out of Captured (PY-12: only a linked refund), Declined, Voided or Failed (PY-54, D-14). The sale's status
-- is not updatable by the application in v1: voids are OQ-017, and the return statuses arrive with domain 5.

INSERT INTO document_type (code) VALUES ('Sale');

-- ============================================================================ runtime role grants (ADR-11, CONVENTIONS s10)

GRANT SELECT ON checkout TO smartstore_app;
GRANT INSERT (id, store_id, pos_terminal_id, cash_drawer_id, cash_shift_id, client_operation_id, currency_code,
              created_by, correlation_id)
  ON checkout TO smartstore_app;
GRANT UPDATE (status) ON checkout TO smartstore_app;

GRANT SELECT ON payment TO smartstore_app;
GRANT INSERT (id, checkout_id, store_id, organization_id, payment_method_id, method_type, currency_code, amount,
              tendered_amount, sequence_number, created_by, status_changed_by, correlation_id)
  ON payment TO smartstore_app;
GRANT UPDATE (status, status_changed_by, provider_transaction_reference, provider_outcome, provider_raw_code)
  ON payment TO smartstore_app;

GRANT SELECT ON sale TO smartstore_app;
GRANT INSERT (id, store_id, organization_id, checkout_id, pos_terminal_id, cash_drawer_id, cash_shift_id,
              client_operation_id, employee_id, customer_id, store_setting_version_id, tax_mode, currency_code,
              subtotal, tax_total, total_due, total_tendered, change_given, correlation_id)
  ON sale TO smartstore_app;
GRANT UPDATE (receipt_status) ON sale TO smartstore_app;
-- A completed sale is never edited (BI-08). The receipt status is operational, not financial (SP-58).

GRANT SELECT ON sale_line TO smartstore_app;
GRANT INSERT (id, sale_id, store_id, organization_id, line_number, variant_id, description, unit_name, quantity,
              unit_price, price_quoted_at, gross_amount, tax_rate_id, tax_amount, line_total, settled_amount,
              unit_cost, storage_location_id, entry_method, scanned_barcode)
  ON sale_line TO smartstore_app;
-- The returned and refunded counters are written by the returns domain, never by the till.

GRANT INSERT (sale_id, sale_line_id) ON inventory_movement TO smartstore_app;
GRANT INSERT (sale_id) ON cash_transaction TO smartstore_app;

GRANT SELECT ON shift_count TO smartstore_app;
GRANT INSERT (id, cash_shift_id, store_id, organization_id, counted_amount, counted_by) ON shift_count TO smartstore_app;
GRANT UPDATE (acknowledged_by, reason_code_id) ON shift_count TO smartstore_app;

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'Migrations are forward-only and are never rolled back (docs/database/CONVENTIONS.md s14).'; END $$;
