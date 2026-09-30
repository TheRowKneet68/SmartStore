-- migrate:up

-- Domain 1: Organization / Store / Warehouse.
-- Design, citations and decisions: docs/database/D1-ORGANIZATION-STORE-WAREHOUSE.md
-- Conventions: docs/database/CONVENTIONS.md

-- ============================================================================ time zones

CREATE FUNCTION is_known_time_zone(p_name text) RETURNS boolean
  LANGUAGE plpgsql STABLE STRICT
AS $$
BEGIN
  -- An IANA name (Area/Location) or UTC. Abbreviations such as PST and POSIX strings such as UTC+5 are refused:
  -- PostgreSQL accepts them, but they carry no daylight-saving rules and a browser's Intl API does not.
  IF p_name !~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+-]+)+)$' THEN
    RETURN false;
  END IF;
  PERFORM now() AT TIME ZONE p_name;
  RETURN true;
EXCEPTION WHEN invalid_parameter_value THEN
  RETURN false;
END
$$;

COMMENT ON FUNCTION is_known_time_zone(text) IS
  'Cites: ORG-02, RT-505, RT-353. True when the name is an IANA time zone the database knows, so business dates are computed in a real zone with its daylight-saving rules.';

CREATE DOMAIN time_zone_name AS text
  CONSTRAINT ck_time_zone_name CHECK (is_known_time_zone(VALUE));

COMMENT ON DOMAIN time_zone_name IS
  'Cites: ORG-02, RT-505. A time zone by IANA name; the business date is a calendar date in such a zone (overview s3.3).';

-- ============================================================================ currency

CREATE TABLE currency (
  code                text        NOT NULL,
  minor_unit_exponent smallint    NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_currency PRIMARY KEY (code),
  CONSTRAINT ck_currency_code CHECK (code ~ '^[A-Z]{3}$'),
  CONSTRAINT ck_currency_exponent CHECK (minor_unit_exponent BETWEEN 0 AND 18)
);

COMMENT ON TABLE currency IS
  'Cites: BI-01, ADR-04, ADR-06. A currency and its minor-unit exponent. Money is stored as integer minor units, so the exponent gives an amount its scale; it is recorded, never assumed to be 2 (overview s3.1).';
COMMENT ON CONSTRAINT ck_currency_code ON currency IS
  'Cites: BI-01. A currency code is three upper-case letters.';
COMMENT ON CONSTRAINT ck_currency_exponent ON currency IS
  'Cites: ADR-04, BI-01. Zero- and three-decimal currencies are representable; 10^exponent must fit in a bigint amount.';

-- ============================================================================ organization

CREATE TABLE organization (
  id                      uuid           NOT NULL DEFAULT gen_random_uuid(),
  legal_name              nonblank_text  NOT NULL,
  trading_name            nonblank_text,
  registration_identifier nonblank_text,
  currency_code           text           NOT NULL,
  time_zone               time_zone_name NOT NULL,
  created_at              timestamptz    NOT NULL DEFAULT now(),
  deactivated_at          timestamptz,
  deactivated_by          uuid,
  CONSTRAINT pk_organization PRIMARY KEY (id),
  CONSTRAINT fk_organization_currency FOREIGN KEY (currency_code) REFERENCES currency (code),
  CONSTRAINT ck_organization_deactivation CHECK ((deactivated_at IS NULL) = (deactivated_by IS NULL))
);

COMMENT ON TABLE organization IS
  'Cites: RT-506, ORG-03, BI-40. The tenant boundary: every entity belongs to exactly one organization, and an organization is deactivated, never deleted.';
COMMENT ON CONSTRAINT fk_organization_currency ON organization IS
  'Cites: ORG-01, RT-504. The organization currency.';
COMMENT ON CONSTRAINT ck_organization_deactivation ON organization IS
  'Cites: RT-506, BI-40. A deactivation records who and when together.';

-- ============================================================================ store

CREATE TABLE store (
  id              uuid           NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid           NOT NULL,
  code            nonblank_text  NOT NULL,
  name            nonblank_text  NOT NULL,
  address         nonblank_text,
  contact_details nonblank_text,
  time_zone       time_zone_name NOT NULL,
  currency_code   text           NOT NULL,
  created_at      timestamptz    NOT NULL DEFAULT now(),
  deactivated_at  timestamptz,
  deactivated_by  uuid,
  CONSTRAINT pk_store PRIMARY KEY (id),
  CONSTRAINT fk_store_organization FOREIGN KEY (organization_id) REFERENCES organization (id),
  CONSTRAINT fk_store_currency FOREIGN KEY (currency_code) REFERENCES currency (code),
  CONSTRAINT uq_store_code UNIQUE (organization_id, code),
  CONSTRAINT uq_store_id_organization UNIQUE (id, organization_id),
  CONSTRAINT ck_store_deactivation CHECK ((deactivated_at IS NULL) = (deactivated_by IS NULL))
);

COMMENT ON TABLE store IS
  'Cites: RT-001, MS-01, RT-269, ORG-05, RT-508. A point of sale and the scope every store-scoped row carries; deactivated, never deleted.';
COMMENT ON CONSTRAINT fk_store_organization ON store IS
  'Cites: RT-001, RT-269. A store belongs to exactly one organization, which may have many.';
COMMENT ON CONSTRAINT fk_store_currency ON store IS
  'Cites: BI-01, BI-11. The store currency. It is immutable (organization-model s3.1), so the application role cannot update it.';
COMMENT ON CONSTRAINT uq_store_code ON store IS
  'Cites: RT-269. A store code identifies one store within its organization (uniqueness scope: OQ-008).';
COMMENT ON CONSTRAINT uq_store_id_organization ON store IS
  'Cites: RT-001, BI-14. Lets a child row prove, by foreign key, that it belongs to the same organization as its store.';
COMMENT ON CONSTRAINT ck_store_deactivation ON store IS
  'Cites: ORG-05, RT-445, RT-508. A deactivation records who and when together.';

-- ============================================================================ deactivation (organization, store)

CREATE FUNCTION record_deactivation() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.deactivated_by IS NOT NULL THEN
    IF NEW.deactivated_by IS DISTINCT FROM OLD.deactivated_by
       OR NEW.deactivated_at IS DISTINCT FROM OLD.deactivated_at THEN
      RAISE EXCEPTION '% % is already deactivated; who deactivated it and when cannot be changed', TG_TABLE_NAME, OLD.id
        USING ERRCODE = 'SS001';
    END IF;
  ELSIF NEW.deactivated_by IS NOT NULL THEN
    NEW.deactivated_at := now();  -- server time, never a client clock (RT-353)
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION record_deactivation() IS
  'Cites: BI-40, RT-506, RT-508, RT-353. Deactivation is recorded once, stamped with server time; who and when cannot be rewritten or cleared. No reactivation is specified (OQ-001).';

CREATE TRIGGER tg_organization_deactivation BEFORE UPDATE ON organization
  FOR EACH ROW EXECUTE FUNCTION record_deactivation();
COMMENT ON TRIGGER tg_organization_deactivation ON organization IS
  'Cites: RT-506, BI-40. Records an organization''s deactivation once, with server time.';

CREATE TRIGGER tg_store_deactivation BEFORE UPDATE ON store
  FOR EACH ROW EXECUTE FUNCTION record_deactivation();
COMMENT ON TRIGGER tg_store_deactivation ON store IS
  'Cites: RT-508, ORG-05. Records a store''s deactivation once, with server time.';

-- ============================================================================ store settings

CREATE TABLE store_setting_version (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid(),
  store_id              uuid        NOT NULL,
  effective_from        timestamptz NOT NULL DEFAULT now(),
  tax_mode              text        NOT NULL,
  negative_stock_policy text        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid        NOT NULL,
  CONSTRAINT pk_store_setting_version PRIMARY KEY (id),
  CONSTRAINT fk_store_setting_version_store FOREIGN KEY (store_id) REFERENCES store (id),
  CONSTRAINT uq_store_setting_version_effective UNIQUE (store_id, effective_from),
  CONSTRAINT ck_store_setting_version_prospective CHECK (effective_from >= created_at),
  CONSTRAINT ck_store_setting_version_tax_mode CHECK (tax_mode IN ('Inclusive', 'Exclusive')),
  CONSTRAINT ck_store_setting_version_negative_stock CHECK (negative_stock_policy IN ('AllowNegative', 'BlockNegative'))
);

COMMENT ON TABLE store_setting_version IS
  'Cites: REQ-AU-06, RT-046, PR-38, SP-33, IV-16. Append-only versions of the store settings that change money or stock, each with an effective timestamp; a financial document references the version it was computed under.';
COMMENT ON CONSTRAINT fk_store_setting_version_store ON store_setting_version IS
  'Cites: RT-001, MS-01. Settings belong to one store.';
COMMENT ON CONSTRAINT uq_store_setting_version_effective ON store_setting_version IS
  'Cites: REQ-AU-06. At most one version takes effect at an instant, so the settings in force are never ambiguous.';
COMMENT ON CONSTRAINT ck_store_setting_version_prospective ON store_setting_version IS
  'Cites: REQ-AU-06, RT-353. A change takes effect now or later, never in the past (organization-model s3.1: prospective only). created_at is server time.';
COMMENT ON CONSTRAINT ck_store_setting_version_tax_mode ON store_setting_version IS
  'Cites: SP-33, PR-38, RT-046. Prices are tax-inclusive or tax-exclusive.';
COMMENT ON CONSTRAINT ck_store_setting_version_negative_stock ON store_setting_version IS
  'Cites: IV-16, RT-483, CON-07. The negative-stock policy the inventory transaction evaluates.';

-- ============================================================================ warehouse

CREATE TABLE warehouse (
  id              uuid          NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid          NOT NULL,
  store_id        uuid,
  kind            text          NOT NULL,
  code            nonblank_text NOT NULL,
  name            nonblank_text NOT NULL,
  address         nonblank_text,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT pk_warehouse PRIMARY KEY (id),
  CONSTRAINT ck_warehouse_kind CHECK (kind IN ('StoreAttached', 'Central')),
  CONSTRAINT ck_warehouse_store_iff_attached CHECK ((kind = 'StoreAttached') = (store_id IS NOT NULL)),
  CONSTRAINT fk_warehouse_organization FOREIGN KEY (organization_id) REFERENCES organization (id),
  CONSTRAINT fk_warehouse_store FOREIGN KEY (store_id, organization_id) REFERENCES store (id, organization_id),
  CONSTRAINT uq_warehouse_code UNIQUE (organization_id, code),
  CONSTRAINT uq_warehouse_id_kind_organization UNIQUE (id, kind, organization_id)
);

CREATE INDEX ix_warehouse_store ON warehouse (store_id);

COMMENT ON TABLE warehouse IS
  'Cites: RT-003, MS-15. Holds stock. Store-attached (belongs to one store) or central (belongs to the organization and does not sell), never both.';
COMMENT ON CONSTRAINT ck_warehouse_kind ON warehouse IS
  'Cites: RT-003. The two warehouse kinds (organization-model s4).';
COMMENT ON CONSTRAINT ck_warehouse_store_iff_attached ON warehouse IS
  'Cites: RT-003, MS-15. A store-attached warehouse names its store; a central warehouse names none.';
COMMENT ON CONSTRAINT fk_warehouse_organization ON warehouse IS
  'Cites: RT-003. Every warehouse belongs to an organization.';
COMMENT ON CONSTRAINT fk_warehouse_store ON warehouse IS
  'Cites: RT-003, BI-14. A store-attached warehouse belongs to a store of the same organization.';
COMMENT ON CONSTRAINT uq_warehouse_code ON warehouse IS
  'Cites: RT-003. A warehouse code identifies one warehouse within its organization (uniqueness scope: OQ-008).';
COMMENT ON CONSTRAINT uq_warehouse_id_kind_organization ON warehouse IS
  'Cites: RT-004, MS-18. Lets a location carry its warehouse kind by foreign key, so a central location can be refused sellability.';
COMMENT ON INDEX ix_warehouse_store IS
  'Cites: BI-14, MS-04. Finds a store''s warehouses when resolving store scope.';

-- ============================================================================ storage location

CREATE TABLE storage_location (
  id              uuid          NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid          NOT NULL,
  warehouse_id    uuid          NOT NULL,
  warehouse_kind  text          NOT NULL,
  code            nonblank_text NOT NULL,
  name            nonblank_text NOT NULL,
  location_type   text          NOT NULL,
  is_sellable     boolean       NOT NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT pk_storage_location PRIMARY KEY (id),
  CONSTRAINT fk_storage_location_warehouse FOREIGN KEY (warehouse_id, warehouse_kind, organization_id)
    REFERENCES warehouse (id, kind, organization_id),
  CONSTRAINT ck_storage_location_type
    CHECK (location_type IN ('Default', 'Receiving', 'Quarantine', 'Damaged', 'ReturnsPending', 'Transit')),
  CONSTRAINT ck_storage_location_sellable_type CHECK (NOT is_sellable OR location_type = 'Default'),
  CONSTRAINT ck_storage_location_central_not_sellable CHECK (NOT is_sellable OR warehouse_kind = 'StoreAttached'),
  CONSTRAINT uq_storage_location_code UNIQUE (warehouse_id, code),
  CONSTRAINT uq_storage_location_id_kind_organization UNIQUE (id, warehouse_kind, organization_id)
);

CREATE UNIQUE INDEX uq_storage_location_one_default ON storage_location (warehouse_id)
  WHERE location_type = 'Default';

COMMENT ON TABLE storage_location IS
  'Cites: MS-17, RT-057, WH-03, RT-509. The leaf that holds stock: stock exists only at a location. It carries no StoreId (D-03); its store is its warehouse''s, or an attribution for a central location.';
COMMENT ON CONSTRAINT fk_storage_location_warehouse ON storage_location IS
  'Cites: MS-17, D-03. A location belongs to one warehouse, and carries that warehouse''s kind and organization by foreign key.';
COMMENT ON CONSTRAINT ck_storage_location_type ON storage_location IS
  'Cites: WH-04, RT-510. The standard location types of organization-model s5.';
COMMENT ON CONSTRAINT ck_storage_location_sellable_type ON storage_location IS
  'Cites: WH-01, WH-04, RT-510. Only a Default location can be sellable; receiving, quarantine, damaged, returns-pending and transit stock is never sold from (organization-model s5).';
COMMENT ON CONSTRAINT ck_storage_location_central_not_sellable ON storage_location IS
  'Cites: RT-004, MS-15, MS-18, WH-02. A central warehouse does not sell, so none of its locations is sellable.';
COMMENT ON CONSTRAINT uq_storage_location_code ON storage_location IS
  'Cites: MS-17. A location code identifies one location within its warehouse (uniqueness scope: OQ-008).';
COMMENT ON CONSTRAINT uq_storage_location_id_kind_organization ON storage_location IS
  'Cites: D-03, MS-16. Lets an attribution prove, by foreign key, that its location is central and in the same organization.';
COMMENT ON INDEX uq_storage_location_one_default IS
  'Cites: MS-17, RT-057. At most one Default location per warehouse (organization-model s5: one per warehouse).';

CREATE FUNCTION assert_warehouse_has_default_location() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage_location WHERE warehouse_id = NEW.id AND location_type = 'Default') THEN
    RAISE EXCEPTION 'warehouse % has no Default storage location', NEW.id
      USING ERRCODE = 'SS002',
            HINT = 'Create the Default location in the same transaction as the warehouse.';
  END IF;
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION assert_warehouse_has_default_location() IS
  'Cites: MS-17, RT-057. At commit, a new warehouse has its Default location (organization-model s1: the default location is required; the rule has no ID of its own).';

CREATE CONSTRAINT TRIGGER tg_warehouse_default_location AFTER INSERT ON warehouse
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_warehouse_has_default_location();
COMMENT ON TRIGGER tg_warehouse_default_location ON warehouse IS
  'Cites: MS-17, RT-057. Checked at commit, so the warehouse and its Default location are created together.';

-- ============================================================================ store attribution (D-03)

CREATE TABLE storage_location_attribution (
  storage_location_id     uuid        NOT NULL,
  location_warehouse_kind text        NOT NULL,
  organization_id         uuid        NOT NULL,
  store_id                uuid        NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid        NOT NULL,
  CONSTRAINT pk_storage_location_attribution PRIMARY KEY (storage_location_id, store_id),
  CONSTRAINT ck_storage_location_attribution_central CHECK (location_warehouse_kind = 'Central'),
  CONSTRAINT fk_storage_location_attribution_location
    FOREIGN KEY (storage_location_id, location_warehouse_kind, organization_id)
    REFERENCES storage_location (id, warehouse_kind, organization_id),
  CONSTRAINT fk_storage_location_attribution_store FOREIGN KEY (store_id, organization_id)
    REFERENCES store (id, organization_id)
);

CREATE INDEX ix_storage_location_attribution_store ON storage_location_attribution (store_id);

COMMENT ON TABLE storage_location_attribution IS
  'Cites: D-03, MS-16, MS-19. The explicit (StorageLocation, Store) attribution for central-warehouse locations; several stores may draw on one location. A store-attached location is attributed to its warehouse''s store and has no row here.';
COMMENT ON CONSTRAINT ck_storage_location_attribution_central ON storage_location_attribution IS
  'Cites: D-03, MS-15. Only a central-warehouse location is attributed explicitly.';
COMMENT ON CONSTRAINT fk_storage_location_attribution_location ON storage_location_attribution IS
  'Cites: D-03. The attributed location, proven central and in the same organization.';
COMMENT ON CONSTRAINT fk_storage_location_attribution_store ON storage_location_attribution IS
  'Cites: D-03, BI-14. The attributed store, in the same organization as the location.';
COMMENT ON INDEX ix_storage_location_attribution_store IS
  'Cites: BI-14, MS-04. Finds the central locations a store may draw on when resolving store scope.';

-- ============================================================================ document numbers

CREATE TABLE document_type (
  code       nonblank_text NOT NULL,
  created_at timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT pk_document_type PRIMARY KEY (code)
);

COMMENT ON TABLE document_type IS
  'Cites: BI-42, RT-479, ADR-21. The closed set of numbered document types. A domain that creates a document type adds its row in a migration; the application cannot.';

CREATE TABLE document_number_sequence (
  store_id      uuid          NOT NULL,
  document_type nonblank_text NOT NULL,
  last_value    bigint        NOT NULL,
  CONSTRAINT pk_document_number_sequence PRIMARY KEY (store_id, document_type),
  CONSTRAINT fk_document_number_sequence_store FOREIGN KEY (store_id) REFERENCES store (id),
  CONSTRAINT fk_document_number_sequence_type FOREIGN KEY (document_type) REFERENCES document_type (code),
  CONSTRAINT ck_document_number_sequence_positive CHECK (last_value >= 1)
);

COMMENT ON TABLE document_number_sequence IS
  'Cites: BI-42, RT-479. The last document number issued per store and document type. Numbers are never reused.';
COMMENT ON CONSTRAINT fk_document_number_sequence_store ON document_number_sequence IS
  'Cites: BI-42, RT-001. Numbering is per store.';
COMMENT ON CONSTRAINT fk_document_number_sequence_type ON document_number_sequence IS
  'Cites: BI-42, ADR-21. Numbering is per document type, from the closed set.';
COMMENT ON CONSTRAINT ck_document_number_sequence_positive ON document_number_sequence IS
  'Cites: BI-42. Numbers start at 1.';

CREATE FUNCTION allocate_document_number(p_store_id uuid, p_document_type text) RETURNS bigint
  LANGUAGE sql VOLATILE
AS $$
  INSERT INTO document_number_sequence AS s (store_id, document_type, last_value)
  VALUES (p_store_id, p_document_type, 1)
  ON CONFLICT (store_id, document_type) DO UPDATE SET last_value = s.last_value + 1
  RETURNING s.last_value
$$;

COMMENT ON FUNCTION allocate_document_number(uuid, text) IS
  'Cites: BI-42, RT-479, RT-234. Issues the next number for a store and document type inside the caller''s transaction. The counter row stays locked until commit, so concurrent allocations are serialized, and a rollback returns the number unissued.';

CREATE FUNCTION forbid_document_number_decrease() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.last_value <= OLD.last_value THEN
    RAISE EXCEPTION 'document number counter for store % and type % cannot move from % to %',
      OLD.store_id, OLD.document_type, OLD.last_value, NEW.last_value
      USING ERRCODE = 'SS003';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION forbid_document_number_decrease() IS
  'Cites: BI-42, RT-479. A counter that moved backwards would issue a number a second time.';

CREATE TRIGGER tg_document_number_sequence_forward BEFORE UPDATE ON document_number_sequence
  FOR EACH ROW EXECUTE FUNCTION forbid_document_number_decrease();
COMMENT ON TRIGGER tg_document_number_sequence_forward ON document_number_sequence IS
  'Cites: BI-42. Document-number counters only move forward.';

-- ============================================================================ runtime role grants (ADR-11, CONVENTIONS s10)
-- No DELETE anywhere (BI-40). created_at is never insertable, so it is always server time (RT-353).
-- Columns absent from an UPDATE list are immutable to the application.

GRANT SELECT ON currency TO smartstore_app;
GRANT INSERT (code, minor_unit_exponent) ON currency TO smartstore_app;
-- no UPDATE: changing an exponent would reinterpret every stored amount (BI-01, ADR-04)

GRANT SELECT ON organization TO smartstore_app;
GRANT INSERT (id, legal_name, trading_name, registration_identifier, currency_code, time_zone)
  ON organization TO smartstore_app;
GRANT UPDATE (legal_name, trading_name, registration_identifier, currency_code, time_zone, deactivated_by)
  ON organization TO smartstore_app;
-- currency_code and time_zone stay updatable: ORG-01/ORG-02 allow a change until a financial document exists, and
-- the guard arrives with the first financial-document table (CONVENTIONS s12).

GRANT SELECT ON store TO smartstore_app;
GRANT INSERT (id, organization_id, code, name, address, contact_details, time_zone, currency_code)
  ON store TO smartstore_app;
GRANT UPDATE (code, name, address, contact_details, deactivated_by) ON store TO smartstore_app;
-- organization_id: a store never changes tenant. currency_code: immutable (organization-model s3.1).
-- time_zone: no store time-zone change is built until OQ-007 is answered.

GRANT SELECT ON store_setting_version TO smartstore_app;
GRANT INSERT (id, store_id, effective_from, tax_mode, negative_stock_policy, created_by)
  ON store_setting_version TO smartstore_app;
-- append-only: no UPDATE, no DELETE (REQ-AU-06: a document references the version it was computed under)

GRANT SELECT ON warehouse TO smartstore_app;
GRANT INSERT (id, organization_id, store_id, kind, code, name, address) ON warehouse TO smartstore_app;
GRANT UPDATE (code, name, address) ON warehouse TO smartstore_app;

GRANT SELECT ON storage_location TO smartstore_app;
GRANT INSERT (id, organization_id, warehouse_id, warehouse_kind, code, name, location_type, is_sellable)
  ON storage_location TO smartstore_app;
GRANT UPDATE (code, name, is_sellable) ON storage_location TO smartstore_app;
-- location_type is immutable, so a warehouse's Default location stays its Default location.

GRANT SELECT ON storage_location_attribution TO smartstore_app;
GRANT INSERT (storage_location_id, location_warehouse_kind, organization_id, store_id, created_by)
  ON storage_location_attribution TO smartstore_app;

GRANT SELECT ON document_type TO smartstore_app;

GRANT SELECT ON document_number_sequence TO smartstore_app;
GRANT INSERT (store_id, document_type, last_value) ON document_number_sequence TO smartstore_app;
GRANT UPDATE (last_value) ON document_number_sequence TO smartstore_app;

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'Migrations are forward-only and are never rolled back (docs/database/CONVENTIONS.md s14).'; END $$;
