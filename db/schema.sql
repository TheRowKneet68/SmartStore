\restrict dbmate

-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: nonblank_text; Type: DOMAIN; Schema: public; Owner: -
--

CREATE DOMAIN public.nonblank_text AS text
	CONSTRAINT ck_nonblank_text CHECK (((VALUE = btrim(VALUE)) AND (VALUE <> ''::text)));


--
-- Name: DOMAIN nonblank_text; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON DOMAIN public.nonblank_text IS 'Cites: ADR-31, PR-12. Text with no leading or trailing whitespace and never empty, for codes, names and labels; identifiers that look like numbers are text, so a leading zero is data (CONVENTIONS s6).';


--
-- Name: is_known_time_zone(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_known_time_zone(p_name text) RETURNS boolean
    LANGUAGE plpgsql STABLE STRICT
    AS $_$
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
$_$;


--
-- Name: FUNCTION is_known_time_zone(p_name text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.is_known_time_zone(p_name text) IS 'Cites: ORG-02, RT-505, RT-353. True when the name is an IANA time zone the database knows, so business dates are computed in a real zone with its daylight-saving rules.';


--
-- Name: time_zone_name; Type: DOMAIN; Schema: public; Owner: -
--

CREATE DOMAIN public.time_zone_name AS text
	CONSTRAINT ck_time_zone_name CHECK (public.is_known_time_zone(VALUE));


--
-- Name: DOMAIN time_zone_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON DOMAIN public.time_zone_name IS 'Cites: ORG-02, RT-505. A time zone by IANA name; the business date is a calendar date in such a zone (overview s3.3).';


--
-- Name: allocate_document_number(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.allocate_document_number(p_store_id uuid, p_document_type text) RETURNS bigint
    LANGUAGE sql
    AS $$
  INSERT INTO document_number_sequence AS s (store_id, document_type, last_value)
  VALUES (p_store_id, p_document_type, 1)
  ON CONFLICT (store_id, document_type) DO UPDATE SET last_value = s.last_value + 1
  RETURNING s.last_value
$$;


--
-- Name: FUNCTION allocate_document_number(p_store_id uuid, p_document_type text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.allocate_document_number(p_store_id uuid, p_document_type text) IS 'Cites: BI-42, RT-479, RT-234. Issues the next number for a store and document type inside the caller''s transaction. The counter row stays locked until commit, so concurrent allocations are serialized, and a rollback returns the number unissued.';


--
-- Name: assert_warehouse_has_default_location(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_warehouse_has_default_location() RETURNS trigger
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


--
-- Name: FUNCTION assert_warehouse_has_default_location(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.assert_warehouse_has_default_location() IS 'Cites: MS-17, RT-057. At commit, a new warehouse has its Default location (organization-model s1: the default location is required; the rule has no ID of its own).';


--
-- Name: forbid_document_number_decrease(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.forbid_document_number_decrease() RETURNS trigger
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


--
-- Name: FUNCTION forbid_document_number_decrease(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.forbid_document_number_decrease() IS 'Cites: BI-42, RT-479. A counter that moved backwards would issue a number a second time.';


--
-- Name: record_deactivation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_deactivation() RETURNS trigger
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


--
-- Name: FUNCTION record_deactivation(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.record_deactivation() IS 'Cites: BI-40, RT-506, RT-508, RT-353. Deactivation is recorded once, stamped with server time; who and when cannot be rewritten or cleared. No reactivation is specified (OQ-001).';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: currency; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.currency (
    code text NOT NULL,
    minor_unit_exponent smallint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_currency_code CHECK ((code ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT ck_currency_exponent CHECK (((minor_unit_exponent >= 0) AND (minor_unit_exponent <= 18)))
);


--
-- Name: TABLE currency; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.currency IS 'Cites: BI-01, ADR-04, ADR-06. A currency and its minor-unit exponent. Money is stored as integer minor units, so the exponent gives an amount its scale; it is recorded, never assumed to be 2 (overview s3.1).';


--
-- Name: CONSTRAINT ck_currency_code ON currency; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_currency_code ON public.currency IS 'Cites: BI-01. A currency code is three upper-case letters.';


--
-- Name: CONSTRAINT ck_currency_exponent ON currency; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_currency_exponent ON public.currency IS 'Cites: ADR-04, BI-01. Zero- and three-decimal currencies are representable; 10^exponent must fit in a bigint amount.';


--
-- Name: document_number_sequence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_number_sequence (
    store_id uuid NOT NULL,
    document_type public.nonblank_text NOT NULL,
    last_value bigint NOT NULL,
    CONSTRAINT ck_document_number_sequence_positive CHECK ((last_value >= 1))
);


--
-- Name: TABLE document_number_sequence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.document_number_sequence IS 'Cites: BI-42, RT-479. The last document number issued per store and document type. Numbers are never reused.';


--
-- Name: CONSTRAINT ck_document_number_sequence_positive ON document_number_sequence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_document_number_sequence_positive ON public.document_number_sequence IS 'Cites: BI-42. Numbers start at 1.';


--
-- Name: document_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_type (
    code public.nonblank_text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE document_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.document_type IS 'Cites: BI-42, RT-479, ADR-21. The closed set of numbered document types. A domain that creates a document type adds its row in a migration; the application cannot.';


--
-- Name: organization; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    legal_name public.nonblank_text NOT NULL,
    trading_name public.nonblank_text,
    registration_identifier public.nonblank_text,
    currency_code text NOT NULL,
    time_zone public.time_zone_name NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deactivated_at timestamp with time zone,
    deactivated_by uuid,
    CONSTRAINT ck_organization_deactivation CHECK (((deactivated_at IS NULL) = (deactivated_by IS NULL)))
);


--
-- Name: TABLE organization; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.organization IS 'Cites: RT-506, ORG-03, BI-40. The tenant boundary: every entity belongs to exactly one organization, and an organization is deactivated, never deleted.';


--
-- Name: CONSTRAINT ck_organization_deactivation ON organization; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_organization_deactivation ON public.organization IS 'Cites: RT-506, BI-40. A deactivation records who and when together.';


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: storage_location; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storage_location (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    warehouse_id uuid NOT NULL,
    warehouse_kind text NOT NULL,
    code public.nonblank_text NOT NULL,
    name public.nonblank_text NOT NULL,
    location_type text NOT NULL,
    is_sellable boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_storage_location_central_not_sellable CHECK (((NOT is_sellable) OR (warehouse_kind = 'StoreAttached'::text))),
    CONSTRAINT ck_storage_location_sellable_type CHECK (((NOT is_sellable) OR (location_type = 'Default'::text))),
    CONSTRAINT ck_storage_location_type CHECK ((location_type = ANY (ARRAY['Default'::text, 'Receiving'::text, 'Quarantine'::text, 'Damaged'::text, 'ReturnsPending'::text, 'Transit'::text])))
);


--
-- Name: TABLE storage_location; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.storage_location IS 'Cites: MS-17, RT-057, WH-03, RT-509. The leaf that holds stock: stock exists only at a location. It carries no StoreId (D-03); its store is its warehouse''s, or an attribution for a central location.';


--
-- Name: CONSTRAINT ck_storage_location_central_not_sellable ON storage_location; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_storage_location_central_not_sellable ON public.storage_location IS 'Cites: RT-004, MS-15, MS-18, WH-02. A central warehouse does not sell, so none of its locations is sellable.';


--
-- Name: CONSTRAINT ck_storage_location_sellable_type ON storage_location; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_storage_location_sellable_type ON public.storage_location IS 'Cites: WH-01, WH-04, RT-510. Only a Default location can be sellable; receiving, quarantine, damaged, returns-pending and transit stock is never sold from (organization-model s5).';


--
-- Name: CONSTRAINT ck_storage_location_type ON storage_location; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_storage_location_type ON public.storage_location IS 'Cites: WH-04, RT-510. The standard location types of organization-model s5.';


--
-- Name: storage_location_attribution; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storage_location_attribution (
    storage_location_id uuid NOT NULL,
    location_warehouse_kind text NOT NULL,
    organization_id uuid NOT NULL,
    store_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid NOT NULL,
    CONSTRAINT ck_storage_location_attribution_central CHECK ((location_warehouse_kind = 'Central'::text))
);


--
-- Name: TABLE storage_location_attribution; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.storage_location_attribution IS 'Cites: D-03, MS-16, MS-19. The explicit (StorageLocation, Store) attribution for central-warehouse locations; several stores may draw on one location. A store-attached location is attributed to its warehouse''s store and has no row here.';


--
-- Name: CONSTRAINT ck_storage_location_attribution_central ON storage_location_attribution; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_storage_location_attribution_central ON public.storage_location_attribution IS 'Cites: D-03, MS-15. Only a central-warehouse location is attributed explicitly.';


--
-- Name: store; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    code public.nonblank_text NOT NULL,
    name public.nonblank_text NOT NULL,
    address public.nonblank_text,
    contact_details public.nonblank_text,
    time_zone public.time_zone_name NOT NULL,
    currency_code text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deactivated_at timestamp with time zone,
    deactivated_by uuid,
    CONSTRAINT ck_store_deactivation CHECK (((deactivated_at IS NULL) = (deactivated_by IS NULL)))
);


--
-- Name: TABLE store; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.store IS 'Cites: RT-001, MS-01, RT-269, ORG-05, RT-508. A point of sale and the scope every store-scoped row carries; deactivated, never deleted.';


--
-- Name: CONSTRAINT ck_store_deactivation ON store; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_store_deactivation ON public.store IS 'Cites: ORG-05, RT-445, RT-508. A deactivation records who and when together.';


--
-- Name: store_setting_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_setting_version (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    tax_mode text NOT NULL,
    negative_stock_policy text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid NOT NULL,
    CONSTRAINT ck_store_setting_version_negative_stock CHECK ((negative_stock_policy = ANY (ARRAY['AllowNegative'::text, 'BlockNegative'::text]))),
    CONSTRAINT ck_store_setting_version_prospective CHECK ((effective_from >= created_at)),
    CONSTRAINT ck_store_setting_version_tax_mode CHECK ((tax_mode = ANY (ARRAY['Inclusive'::text, 'Exclusive'::text])))
);


--
-- Name: TABLE store_setting_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.store_setting_version IS 'Cites: REQ-AU-06, RT-046, PR-38, SP-33, IV-16. Append-only versions of the store settings that change money or stock, each with an effective timestamp; a financial document references the version it was computed under.';


--
-- Name: CONSTRAINT ck_store_setting_version_negative_stock ON store_setting_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_store_setting_version_negative_stock ON public.store_setting_version IS 'Cites: IV-16, RT-483, CON-07. The negative-stock policy the inventory transaction evaluates.';


--
-- Name: CONSTRAINT ck_store_setting_version_prospective ON store_setting_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_store_setting_version_prospective ON public.store_setting_version IS 'Cites: REQ-AU-06, RT-353. A change takes effect now or later, never in the past (organization-model s3.1: prospective only). created_at is server time.';


--
-- Name: CONSTRAINT ck_store_setting_version_tax_mode ON store_setting_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_store_setting_version_tax_mode ON public.store_setting_version IS 'Cites: SP-33, PR-38, RT-046. Prices are tax-inclusive or tax-exclusive.';


--
-- Name: warehouse; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.warehouse (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    store_id uuid,
    kind text NOT NULL,
    code public.nonblank_text NOT NULL,
    name public.nonblank_text NOT NULL,
    address public.nonblank_text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_warehouse_kind CHECK ((kind = ANY (ARRAY['StoreAttached'::text, 'Central'::text]))),
    CONSTRAINT ck_warehouse_store_iff_attached CHECK (((kind = 'StoreAttached'::text) = (store_id IS NOT NULL)))
);


--
-- Name: TABLE warehouse; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.warehouse IS 'Cites: RT-003, MS-15. Holds stock. Store-attached (belongs to one store) or central (belongs to the organization and does not sell), never both.';


--
-- Name: CONSTRAINT ck_warehouse_kind ON warehouse; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_warehouse_kind ON public.warehouse IS 'Cites: RT-003. The two warehouse kinds (organization-model s4).';


--
-- Name: CONSTRAINT ck_warehouse_store_iff_attached ON warehouse; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_warehouse_store_iff_attached ON public.warehouse IS 'Cites: RT-003, MS-15. A store-attached warehouse names its store; a central warehouse names none.';


--
-- Name: currency pk_currency; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.currency
    ADD CONSTRAINT pk_currency PRIMARY KEY (code);


--
-- Name: document_number_sequence pk_document_number_sequence; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_number_sequence
    ADD CONSTRAINT pk_document_number_sequence PRIMARY KEY (store_id, document_type);


--
-- Name: document_type pk_document_type; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_type
    ADD CONSTRAINT pk_document_type PRIMARY KEY (code);


--
-- Name: organization pk_organization; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization
    ADD CONSTRAINT pk_organization PRIMARY KEY (id);


--
-- Name: storage_location pk_storage_location; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_location
    ADD CONSTRAINT pk_storage_location PRIMARY KEY (id);


--
-- Name: storage_location_attribution pk_storage_location_attribution; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_location_attribution
    ADD CONSTRAINT pk_storage_location_attribution PRIMARY KEY (storage_location_id, store_id);


--
-- Name: store pk_store; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store
    ADD CONSTRAINT pk_store PRIMARY KEY (id);


--
-- Name: store_setting_version pk_store_setting_version; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_setting_version
    ADD CONSTRAINT pk_store_setting_version PRIMARY KEY (id);


--
-- Name: warehouse pk_warehouse; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouse
    ADD CONSTRAINT pk_warehouse PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: storage_location uq_storage_location_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_location
    ADD CONSTRAINT uq_storage_location_code UNIQUE (warehouse_id, code);


--
-- Name: CONSTRAINT uq_storage_location_code ON storage_location; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_storage_location_code ON public.storage_location IS 'Cites: MS-17. A location code identifies one location within its warehouse (uniqueness scope: OQ-008).';


--
-- Name: storage_location uq_storage_location_id_kind_organization; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_location
    ADD CONSTRAINT uq_storage_location_id_kind_organization UNIQUE (id, warehouse_kind, organization_id);


--
-- Name: CONSTRAINT uq_storage_location_id_kind_organization ON storage_location; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_storage_location_id_kind_organization ON public.storage_location IS 'Cites: D-03, MS-16. Lets an attribution prove, by foreign key, that its location is central and in the same organization.';


--
-- Name: store uq_store_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store
    ADD CONSTRAINT uq_store_code UNIQUE (organization_id, code);


--
-- Name: CONSTRAINT uq_store_code ON store; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_store_code ON public.store IS 'Cites: RT-269. A store code identifies one store within its organization (uniqueness scope: OQ-008).';


--
-- Name: store uq_store_id_organization; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store
    ADD CONSTRAINT uq_store_id_organization UNIQUE (id, organization_id);


--
-- Name: CONSTRAINT uq_store_id_organization ON store; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_store_id_organization ON public.store IS 'Cites: RT-001, BI-14. Lets a child row prove, by foreign key, that it belongs to the same organization as its store.';


--
-- Name: store_setting_version uq_store_setting_version_effective; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_setting_version
    ADD CONSTRAINT uq_store_setting_version_effective UNIQUE (store_id, effective_from);


--
-- Name: CONSTRAINT uq_store_setting_version_effective ON store_setting_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_store_setting_version_effective ON public.store_setting_version IS 'Cites: REQ-AU-06. At most one version takes effect at an instant, so the settings in force are never ambiguous.';


--
-- Name: warehouse uq_warehouse_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouse
    ADD CONSTRAINT uq_warehouse_code UNIQUE (organization_id, code);


--
-- Name: CONSTRAINT uq_warehouse_code ON warehouse; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_warehouse_code ON public.warehouse IS 'Cites: RT-003. A warehouse code identifies one warehouse within its organization (uniqueness scope: OQ-008).';


--
-- Name: warehouse uq_warehouse_id_kind_organization; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouse
    ADD CONSTRAINT uq_warehouse_id_kind_organization UNIQUE (id, kind, organization_id);


--
-- Name: CONSTRAINT uq_warehouse_id_kind_organization ON warehouse; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_warehouse_id_kind_organization ON public.warehouse IS 'Cites: RT-004, MS-18. Lets a location carry its warehouse kind by foreign key, so a central location can be refused sellability.';


--
-- Name: ix_storage_location_attribution_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_storage_location_attribution_store ON public.storage_location_attribution USING btree (store_id);


--
-- Name: INDEX ix_storage_location_attribution_store; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.ix_storage_location_attribution_store IS 'Cites: BI-14, MS-04. Finds the central locations a store may draw on when resolving store scope.';


--
-- Name: ix_warehouse_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_warehouse_store ON public.warehouse USING btree (store_id);


--
-- Name: INDEX ix_warehouse_store; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.ix_warehouse_store IS 'Cites: BI-14, MS-04. Finds a store''s warehouses when resolving store scope.';


--
-- Name: uq_storage_location_one_default; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_storage_location_one_default ON public.storage_location USING btree (warehouse_id) WHERE (location_type = 'Default'::text);


--
-- Name: INDEX uq_storage_location_one_default; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.uq_storage_location_one_default IS 'Cites: MS-17, RT-057. At most one Default location per warehouse (organization-model s5: one per warehouse).';


--
-- Name: document_number_sequence tg_document_number_sequence_forward; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_document_number_sequence_forward BEFORE UPDATE ON public.document_number_sequence FOR EACH ROW EXECUTE FUNCTION public.forbid_document_number_decrease();


--
-- Name: TRIGGER tg_document_number_sequence_forward ON document_number_sequence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_document_number_sequence_forward ON public.document_number_sequence IS 'Cites: BI-42. Document-number counters only move forward.';


--
-- Name: organization tg_organization_deactivation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_organization_deactivation BEFORE UPDATE ON public.organization FOR EACH ROW EXECUTE FUNCTION public.record_deactivation();


--
-- Name: TRIGGER tg_organization_deactivation ON organization; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_organization_deactivation ON public.organization IS 'Cites: RT-506, BI-40. Records an organization''s deactivation once, with server time.';


--
-- Name: store tg_store_deactivation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_store_deactivation BEFORE UPDATE ON public.store FOR EACH ROW EXECUTE FUNCTION public.record_deactivation();


--
-- Name: TRIGGER tg_store_deactivation ON store; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_store_deactivation ON public.store IS 'Cites: RT-508, ORG-05. Records a store''s deactivation once, with server time.';


--
-- Name: warehouse tg_warehouse_default_location; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER tg_warehouse_default_location AFTER INSERT ON public.warehouse DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_warehouse_has_default_location();


--
-- Name: TRIGGER tg_warehouse_default_location ON warehouse; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_warehouse_default_location ON public.warehouse IS 'Cites: MS-17, RT-057. Checked at commit, so the warehouse and its Default location are created together.';


--
-- Name: document_number_sequence fk_document_number_sequence_store; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_number_sequence
    ADD CONSTRAINT fk_document_number_sequence_store FOREIGN KEY (store_id) REFERENCES public.store(id);


--
-- Name: CONSTRAINT fk_document_number_sequence_store ON document_number_sequence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_document_number_sequence_store ON public.document_number_sequence IS 'Cites: BI-42, RT-001. Numbering is per store.';


--
-- Name: document_number_sequence fk_document_number_sequence_type; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_number_sequence
    ADD CONSTRAINT fk_document_number_sequence_type FOREIGN KEY (document_type) REFERENCES public.document_type(code);


--
-- Name: CONSTRAINT fk_document_number_sequence_type ON document_number_sequence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_document_number_sequence_type ON public.document_number_sequence IS 'Cites: BI-42, ADR-21. Numbering is per document type, from the closed set.';


--
-- Name: organization fk_organization_currency; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization
    ADD CONSTRAINT fk_organization_currency FOREIGN KEY (currency_code) REFERENCES public.currency(code);


--
-- Name: CONSTRAINT fk_organization_currency ON organization; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_organization_currency ON public.organization IS 'Cites: ORG-01, RT-504. The organization currency.';


--
-- Name: storage_location_attribution fk_storage_location_attribution_location; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_location_attribution
    ADD CONSTRAINT fk_storage_location_attribution_location FOREIGN KEY (storage_location_id, location_warehouse_kind, organization_id) REFERENCES public.storage_location(id, warehouse_kind, organization_id);


--
-- Name: CONSTRAINT fk_storage_location_attribution_location ON storage_location_attribution; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_storage_location_attribution_location ON public.storage_location_attribution IS 'Cites: D-03. The attributed location, proven central and in the same organization.';


--
-- Name: storage_location_attribution fk_storage_location_attribution_store; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_location_attribution
    ADD CONSTRAINT fk_storage_location_attribution_store FOREIGN KEY (store_id, organization_id) REFERENCES public.store(id, organization_id);


--
-- Name: CONSTRAINT fk_storage_location_attribution_store ON storage_location_attribution; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_storage_location_attribution_store ON public.storage_location_attribution IS 'Cites: D-03, BI-14. The attributed store, in the same organization as the location.';


--
-- Name: storage_location fk_storage_location_warehouse; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_location
    ADD CONSTRAINT fk_storage_location_warehouse FOREIGN KEY (warehouse_id, warehouse_kind, organization_id) REFERENCES public.warehouse(id, kind, organization_id);


--
-- Name: CONSTRAINT fk_storage_location_warehouse ON storage_location; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_storage_location_warehouse ON public.storage_location IS 'Cites: MS-17, D-03. A location belongs to one warehouse, and carries that warehouse''s kind and organization by foreign key.';


--
-- Name: store fk_store_currency; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store
    ADD CONSTRAINT fk_store_currency FOREIGN KEY (currency_code) REFERENCES public.currency(code);


--
-- Name: CONSTRAINT fk_store_currency ON store; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_store_currency ON public.store IS 'Cites: BI-01, BI-11. The store currency. It is immutable (organization-model s3.1), so the application role cannot update it.';


--
-- Name: store fk_store_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store
    ADD CONSTRAINT fk_store_organization FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: CONSTRAINT fk_store_organization ON store; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_store_organization ON public.store IS 'Cites: RT-001, RT-269. A store belongs to exactly one organization, which may have many.';


--
-- Name: store_setting_version fk_store_setting_version_store; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_setting_version
    ADD CONSTRAINT fk_store_setting_version_store FOREIGN KEY (store_id) REFERENCES public.store(id);


--
-- Name: CONSTRAINT fk_store_setting_version_store ON store_setting_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_store_setting_version_store ON public.store_setting_version IS 'Cites: RT-001, MS-01. Settings belong to one store.';


--
-- Name: warehouse fk_warehouse_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouse
    ADD CONSTRAINT fk_warehouse_organization FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: CONSTRAINT fk_warehouse_organization ON warehouse; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_warehouse_organization ON public.warehouse IS 'Cites: RT-003. Every warehouse belongs to an organization.';


--
-- Name: warehouse fk_warehouse_store; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouse
    ADD CONSTRAINT fk_warehouse_store FOREIGN KEY (store_id, organization_id) REFERENCES public.store(id, organization_id);


--
-- Name: CONSTRAINT fk_warehouse_store ON warehouse; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_warehouse_store ON public.warehouse IS 'Cites: RT-003, BI-14. A store-attached warehouse belongs to a store of the same organization.';


--
-- PostgreSQL database dump complete
--

\unrestrict dbmate


--
-- Dbmate schema migrations
--

INSERT INTO public.schema_migrations (version) VALUES
    ('20260930120000'),
    ('20260930130000');
