-- migrate:up

-- Domain 4, part 1 of 2: the till and its cash (terminal, drawer, shift, cash ledger), the walk-in customer, and
-- payment methods. Part 2 (d4_sale_and_payment) adds checkout, payment and sale.
-- Design, citations and decisions: docs/database/D4-SALE-PAYMENT.md

-- ============================================================================ the walk-in customer (CU-01)

CREATE TABLE customer (
  id              uuid          NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid          NOT NULL,
  is_walk_in      boolean       NOT NULL,
  display_name    nonblank_text NOT NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT pk_customer PRIMARY KEY (id),
  CONSTRAINT fk_customer_organization FOREIGN KEY (organization_id) REFERENCES organization (id),
  CONSTRAINT uq_customer_id_organization UNIQUE (id, organization_id)
);

CREATE UNIQUE INDEX uq_customer_one_walk_in ON customer (organization_id) WHERE is_walk_in;

COMMENT ON TABLE customer IS
  'Cites: CU-01, RT-001. A customer. v1 builds only the identity a sale needs: a walk-in is a customer record, never a null. Named customers, accounts, credit and loyalty are deferred.';
COMMENT ON CONSTRAINT fk_customer_organization ON customer IS
  'Cites: CU-01, CU-06. Customers are organization-global (organization-model s8.1).';
COMMENT ON CONSTRAINT uq_customer_id_organization ON customer IS
  'Cites: RT-001, BI-14. Lets a sale prove, by foreign key, that its customer is in its own organization.';
COMMENT ON INDEX uq_customer_one_walk_in IS
  'Cites: CU-01. One shared walk-in record per organization.';

-- ============================================================================ POS terminal (organization-model s6)

CREATE TABLE pos_terminal (
  id                    uuid          NOT NULL DEFAULT gen_random_uuid(),
  store_id              uuid          NOT NULL,
  organization_id       uuid          NOT NULL,
  code                  nonblank_text NOT NULL,
  label                 nonblank_text NOT NULL,
  mode                  text          NOT NULL DEFAULT 'Standard',
  status                text          NOT NULL DEFAULT 'Registered',
  sell_from_location_id uuid          NOT NULL,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  status_changed_at     timestamptz   NOT NULL DEFAULT now(),
  status_changed_by     uuid          NOT NULL,
  CONSTRAINT pk_pos_terminal PRIMARY KEY (id),
  CONSTRAINT fk_pos_terminal_store FOREIGN KEY (store_id, organization_id) REFERENCES store (id, organization_id),
  CONSTRAINT fk_pos_terminal_location FOREIGN KEY (sell_from_location_id, organization_id)
    REFERENCES storage_location (id, organization_id),
  CONSTRAINT uq_pos_terminal_code UNIQUE (store_id, code),
  CONSTRAINT uq_pos_terminal_id_store UNIQUE (id, store_id),
  CONSTRAINT ck_pos_terminal_mode CHECK (mode IN ('Standard', 'Training', 'Maintenance')),
  CONSTRAINT ck_pos_terminal_status CHECK (status IN ('Registered', 'Active', 'Disabled', 'Retired'))
);

COMMENT ON TABLE pos_terminal IS
  'Cites: PT-01, PT-02, PT-03, RT-122, RT-423, SM-59. A registered till bound to exactly one store. Its mode (Standard, Training, Maintenance) is configuration, and its status is the device lifecycle; the two are separate axes (ADR-27).';
COMMENT ON CONSTRAINT fk_pos_terminal_store ON pos_terminal IS
  'Cites: PT-02, RT-001. A terminal belongs to one store, always; the application cannot move it.';
COMMENT ON CONSTRAINT fk_pos_terminal_location ON pos_terminal IS
  'Cites: WH-01, RT-004. The sellable location this till sells from, in its own organization (which location a till sells from: OQ-019).';
COMMENT ON CONSTRAINT uq_pos_terminal_code ON pos_terminal IS
  'Cites: PT-01. A terminal code identifies one till within its store.';
COMMENT ON CONSTRAINT uq_pos_terminal_id_store ON pos_terminal IS
  'Cites: PT-02, BI-14. Lets a drawer, shift or sale prove, by foreign key, that it uses a terminal of its own store.';
COMMENT ON CONSTRAINT ck_pos_terminal_mode ON pos_terminal IS
  'Cites: PT-03, SM-59, RT-423. The three modes; a mode is a field, not a lifecycle step.';
COMMENT ON CONSTRAINT ck_pos_terminal_status ON pos_terminal IS
  'Cites: SM-60, HD-08. The stored device states a till uses in v1. Degraded and Offline are health telemetry (SM-61) and arrive with device monitoring.';

CREATE FUNCTION assert_terminal_sells_from_own_location() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM storage_location l JOIN warehouse w ON w.id = l.warehouse_id
       WHERE l.id = NEW.sell_from_location_id AND l.is_sellable AND w.store_id = NEW.store_id) THEN
    RAISE EXCEPTION 'terminal % must sell from a sellable location of its own store', NEW.id USING ERRCODE = 'SS032';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION assert_terminal_sells_from_own_location() IS
  'Cites: WH-01, RT-004, MS-18, PT-02. A till sells only from a sellable location of its own store.';

CREATE TRIGGER tg_pos_terminal_location BEFORE INSERT OR UPDATE OF sell_from_location_id ON pos_terminal
  FOR EACH ROW EXECUTE FUNCTION assert_terminal_sells_from_own_location();
COMMENT ON TRIGGER tg_pos_terminal_location ON pos_terminal IS
  'Cites: WH-01, RT-004. Checks the till''s sell-from location.';

CREATE FUNCTION stamp_status_change() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION stamp_status_change() IS
  'Cites: SM-03, RT-353. Stamps the entry into a new state with server time (overview s3.7).';

CREATE TRIGGER tg_pos_terminal_status_stamp BEFORE UPDATE OF status ON pos_terminal
  FOR EACH ROW EXECUTE FUNCTION stamp_status_change();
COMMENT ON TRIGGER tg_pos_terminal_status_stamp ON pos_terminal IS
  'Cites: SM-03. Server time for each terminal status change.';

CREATE TRIGGER tg_pos_terminal_state_machine BEFORE INSERT OR UPDATE OF status ON pos_terminal
  FOR EACH ROW EXECUTE FUNCTION enforce_state_transition('Device', 'status');
COMMENT ON TRIGGER tg_pos_terminal_state_machine ON pos_terminal IS
  'Cites: SM-60, HD-08, SM-02. A terminal is registered, activated, disabled and retired only along the Device edges of state-machines s22.12.';

-- ============================================================================ cash drawer (organization-model s7)

CREATE TABLE cash_drawer (
  id              uuid          NOT NULL DEFAULT gen_random_uuid(),
  store_id        uuid          NOT NULL,
  pos_terminal_id uuid          NOT NULL,
  label           nonblank_text NOT NULL,
  currency_code   text          NOT NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT pk_cash_drawer PRIMARY KEY (id),
  CONSTRAINT fk_cash_drawer_terminal FOREIGN KEY (pos_terminal_id, store_id) REFERENCES pos_terminal (id, store_id),
  CONSTRAINT fk_cash_drawer_currency FOREIGN KEY (store_id, currency_code) REFERENCES store (id, currency_code),
  CONSTRAINT uq_cash_drawer_one_per_terminal UNIQUE (pos_terminal_id),
  CONSTRAINT uq_cash_drawer_identity UNIQUE (id, pos_terminal_id, store_id)
);

COMMENT ON TABLE cash_drawer IS
  'Cites: CD-01, CD-05, CD-36, RT-005. The physical cash container at a terminal. Single-currency, in the store''s currency.';
COMMENT ON CONSTRAINT fk_cash_drawer_terminal ON cash_drawer IS
  'Cites: CD-01, RT-005. A drawer belongs to one terminal of its store.';
COMMENT ON CONSTRAINT fk_cash_drawer_currency ON cash_drawer IS
  'Cites: CD-36, BI-01. A drawer holds one currency, the store''s.';
COMMENT ON CONSTRAINT uq_cash_drawer_one_per_terminal ON cash_drawer IS
  'Cites: CD-34. At most one drawer per terminal in v1 (organization-model s1: PosTerminal to CashDrawer is 1 to 0..1).';
COMMENT ON CONSTRAINT uq_cash_drawer_identity ON cash_drawer IS
  'Cites: RT-122, BI-14. Lets a shift prove, by foreign key, that its drawer belongs to its terminal and store.';

-- ============================================================================ cash shift (cash-management s2, s22.11)

CREATE TABLE cash_shift (
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  store_id          uuid        NOT NULL,
  pos_terminal_id   uuid        NOT NULL,
  cash_drawer_id    uuid        NOT NULL,
  opened_by         uuid        NOT NULL,
  opened_at         timestamptz NOT NULL DEFAULT now(),
  closed_by         uuid,
  closed_at         timestamptz,
  status            text        NOT NULL DEFAULT 'Open',
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  status_changed_by uuid        NOT NULL,
  CONSTRAINT pk_cash_shift PRIMARY KEY (id),
  CONSTRAINT fk_cash_shift_drawer FOREIGN KEY (cash_drawer_id, pos_terminal_id, store_id)
    REFERENCES cash_drawer (id, pos_terminal_id, store_id),
  CONSTRAINT uq_cash_shift_identity UNIQUE (id, cash_drawer_id, pos_terminal_id, store_id),
  CONSTRAINT uq_cash_shift_drawer_store UNIQUE (id, cash_drawer_id, store_id),
  CONSTRAINT ck_cash_shift_status CHECK (status IN ('Open', 'Reconciling', 'Closed', 'Reopened')),
  CONSTRAINT ck_cash_shift_closed CHECK ((closed_at IS NULL) = (closed_by IS NULL)),
  CONSTRAINT ck_cash_shift_closed_when CHECK ((status = 'Closed') = (closed_by IS NOT NULL))
);

CREATE UNIQUE INDEX uq_cash_shift_open_per_drawer ON cash_shift (cash_drawer_id)
  WHERE status IN ('Open', 'Reconciling');
CREATE UNIQUE INDEX uq_cash_shift_open_per_employee ON cash_shift (store_id, opened_by)
  WHERE status IN ('Open', 'Reconciling');

COMMENT ON TABLE cash_shift IS
  'Cites: CD-02, CD-03, CD-05, BI-39, RT-005, SM-55, SM-58. The till shift: a drawer''s money for one cashier''s session. It stores only who, when, where and its status; every amount is derived from its cash transactions and sales (cash-management s2).';
COMMENT ON CONSTRAINT fk_cash_shift_drawer ON cash_shift IS
  'Cites: CD-05, RT-005, RT-122. A cash shift needs a drawer, and the drawer belongs to the shift''s terminal and store. A terminal without a drawer has no cash shift.';
COMMENT ON CONSTRAINT uq_cash_shift_identity ON cash_shift IS
  'Cites: RT-122, PY-46. Lets a checkout or sale prove, by foreign key, that its shift, drawer, terminal and store agree.';
COMMENT ON CONSTRAINT uq_cash_shift_drawer_store ON cash_shift IS
  'Cites: CD-19, BI-14. Lets a cash transaction prove, by foreign key, that its drawer and store are its shift''s.';
COMMENT ON CONSTRAINT ck_cash_shift_status ON cash_shift IS
  'Cites: SM-55, SM-56a, SM-58. The shift states of cash-management s2; there is no void state.';
COMMENT ON CONSTRAINT ck_cash_shift_closed ON cash_shift IS
  'Cites: CD-20, SM-03. A close records who and when together.';
COMMENT ON CONSTRAINT ck_cash_shift_closed_when ON cash_shift IS
  'Cites: CD-20, SM-57. A shift records who closed it exactly when it is Closed.';
COMMENT ON INDEX uq_cash_shift_open_per_drawer IS
  'Cites: CD-01, CD-03, BI-39. At most one open shift per drawer: a uniqueness constraint, not a check-then-act.';
COMMENT ON INDEX uq_cash_shift_open_per_employee IS
  'Cites: CD-03, BI-39. At most one open shift per employee per store.';

CREATE FUNCTION cash_shift_before_write() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM pos_terminal WHERE id = NEW.pos_terminal_id AND status = 'Active') THEN
      RAISE EXCEPTION 'terminal % is not in service', NEW.pos_terminal_id USING ERRCODE = 'SS025';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
    IF NEW.status = 'Closed' THEN
      NEW.closed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION cash_shift_before_write() IS
  'Cites: CD-10, CD-20, SM-03, RT-353. A shift opens only on a terminal in service; each transition, and the close, is stamped with server time.';

CREATE TRIGGER tg_cash_shift_before_write BEFORE INSERT OR UPDATE ON cash_shift
  FOR EACH ROW EXECUTE FUNCTION cash_shift_before_write();
COMMENT ON TRIGGER tg_cash_shift_before_write ON cash_shift IS
  'Cites: CD-10, SM-03. Opening check and transition stamps.';

CREATE TRIGGER tg_cash_shift_state_machine BEFORE INSERT OR UPDATE OF status ON cash_shift
  FOR EACH ROW EXECUTE FUNCTION enforce_state_transition('Shift', 'status');
COMMENT ON TRIGGER tg_cash_shift_state_machine ON cash_shift IS
  'Cites: SM-55, SM-56, SM-02. A shift is created Open and moves only along the edges of state-machines s22.11.';

-- ============================================================================ cash transactions (cash-management s5)

CREATE TABLE cash_transaction (
  seq            bigint      GENERATED ALWAYS AS IDENTITY,
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  cash_shift_id  uuid        NOT NULL,
  cash_drawer_id uuid        NOT NULL,
  store_id       uuid        NOT NULL,
  type           text        NOT NULL,
  direction      text        NOT NULL,
  amount         bigint      NOT NULL,
  currency_code  text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  CONSTRAINT pk_cash_transaction PRIMARY KEY (id),
  CONSTRAINT uq_cash_transaction_seq UNIQUE (seq),
  CONSTRAINT fk_cash_transaction_shift FOREIGN KEY (cash_shift_id, cash_drawer_id, store_id)
    REFERENCES cash_shift (id, cash_drawer_id, store_id),
  CONSTRAINT fk_cash_transaction_currency FOREIGN KEY (store_id, currency_code) REFERENCES store (id, currency_code),
  CONSTRAINT ck_cash_transaction_type CHECK (type IN ('OpeningFloat', 'ChangeDisbursed', 'ClosingFloat')),
  CONSTRAINT ck_cash_transaction_direction CHECK (
    direction = CASE type WHEN 'OpeningFloat' THEN 'In' ELSE 'Out' END),
  CONSTRAINT ck_cash_transaction_amount CHECK (amount > 0 OR (amount = 0 AND type IN ('OpeningFloat', 'ClosingFloat')))
);

COMMENT ON TABLE cash_transaction IS
  'Cites: CD-11, CD-18, CD-19, RT-135. The drawer''s ledger: every cash movement is a row, never a field update. v1 writes the opening float, change given, and the closing float; the other types of cash-management s5 arrive with their flows.';
COMMENT ON CONSTRAINT uq_cash_transaction_seq ON cash_transaction IS
  'Cites: CD-19. A total order over the drawer ledger.';
COMMENT ON CONSTRAINT fk_cash_transaction_shift ON cash_transaction IS
  'Cites: CD-19, PY-46. A cash movement belongs to one shift, and its drawer and store are the shift''s.';
COMMENT ON CONSTRAINT fk_cash_transaction_currency ON cash_transaction IS
  'Cites: CD-36, BI-01. Cash is in the store''s currency, as integer minor units.';
COMMENT ON CONSTRAINT ck_cash_transaction_type ON cash_transaction IS
  'Cites: CD-11, CD-18, CD-20. The cash transaction types v1 writes (cash-management s5).';
COMMENT ON CONSTRAINT ck_cash_transaction_direction ON cash_transaction IS
  'Cites: CD-19, BI-05. Each type has its fixed direction; an amount is never signed.';
COMMENT ON CONSTRAINT ck_cash_transaction_amount ON cash_transaction IS
  'Cites: CD-14, CD-18. A float may be zero (CD-14); change given is a positive disbursement.';

CREATE TRIGGER tg_cash_transaction_immutable BEFORE UPDATE OR DELETE ON cash_transaction
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_rewrite();
COMMENT ON TRIGGER tg_cash_transaction_immutable ON cash_transaction IS
  'Cites: CD-19, BI-08. A cash movement is never updated or deleted, whatever the role.';

CREATE TRIGGER tg_cash_transaction_no_truncate BEFORE TRUNCATE ON cash_transaction
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_ledger_rewrite();
COMMENT ON TRIGGER tg_cash_transaction_no_truncate ON cash_transaction IS
  'Cites: CD-19, AU-32. The drawer ledger cannot be emptied in bulk.';

CREATE FUNCTION assert_shift_opening_float() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF (SELECT count(*) FROM cash_transaction WHERE cash_shift_id = NEW.id AND type = 'OpeningFloat') <> 1 THEN
    RAISE EXCEPTION 'shift % must be opened with exactly one counted opening float', NEW.id USING ERRCODE = 'SS042';
  END IF;
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION assert_shift_opening_float() IS
  'Cites: CD-10, CD-11, CD-14, RT-005. At commit, a new shift has exactly one opening-float cash transaction, which may be zero; the float is never a field.';

CREATE CONSTRAINT TRIGGER tg_cash_shift_opening_float AFTER INSERT ON cash_shift
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_shift_opening_float();
COMMENT ON TRIGGER tg_cash_shift_opening_float ON cash_shift IS
  'Cites: CD-11. The shift and its opening float are created together.';

-- ============================================================================ payment methods (payment-domain s2)

CREATE TABLE payment_method (
  id              uuid          NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid          NOT NULL,
  code            nonblank_text NOT NULL,
  name            nonblank_text NOT NULL,
  method_type     text          NOT NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT pk_payment_method PRIMARY KEY (id),
  CONSTRAINT fk_payment_method_organization FOREIGN KEY (organization_id) REFERENCES organization (id),
  CONSTRAINT uq_payment_method_code UNIQUE (organization_id, code),
  CONSTRAINT uq_payment_method_type UNIQUE (id, method_type),
  CONSTRAINT ck_payment_method_type CHECK (method_type IN ('Cash', 'Card'))
);

COMMENT ON TABLE payment_method IS
  'Cites: PY-03, PY-04, ADR-09. A typed payment method; the type decides the settlement logic. v1 supports Cash and Card; stored-value, credit and wallet types arrive with their balances (PY-29).';
COMMENT ON CONSTRAINT fk_payment_method_organization ON payment_method IS
  'Cites: PY-03. Methods are configured per organization.';
COMMENT ON CONSTRAINT uq_payment_method_code ON payment_method IS
  'Cites: PY-04. A method code identifies one method within its organization.';
COMMENT ON CONSTRAINT uq_payment_method_type ON payment_method IS
  'Cites: PY-03, CD-09. Lets a payment prove, by foreign key, which type of method it used.';
COMMENT ON CONSTRAINT ck_payment_method_type ON payment_method IS
  'Cites: PY-03, ADR-09. The method types v1 settles: cash in the drawer, and card through the provider abstraction.';

CREATE TABLE store_payment_method (
  store_id          uuid        NOT NULL,
  payment_method_id uuid        NOT NULL,
  is_enabled        boolean     NOT NULL,
  changed_at        timestamptz NOT NULL DEFAULT now(),
  changed_by        uuid        NOT NULL,
  CONSTRAINT pk_store_payment_method PRIMARY KEY (store_id, payment_method_id),
  CONSTRAINT fk_store_payment_method_store FOREIGN KEY (store_id) REFERENCES store (id),
  CONSTRAINT fk_store_payment_method_method FOREIGN KEY (payment_method_id) REFERENCES payment_method (id)
);

COMMENT ON TABLE store_payment_method IS
  'Cites: PY-04, PY-05. Whether a method may be used at a store. Enablement is prospective: disabling stops new use and historical payments render unchanged.';
COMMENT ON CONSTRAINT fk_store_payment_method_store ON store_payment_method IS
  'Cites: PY-04, RT-001. Enablement is per store.';
COMMENT ON CONSTRAINT fk_store_payment_method_method ON store_payment_method IS
  'Cites: PY-04. Of a configured method.';

CREATE FUNCTION stamp_changed_at() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  NEW.changed_at := now();
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION stamp_changed_at() IS
  'Cites: RT-353, PY-05. Stamps a configuration change with server time.';

CREATE TRIGGER tg_store_payment_method_stamp BEFORE UPDATE ON store_payment_method
  FOR EACH ROW EXECUTE FUNCTION stamp_changed_at();
COMMENT ON TRIGGER tg_store_payment_method_stamp ON store_payment_method IS
  'Cites: PY-05. Server time for each enablement change.';

-- ============================================================================ machines (s22.11, s22.12)

INSERT INTO state_machine_state (machine, state, is_initial) VALUES
  ('Device', 'Registered', true),
  ('Device', 'Active', false),
  ('Device', 'Disabled', false),
  ('Device', 'Retired', false),
  ('Shift', 'Open', true),
  ('Shift', 'Reconciling', false),
  ('Shift', 'Closed', false),
  ('Shift', 'Reopened', false);

INSERT INTO state_machine_edge (machine, from_state, to_state, event) VALUES
  ('Device', 'Registered', 'Active', 'activate'),
  ('Device', 'Active', 'Disabled', 'disable'),
  ('Device', 'Disabled', 'Active', 'activate'),
  ('Device', 'Registered', 'Retired', 'retire'),
  ('Device', 'Active', 'Retired', 'retire'),
  ('Device', 'Disabled', 'Retired', 'retire'),
  ('Shift', 'Open', 'Reconciling', 'begin count'),
  ('Shift', 'Reconciling', 'Closed', 'close'),
  ('Shift', 'Reopened', 'Reconciling', 'recount');
-- Not edges: Device Degraded and Offline (health telemetry, SM-61) arrive with device monitoring. Shift
-- Closed -> Reopened has an OPEN DECISION permission (s22.11, GAP-036), so it refuses (architecture s8.4), and
-- Reconciling -> Open is drawn in s12 but has no contract row (OQ-014).

-- ============================================================================ runtime role grants (ADR-11, CONVENTIONS s10)

GRANT SELECT ON customer TO smartstore_app;
GRANT INSERT (id, organization_id, is_walk_in, display_name) ON customer TO smartstore_app;

GRANT SELECT ON pos_terminal TO smartstore_app;
GRANT INSERT (id, store_id, organization_id, code, label, mode, sell_from_location_id, status_changed_by)
  ON pos_terminal TO smartstore_app;
GRANT UPDATE (label, mode, status, status_changed_by, sell_from_location_id) ON pos_terminal TO smartstore_app;
-- store_id is immutable: reassigning a terminal is not a v1 operation (PT-02).

GRANT SELECT ON cash_drawer TO smartstore_app;
GRANT INSERT (id, store_id, pos_terminal_id, label, currency_code) ON cash_drawer TO smartstore_app;
GRANT UPDATE (label) ON cash_drawer TO smartstore_app;

GRANT SELECT ON cash_shift TO smartstore_app;
GRANT INSERT (id, store_id, pos_terminal_id, cash_drawer_id, opened_by, status_changed_by) ON cash_shift TO smartstore_app;
GRANT UPDATE (status, status_changed_by, closed_by) ON cash_shift TO smartstore_app;

GRANT SELECT ON cash_transaction TO smartstore_app;
GRANT INSERT (id, cash_shift_id, cash_drawer_id, store_id, type, direction, amount, currency_code, created_by)
  ON cash_transaction TO smartstore_app;

GRANT SELECT ON payment_method TO smartstore_app;
GRANT INSERT (id, organization_id, code, name, method_type) ON payment_method TO smartstore_app;
GRANT UPDATE (name) ON payment_method TO smartstore_app;

GRANT SELECT ON store_payment_method TO smartstore_app;
GRANT INSERT (store_id, payment_method_id, is_enabled, changed_by) ON store_payment_method TO smartstore_app;
GRANT UPDATE (is_enabled, changed_by) ON store_payment_method TO smartstore_app;

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'Migrations are forward-only and are never rolled back (docs/database/CONVENTIONS.md s14).'; END $$;
