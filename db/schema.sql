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
-- Name: assert_new_variant_usable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_new_variant_usable() RETURNS trigger
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


--
-- Name: FUNCTION assert_new_variant_usable(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.assert_new_variant_usable() IS 'Cites: RT-042, PR-34, PR-47, SM-13. At commit, a new variant of an archived product is refused, and a new variant of a released product carries a price in force.';


--
-- Name: assert_variant_has_primary_barcode(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_variant_has_primary_barcode() RETURNS trigger
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


--
-- Name: FUNCTION assert_variant_has_primary_barcode(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.assert_variant_has_primary_barcode() IS 'Cites: PR-08. At commit, a variant with any live barcode has exactly one primary (the unique index gives at most one).';


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
-- Name: barcode_lookup_key(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.barcode_lookup_key(p_value text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $_$
  SELECT CASE WHEN p_value ~ '^([0-9]{8}|[0-9]{12,14})$' THEN lpad(p_value, 14, '0') ELSE p_value END
$_$;


--
-- Name: FUNCTION barcode_lookup_key(p_value text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.barcode_lookup_key(p_value text) IS 'Cites: PR-08, PR-12, RT-024, RT-490, UX-48. The exact-match key a scan is looked up by: an all-digit GTIN-length code is left-padded to 14 digits (padded, never trimmed), so a UPC-A and the same code read as EAN-13 are one key; anything else is itself. Scans and stored barcodes use this same function.';


--
-- Name: enforce_state_transition(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_state_transition() RETURNS trigger
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


--
-- Name: FUNCTION enforce_state_transition(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.enforce_state_transition() IS 'Cites: SM-02, SM-05, SM-06, SM-07. Refuses a creation state that is not initial and a change of state that is not an edge of the machine, with a code the application names (SS004).';


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
-- Name: gtin_check_digit_valid(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gtin_check_digit_valid(p_code text) RETURNS boolean
    LANGUAGE sql IMMUTABLE STRICT
    AS $_$
  -- CASE, not AND: SQL does not promise to evaluate AND left to right, and the digit casts must never see a letter.
  SELECT CASE WHEN p_code ~ '^[0-9]{2,}$' THEN
    (10 - (SELECT sum(substr(p_code, length(p_code) - i, 1)::int * CASE WHEN i % 2 = 1 THEN 3 ELSE 1 END)
           FROM generate_series(1, length(p_code) - 1) AS i) % 10) % 10
      = substr(p_code, length(p_code), 1)::int
  ELSE false END
$_$;


--
-- Name: FUNCTION gtin_check_digit_valid(p_code text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.gtin_check_digit_valid(p_code text) IS 'Cites: PR-12, RT-490. True when the last digit is the GS1 modulo-10 check digit of the others (EAN-13, EAN-8, UPC-A, ITF-14).';


--
-- Name: prevent_category_cycle(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_category_cycle() RETURNS trigger
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


--
-- Name: FUNCTION prevent_category_cycle(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.prevent_category_cycle() IS 'Cites: RT-026, EC-42, PR-04. Refuses a move that would put a category beneath itself or its own descendant.';


--
-- Name: product_before_status_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.product_before_status_change() RETURNS trigger
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


--
-- Name: FUNCTION product_before_status_change(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.product_before_status_change() IS 'Cites: PR-02, SM-12, RT-028, RT-042. Stamps the time of every status change, and refuses Draft to Active unless the product has an active variant and every active variant has a price in force.';


--
-- Name: record_archival(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_archival() RETURNS trigger
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


--
-- Name: FUNCTION record_archival(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.record_archival() IS 'Cites: BI-40, PR-05, PR-48, RT-353. Archival is recorded once, stamped with server time; who and when cannot be rewritten or cleared.';


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


--
-- Name: upc_e_expand(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upc_e_expand(p_code text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $_$
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
$_$;


--
-- Name: FUNCTION upc_e_expand(p_code text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.upc_e_expand(p_code text) IS 'Cites: PR-12, RT-490. Expands a zero-suppressed UPC-E code to its UPC-A form, where its check digit is validated.';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: brand; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brand (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name public.nonblank_text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE brand; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.brand IS 'Cites: RT-021, PR-01. An optional, organization-global brand; a product with no brand has a null brand, never a placeholder (product-domain s3).';


--
-- Name: category; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.category (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    parent_id uuid,
    name public.nonblank_text NOT NULL,
    sort_order integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    archived_by uuid,
    CONSTRAINT ck_category_archival CHECK (((archived_at IS NULL) = (archived_by IS NULL))),
    CONSTRAINT ck_category_not_own_parent CHECK ((parent_id <> id))
);


--
-- Name: TABLE category; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.category IS 'Cites: PR-04, PR-05, PR-06, RT-026, RT-027, RT-488. A single-parent category tree with an explicit sort order; archived, never deleted.';


--
-- Name: CONSTRAINT ck_category_archival ON category; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_category_archival ON public.category IS 'Cites: PR-05, RT-027. An archival records who and when together.';


--
-- Name: CONSTRAINT ck_category_not_own_parent ON category; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_category_not_own_parent ON public.category IS 'Cites: RT-026, EC-42. A category is never its own parent.';


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
-- Name: product; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    category_id uuid NOT NULL,
    brand_id uuid,
    name public.nonblank_text NOT NULL,
    description public.nonblank_text,
    status text DEFAULT 'Draft'::text NOT NULL,
    status_changed_at timestamp with time zone DEFAULT now() NOT NULL,
    status_changed_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_product_status CHECK ((status = ANY (ARRAY['Draft'::text, 'Active'::text, 'Discontinued'::text, 'Hidden'::text, 'Archived'::text])))
);


--
-- Name: TABLE product; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.product IS 'Cites: RT-021, PR-01, PR-02, SM-11, SM-13, RT-444. The SPU a shopper recognises; never stocked or sold directly, never deleted.';


--
-- Name: CONSTRAINT ck_product_status ON product; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_product_status ON public.product IS 'Cites: SM-13a, PR-46, PR-47. The stored lifecycle states. OutOfStock is a derived condition, never stored (SM-13a, BI-02).';


--
-- Name: product_barcode; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_barcode (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    value text NOT NULL,
    kind text NOT NULL,
    lookup_key text GENERATED ALWAYS AS (public.barcode_lookup_key(value)) STORED,
    is_primary boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    archived_by uuid,
    CONSTRAINT ck_product_barcode_archival CHECK (((archived_at IS NULL) = (archived_by IS NULL))),
    CONSTRAINT ck_product_barcode_archived_not_primary CHECK ((NOT (is_primary AND (archived_at IS NOT NULL)))),
    CONSTRAINT ck_product_barcode_format CHECK (((value !~ '\s'::text) AND (value <> ''::text) AND
CASE kind
    WHEN 'EAN13'::text THEN ((value ~ '^[0-9]{13}$'::text) AND public.gtin_check_digit_valid(value))
    WHEN 'EAN8'::text THEN ((value ~ '^[0-9]{8}$'::text) AND public.gtin_check_digit_valid(value))
    WHEN 'UPC_A'::text THEN ((value ~ '^[0-9]{12}$'::text) AND public.gtin_check_digit_valid(value))
    WHEN 'UPC_E'::text THEN ((value ~ '^[01][0-9]{7}$'::text) AND public.gtin_check_digit_valid(public.upc_e_expand(value)))
    WHEN 'ITF14'::text THEN ((value ~ '^[0-9]{14}$'::text) AND public.gtin_check_digit_valid(value))
    WHEN 'PLU'::text THEN (value ~ '^[0-9]+$'::text)
    WHEN 'Internal'::text THEN (value !~ '^([0-9]{8}|[0-9]{12,14})$'::text)
    WHEN 'QR'::text THEN true
    ELSE (value ~ '^[\x21-\x7E]+$'::text)
END)),
    CONSTRAINT ck_product_barcode_kind CHECK ((kind = ANY (ARRAY['EAN13'::text, 'EAN8'::text, 'UPC_A'::text, 'UPC_E'::text, 'Code128'::text, 'ITF14'::text, 'GS1-128'::text, 'QR'::text, 'PLU'::text, 'Internal'::text])))
);


--
-- Name: TABLE product_barcode; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.product_barcode IS 'Cites: RT-023, RT-024, RT-025, RT-490, PR-08, PR-09, PR-12. A variant carries many barcodes, one primary. A barcode is a string, never a number; it is never reassigned, only archived and a new one issued.';


--
-- Name: CONSTRAINT ck_product_barcode_archival ON product_barcode; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_product_barcode_archival ON public.product_barcode IS 'Cites: PR-09, RT-025. An archival records who and when together.';


--
-- Name: CONSTRAINT ck_product_barcode_archived_not_primary ON product_barcode; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_product_barcode_archived_not_primary ON public.product_barcode IS 'Cites: PR-08. An archived barcode is never the primary one.';


--
-- Name: CONSTRAINT ck_product_barcode_format ON product_barcode; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_product_barcode_format ON public.product_barcode IS 'Cites: PR-12, RT-490. Stored canonical: no whitespace, leading zeros kept, check digit valid where the symbology has one; an Internal code can never look like a retail GTIN.';


--
-- Name: CONSTRAINT ck_product_barcode_kind ON product_barcode; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_product_barcode_kind ON public.product_barcode IS 'Cites: PR-12, PR-25. The symbologies of product-domain s5.1.';


--
-- Name: product_variant; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_variant (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    product_id uuid NOT NULL,
    name public.nonblank_text,
    base_unit_id uuid NOT NULL,
    tax_category_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    archived_by uuid,
    CONSTRAINT ck_product_variant_archival CHECK (((archived_at IS NULL) = (archived_by IS NULL)))
);


--
-- Name: TABLE product_variant; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.product_variant IS 'Cites: RT-021, RT-022, PR-01, PR-15, RT-033, RT-443, RT-495. The SKU: the one thing that is stocked, priced, barcoded and sold. Archived, never deleted; archival blocks new use and never removes stock (EC-33).';


--
-- Name: CONSTRAINT ck_product_variant_archival ON product_variant; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_product_variant_archival ON public.product_variant IS 'Cites: PR-48, RT-495. An archival records who and when together.';


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: state_machine_edge; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.state_machine_edge (
    machine public.nonblank_text NOT NULL,
    from_state public.nonblank_text NOT NULL,
    to_state public.nonblank_text NOT NULL,
    event public.nonblank_text NOT NULL,
    CONSTRAINT ck_state_machine_edge_not_loop CHECK (((from_state)::text <> (to_state)::text))
);


--
-- Name: TABLE state_machine_edge; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.state_machine_edge IS 'Cites: SM-02, SM-05, SM-07, ADR-19. Every legal transition of every machine. A state with no outgoing edge is terminal, and the graph is asserted in tests.';


--
-- Name: CONSTRAINT ck_state_machine_edge_not_loop ON state_machine_edge; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_state_machine_edge_not_loop ON public.state_machine_edge IS 'Cites: SM-04. Repeating a transition to the current state is a no-op, not an edge.';


--
-- Name: state_machine_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.state_machine_state (
    machine public.nonblank_text NOT NULL,
    state public.nonblank_text NOT NULL,
    is_initial boolean NOT NULL
);


--
-- Name: TABLE state_machine_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.state_machine_state IS 'Cites: SM-07, ADR-19, ADR-21. The closed state set of each lifecycle machine; a state is added only by a reviewed migration.';


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
-- Name: store_variant_price; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_variant_price (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    currency_code text NOT NULL,
    amount bigint NOT NULL,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid NOT NULL,
    CONSTRAINT ck_store_variant_price_positive CHECK ((amount > 0)),
    CONSTRAINT ck_store_variant_price_prospective CHECK ((effective_from >= created_at))
);


--
-- Name: TABLE store_variant_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.store_variant_price IS 'Cites: PR-30, PR-32, RT-040, RT-041, RT-042. A store-specific price for a variant, which wins over the organization default (PR-30). Append-only and effective-dated.';


--
-- Name: CONSTRAINT ck_store_variant_price_positive ON store_variant_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_store_variant_price_positive ON public.store_variant_price IS 'Cites: PR-34, RT-042. A zero or negative price is refused.';


--
-- Name: CONSTRAINT ck_store_variant_price_prospective ON store_variant_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_store_variant_price_prospective ON public.store_variant_price IS 'Cites: PR-32, RT-041, RT-353. A price change takes effect now or later; created_at is server time.';


--
-- Name: tax_category; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax_category (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    code public.nonblank_text NOT NULL,
    name public.nonblank_text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE tax_category; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tax_category IS 'Cites: PR-40, RT-493, SP-38. Groups variants for tax. Exempt is a zero-rate category, never a missing one. No rate or category is seeded: those are jurisdictional facts (D-12, GAP-044).';


--
-- Name: tax_rate; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax_rate (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    tax_category_id uuid NOT NULL,
    jurisdiction public.nonblank_text NOT NULL,
    rate_percent numeric(9,4) NOT NULL,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid NOT NULL,
    CONSTRAINT ck_tax_rate_non_negative CHECK ((rate_percent >= (0)::numeric)),
    CONSTRAINT ck_tax_rate_prospective CHECK ((effective_from >= created_at))
);


--
-- Name: TABLE tax_rate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tax_rate IS 'Cites: PR-37, RT-047, BI-18. Append-only versions of a category''s rate: a change is a new version with an effective time, never an edit, so a document always shows the rate that applied.';


--
-- Name: CONSTRAINT ck_tax_rate_non_negative ON tax_rate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_tax_rate_non_negative ON public.tax_rate IS 'Cites: PR-40. A rate is a non-negative percentage; zero is how exemption is expressed.';


--
-- Name: CONSTRAINT ck_tax_rate_prospective ON tax_rate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_tax_rate_prospective ON public.tax_rate IS 'Cites: PR-37, RT-353. A new rate takes effect now or later; created_at is server time.';


--
-- Name: unit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    code public.nonblank_text NOT NULL,
    name public.nonblank_text NOT NULL,
    plural_name public.nonblank_text,
    quantity_kind text NOT NULL,
    scale smallint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_unit_countable_whole CHECK (((quantity_kind <> 'Countable'::text) OR (scale = 0))),
    CONSTRAINT ck_unit_quantity_kind CHECK ((quantity_kind = ANY (ARRAY['Countable'::text, 'Measurable'::text, 'Service'::text]))),
    CONSTRAINT ck_unit_scale CHECK (((scale >= 0) AND (scale <= 4)))
);


--
-- Name: TABLE unit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.unit IS 'Cites: PR-14, PR-15, RT-033, RT-491. A unit of measure the organization defines once; every variant stores stock in its base unit.';


--
-- Name: CONSTRAINT ck_unit_countable_whole ON unit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_unit_countable_whole ON public.unit IS 'Cites: PR-14, RT-033. A countable unit is stored as whole numbers (overview s3.2).';


--
-- Name: CONSTRAINT ck_unit_quantity_kind ON unit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_unit_quantity_kind ON public.unit IS 'Cites: PR-14, RT-491. Countable, measurable, or service (product-domain s6.1).';


--
-- Name: CONSTRAINT ck_unit_scale ON unit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_unit_scale ON public.unit IS 'Cites: ADR-06. Quantities are numeric(18,4), so a unit''s entry scale is at most 4 decimals.';


--
-- Name: variant_price; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.variant_price (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    currency_code text NOT NULL,
    amount bigint NOT NULL,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid NOT NULL,
    CONSTRAINT ck_variant_price_positive CHECK ((amount > 0)),
    CONSTRAINT ck_variant_price_prospective CHECK ((effective_from >= created_at))
);


--
-- Name: TABLE variant_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.variant_price IS 'Cites: PR-30, PR-32, PR-34, RT-040, RT-041, RT-042. The organization default price on a variant, the last tier of price resolution. Append-only and effective-dated: a change is a new version, and sales before it keep the old price.';


--
-- Name: CONSTRAINT ck_variant_price_positive ON variant_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_variant_price_positive ON public.variant_price IS 'Cites: PR-34, RT-042. A zero or negative price is refused; a free item is a 100% discount line.';


--
-- Name: CONSTRAINT ck_variant_price_prospective ON variant_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_variant_price_prospective ON public.variant_price IS 'Cites: PR-32, RT-041, RT-353. A price change takes effect now or later. A backdated change needs approval (PR-32), which v1 does not build, so it is refused.';


--
-- Name: variant_standard_cost; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.variant_standard_cost (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    currency_code text NOT NULL,
    amount bigint NOT NULL,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid NOT NULL,
    CONSTRAINT ck_variant_standard_cost_non_negative CHECK ((amount >= 0)),
    CONSTRAINT ck_variant_standard_cost_prospective CHECK ((effective_from >= created_at))
);


--
-- Name: TABLE variant_standard_cost; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.variant_standard_cost IS 'Cites: PR-33, PR-35, PR-36, RT-043, RT-044, RT-045. A variant''s standard cost, for margin and the below-cost check. It is not the batch''s actual cost, which values stock (PR-35). Append-only and effective-dated.';


--
-- Name: CONSTRAINT ck_variant_standard_cost_non_negative ON variant_standard_cost; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_variant_standard_cost_non_negative ON public.variant_standard_cost IS 'Cites: BI-01, PR-35. A cost is never negative.';


--
-- Name: CONSTRAINT ck_variant_standard_cost_prospective ON variant_standard_cost; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_variant_standard_cost_prospective ON public.variant_standard_cost IS 'Cites: PR-35, RT-353. A cost change takes effect now or later; created_at is server time.';


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
-- Name: brand pk_brand; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand
    ADD CONSTRAINT pk_brand PRIMARY KEY (id);


--
-- Name: category pk_category; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category
    ADD CONSTRAINT pk_category PRIMARY KEY (id);


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
-- Name: product pk_product; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT pk_product PRIMARY KEY (id);


--
-- Name: product_barcode pk_product_barcode; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_barcode
    ADD CONSTRAINT pk_product_barcode PRIMARY KEY (id);


--
-- Name: product_variant pk_product_variant; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variant
    ADD CONSTRAINT pk_product_variant PRIMARY KEY (id);


--
-- Name: state_machine_edge pk_state_machine_edge; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_machine_edge
    ADD CONSTRAINT pk_state_machine_edge PRIMARY KEY (machine, from_state, to_state);


--
-- Name: state_machine_state pk_state_machine_state; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_machine_state
    ADD CONSTRAINT pk_state_machine_state PRIMARY KEY (machine, state);


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
-- Name: store_variant_price pk_store_variant_price; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_variant_price
    ADD CONSTRAINT pk_store_variant_price PRIMARY KEY (id);


--
-- Name: tax_category pk_tax_category; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_category
    ADD CONSTRAINT pk_tax_category PRIMARY KEY (id);


--
-- Name: tax_rate pk_tax_rate; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_rate
    ADD CONSTRAINT pk_tax_rate PRIMARY KEY (id);


--
-- Name: unit pk_unit; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit
    ADD CONSTRAINT pk_unit PRIMARY KEY (id);


--
-- Name: variant_price pk_variant_price; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.variant_price
    ADD CONSTRAINT pk_variant_price PRIMARY KEY (id);


--
-- Name: variant_standard_cost pk_variant_standard_cost; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.variant_standard_cost
    ADD CONSTRAINT pk_variant_standard_cost PRIMARY KEY (id);


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
-- Name: brand uq_brand_id_organization; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand
    ADD CONSTRAINT uq_brand_id_organization UNIQUE (id, organization_id);


--
-- Name: CONSTRAINT uq_brand_id_organization ON brand; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_brand_id_organization ON public.brand IS 'Cites: RT-001, BI-14. Lets a product prove, by foreign key, that its brand is in its own organization.';


--
-- Name: category uq_category_id_organization; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category
    ADD CONSTRAINT uq_category_id_organization UNIQUE (id, organization_id);


--
-- Name: CONSTRAINT uq_category_id_organization ON category; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_category_id_organization ON public.category IS 'Cites: RT-001, BI-14. Lets a child category or product prove, by foreign key, that the category is in its own organization.';


--
-- Name: product uq_product_id_organization; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT uq_product_id_organization UNIQUE (id, organization_id);


--
-- Name: CONSTRAINT uq_product_id_organization ON product; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_product_id_organization ON public.product IS 'Cites: RT-001, BI-14. Lets a variant prove, by foreign key, that its product is in its own organization.';


--
-- Name: product_variant uq_product_variant_id_organization; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variant
    ADD CONSTRAINT uq_product_variant_id_organization UNIQUE (id, organization_id);


--
-- Name: CONSTRAINT uq_product_variant_id_organization ON product_variant; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_product_variant_id_organization ON public.product_variant IS 'Cites: RT-001, BI-14. Lets a barcode, price or cost prove, by foreign key, that its variant is in its own organization.';


--
-- Name: state_machine_edge uq_state_machine_edge_event; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_machine_edge
    ADD CONSTRAINT uq_state_machine_edge_event UNIQUE (machine, from_state, event);


--
-- Name: CONSTRAINT uq_state_machine_edge_event ON state_machine_edge; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_state_machine_edge_event ON public.state_machine_edge IS 'Cites: SM-02. A named event from a state leads to exactly one destination.';


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
-- Name: store uq_store_id_currency; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store
    ADD CONSTRAINT uq_store_id_currency UNIQUE (id, currency_code);


--
-- Name: CONSTRAINT uq_store_id_currency ON store; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_store_id_currency ON public.store IS 'Cites: BI-01, PR-30. Lets a store price prove, by foreign key, that it is in the store''s own currency.';


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
-- Name: store_variant_price uq_store_variant_price_effective; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_variant_price
    ADD CONSTRAINT uq_store_variant_price_effective UNIQUE (store_id, variant_id, effective_from);


--
-- Name: CONSTRAINT uq_store_variant_price_effective ON store_variant_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_store_variant_price_effective ON public.store_variant_price IS 'Cites: PR-32, RT-041. One version per store and variant takes effect at an instant; also the index the till''s price lookup uses.';


--
-- Name: tax_category uq_tax_category_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_category
    ADD CONSTRAINT uq_tax_category_code UNIQUE (organization_id, code);


--
-- Name: CONSTRAINT uq_tax_category_code ON tax_category; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_tax_category_code ON public.tax_category IS 'Cites: PR-40. A tax category code identifies one category within its organization.';


--
-- Name: tax_category uq_tax_category_id_organization; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_category
    ADD CONSTRAINT uq_tax_category_id_organization UNIQUE (id, organization_id);


--
-- Name: CONSTRAINT uq_tax_category_id_organization ON tax_category; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_tax_category_id_organization ON public.tax_category IS 'Cites: RT-001, BI-14. Lets a rate or variant prove, by foreign key, that its category is in its own organization.';


--
-- Name: tax_rate uq_tax_rate_effective; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_rate
    ADD CONSTRAINT uq_tax_rate_effective UNIQUE (tax_category_id, effective_from);


--
-- Name: CONSTRAINT uq_tax_rate_effective ON tax_rate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_tax_rate_effective ON public.tax_rate IS 'Cites: PR-37, BI-18. One version takes effect at an instant, so the rate in force is unambiguous (jurisdiction selection: OQ-012).';


--
-- Name: unit uq_unit_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit
    ADD CONSTRAINT uq_unit_code UNIQUE (organization_id, code);


--
-- Name: CONSTRAINT uq_unit_code ON unit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_unit_code ON public.unit IS 'Cites: PR-15. A unit code identifies one unit within its organization.';


--
-- Name: unit uq_unit_id_organization; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit
    ADD CONSTRAINT uq_unit_id_organization UNIQUE (id, organization_id);


--
-- Name: CONSTRAINT uq_unit_id_organization ON unit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_unit_id_organization ON public.unit IS 'Cites: RT-001, BI-14. Lets a variant prove, by foreign key, that its base unit is in its own organization.';


--
-- Name: variant_price uq_variant_price_effective; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.variant_price
    ADD CONSTRAINT uq_variant_price_effective UNIQUE (variant_id, effective_from);


--
-- Name: CONSTRAINT uq_variant_price_effective ON variant_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_variant_price_effective ON public.variant_price IS 'Cites: PR-32, RT-041. One version takes effect at an instant, so the price in force is unambiguous.';


--
-- Name: variant_standard_cost uq_variant_standard_cost_effective; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.variant_standard_cost
    ADD CONSTRAINT uq_variant_standard_cost_effective UNIQUE (variant_id, effective_from);


--
-- Name: CONSTRAINT uq_variant_standard_cost_effective ON variant_standard_cost; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_variant_standard_cost_effective ON public.variant_standard_cost IS 'Cites: PR-35. One version takes effect at an instant, so the current standard cost is unambiguous.';


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
-- Name: ix_category_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_category_parent ON public.category USING btree (parent_id);


--
-- Name: INDEX ix_category_parent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.ix_category_parent IS 'Cites: PR-04, RT-026. Walks the tree from a parent to its children.';


--
-- Name: ix_product_barcode_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_product_barcode_variant ON public.product_barcode USING btree (variant_id);


--
-- Name: INDEX ix_product_barcode_variant; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.ix_product_barcode_variant IS 'Cites: RT-023. Finds a variant''s barcodes.';


--
-- Name: ix_product_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_product_category ON public.product USING btree (category_id);


--
-- Name: INDEX ix_product_category; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.ix_product_category IS 'Cites: RT-027. Finds a category''s products, for archival and navigation.';


--
-- Name: ix_product_variant_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_product_variant_product ON public.product_variant USING btree (product_id);


--
-- Name: INDEX ix_product_variant_product; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.ix_product_variant_product IS 'Cites: RT-022. Finds a product''s variants.';


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
-- Name: uq_brand_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_brand_name ON public.brand USING btree (organization_id, lower((name)::text));


--
-- Name: INDEX uq_brand_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.uq_brand_name IS 'Cites: RT-021. A brand name is unique within its organization, case-insensitively (product-domain s3).';


--
-- Name: uq_product_barcode_active_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_product_barcode_active_key ON public.product_barcode USING btree (organization_id, lookup_key) WHERE (archived_at IS NULL);


--
-- Name: INDEX uq_product_barcode_active_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.uq_product_barcode_active_key IS 'Cites: PR-08, RT-024, EC-41, UX-48. The scan path: an exact match on the lookup key, unique organization-wide among live barcodes, so one scan resolves to exactly one variant. Archived barcodes leave it, so a value can be reissued (PR-10).';


--
-- Name: uq_product_barcode_one_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_product_barcode_one_primary ON public.product_barcode USING btree (variant_id) WHERE (is_primary AND (archived_at IS NULL));


--
-- Name: INDEX uq_product_barcode_one_primary; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.uq_product_barcode_one_primary IS 'Cites: PR-08. At most one live primary barcode per variant.';


--
-- Name: uq_storage_location_one_default; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_storage_location_one_default ON public.storage_location USING btree (warehouse_id) WHERE (location_type = 'Default'::text);


--
-- Name: INDEX uq_storage_location_one_default; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.uq_storage_location_one_default IS 'Cites: MS-17, RT-057. At most one Default location per warehouse (organization-model s5: one per warehouse).';


--
-- Name: category tg_category_archival; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_category_archival BEFORE UPDATE ON public.category FOR EACH ROW EXECUTE FUNCTION public.record_archival();


--
-- Name: TRIGGER tg_category_archival ON category; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_category_archival ON public.category IS 'Cites: PR-05, RT-027. Records a category''s archival once, with server time.';


--
-- Name: category tg_category_no_cycle; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_category_no_cycle BEFORE UPDATE OF parent_id ON public.category FOR EACH ROW EXECUTE FUNCTION public.prevent_category_cycle();


--
-- Name: TRIGGER tg_category_no_cycle ON category; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_category_no_cycle ON public.category IS 'Cites: RT-026, EC-42. Keeps the category tree acyclic when a category is moved.';


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
-- Name: product_barcode tg_product_barcode_archival; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_product_barcode_archival BEFORE UPDATE ON public.product_barcode FOR EACH ROW EXECUTE FUNCTION public.record_archival();


--
-- Name: TRIGGER tg_product_barcode_archival ON product_barcode; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_product_barcode_archival ON public.product_barcode IS 'Cites: PR-09, RT-025. Records a barcode''s archival once, with server time.';


--
-- Name: product_barcode tg_product_barcode_primary; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER tg_product_barcode_primary AFTER INSERT OR UPDATE ON public.product_barcode DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_variant_has_primary_barcode();


--
-- Name: TRIGGER tg_product_barcode_primary ON product_barcode; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_product_barcode_primary ON public.product_barcode IS 'Cites: PR-08. Checked at commit, so the primary can be moved from one barcode to another in one transaction.';


--
-- Name: product tg_product_state_machine; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_product_state_machine BEFORE INSERT OR UPDATE OF status ON public.product FOR EACH ROW EXECUTE FUNCTION public.enforce_state_transition('Product', 'status');


--
-- Name: TRIGGER tg_product_state_machine ON product; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_product_state_machine ON public.product IS 'Cites: SM-02, SM-13, PR-47. A product is created Draft and moves only along the edges of state-machines s22.1.';


--
-- Name: product tg_product_status_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_product_status_change BEFORE UPDATE OF status ON public.product FOR EACH ROW EXECUTE FUNCTION public.product_before_status_change();


--
-- Name: TRIGGER tg_product_status_change ON product; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_product_status_change ON public.product IS 'Cites: PR-02, SM-12, RT-042. The completeness check on activation, and the entry time of the new state (overview s3.7).';


--
-- Name: product_variant tg_product_variant_archival; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_product_variant_archival BEFORE UPDATE ON public.product_variant FOR EACH ROW EXECUTE FUNCTION public.record_archival();


--
-- Name: TRIGGER tg_product_variant_archival ON product_variant; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_product_variant_archival ON public.product_variant IS 'Cites: PR-48, RT-495, EC-33. Records a variant''s archival once, with server time.';


--
-- Name: product_variant tg_product_variant_usable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER tg_product_variant_usable AFTER INSERT ON public.product_variant DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_new_variant_usable();


--
-- Name: TRIGGER tg_product_variant_usable ON product_variant; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_product_variant_usable ON public.product_variant IS 'Cites: RT-042, SM-13. Checked at commit, so a variant and its first price are created together.';


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
-- Name: brand fk_brand_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand
    ADD CONSTRAINT fk_brand_organization FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: CONSTRAINT fk_brand_organization ON brand; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_brand_organization ON public.brand IS 'Cites: RT-021. Brands are organization-global.';


--
-- Name: category fk_category_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category
    ADD CONSTRAINT fk_category_organization FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: CONSTRAINT fk_category_organization ON category; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_category_organization ON public.category IS 'Cites: PR-04. Categories are organization-global.';


--
-- Name: category fk_category_parent; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category
    ADD CONSTRAINT fk_category_parent FOREIGN KEY (parent_id, organization_id) REFERENCES public.category(id, organization_id);


--
-- Name: CONSTRAINT fk_category_parent ON category; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_category_parent ON public.category IS 'Cites: PR-04, RT-026. At most one parent, in the same organization.';


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
-- Name: product_barcode fk_product_barcode_variant; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_barcode
    ADD CONSTRAINT fk_product_barcode_variant FOREIGN KEY (variant_id, organization_id) REFERENCES public.product_variant(id, organization_id);


--
-- Name: CONSTRAINT fk_product_barcode_variant ON product_barcode; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_product_barcode_variant ON public.product_barcode IS 'Cites: RT-023. A barcode identifies one variant of its organization; the application cannot re-point it (PR-09).';


--
-- Name: product fk_product_brand; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT fk_product_brand FOREIGN KEY (brand_id, organization_id) REFERENCES public.brand(id, organization_id);


--
-- Name: CONSTRAINT fk_product_brand ON product; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_product_brand ON public.product IS 'Cites: RT-021. An optional brand, in the product''s own organization.';


--
-- Name: product fk_product_category; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT fk_product_category FOREIGN KEY (category_id, organization_id) REFERENCES public.category(id, organization_id);


--
-- Name: CONSTRAINT fk_product_category ON product; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_product_category ON public.product IS 'Cites: PR-04. A product belongs to exactly one category, in its own organization.';


--
-- Name: product_variant fk_product_variant_base_unit; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variant
    ADD CONSTRAINT fk_product_variant_base_unit FOREIGN KEY (base_unit_id, organization_id) REFERENCES public.unit(id, organization_id);


--
-- Name: CONSTRAINT fk_product_variant_base_unit ON product_variant; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_product_variant_base_unit ON public.product_variant IS 'Cites: PR-15, RT-033. Every variant has a base unit, and all its stock is stored in it; the application cannot change it.';


--
-- Name: product_variant fk_product_variant_product; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variant
    ADD CONSTRAINT fk_product_variant_product FOREIGN KEY (product_id, organization_id) REFERENCES public.product(id, organization_id);


--
-- Name: CONSTRAINT fk_product_variant_product ON product_variant; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_product_variant_product ON public.product_variant IS 'Cites: RT-022, PR-01. A product has many variants; a variant belongs to one product of its organization.';


--
-- Name: product_variant fk_product_variant_tax_category; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variant
    ADD CONSTRAINT fk_product_variant_tax_category FOREIGN KEY (tax_category_id, organization_id) REFERENCES public.tax_category(id, organization_id);


--
-- Name: CONSTRAINT fk_product_variant_tax_category ON product_variant; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_product_variant_tax_category ON public.product_variant IS 'Cites: PR-40, RT-493. The variant''s tax category. Null is the unclassified state, which is a validation error on a document line, never exemption.';


--
-- Name: state_machine_edge fk_state_machine_edge_from; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_machine_edge
    ADD CONSTRAINT fk_state_machine_edge_from FOREIGN KEY (machine, from_state) REFERENCES public.state_machine_state(machine, state);


--
-- Name: CONSTRAINT fk_state_machine_edge_from ON state_machine_edge; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_state_machine_edge_from ON public.state_machine_edge IS 'Cites: SM-07. An edge starts at a state of its machine.';


--
-- Name: state_machine_edge fk_state_machine_edge_to; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_machine_edge
    ADD CONSTRAINT fk_state_machine_edge_to FOREIGN KEY (machine, to_state) REFERENCES public.state_machine_state(machine, state);


--
-- Name: CONSTRAINT fk_state_machine_edge_to ON state_machine_edge; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_state_machine_edge_to ON public.state_machine_edge IS 'Cites: SM-07. An edge ends at a state of its machine.';


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
-- Name: store_variant_price fk_store_variant_price_currency; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_variant_price
    ADD CONSTRAINT fk_store_variant_price_currency FOREIGN KEY (store_id, currency_code) REFERENCES public.store(id, currency_code);


--
-- Name: CONSTRAINT fk_store_variant_price_currency ON store_variant_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_store_variant_price_currency ON public.store_variant_price IS 'Cites: BI-01. A store price is in the store''s own currency.';


--
-- Name: store_variant_price fk_store_variant_price_store; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_variant_price
    ADD CONSTRAINT fk_store_variant_price_store FOREIGN KEY (store_id, organization_id) REFERENCES public.store(id, organization_id);


--
-- Name: CONSTRAINT fk_store_variant_price_store ON store_variant_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_store_variant_price_store ON public.store_variant_price IS 'Cites: RT-001, PR-30. A store price belongs to one store of the variant''s organization.';


--
-- Name: store_variant_price fk_store_variant_price_variant; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_variant_price
    ADD CONSTRAINT fk_store_variant_price_variant FOREIGN KEY (variant_id, organization_id) REFERENCES public.product_variant(id, organization_id);


--
-- Name: CONSTRAINT fk_store_variant_price_variant ON store_variant_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_store_variant_price_variant ON public.store_variant_price IS 'Cites: RT-021. Prices belong to variants, never to products.';


--
-- Name: tax_category fk_tax_category_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_category
    ADD CONSTRAINT fk_tax_category_organization FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: CONSTRAINT fk_tax_category_organization ON tax_category; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_tax_category_organization ON public.tax_category IS 'Cites: PR-40. Tax categories are organization-global.';


--
-- Name: tax_rate fk_tax_rate_category; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_rate
    ADD CONSTRAINT fk_tax_rate_category FOREIGN KEY (tax_category_id, organization_id) REFERENCES public.tax_category(id, organization_id);


--
-- Name: CONSTRAINT fk_tax_rate_category ON tax_rate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_tax_rate_category ON public.tax_rate IS 'Cites: PR-37. A rate belongs to one tax category of the same organization.';


--
-- Name: unit fk_unit_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit
    ADD CONSTRAINT fk_unit_organization FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: CONSTRAINT fk_unit_organization ON unit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_unit_organization ON public.unit IS 'Cites: PR-15. Units are organization-global.';


--
-- Name: variant_price fk_variant_price_currency; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.variant_price
    ADD CONSTRAINT fk_variant_price_currency FOREIGN KEY (currency_code) REFERENCES public.currency(code);


--
-- Name: CONSTRAINT fk_variant_price_currency ON variant_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_variant_price_currency ON public.variant_price IS 'Cites: BI-01. A price carries its currency; amounts are integer minor units.';


--
-- Name: variant_price fk_variant_price_variant; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.variant_price
    ADD CONSTRAINT fk_variant_price_variant FOREIGN KEY (variant_id, organization_id) REFERENCES public.product_variant(id, organization_id);


--
-- Name: CONSTRAINT fk_variant_price_variant ON variant_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_variant_price_variant ON public.variant_price IS 'Cites: RT-021. Prices belong to variants, never to products.';


--
-- Name: variant_standard_cost fk_variant_standard_cost_currency; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.variant_standard_cost
    ADD CONSTRAINT fk_variant_standard_cost_currency FOREIGN KEY (currency_code) REFERENCES public.currency(code);


--
-- Name: CONSTRAINT fk_variant_standard_cost_currency ON variant_standard_cost; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_variant_standard_cost_currency ON public.variant_standard_cost IS 'Cites: BI-01. A cost carries its currency; amounts are integer minor units.';


--
-- Name: variant_standard_cost fk_variant_standard_cost_variant; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.variant_standard_cost
    ADD CONSTRAINT fk_variant_standard_cost_variant FOREIGN KEY (variant_id, organization_id) REFERENCES public.product_variant(id, organization_id);


--
-- Name: CONSTRAINT fk_variant_standard_cost_variant ON variant_standard_cost; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_variant_standard_cost_variant ON public.variant_standard_cost IS 'Cites: PR-35. Standard cost belongs to a variant.';


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
    ('20260930130000'),
    ('20260930140000');
