-- migrate:up

-- Domain 2: Product / Barcode / Unit.
-- Design, citations and decisions: docs/database/D2-PRODUCT-BARCODE-UNIT.md
-- Conventions: docs/database/CONVENTIONS.md

-- ============================================================================ state machines, as data

CREATE TABLE state_machine_state (
  machine    nonblank_text NOT NULL,
  state      nonblank_text NOT NULL,
  is_initial boolean       NOT NULL,
  CONSTRAINT pk_state_machine_state PRIMARY KEY (machine, state)
);

COMMENT ON TABLE state_machine_state IS
  'Cites: SM-07, ADR-19, ADR-21. The closed state set of each lifecycle machine; a state is added only by a reviewed migration.';

CREATE TABLE state_machine_edge (
  machine    nonblank_text NOT NULL,
  from_state nonblank_text NOT NULL,
  to_state   nonblank_text NOT NULL,
  event      nonblank_text NOT NULL,
  CONSTRAINT pk_state_machine_edge PRIMARY KEY (machine, from_state, to_state),
  CONSTRAINT uq_state_machine_edge_event UNIQUE (machine, from_state, event),
  CONSTRAINT fk_state_machine_edge_from FOREIGN KEY (machine, from_state) REFERENCES state_machine_state (machine, state),
  CONSTRAINT fk_state_machine_edge_to FOREIGN KEY (machine, to_state) REFERENCES state_machine_state (machine, state),
  CONSTRAINT ck_state_machine_edge_not_loop CHECK (from_state <> to_state)
);

COMMENT ON TABLE state_machine_edge IS
  'Cites: SM-02, SM-05, SM-07, ADR-19. Every legal transition of every machine. A state with no outgoing edge is terminal, and the graph is asserted in tests.';
COMMENT ON CONSTRAINT uq_state_machine_edge_event ON state_machine_edge IS
  'Cites: SM-02. A named event from a state leads to exactly one destination.';
COMMENT ON CONSTRAINT fk_state_machine_edge_from ON state_machine_edge IS
  'Cites: SM-07. An edge starts at a state of its machine.';
COMMENT ON CONSTRAINT fk_state_machine_edge_to ON state_machine_edge IS
  'Cites: SM-07. An edge ends at a state of its machine.';
COMMENT ON CONSTRAINT ck_state_machine_edge_not_loop ON state_machine_edge IS
  'Cites: SM-04. Repeating a transition to the current state is a no-op, not an edge.';

CREATE FUNCTION enforce_state_transition() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  v_machine text := TG_ARGV[0];
  v_column  text := TG_ARGV[1];
  v_new     text := to_jsonb(NEW) ->> v_column;
  v_old     text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM state_machine_state
                   WHERE machine = v_machine AND state = v_new AND is_initial) THEN
      RAISE EXCEPTION '% cannot be created in state %', v_machine, v_new USING ERRCODE = 'SS004';
    END IF;
  ELSE
    v_old := to_jsonb(OLD) ->> v_column;
    IF v_new IS DISTINCT FROM v_old
       AND NOT EXISTS (SELECT 1 FROM state_machine_edge
                       WHERE machine = v_machine AND from_state = v_old AND to_state = v_new) THEN
      RAISE EXCEPTION '% cannot move from % to %', v_machine, v_old, v_new USING ERRCODE = 'SS004';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION enforce_state_transition() IS
  'Cites: SM-02, SM-05, SM-06, SM-07. Refuses a creation state that is not initial and a change of state that is not an edge of the machine, with a code the application names (SS004).';

-- ============================================================================ archival (category, variant, barcode)

CREATE FUNCTION record_archival() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.archived_by IS NOT NULL THEN
    IF NEW.archived_by IS DISTINCT FROM OLD.archived_by OR NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
      RAISE EXCEPTION '% % is already archived; who archived it and when cannot be changed', TG_TABLE_NAME, OLD.id
        USING ERRCODE = 'SS001';
    END IF;
  ELSIF NEW.archived_by IS NOT NULL THEN
    NEW.archived_at := now();  -- server time, never a client clock (RT-353)
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION record_archival() IS
  'Cites: BI-40, PR-05, PR-48, RT-353. Archival is recorded once, stamped with server time; who and when cannot be rewritten or cleared.';

-- ============================================================================ units

CREATE TABLE unit (
  id              uuid          NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid          NOT NULL,
  code            nonblank_text NOT NULL,
  name            nonblank_text NOT NULL,
  plural_name     nonblank_text,
  quantity_kind   text          NOT NULL,
  scale           smallint      NOT NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT pk_unit PRIMARY KEY (id),
  CONSTRAINT fk_unit_organization FOREIGN KEY (organization_id) REFERENCES organization (id),
  CONSTRAINT uq_unit_code UNIQUE (organization_id, code),
  CONSTRAINT uq_unit_id_organization UNIQUE (id, organization_id),
  CONSTRAINT ck_unit_quantity_kind CHECK (quantity_kind IN ('Countable', 'Measurable', 'Service')),
  CONSTRAINT ck_unit_scale CHECK (scale BETWEEN 0 AND 4),
  CONSTRAINT ck_unit_countable_whole CHECK (quantity_kind <> 'Countable' OR scale = 0)
);

COMMENT ON TABLE unit IS
  'Cites: PR-14, PR-15, RT-033, RT-491. A unit of measure the organization defines once; every variant stores stock in its base unit.';
COMMENT ON CONSTRAINT fk_unit_organization ON unit IS
  'Cites: PR-15. Units are organization-global.';
COMMENT ON CONSTRAINT uq_unit_code ON unit IS
  'Cites: PR-15. A unit code identifies one unit within its organization.';
COMMENT ON CONSTRAINT uq_unit_id_organization ON unit IS
  'Cites: RT-001, BI-14. Lets a variant prove, by foreign key, that its base unit is in its own organization.';
COMMENT ON CONSTRAINT ck_unit_quantity_kind ON unit IS
  'Cites: PR-14, RT-491. Countable, measurable, or service (product-domain s6.1).';
COMMENT ON CONSTRAINT ck_unit_scale ON unit IS
  'Cites: ADR-06. Quantities are numeric(18,4), so a unit''s entry scale is at most 4 decimals.';
COMMENT ON CONSTRAINT ck_unit_countable_whole ON unit IS
  'Cites: PR-14, RT-033. A countable unit is stored as whole numbers (overview s3.2).';

-- ============================================================================ tax

CREATE TABLE tax_category (
  id              uuid          NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid          NOT NULL,
  code            nonblank_text NOT NULL,
  name            nonblank_text NOT NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT pk_tax_category PRIMARY KEY (id),
  CONSTRAINT fk_tax_category_organization FOREIGN KEY (organization_id) REFERENCES organization (id),
  CONSTRAINT uq_tax_category_code UNIQUE (organization_id, code),
  CONSTRAINT uq_tax_category_id_organization UNIQUE (id, organization_id)
);

COMMENT ON TABLE tax_category IS
  'Cites: PR-40, RT-493, SP-38. Groups variants for tax. Exempt is a zero-rate category, never a missing one. No rate or category is seeded: those are jurisdictional facts (D-12, GAP-044).';
COMMENT ON CONSTRAINT fk_tax_category_organization ON tax_category IS
  'Cites: PR-40. Tax categories are organization-global.';
COMMENT ON CONSTRAINT uq_tax_category_code ON tax_category IS
  'Cites: PR-40. A tax category code identifies one category within its organization.';
COMMENT ON CONSTRAINT uq_tax_category_id_organization ON tax_category IS
  'Cites: RT-001, BI-14. Lets a rate or variant prove, by foreign key, that its category is in its own organization.';

CREATE TABLE tax_rate (
  id              uuid          NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid          NOT NULL,
  tax_category_id uuid          NOT NULL,
  jurisdiction    nonblank_text NOT NULL,
  rate_percent    numeric(9, 4) NOT NULL,
  effective_from  timestamptz   NOT NULL DEFAULT now(),
  created_at      timestamptz   NOT NULL DEFAULT now(),
  created_by      uuid          NOT NULL,
  CONSTRAINT pk_tax_rate PRIMARY KEY (id),
  CONSTRAINT fk_tax_rate_category FOREIGN KEY (tax_category_id, organization_id)
    REFERENCES tax_category (id, organization_id),
  CONSTRAINT uq_tax_rate_effective UNIQUE (tax_category_id, effective_from),
  CONSTRAINT ck_tax_rate_non_negative CHECK (rate_percent >= 0),
  CONSTRAINT ck_tax_rate_prospective CHECK (effective_from >= created_at)
);

COMMENT ON TABLE tax_rate IS
  'Cites: PR-37, RT-047, BI-18. Append-only versions of a category''s rate: a change is a new version with an effective time, never an edit, so a document always shows the rate that applied.';
COMMENT ON CONSTRAINT fk_tax_rate_category ON tax_rate IS
  'Cites: PR-37. A rate belongs to one tax category of the same organization.';
COMMENT ON CONSTRAINT uq_tax_rate_effective ON tax_rate IS
  'Cites: PR-37, BI-18. One version takes effect at an instant, so the rate in force is unambiguous (jurisdiction selection: OQ-012).';
COMMENT ON CONSTRAINT ck_tax_rate_non_negative ON tax_rate IS
  'Cites: PR-40. A rate is a non-negative percentage; zero is how exemption is expressed.';
COMMENT ON CONSTRAINT ck_tax_rate_prospective ON tax_rate IS
  'Cites: PR-37, RT-353. A new rate takes effect now or later; created_at is server time.';

-- ============================================================================ category

CREATE TABLE category (
  id              uuid          NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid          NOT NULL,
  parent_id       uuid,
  name            nonblank_text NOT NULL,
  sort_order      integer       NOT NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  archived_by     uuid,
  CONSTRAINT pk_category PRIMARY KEY (id),
  CONSTRAINT fk_category_organization FOREIGN KEY (organization_id) REFERENCES organization (id),
  CONSTRAINT fk_category_parent FOREIGN KEY (parent_id, organization_id) REFERENCES category (id, organization_id),
  CONSTRAINT uq_category_id_organization UNIQUE (id, organization_id),
  CONSTRAINT ck_category_not_own_parent CHECK (parent_id <> id),
  CONSTRAINT ck_category_archival CHECK ((archived_at IS NULL) = (archived_by IS NULL))
);

CREATE INDEX ix_category_parent ON category (parent_id);

COMMENT ON TABLE category IS
  'Cites: PR-04, PR-05, PR-06, RT-026, RT-027, RT-488. A single-parent category tree with an explicit sort order; archived, never deleted.';
COMMENT ON CONSTRAINT fk_category_organization ON category IS
  'Cites: PR-04. Categories are organization-global.';
COMMENT ON CONSTRAINT fk_category_parent ON category IS
  'Cites: PR-04, RT-026. At most one parent, in the same organization.';
COMMENT ON CONSTRAINT uq_category_id_organization ON category IS
  'Cites: RT-001, BI-14. Lets a child category or product prove, by foreign key, that the category is in its own organization.';
COMMENT ON CONSTRAINT ck_category_not_own_parent ON category IS
  'Cites: RT-026, EC-42. A category is never its own parent.';
COMMENT ON CONSTRAINT ck_category_archival ON category IS
  'Cites: PR-05, RT-027. An archival records who and when together.';
COMMENT ON INDEX ix_category_parent IS
  'Cites: PR-04, RT-026. Walks the tree from a parent to its children.';

CREATE FUNCTION prevent_category_cycle() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL AND NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
    -- Two concurrent moves could each pass the check and together form a cycle, so moves are serialized per tree.
    PERFORM pg_advisory_xact_lock(hashtextextended('smartstore.category_tree.' || NEW.organization_id::text, 0));
    IF EXISTS (
      WITH RECURSIVE ancestor (id, parent_id) AS (
        SELECT id, parent_id FROM category WHERE id = NEW.parent_id
        UNION
        SELECT c.id, c.parent_id FROM category c JOIN ancestor a ON c.id = a.parent_id
      )
      SELECT 1 FROM ancestor WHERE id = NEW.id
    ) THEN
      RAISE EXCEPTION 'category % cannot be moved under itself or under one of its own descendants', NEW.id
        USING ERRCODE = 'SS006';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION prevent_category_cycle() IS
  'Cites: RT-026, EC-42, PR-04. Refuses a move that would put a category beneath itself or its own descendant.';

CREATE TRIGGER tg_category_no_cycle BEFORE UPDATE OF parent_id ON category
  FOR EACH ROW EXECUTE FUNCTION prevent_category_cycle();
COMMENT ON TRIGGER tg_category_no_cycle ON category IS
  'Cites: RT-026, EC-42. Keeps the category tree acyclic when a category is moved.';

CREATE TRIGGER tg_category_archival BEFORE UPDATE ON category
  FOR EACH ROW EXECUTE FUNCTION record_archival();
COMMENT ON TRIGGER tg_category_archival ON category IS
  'Cites: PR-05, RT-027. Records a category''s archival once, with server time.';

-- ============================================================================ brand

CREATE TABLE brand (
  id              uuid          NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid          NOT NULL,
  name            nonblank_text NOT NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT pk_brand PRIMARY KEY (id),
  CONSTRAINT fk_brand_organization FOREIGN KEY (organization_id) REFERENCES organization (id),
  CONSTRAINT uq_brand_id_organization UNIQUE (id, organization_id)
);

CREATE UNIQUE INDEX uq_brand_name ON brand (organization_id, lower(name));

COMMENT ON TABLE brand IS
  'Cites: RT-021, PR-01. An optional, organization-global brand; a product with no brand has a null brand, never a placeholder (product-domain s3).';
COMMENT ON CONSTRAINT fk_brand_organization ON brand IS
  'Cites: RT-021. Brands are organization-global.';
COMMENT ON CONSTRAINT uq_brand_id_organization ON brand IS
  'Cites: RT-001, BI-14. Lets a product prove, by foreign key, that its brand is in its own organization.';
COMMENT ON INDEX uq_brand_name IS
  'Cites: RT-021. A brand name is unique within its organization, case-insensitively (product-domain s3).';

-- ============================================================================ product

CREATE TABLE product (
  id                uuid          NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid          NOT NULL,
  category_id       uuid          NOT NULL,
  brand_id          uuid,
  name              nonblank_text NOT NULL,
  description       nonblank_text,
  status            text          NOT NULL DEFAULT 'Draft',
  status_changed_at timestamptz   NOT NULL DEFAULT now(),
  status_changed_by uuid          NOT NULL,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT pk_product PRIMARY KEY (id),
  CONSTRAINT fk_product_category FOREIGN KEY (category_id, organization_id) REFERENCES category (id, organization_id),
  CONSTRAINT fk_product_brand FOREIGN KEY (brand_id, organization_id) REFERENCES brand (id, organization_id),
  CONSTRAINT uq_product_id_organization UNIQUE (id, organization_id),
  CONSTRAINT ck_product_status CHECK (status IN ('Draft', 'Active', 'Discontinued', 'Hidden', 'Archived'))
);

CREATE INDEX ix_product_category ON product (category_id);

COMMENT ON TABLE product IS
  'Cites: RT-021, PR-01, PR-02, SM-11, SM-13, RT-444. The SPU a shopper recognises; never stocked or sold directly, never deleted.';
COMMENT ON CONSTRAINT fk_product_category ON product IS
  'Cites: PR-04. A product belongs to exactly one category, in its own organization.';
COMMENT ON CONSTRAINT fk_product_brand ON product IS
  'Cites: RT-021. An optional brand, in the product''s own organization.';
COMMENT ON CONSTRAINT uq_product_id_organization ON product IS
  'Cites: RT-001, BI-14. Lets a variant prove, by foreign key, that its product is in its own organization.';
COMMENT ON CONSTRAINT ck_product_status ON product IS
  'Cites: SM-13a, PR-46, PR-47. The stored lifecycle states. OutOfStock is a derived condition, never stored (SM-13a, BI-02).';
COMMENT ON INDEX ix_product_category IS
  'Cites: RT-027. Finds a category''s products, for archival and navigation.';

CREATE TRIGGER tg_product_state_machine BEFORE INSERT OR UPDATE OF status ON product
  FOR EACH ROW EXECUTE FUNCTION enforce_state_transition('Product', 'status');
COMMENT ON TRIGGER tg_product_state_machine ON product IS
  'Cites: SM-02, SM-13, PR-47. A product is created Draft and moves only along the edges of state-machines s22.1.';

-- ============================================================================ variant

CREATE TABLE product_variant (
  id              uuid          NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid          NOT NULL,
  product_id      uuid          NOT NULL,
  name            nonblank_text,
  base_unit_id    uuid          NOT NULL,
  tax_category_id uuid,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  archived_by     uuid,
  CONSTRAINT pk_product_variant PRIMARY KEY (id),
  CONSTRAINT fk_product_variant_product FOREIGN KEY (product_id, organization_id) REFERENCES product (id, organization_id),
  CONSTRAINT fk_product_variant_base_unit FOREIGN KEY (base_unit_id, organization_id) REFERENCES unit (id, organization_id),
  CONSTRAINT fk_product_variant_tax_category FOREIGN KEY (tax_category_id, organization_id)
    REFERENCES tax_category (id, organization_id),
  CONSTRAINT uq_product_variant_id_organization UNIQUE (id, organization_id),
  CONSTRAINT ck_product_variant_archival CHECK ((archived_at IS NULL) = (archived_by IS NULL))
);

CREATE INDEX ix_product_variant_product ON product_variant (product_id);

COMMENT ON TABLE product_variant IS
  'Cites: RT-021, RT-022, PR-01, PR-15, RT-033, RT-443, RT-495. The SKU: the one thing that is stocked, priced, barcoded and sold. Archived, never deleted; archival blocks new use and never removes stock (EC-33).';
COMMENT ON CONSTRAINT fk_product_variant_product ON product_variant IS
  'Cites: RT-022, PR-01. A product has many variants; a variant belongs to one product of its organization.';
COMMENT ON CONSTRAINT fk_product_variant_base_unit ON product_variant IS
  'Cites: PR-15, RT-033. Every variant has a base unit, and all its stock is stored in it; the application cannot change it.';
COMMENT ON CONSTRAINT fk_product_variant_tax_category ON product_variant IS
  'Cites: PR-40, RT-493. The variant''s tax category. Null is the unclassified state, which is a validation error on a document line, never exemption.';
COMMENT ON CONSTRAINT uq_product_variant_id_organization ON product_variant IS
  'Cites: RT-001, BI-14. Lets a barcode, price or cost prove, by foreign key, that its variant is in its own organization.';
COMMENT ON CONSTRAINT ck_product_variant_archival ON product_variant IS
  'Cites: PR-48, RT-495. An archival records who and when together.';
COMMENT ON INDEX ix_product_variant_product IS
  'Cites: RT-022. Finds a product''s variants.';

CREATE TRIGGER tg_product_variant_archival BEFORE UPDATE ON product_variant
  FOR EACH ROW EXECUTE FUNCTION record_archival();
COMMENT ON TRIGGER tg_product_variant_archival ON product_variant IS
  'Cites: PR-48, RT-495, EC-33. Records a variant''s archival once, with server time.';

-- ============================================================================ barcodes

CREATE FUNCTION gtin_check_digit_valid(p_code text) RETURNS boolean
  LANGUAGE sql IMMUTABLE STRICT
AS $$
  -- CASE, not AND: SQL does not promise to evaluate AND left to right, and the digit casts must never see a letter.
  SELECT CASE WHEN p_code ~ '^[0-9]{2,}$' THEN
    (10 - (SELECT sum(substr(p_code, length(p_code) - i, 1)::int * CASE WHEN i % 2 = 1 THEN 3 ELSE 1 END)
           FROM generate_series(1, length(p_code) - 1) AS i) % 10) % 10
      = substr(p_code, length(p_code), 1)::int
  ELSE false END
$$;

COMMENT ON FUNCTION gtin_check_digit_valid(text) IS
  'Cites: PR-12, RT-490. True when the last digit is the GS1 modulo-10 check digit of the others (EAN-13, EAN-8, UPC-A, ITF-14).';

CREATE FUNCTION upc_e_expand(p_code text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT
AS $$
  SELECT CASE
    WHEN p_code !~ '^[01][0-9]{7}$' THEN NULL
    WHEN substr(p_code, 7, 1) IN ('0', '1', '2')
      THEN substr(p_code, 1, 3) || substr(p_code, 7, 1) || '0000' || substr(p_code, 4, 3) || substr(p_code, 8, 1)
    WHEN substr(p_code, 7, 1) = '3'
      THEN substr(p_code, 1, 4) || '00000' || substr(p_code, 5, 2) || substr(p_code, 8, 1)
    WHEN substr(p_code, 7, 1) = '4'
      THEN substr(p_code, 1, 5) || '00000' || substr(p_code, 6, 1) || substr(p_code, 8, 1)
    ELSE substr(p_code, 1, 6) || '0000' || substr(p_code, 7, 1) || substr(p_code, 8, 1)
  END
$$;

COMMENT ON FUNCTION upc_e_expand(text) IS
  'Cites: PR-12, RT-490. Expands a zero-suppressed UPC-E code to its UPC-A form, where its check digit is validated.';

CREATE FUNCTION barcode_lookup_key(p_value text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT
AS $$
  SELECT CASE WHEN p_value ~ '^([0-9]{8}|[0-9]{12,14})$' THEN lpad(p_value, 14, '0') ELSE p_value END
$$;

COMMENT ON FUNCTION barcode_lookup_key(text) IS
  'Cites: PR-08, PR-12, RT-024, RT-490, UX-48. The exact-match key a scan is looked up by: an all-digit GTIN-length code is left-padded to 14 digits (padded, never trimmed), so a UPC-A and the same code read as EAN-13 are one key; anything else is itself. Scans and stored barcodes use this same function.';

CREATE TABLE product_barcode (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL,
  variant_id      uuid        NOT NULL,
  value           text        NOT NULL,
  kind            text        NOT NULL,
  lookup_key      text        GENERATED ALWAYS AS (barcode_lookup_key(value)) STORED,
  is_primary      boolean     NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  archived_by     uuid,
  CONSTRAINT pk_product_barcode PRIMARY KEY (id),
  CONSTRAINT fk_product_barcode_variant FOREIGN KEY (variant_id, organization_id)
    REFERENCES product_variant (id, organization_id),
  CONSTRAINT ck_product_barcode_kind CHECK (kind IN ('EAN13', 'EAN8', 'UPC_A', 'UPC_E', 'Code128', 'ITF14',
                                                      'GS1-128', 'QR', 'PLU', 'Internal')),
  CONSTRAINT ck_product_barcode_format CHECK (
    value !~ '\s' AND value <> '' AND CASE kind
      WHEN 'EAN13'    THEN value ~ '^[0-9]{13}$' AND gtin_check_digit_valid(value)
      WHEN 'EAN8'     THEN value ~ '^[0-9]{8}$' AND gtin_check_digit_valid(value)
      WHEN 'UPC_A'    THEN value ~ '^[0-9]{12}$' AND gtin_check_digit_valid(value)
      WHEN 'UPC_E'    THEN value ~ '^[01][0-9]{7}$' AND gtin_check_digit_valid(upc_e_expand(value))
      WHEN 'ITF14'    THEN value ~ '^[0-9]{14}$' AND gtin_check_digit_valid(value)
      WHEN 'PLU'      THEN value ~ '^[0-9]+$'
      WHEN 'Internal' THEN value !~ '^([0-9]{8}|[0-9]{12,14})$'
      WHEN 'QR'       THEN true
      ELSE value ~ '^[\x21-\x7E]+$'
    END),
  CONSTRAINT ck_product_barcode_archived_not_primary CHECK (NOT (is_primary AND archived_at IS NOT NULL)),
  CONSTRAINT ck_product_barcode_archival CHECK ((archived_at IS NULL) = (archived_by IS NULL))
);

CREATE UNIQUE INDEX uq_product_barcode_active_key ON product_barcode (organization_id, lookup_key)
  WHERE archived_at IS NULL;
CREATE UNIQUE INDEX uq_product_barcode_one_primary ON product_barcode (variant_id)
  WHERE is_primary AND archived_at IS NULL;
CREATE INDEX ix_product_barcode_variant ON product_barcode (variant_id);

COMMENT ON TABLE product_barcode IS
  'Cites: RT-023, RT-024, RT-025, RT-490, PR-08, PR-09, PR-12. A variant carries many barcodes, one primary. A barcode is a string, never a number; it is never reassigned, only archived and a new one issued.';
COMMENT ON CONSTRAINT fk_product_barcode_variant ON product_barcode IS
  'Cites: RT-023. A barcode identifies one variant of its organization; the application cannot re-point it (PR-09).';
COMMENT ON CONSTRAINT ck_product_barcode_kind ON product_barcode IS
  'Cites: PR-12, PR-25. The symbologies of product-domain s5.1.';
COMMENT ON CONSTRAINT ck_product_barcode_format ON product_barcode IS
  'Cites: PR-12, RT-490. Stored canonical: no whitespace, leading zeros kept, check digit valid where the symbology has one; an Internal code can never look like a retail GTIN.';
COMMENT ON CONSTRAINT ck_product_barcode_archived_not_primary ON product_barcode IS
  'Cites: PR-08. An archived barcode is never the primary one.';
COMMENT ON CONSTRAINT ck_product_barcode_archival ON product_barcode IS
  'Cites: PR-09, RT-025. An archival records who and when together.';
COMMENT ON INDEX uq_product_barcode_active_key IS
  'Cites: PR-08, RT-024, EC-41, UX-48. The scan path: an exact match on the lookup key, unique organization-wide among live barcodes, so one scan resolves to exactly one variant. Archived barcodes leave it, so a value can be reissued (PR-10).';
COMMENT ON INDEX uq_product_barcode_one_primary IS
  'Cites: PR-08. At most one live primary barcode per variant.';
COMMENT ON INDEX ix_product_barcode_variant IS
  'Cites: RT-023. Finds a variant''s barcodes.';

CREATE FUNCTION assert_variant_has_primary_barcode() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM product_barcode WHERE variant_id = NEW.variant_id AND archived_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM product_barcode
                     WHERE variant_id = NEW.variant_id AND archived_at IS NULL AND is_primary) THEN
    RAISE EXCEPTION 'variant % has live barcodes but none is primary', NEW.variant_id
      USING ERRCODE = 'SS007', HINT = 'Mark another barcode primary in the same transaction.';
  END IF;
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION assert_variant_has_primary_barcode() IS
  'Cites: PR-08. At commit, a variant with any live barcode has exactly one primary (the unique index gives at most one).';

CREATE CONSTRAINT TRIGGER tg_product_barcode_primary AFTER INSERT OR UPDATE ON product_barcode
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_variant_has_primary_barcode();
COMMENT ON TRIGGER tg_product_barcode_primary ON product_barcode IS
  'Cites: PR-08. Checked at commit, so the primary can be moved from one barcode to another in one transaction.';

CREATE TRIGGER tg_product_barcode_archival BEFORE UPDATE ON product_barcode
  FOR EACH ROW EXECUTE FUNCTION record_archival();
COMMENT ON TRIGGER tg_product_barcode_archival ON product_barcode IS
  'Cites: PR-09, RT-025. Records a barcode''s archival once, with server time.';

-- ============================================================================ prices and cost

ALTER TABLE store ADD CONSTRAINT uq_store_id_currency UNIQUE (id, currency_code);
COMMENT ON CONSTRAINT uq_store_id_currency ON store IS
  'Cites: BI-01, PR-30. Lets a store price prove, by foreign key, that it is in the store''s own currency.';

CREATE TABLE variant_price (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL,
  variant_id      uuid        NOT NULL,
  currency_code   text        NOT NULL,
  amount          bigint      NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL,
  CONSTRAINT pk_variant_price PRIMARY KEY (id),
  CONSTRAINT fk_variant_price_variant FOREIGN KEY (variant_id, organization_id)
    REFERENCES product_variant (id, organization_id),
  CONSTRAINT fk_variant_price_currency FOREIGN KEY (currency_code) REFERENCES currency (code),
  CONSTRAINT uq_variant_price_effective UNIQUE (variant_id, effective_from),
  CONSTRAINT ck_variant_price_positive CHECK (amount > 0),
  CONSTRAINT ck_variant_price_prospective CHECK (effective_from >= created_at)
);

COMMENT ON TABLE variant_price IS
  'Cites: PR-30, PR-32, PR-34, RT-040, RT-041, RT-042. The organization default price on a variant, the last tier of price resolution. Append-only and effective-dated: a change is a new version, and sales before it keep the old price.';
COMMENT ON CONSTRAINT fk_variant_price_variant ON variant_price IS
  'Cites: RT-021. Prices belong to variants, never to products.';
COMMENT ON CONSTRAINT fk_variant_price_currency ON variant_price IS
  'Cites: BI-01. A price carries its currency; amounts are integer minor units.';
COMMENT ON CONSTRAINT uq_variant_price_effective ON variant_price IS
  'Cites: PR-32, RT-041. One version takes effect at an instant, so the price in force is unambiguous.';
COMMENT ON CONSTRAINT ck_variant_price_positive ON variant_price IS
  'Cites: PR-34, RT-042. A zero or negative price is refused; a free item is a 100% discount line.';
COMMENT ON CONSTRAINT ck_variant_price_prospective ON variant_price IS
  'Cites: PR-32, RT-041, RT-353. A price change takes effect now or later. A backdated change needs approval (PR-32), which v1 does not build, so it is refused.';

CREATE TABLE store_variant_price (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  store_id        uuid        NOT NULL,
  organization_id uuid        NOT NULL,
  variant_id      uuid        NOT NULL,
  currency_code   text        NOT NULL,
  amount          bigint      NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL,
  CONSTRAINT pk_store_variant_price PRIMARY KEY (id),
  CONSTRAINT fk_store_variant_price_store FOREIGN KEY (store_id, organization_id) REFERENCES store (id, organization_id),
  CONSTRAINT fk_store_variant_price_variant FOREIGN KEY (variant_id, organization_id)
    REFERENCES product_variant (id, organization_id),
  CONSTRAINT fk_store_variant_price_currency FOREIGN KEY (store_id, currency_code) REFERENCES store (id, currency_code),
  CONSTRAINT uq_store_variant_price_effective UNIQUE (store_id, variant_id, effective_from),
  CONSTRAINT ck_store_variant_price_positive CHECK (amount > 0),
  CONSTRAINT ck_store_variant_price_prospective CHECK (effective_from >= created_at)
);

COMMENT ON TABLE store_variant_price IS
  'Cites: PR-30, PR-32, RT-040, RT-041, RT-042. A store-specific price for a variant, which wins over the organization default (PR-30). Append-only and effective-dated.';
COMMENT ON CONSTRAINT fk_store_variant_price_store ON store_variant_price IS
  'Cites: RT-001, PR-30. A store price belongs to one store of the variant''s organization.';
COMMENT ON CONSTRAINT fk_store_variant_price_variant ON store_variant_price IS
  'Cites: RT-021. Prices belong to variants, never to products.';
COMMENT ON CONSTRAINT fk_store_variant_price_currency ON store_variant_price IS
  'Cites: BI-01. A store price is in the store''s own currency.';
COMMENT ON CONSTRAINT uq_store_variant_price_effective ON store_variant_price IS
  'Cites: PR-32, RT-041. One version per store and variant takes effect at an instant; also the index the till''s price lookup uses.';
COMMENT ON CONSTRAINT ck_store_variant_price_positive ON store_variant_price IS
  'Cites: PR-34, RT-042. A zero or negative price is refused.';
COMMENT ON CONSTRAINT ck_store_variant_price_prospective ON store_variant_price IS
  'Cites: PR-32, RT-041, RT-353. A price change takes effect now or later; created_at is server time.';

CREATE TABLE variant_standard_cost (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL,
  variant_id      uuid        NOT NULL,
  currency_code   text        NOT NULL,
  amount          bigint      NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL,
  CONSTRAINT pk_variant_standard_cost PRIMARY KEY (id),
  CONSTRAINT fk_variant_standard_cost_variant FOREIGN KEY (variant_id, organization_id)
    REFERENCES product_variant (id, organization_id),
  CONSTRAINT fk_variant_standard_cost_currency FOREIGN KEY (currency_code) REFERENCES currency (code),
  CONSTRAINT uq_variant_standard_cost_effective UNIQUE (variant_id, effective_from),
  CONSTRAINT ck_variant_standard_cost_non_negative CHECK (amount >= 0),
  CONSTRAINT ck_variant_standard_cost_prospective CHECK (effective_from >= created_at)
);

COMMENT ON TABLE variant_standard_cost IS
  'Cites: PR-33, PR-35, PR-36, RT-043, RT-044, RT-045. A variant''s standard cost, for margin and the below-cost check. It is not the batch''s actual cost, which values stock (PR-35). Append-only and effective-dated.';
COMMENT ON CONSTRAINT fk_variant_standard_cost_variant ON variant_standard_cost IS
  'Cites: PR-35. Standard cost belongs to a variant.';
COMMENT ON CONSTRAINT fk_variant_standard_cost_currency ON variant_standard_cost IS
  'Cites: BI-01. A cost carries its currency; amounts are integer minor units.';
COMMENT ON CONSTRAINT uq_variant_standard_cost_effective ON variant_standard_cost IS
  'Cites: PR-35. One version takes effect at an instant, so the current standard cost is unambiguous.';
COMMENT ON CONSTRAINT ck_variant_standard_cost_non_negative ON variant_standard_cost IS
  'Cites: BI-01, PR-35. A cost is never negative.';
COMMENT ON CONSTRAINT ck_variant_standard_cost_prospective ON variant_standard_cost IS
  'Cites: PR-35, RT-353. A cost change takes effect now or later; created_at is server time.';

-- ============================================================================ activation guards (PR-02, RT-042)

CREATE FUNCTION product_before_status_change() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
    IF OLD.status = 'Draft' AND NEW.status = 'Active' THEN
      IF NOT EXISTS (SELECT 1 FROM product_variant WHERE product_id = NEW.id AND archived_at IS NULL) THEN
        RAISE EXCEPTION 'product % cannot be activated: it has no active variant', NEW.id USING ERRCODE = 'SS005';
      END IF;
      IF EXISTS (SELECT 1 FROM product_variant v
                 WHERE v.product_id = NEW.id AND v.archived_at IS NULL
                   AND NOT EXISTS (SELECT 1 FROM variant_price p
                                   WHERE p.variant_id = v.id AND p.effective_from <= now())) THEN
        RAISE EXCEPTION 'product % cannot be activated: an active variant has no price in force', NEW.id
          USING ERRCODE = 'SS008';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION product_before_status_change() IS
  'Cites: PR-02, SM-12, RT-028, RT-042. Stamps the time of every status change, and refuses Draft to Active unless the product has an active variant and every active variant has a price in force.';

CREATE TRIGGER tg_product_status_change BEFORE UPDATE OF status ON product
  FOR EACH ROW EXECUTE FUNCTION product_before_status_change();
COMMENT ON TRIGGER tg_product_status_change ON product IS
  'Cites: PR-02, SM-12, RT-042. The completeness check on activation, and the entry time of the new state (overview s3.7).';

CREATE FUNCTION assert_new_variant_usable() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
BEGIN
  -- FOR SHARE waits for a concurrent status change of the product to commit and then reads it, so a variant added
  -- while the product is being activated cannot slip in without a price.
  SELECT status INTO v_status FROM product WHERE id = NEW.product_id FOR SHARE;
  IF v_status = 'Archived' THEN
    RAISE EXCEPTION 'product % is archived; nothing new may reference it', NEW.product_id USING ERRCODE = 'SS009';
  END IF;
  IF v_status <> 'Draft' AND NEW.archived_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM variant_price WHERE variant_id = NEW.id AND effective_from <= now()) THEN
    RAISE EXCEPTION 'variant % of a released product needs a price in force', NEW.id USING ERRCODE = 'SS008';
  END IF;
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION assert_new_variant_usable() IS
  'Cites: RT-042, PR-34, PR-47, SM-13. At commit, a new variant of an archived product is refused, and a new variant of a released product carries a price in force.';

CREATE CONSTRAINT TRIGGER tg_product_variant_usable AFTER INSERT ON product_variant
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_new_variant_usable();
COMMENT ON TRIGGER tg_product_variant_usable ON product_variant IS
  'Cites: RT-042, SM-13. Checked at commit, so a variant and its first price are created together.';

-- ============================================================================ the Product machine (state-machines s22.1)

INSERT INTO state_machine_state (machine, state, is_initial) VALUES
  ('Product', 'Draft', true),
  ('Product', 'Active', false),
  ('Product', 'Discontinued', false),
  ('Product', 'Hidden', false),
  ('Product', 'Archived', false);

INSERT INTO state_machine_edge (machine, from_state, to_state, event) VALUES
  ('Product', 'Draft', 'Active', 'activate'),
  ('Product', 'Active', 'Discontinued', 'discontinue'),
  ('Product', 'Discontinued', 'Active', 'reactivate'),
  ('Product', 'Active', 'Hidden', 'hide'),
  ('Product', 'Hidden', 'Active', 'unhide'),
  ('Product', 'Draft', 'Archived', 'archive'),
  ('Product', 'Active', 'Archived', 'archive'),
  ('Product', 'Discontinued', 'Archived', 'archive'),
  ('Product', 'Hidden', 'Archived', 'archive');
-- Not an edge: Active -> Draft (its reversal is OPEN DECISION in s22.1), Draft -> Hidden (drawn in s1's diagram but
-- has no contract row, OQ-009), and anything out of Archived (terminal, PR-47, SM-13).

-- ============================================================================ runtime role grants (ADR-11, CONVENTIONS s10)

GRANT SELECT ON state_machine_state, state_machine_edge TO smartstore_app;

GRANT SELECT ON unit TO smartstore_app;
GRANT INSERT (id, organization_id, code, name, plural_name, quantity_kind, scale) ON unit TO smartstore_app;
GRANT UPDATE (code, name, plural_name, quantity_kind, scale) ON unit TO smartstore_app;
-- quantity_kind stays updatable until the unit is used in a movement or document (PR-14, RT-491); that guard
-- arrives with the first movement and document tables (CONVENTIONS s12).

GRANT SELECT ON tax_category TO smartstore_app;
GRANT INSERT (id, organization_id, code, name) ON tax_category TO smartstore_app;
GRANT UPDATE (code, name) ON tax_category TO smartstore_app;

GRANT SELECT ON tax_rate TO smartstore_app;
GRANT INSERT (id, organization_id, tax_category_id, jurisdiction, rate_percent, effective_from, created_by)
  ON tax_rate TO smartstore_app;
-- append-only (PR-37, RT-047)

GRANT SELECT ON category TO smartstore_app;
GRANT INSERT (id, organization_id, parent_id, name, sort_order) ON category TO smartstore_app;
GRANT UPDATE (parent_id, name, sort_order, archived_by) ON category TO smartstore_app;

GRANT SELECT ON brand TO smartstore_app;
GRANT INSERT (id, organization_id, name) ON brand TO smartstore_app;
GRANT UPDATE (name) ON brand TO smartstore_app;

GRANT SELECT ON product TO smartstore_app;
GRANT INSERT (id, organization_id, category_id, brand_id, name, description, status_changed_by)
  ON product TO smartstore_app;
GRANT UPDATE (category_id, brand_id, name, description, status, status_changed_by) ON product TO smartstore_app;
-- status is not insertable: every product is created Draft (PR-02).

GRANT SELECT ON product_variant TO smartstore_app;
GRANT INSERT (id, organization_id, product_id, name, base_unit_id, tax_category_id) ON product_variant TO smartstore_app;
GRANT UPDATE (name, tax_category_id, archived_by) ON product_variant TO smartstore_app;
-- product_id and base_unit_id are immutable: a variant never changes product, and changing a base unit would
-- reinterpret every stored quantity (PR-15). name stays updatable until a document references the variant (PR-03's
-- intent; guard pending with the first document table).

GRANT SELECT ON product_barcode TO smartstore_app;
GRANT INSERT (id, organization_id, variant_id, value, kind, is_primary) ON product_barcode TO smartstore_app;
GRANT UPDATE (is_primary, archived_by) ON product_barcode TO smartstore_app;
-- value, kind and variant_id are immutable: a barcode is never reassigned (PR-09).

GRANT SELECT ON variant_price, store_variant_price, variant_standard_cost TO smartstore_app;
GRANT INSERT (id, organization_id, variant_id, currency_code, amount, effective_from, created_by)
  ON variant_price TO smartstore_app;
GRANT INSERT (id, store_id, organization_id, variant_id, currency_code, amount, effective_from, created_by)
  ON store_variant_price TO smartstore_app;
GRANT INSERT (id, organization_id, variant_id, currency_code, amount, effective_from, created_by)
  ON variant_standard_cost TO smartstore_app;
-- append-only (PR-32: a change is a new effective-dated version; history is never rewritten)

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'Migrations are forward-only and are never rolled back (docs/database/CONVENTIONS.md s14).'; END $$;
