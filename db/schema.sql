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
-- Name: apply_inventory_movement(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_inventory_movement() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
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


--
-- Name: FUNCTION apply_inventory_movement(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.apply_inventory_movement() IS 'Cites: BI-02, BI-36, IV-06, IV-08, IV-16, IV-17, IV-21, IV-22, WH-02, MS-16, D-03, PR-22, RT-056, RT-483, RT-484. The only writer of stock balances. It validates the movement, applies it to the balance in one atomic statement, judges the negative-stock policy on the result in the same transaction, and stamps the resulting balance. Under AllowNegative the negative is written in full, never clamped (IV-17).';


--
-- Name: assert_adjustment_posting_complete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_adjustment_posting_complete() RETURNS trigger
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


--
-- Name: FUNCTION assert_adjustment_posting_complete(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.assert_adjustment_posting_complete() IS 'Cites: RT-486, BI-04, BI-15. At commit, a posted adjustment has written exactly its lines, and a reversed one has compensated every movement.';


--
-- Name: assert_checkout_outcome(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_checkout_outcome() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status = 'Completed' AND NOT EXISTS (SELECT 1 FROM sale WHERE checkout_id = NEW.id) THEN
    RAISE EXCEPTION 'checkout % cannot complete without its sale', NEW.id USING ERRCODE = 'SS043';
  END IF;
  RETURN NULL;
END
$$;


--
-- Name: FUNCTION assert_checkout_outcome(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.assert_checkout_outcome() IS 'Cites: SP-01, PY-37. A checkout is Completed only by the sale that completes it.';


--
-- Name: assert_movement_adjustment_state(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_movement_adjustment_state() RETURNS trigger
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


--
-- Name: FUNCTION assert_movement_adjustment_state(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.assert_movement_adjustment_state() IS 'Cites: BI-27, IV-32, RT-486. An adjustment moves stock only when it is Posted, and its reversal only when it is Reversed; a movement carries its line''s type.';


--
-- Name: assert_movement_sale_state(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_movement_sale_state() RETURNS trigger
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


--
-- Name: FUNCTION assert_movement_sale_state(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.assert_movement_sale_state() IS 'Cites: IV-15, SP-02, SM-11, PR-46, RT-031. A sale writes SALE movements only in its completion transaction, and a discontinued product only from stock actually on hand.';


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
-- Name: assert_sale_complete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_sale_complete() RETURNS trigger
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


--
-- Name: FUNCTION assert_sale_complete(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.assert_sale_complete() IS 'Cites: SP-02, SP-36, SP-40, BI-04, BI-18, RT-119, RT-133, RT-135, RT-136, RT-146, IV-15. At commit, a sale is whole: at least one line; totals are the sums of its lines and follow the tax mode; the settled amounts sum to the total due; no tender is left pending; captured tenders equal the total due; change equals cash tendered beyond cash applied and is disbursed from the drawer; and every stocked line moved exactly its quantity.';


--
-- Name: assert_shift_close_ready(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_shift_close_ready() RETURNS trigger
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


--
-- Name: FUNCTION assert_shift_close_ready(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.assert_shift_close_ready() IS 'Cites: CD-20, CD-23, CD-25, SM-55. A shift closes only from its latest count, with a zero or acknowledged variance, and with the closing float declared.';


--
-- Name: assert_shift_opening_float(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_shift_opening_float() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (SELECT count(*) FROM cash_transaction WHERE cash_shift_id = NEW.id AND type = 'OpeningFloat') <> 1 THEN
    RAISE EXCEPTION 'shift % must be opened with exactly one counted opening float', NEW.id USING ERRCODE = 'SS042';
  END IF;
  RETURN NULL;
END
$$;


--
-- Name: FUNCTION assert_shift_opening_float(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.assert_shift_opening_float() IS 'Cites: CD-10, CD-11, CD-14, RT-005. At commit, a new shift has exactly one opening-float cash transaction, which may be zero; the float is never a field.';


--
-- Name: assert_terminal_sells_from_own_location(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_terminal_sells_from_own_location() RETURNS trigger
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


--
-- Name: FUNCTION assert_terminal_sells_from_own_location(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.assert_terminal_sells_from_own_location() IS 'Cites: WH-01, RT-004, MS-18, PT-02. A till sells only from a sellable location of its own store.';


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
-- Name: cash_shift_before_write(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cash_shift_before_write() RETURNS trigger
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


--
-- Name: FUNCTION cash_shift_before_write(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.cash_shift_before_write() IS 'Cites: CD-10, CD-20, SM-03, RT-353. A shift opens only on a terminal in service; each transition, and the close, is stamped with server time.';


--
-- Name: checkout_before_write(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.checkout_before_write() RETURNS trigger
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


--
-- Name: FUNCTION checkout_before_write(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.checkout_before_write() IS 'Cites: PT-03, BI-39, SP-43, RT-353. A checkout starts only on a till in service and not in training, inside an open shift; once completed or abandoned it never changes.';


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
-- Name: forbid_ledger_rewrite(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.forbid_ledger_rewrite() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is refused for every role', TG_TABLE_NAME, TG_OP USING ERRCODE = 'SS010';
END
$$;


--
-- Name: FUNCTION forbid_ledger_rewrite(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.forbid_ledger_rewrite() IS 'Cites: BI-15, RT-059, AU-32. Refuses UPDATE, DELETE and TRUNCATE on an append-only ledger whatever the role, including the schema owner.';


--
-- Name: forbid_store_deactivation_with_open_shift(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.forbid_store_deactivation_with_open_shift() RETURNS trigger
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


--
-- Name: FUNCTION forbid_store_deactivation_with_open_shift(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.forbid_store_deactivation_with_open_shift() IS 'Cites: ORG-05, RT-445, EC-89. A store is not deactivated while any of its shifts is not closed.';


--
-- Name: forbid_store_deactivation_with_stock(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.forbid_store_deactivation_with_stock() RETURNS trigger
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


--
-- Name: FUNCTION forbid_store_deactivation_with_stock(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.forbid_store_deactivation_with_stock() IS 'Cites: ORG-05, RT-445, RT-508, EC-39. A store is not deactivated while its own locations hold stock.';


--
-- Name: freeze_organization_money_settings(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.freeze_organization_money_settings() RETURNS trigger
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


--
-- Name: FUNCTION freeze_organization_money_settings(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.freeze_organization_money_settings() IS 'Cites: ORG-01, ORG-02, RT-504, RT-505. Once a financial document exists, the organization''s currency and business time zone cannot change; the refusal names the first document.';


--
-- Name: freeze_referenced_variant_name(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.freeze_referenced_variant_name() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name AND EXISTS (SELECT 1 FROM sale_line WHERE variant_id = OLD.id) THEN
    RAISE EXCEPTION 'variant % has been sold; a different variant is a new variant', OLD.id USING ERRCODE = 'SS040';
  END IF;
  RETURN NEW;
END
$$;


--
-- Name: FUNCTION freeze_referenced_variant_name(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.freeze_referenced_variant_name() IS 'Cites: PR-03, RT-030. A variant''s identity (its name, standing in for its option values) is fixed once a document references it; a new colour is a new variant.';


--
-- Name: freeze_tax_mode_after_sale(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.freeze_tax_mode_after_sale() RETURNS trigger
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


--
-- Name: FUNCTION freeze_tax_mode_after_sale(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.freeze_tax_mode_after_sale() IS 'Cites: SP-33, PR-38, RT-046. Once a store has a sale, no settings version may change its tax mode.';


--
-- Name: freeze_used_quantity_kind(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.freeze_used_quantity_kind() RETURNS trigger
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


--
-- Name: FUNCTION freeze_used_quantity_kind(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.freeze_used_quantity_kind() IS 'Cites: PR-14, RT-491. A unit''s quantity kind is frozen once any movement or document line uses it; the refusal names the first use.';


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
-- Name: inventory_ledger_drift(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.inventory_ledger_drift() RETURNS TABLE(variant_id uuid, storage_location_id uuid, problem text, recorded numeric, expected numeric)
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


--
-- Name: FUNCTION inventory_ledger_drift(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.inventory_ledger_drift() IS 'Cites: IV-06, IV-09, BI-02, ADR-22, RT-056. Rebuilds every balance from the ledger and walks every resulting balance; returns each disagreement. It never repairs: an empty result is the proof, and anything else is an alert.';


--
-- Name: inventory_transaction_business_date(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.inventory_transaction_business_date() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  SELECT (now() AT TIME ZONE s.time_zone)::date INTO NEW.business_date FROM store s WHERE s.id = NEW.store_id;
  RETURN NEW;
END
$$;


--
-- Name: FUNCTION inventory_transaction_business_date(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.inventory_transaction_business_date() IS 'Cites: RT-234, RT-353, EC-68. The business date is computed by the server from its own clock in the store''s time zone (overview s3.3; OQ-007), never supplied by a client.';


--
-- Name: payment_before_write(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.payment_before_write() RETURNS trigger
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


--
-- Name: FUNCTION payment_before_write(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.payment_before_write() IS 'Cites: PY-04, PY-12, PY-54, D-14, BI-09. An attempt is added only to an open checkout with a method enabled at the store; a payment in a terminal state is never modified again.';


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
-- Name: resolve_price(uuid, uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_price(p_store_id uuid, p_variant_id uuid, p_at timestamp with time zone) RETURNS bigint
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


--
-- Name: FUNCTION resolve_price(p_store_id uuid, p_variant_id uuid, p_at timestamp with time zone); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.resolve_price(p_store_id uuid, p_variant_id uuid, p_at timestamp with time zone) IS 'Cites: PR-30, PR-31, BI-30, RT-040, RT-041. The price of a variant at a store at an instant: the store price in force, else the organization default in force if it is in the store''s currency. The one resolution rule, used by the till''s scan and by the sale line''s check.';


--
-- Name: sale_before_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sale_before_insert() RETURNS trigger
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


--
-- Name: FUNCTION sale_before_insert(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.sale_before_insert() IS 'Cites: SP-02, SP-05, PT-03, BI-39, BI-42, SP-33, REQ-AU-06, RT-234. The completion transaction''s header: a till in service and not in training, an open shift, the settings in force and never under a scheduled tax-mode change, the checkout closed into this sale, the number allocated and the business date computed by the server.';


--
-- Name: sale_line_before_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sale_line_before_insert() RETURNS trigger
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


--
-- Name: FUNCTION sale_line_before_insert(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.sale_line_before_insert() IS 'Cites: SP-06, SP-07, SP-09, BI-30, RT-124, RT-130, RT-489, RT-493, WH-01, RT-004, PR-48. The server''s authority over a line: written only in the completion transaction; the variant sellable; the tax rate the one in force for its category; the price the one in force when the server quoted it; the cost the standard cost in force; the location sellable and the store''s own; a scanned barcode that identifies the variant.';


--
-- Name: shift_count_before_write(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.shift_count_before_write() RETURNS trigger
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


--
-- Name: FUNCTION shift_count_before_write(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.shift_count_before_write() IS 'Cites: CD-21, CD-22, CD-23, RT-353. A count is taken only while the shift is reconciling; the server numbers the pass and computes the expected amount; an acknowledgement is written once, with server time.';


--
-- Name: shift_expected_cash(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.shift_expected_cash(p_shift_id uuid) RETURNS bigint
    LANGUAGE sql STABLE
    AS $$
  SELECT coalesce((SELECT sum(amount) FROM cash_transaction WHERE cash_shift_id = p_shift_id AND type = 'OpeningFloat'), 0)
       + coalesce((SELECT sum(p.amount) FROM payment p JOIN checkout c ON c.id = p.checkout_id
                   WHERE c.cash_shift_id = p_shift_id AND c.status = 'Completed'
                     AND p.status = 'Captured' AND p.method_type = 'Cash'), 0)
$$;


--
-- Name: FUNCTION shift_expected_cash(p_shift_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.shift_expected_cash(p_shift_id uuid) IS 'Cites: CD-06, CD-08, CD-09, RT-135. What should be in the drawer, derived and never stored: the opening float plus the cash applied to the shift''s sales (net of change, which is why change is not subtracted again; OQ-015). Card is never in the drawer.';


--
-- Name: stamp_changed_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.stamp_changed_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.changed_at := now();
  RETURN NEW;
END
$$;


--
-- Name: FUNCTION stamp_changed_at(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.stamp_changed_at() IS 'Cites: RT-353, PY-05. Stamps a configuration change with server time.';


--
-- Name: stamp_status_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.stamp_status_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
  END IF;
  RETURN NEW;
END
$$;


--
-- Name: FUNCTION stamp_status_change(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.stamp_status_change() IS 'Cites: SM-03, RT-353. Stamps the entry into a new state with server time (overview s3.7).';


--
-- Name: stock_adjustment_before_write(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.stock_adjustment_before_write() RETURNS trigger
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


--
-- Name: FUNCTION stock_adjustment_before_write(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.stock_adjustment_before_write() IS 'Cites: BI-42, SM-03, BI-25, RT-353. Allocates the document number in the creating transaction, refuses an archived reason, stamps each transition with server time, and keeps who submitted and approved unchangeable.';


--
-- Name: stock_adjustment_line_draft_only(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.stock_adjustment_line_draft_only() RETURNS trigger
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


--
-- Name: FUNCTION stock_adjustment_line_draft_only(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.stock_adjustment_line_draft_only() IS 'Cites: IV-32, BI-08, RT-486. Lines are written, and never-submitted lines deleted, only while the adjustment is a draft (overview s3.6); after submission they are part of the document.';


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
-- Name: cash_drawer; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_drawer (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    pos_terminal_id uuid NOT NULL,
    label public.nonblank_text NOT NULL,
    currency_code text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE cash_drawer; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.cash_drawer IS 'Cites: CD-01, CD-05, CD-36, RT-005. The physical cash container at a terminal. Single-currency, in the store''s currency.';


--
-- Name: cash_shift; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_shift (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    pos_terminal_id uuid NOT NULL,
    cash_drawer_id uuid NOT NULL,
    opened_by uuid NOT NULL,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_by uuid,
    closed_at timestamp with time zone,
    status text DEFAULT 'Open'::text NOT NULL,
    status_changed_at timestamp with time zone DEFAULT now() NOT NULL,
    status_changed_by uuid NOT NULL,
    CONSTRAINT ck_cash_shift_closed CHECK (((closed_at IS NULL) = (closed_by IS NULL))),
    CONSTRAINT ck_cash_shift_closed_when CHECK (((status = 'Closed'::text) = (closed_by IS NOT NULL))),
    CONSTRAINT ck_cash_shift_status CHECK ((status = ANY (ARRAY['Open'::text, 'Reconciling'::text, 'Closed'::text, 'Reopened'::text])))
);


--
-- Name: TABLE cash_shift; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.cash_shift IS 'Cites: CD-02, CD-03, CD-05, BI-39, RT-005, SM-55, SM-58. The till shift: a drawer''s money for one cashier''s session. It stores only who, when, where and its status; every amount is derived from its cash transactions and sales (cash-management s2).';


--
-- Name: CONSTRAINT ck_cash_shift_closed ON cash_shift; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_cash_shift_closed ON public.cash_shift IS 'Cites: CD-20, SM-03. A close records who and when together.';


--
-- Name: CONSTRAINT ck_cash_shift_closed_when ON cash_shift; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_cash_shift_closed_when ON public.cash_shift IS 'Cites: CD-20, SM-57. A shift records who closed it exactly when it is Closed.';


--
-- Name: CONSTRAINT ck_cash_shift_status ON cash_shift; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_cash_shift_status ON public.cash_shift IS 'Cites: SM-55, SM-56a, SM-58. The shift states of cash-management s2; there is no void state.';


--
-- Name: cash_transaction; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_transaction (
    seq bigint NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cash_shift_id uuid NOT NULL,
    cash_drawer_id uuid NOT NULL,
    store_id uuid NOT NULL,
    type text NOT NULL,
    direction text NOT NULL,
    amount bigint NOT NULL,
    currency_code text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid NOT NULL,
    sale_id uuid,
    CONSTRAINT ck_cash_transaction_amount CHECK (((amount > 0) OR ((amount = 0) AND (type = ANY (ARRAY['OpeningFloat'::text, 'ClosingFloat'::text]))))),
    CONSTRAINT ck_cash_transaction_direction CHECK ((direction =
CASE type
    WHEN 'OpeningFloat'::text THEN 'In'::text
    ELSE 'Out'::text
END)),
    CONSTRAINT ck_cash_transaction_sale CHECK (((type = 'ChangeDisbursed'::text) = (sale_id IS NOT NULL))),
    CONSTRAINT ck_cash_transaction_type CHECK ((type = ANY (ARRAY['OpeningFloat'::text, 'ChangeDisbursed'::text, 'ClosingFloat'::text])))
);


--
-- Name: TABLE cash_transaction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.cash_transaction IS 'Cites: CD-11, CD-18, CD-19, RT-135. The drawer''s ledger: every cash movement is a row, never a field update. v1 writes the opening float, change given, and the closing float; the other types of cash-management s5 arrive with their flows.';


--
-- Name: CONSTRAINT ck_cash_transaction_amount ON cash_transaction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_cash_transaction_amount ON public.cash_transaction IS 'Cites: CD-14, CD-18. A float may be zero (CD-14); change given is a positive disbursement.';


--
-- Name: CONSTRAINT ck_cash_transaction_direction ON cash_transaction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_cash_transaction_direction ON public.cash_transaction IS 'Cites: CD-19, BI-05. Each type has its fixed direction; an amount is never signed.';


--
-- Name: CONSTRAINT ck_cash_transaction_sale ON cash_transaction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_cash_transaction_sale ON public.cash_transaction IS 'Cites: CD-18. Change given, and only change given, names its sale.';


--
-- Name: CONSTRAINT ck_cash_transaction_type ON cash_transaction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_cash_transaction_type ON public.cash_transaction IS 'Cites: CD-11, CD-18, CD-20. The cash transaction types v1 writes (cash-management s5).';


--
-- Name: cash_transaction_seq_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.cash_transaction ALTER COLUMN seq ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.cash_transaction_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


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
-- Name: checkout; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checkout (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    pos_terminal_id uuid NOT NULL,
    cash_drawer_id uuid NOT NULL,
    cash_shift_id uuid NOT NULL,
    client_operation_id uuid NOT NULL,
    currency_code text NOT NULL,
    status text DEFAULT 'Open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid NOT NULL,
    closed_at timestamp with time zone,
    correlation_id uuid,
    CONSTRAINT ck_checkout_closed CHECK (((status = 'Open'::text) = (closed_at IS NULL))),
    CONSTRAINT ck_checkout_status CHECK ((status = ANY (ARRAY['Open'::text, 'Completed'::text, 'Abandoned'::text])))
);


--
-- Name: TABLE checkout; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.checkout IS 'Cites: PY-37, PY-38, PY-42, PY-54, SP-43, SP-01. The settlement of one cart at one till: it holds every payment attempt, which PY-38 takes before the sale commits, and completes into at most one sale. It is not a sale: it has no number, no lines and no ledger effect (SP-01). An abandoned checkout''s captured payments are money taken for nothing and are reconciled (PY-37, PY-40).';


--
-- Name: CONSTRAINT ck_checkout_closed ON checkout; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_checkout_closed ON public.checkout IS 'Cites: SM-03, RT-353. A checkout records when it closed, exactly when it closed.';


--
-- Name: CONSTRAINT ck_checkout_status ON checkout; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_checkout_status ON public.checkout IS 'Cites: SP-43, PY-17. A checkout is open until it completes into a sale or is abandoned with the cart.';


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
-- Name: customer; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    is_walk_in boolean NOT NULL,
    display_name public.nonblank_text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE customer; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.customer IS 'Cites: CU-01, RT-001. A customer. v1 builds only the identity a sale needs: a walk-in is a customer record, never a null. Named customers, accounts, credit and loyalty are deferred.';


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
-- Name: inventory_movement; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_movement (
    seq bigint NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inventory_transaction_id uuid NOT NULL,
    store_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    storage_location_id uuid NOT NULL,
    movement_type text NOT NULL,
    direction text NOT NULL,
    quantity numeric(18,4) NOT NULL,
    delta numeric(18,4) GENERATED ALWAYS AS (
CASE direction
    WHEN 'In'::text THEN quantity
    ELSE (- quantity)
END) STORED,
    resulting_balance numeric(18,4) NOT NULL,
    balance_sequence bigint NOT NULL,
    reverses_movement_id uuid,
    stock_adjustment_id uuid,
    stock_adjustment_line_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sale_id uuid,
    sale_line_id uuid,
    CONSTRAINT ck_inventory_movement_adjustment_pair CHECK (((stock_adjustment_id IS NULL) = (stock_adjustment_line_id IS NULL))),
    CONSTRAINT ck_inventory_movement_one_cause CHECK ((num_nonnulls(stock_adjustment_line_id, sale_line_id) = 1)),
    CONSTRAINT ck_inventory_movement_positive CHECK ((quantity > (0)::numeric)),
    CONSTRAINT ck_inventory_movement_reversal CHECK (((movement_type = 'REVERSAL'::text) = (reverses_movement_id IS NOT NULL))),
    CONSTRAINT ck_inventory_movement_sale_pair CHECK (((sale_id IS NULL) = (sale_line_id IS NULL)))
);


--
-- Name: TABLE inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.inventory_movement IS 'Cites: ADR-05, BI-02, BI-03, BI-12, BI-15, IV-05, IV-06, IV-07, RT-056, RT-059, RT-060. The append-only ledger and the source of truth for stock. Each row names its transaction and the document line that caused it, has a positive quantity and an explicit direction, and records the balance it produced.';


--
-- Name: COLUMN inventory_movement.balance_sequence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inventory_movement.balance_sequence IS 'Position of this movement in its stock item''s history, assigned under the balance row lock, so it is the true application order even when concurrent transactions draw seq out of order (IV-06).';


--
-- Name: CONSTRAINT ck_inventory_movement_adjustment_pair ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_inventory_movement_adjustment_pair ON public.inventory_movement IS 'Cites: BI-03. An adjustment line is always named with its adjustment.';


--
-- Name: CONSTRAINT ck_inventory_movement_one_cause ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_inventory_movement_one_cause ON public.inventory_movement IS 'Cites: BI-03, RT-060, IV-14. Exactly one causing document line: an adjustment line or a sale line. Later domains add their line columns to this count.';


--
-- Name: CONSTRAINT ck_inventory_movement_positive ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_inventory_movement_positive ON public.inventory_movement IS 'Cites: BI-05. A movement quantity is positive; its effect''s sign comes from its direction.';


--
-- Name: CONSTRAINT ck_inventory_movement_reversal ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_inventory_movement_reversal ON public.inventory_movement IS 'Cites: IV-12, BI-15. A REVERSAL, and only a REVERSAL, references the movement it reverses.';


--
-- Name: CONSTRAINT ck_inventory_movement_sale_pair ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_inventory_movement_sale_pair ON public.inventory_movement IS 'Cites: BI-03. A sale line is always named with its sale.';


--
-- Name: inventory_movement_seq_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.inventory_movement ALTER COLUMN seq ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.inventory_movement_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: inventory_movement_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_movement_type (
    code public.nonblank_text NOT NULL,
    direction text NOT NULL,
    stock_class text,
    CONSTRAINT ck_inventory_movement_type_class CHECK (((((code)::text = 'REVERSAL'::text) AND (stock_class IS NULL)) OR (((code)::text <> 'REVERSAL'::text) AND (stock_class = ANY (ARRAY['Creates'::text, 'Destroys'::text, 'Conserves'::text]))))),
    CONSTRAINT ck_inventory_movement_type_direction CHECK ((direction = ANY (ARRAY['In'::text, 'Out'::text])))
);


--
-- Name: TABLE inventory_movement_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.inventory_movement_type IS 'Cites: RT-058, IV-11, IV-12, IV-13, BI-12. The closed movement-type enumeration with each type''s direction and whether it creates, destroys or conserves total stock. REVERSAL takes either direction and inherits the inverted class of what it reverses. There is no set-stock type (IV-13) and no reservation type (IV-11).';


--
-- Name: CONSTRAINT ck_inventory_movement_type_class ON inventory_movement_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_inventory_movement_type_class ON public.inventory_movement_type IS 'Cites: BI-12. Every type but REVERSAL is classified as creating, destroying or conserving stock.';


--
-- Name: CONSTRAINT ck_inventory_movement_type_direction ON inventory_movement_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_inventory_movement_type_direction ON public.inventory_movement_type IS 'Cites: BI-05. Direction is explicit; a quantity is never signed.';


--
-- Name: inventory_transaction; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_transaction (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    business_date date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid NOT NULL,
    correlation_id uuid
);


--
-- Name: TABLE inventory_transaction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.inventory_transaction IS 'Cites: IV-05, BI-03, RT-060, AU-10. The business event that moved stock: one row per posting, with its store, actor, server time, business date and correlation id. Its movements name the document lines.';


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
-- Name: payment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    checkout_id uuid NOT NULL,
    store_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    payment_method_id uuid NOT NULL,
    method_type text NOT NULL,
    currency_code text NOT NULL,
    amount bigint NOT NULL,
    tendered_amount bigint,
    sequence_number integer NOT NULL,
    status text DEFAULT 'Pending'::text NOT NULL,
    provider_transaction_reference text,
    provider_outcome text,
    provider_raw_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid NOT NULL,
    status_changed_at timestamp with time zone DEFAULT now() NOT NULL,
    status_changed_by uuid NOT NULL,
    correlation_id uuid,
    CONSTRAINT ck_payment_positive CHECK ((amount > 0)),
    CONSTRAINT ck_payment_provider_outcome CHECK ((provider_outcome = ANY (ARRAY['Approved'::text, 'Declined'::text, 'Pending'::text, 'Failed'::text, 'Errored'::text, 'Timeout'::text]))),
    CONSTRAINT ck_payment_sequence CHECK ((sequence_number >= 1)),
    CONSTRAINT ck_payment_status CHECK ((status = ANY (ARRAY['Pending'::text, 'Authorized'::text, 'Captured'::text, 'Declined'::text, 'Voided'::text, 'Failed'::text]))),
    CONSTRAINT ck_payment_tendered CHECK ((((method_type = 'Cash'::text) AND (tendered_amount IS NOT NULL) AND (tendered_amount >= amount)) OR ((method_type <> 'Cash'::text) AND (tendered_amount IS NULL))))
);


--
-- Name: TABLE payment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.payment IS 'Cites: PY-02, PY-12, PY-42, PY-46, PY-54, D-14, ADR-09. One payment attempt: the amount applied to the sale, never the amount handed over. Every attempt is its own row; a retry is a new row, and Captured, Declined, Voided and Failed are terminal for the row.';


--
-- Name: CONSTRAINT ck_payment_positive ON payment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_payment_positive ON public.payment IS 'Cites: PY-02, SP-39. A tender applies a positive amount. The zero-value payment of a credit sale (PY-01) arrives with credit.';


--
-- Name: CONSTRAINT ck_payment_provider_outcome ON payment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_payment_provider_outcome ON public.payment IS 'Cites: PY-10, PY-11. The provider''s response normalised to six outcomes; the raw code is kept beside it.';


--
-- Name: CONSTRAINT ck_payment_sequence ON payment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_payment_sequence ON public.payment IS 'Cites: PY-20. Settlement order starts at 1.';


--
-- Name: CONSTRAINT ck_payment_status ON payment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_payment_status ON public.payment IS 'Cites: SM-51, SM-52, SM-53, PY-54. The payment states of payment-domain s4. Timeout is not a state; Refunded belongs to the refund.';


--
-- Name: CONSTRAINT ck_payment_tendered ON payment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_payment_tendered ON public.payment IS 'Cites: PY-19, CD-07, RT-132. Cash records what was handed over beside what was applied, and the difference is change; any other method is never overpaid.';


--
-- Name: payment_method; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_method (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    code public.nonblank_text NOT NULL,
    name public.nonblank_text NOT NULL,
    method_type text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_payment_method_type CHECK ((method_type = ANY (ARRAY['Cash'::text, 'Card'::text])))
);


--
-- Name: TABLE payment_method; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.payment_method IS 'Cites: PY-03, PY-04, ADR-09. A typed payment method; the type decides the settlement logic. v1 supports Cash and Card; stored-value, credit and wallet types arrive with their balances (PY-29).';


--
-- Name: CONSTRAINT ck_payment_method_type ON payment_method; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_payment_method_type ON public.payment_method IS 'Cites: PY-03, ADR-09. The method types v1 settles: cash in the drawer, and card through the provider abstraction.';


--
-- Name: pos_terminal; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pos_terminal (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    code public.nonblank_text NOT NULL,
    label public.nonblank_text NOT NULL,
    mode text DEFAULT 'Standard'::text NOT NULL,
    status text DEFAULT 'Registered'::text NOT NULL,
    sell_from_location_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status_changed_at timestamp with time zone DEFAULT now() NOT NULL,
    status_changed_by uuid NOT NULL,
    CONSTRAINT ck_pos_terminal_mode CHECK ((mode = ANY (ARRAY['Standard'::text, 'Training'::text, 'Maintenance'::text]))),
    CONSTRAINT ck_pos_terminal_status CHECK ((status = ANY (ARRAY['Registered'::text, 'Active'::text, 'Disabled'::text, 'Retired'::text])))
);


--
-- Name: TABLE pos_terminal; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.pos_terminal IS 'Cites: PT-01, PT-02, PT-03, RT-122, RT-423, SM-59. A registered till bound to exactly one store. Its mode (Standard, Training, Maintenance) is configuration, and its status is the device lifecycle; the two are separate axes (ADR-27).';


--
-- Name: CONSTRAINT ck_pos_terminal_mode ON pos_terminal; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_pos_terminal_mode ON public.pos_terminal IS 'Cites: PT-03, SM-59, RT-423. The three modes; a mode is a field, not a lifecycle step.';


--
-- Name: CONSTRAINT ck_pos_terminal_status ON pos_terminal; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_pos_terminal_status ON public.pos_terminal IS 'Cites: SM-60, HD-08. The stored device states a till uses in v1. Degraded and Offline are health telemetry (SM-61) and arrive with device monitoring.';


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
-- Name: reason_code; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reason_code (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    code public.nonblank_text NOT NULL,
    name public.nonblank_text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    archived_by uuid,
    CONSTRAINT ck_reason_code_archival CHECK (((archived_at IS NULL) = (archived_by IS NULL)))
);


--
-- Name: TABLE reason_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.reason_code IS 'Cites: BI-25, IV-33, RT-074. The server-defined, per-organization reason list. Free text may add to a reason, never replace one (overview s3.8). None is seeded: the list is the organization''s.';


--
-- Name: CONSTRAINT ck_reason_code_archival ON reason_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_reason_code_archival ON public.reason_code IS 'Cites: BI-40. An archival records who and when together.';


--
-- Name: sale; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sale (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    checkout_id uuid NOT NULL,
    pos_terminal_id uuid NOT NULL,
    cash_drawer_id uuid NOT NULL,
    cash_shift_id uuid NOT NULL,
    client_operation_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    document_number bigint NOT NULL,
    business_date date NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'Completed'::text NOT NULL,
    store_setting_version_id uuid NOT NULL,
    tax_mode text NOT NULL,
    currency_code text NOT NULL,
    subtotal bigint NOT NULL,
    tax_total bigint NOT NULL,
    total_due bigint NOT NULL,
    total_tendered bigint NOT NULL,
    change_given bigint NOT NULL,
    receipt_status text,
    correlation_id uuid,
    CONSTRAINT ck_sale_amounts CHECK (((subtotal >= 0) AND (tax_total >= 0) AND (total_due >= 0) AND (change_given >= 0))),
    CONSTRAINT ck_sale_receipt CHECK ((receipt_status = ANY (ARRAY['Printed'::text, 'Failed'::text, 'Reprinted'::text]))),
    CONSTRAINT ck_sale_status CHECK ((status = ANY (ARRAY['Completed'::text, 'PartiallyReturned'::text, 'Returned'::text, 'Voided'::text]))),
    CONSTRAINT ck_sale_tax_mode CHECK ((tax_mode = ANY (ARRAY['Inclusive'::text, 'Exclusive'::text]))),
    CONSTRAINT ck_sale_tendered CHECK ((total_tendered = total_due))
);


--
-- Name: TABLE sale; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sale IS 'Cites: SP-01, SP-02, RT-118, RT-119, RT-122, RT-123, BI-08. A completed customer transaction. It is created Completed by the completion transaction, never exists as a draft, and is never edited; later changes are compensating documents.';


--
-- Name: CONSTRAINT ck_sale_amounts ON sale; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_sale_amounts ON public.sale IS 'Cites: RT-131, BI-19. No total of a sale is negative.';


--
-- Name: CONSTRAINT ck_sale_receipt ON sale; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_sale_receipt ON public.sale IS 'Cites: SP-58, RT-140. Whether the receipt printed, failed and was queued, or was reprinted.';


--
-- Name: CONSTRAINT ck_sale_status ON sale; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_sale_status ON public.sale IS 'Cites: SM-32, SM-35, SM-36. The sale states of sales-pos-domain s13; there is no draft, pending or cancelled sale.';


--
-- Name: CONSTRAINT ck_sale_tax_mode ON sale; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_sale_tax_mode ON public.sale IS 'Cites: SP-33, PR-38. The tax mode the sale was computed in, snapshotted (TaxModeAtSale).';


--
-- Name: CONSTRAINT ck_sale_tendered ON sale; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_sale_tendered ON public.sale IS 'Cites: SP-40, PY-16, RT-133. The applied tenders equal the total due; an underpaid credit sale (SP-41) arrives with credit.';


--
-- Name: sale_line; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sale_line (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sale_id uuid NOT NULL,
    store_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    line_number integer NOT NULL,
    variant_id uuid NOT NULL,
    description public.nonblank_text NOT NULL,
    unit_name public.nonblank_text NOT NULL,
    quantity numeric(18,4) NOT NULL,
    unit_price bigint NOT NULL,
    price_quoted_at timestamp with time zone NOT NULL,
    gross_amount bigint NOT NULL,
    tax_rate_id uuid NOT NULL,
    tax_amount bigint NOT NULL,
    line_total bigint NOT NULL,
    settled_amount bigint NOT NULL,
    unit_cost bigint,
    storage_location_id uuid NOT NULL,
    entry_method text NOT NULL,
    scanned_barcode text,
    returned_quantity numeric(18,4) DEFAULT 0 NOT NULL,
    refunded_amount bigint DEFAULT 0 NOT NULL,
    CONSTRAINT ck_sale_line_cost CHECK ((unit_cost >= 0)),
    CONSTRAINT ck_sale_line_entry CHECK ((((entry_method = 'Scanned'::text) AND (scanned_barcode IS NOT NULL)) OR ((entry_method = 'Selected'::text) AND (scanned_barcode IS NULL)))),
    CONSTRAINT ck_sale_line_gross CHECK (((gross_amount)::numeric = round((quantity * (unit_price)::numeric)))),
    CONSTRAINT ck_sale_line_number CHECK ((line_number >= 1)),
    CONSTRAINT ck_sale_line_price CHECK ((unit_price > 0)),
    CONSTRAINT ck_sale_line_quantity CHECK ((quantity > (0)::numeric)),
    CONSTRAINT ck_sale_line_refunded CHECK (((refunded_amount >= 0) AND (refunded_amount <= settled_amount))),
    CONSTRAINT ck_sale_line_returned CHECK (((returned_quantity >= (0)::numeric) AND (returned_quantity <= quantity))),
    CONSTRAINT ck_sale_line_settled CHECK (((settled_amount >= 0) AND (settled_amount <= line_total))),
    CONSTRAINT ck_sale_line_tax CHECK (((tax_amount >= 0) AND (line_total >= 0)))
);


--
-- Name: TABLE sale_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sale_line IS 'Cites: SP-06, SP-07, SP-13, RT-021, RT-124, RT-146, BE-43. One line of a sale, every display value and money figure snapshotted: description, unit, quoted price, tax rate and tax, cost at sale, and the settled amount. The returned and refunded counters are the truth the sale''s status caches (SP-66).';


--
-- Name: CONSTRAINT ck_sale_line_cost ON sale_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_sale_line_cost ON public.sale_line IS 'Cites: SP-07, BI-01. A recorded cost is never negative; null means no standard cost was defined.';


--
-- Name: CONSTRAINT ck_sale_line_entry ON sale_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_sale_line_entry ON public.sale_line IS 'Cites: RT-489, PR-11. A scanned line keeps the barcode read; a search-only selection is recorded as explicit.';


--
-- Name: CONSTRAINT ck_sale_line_gross ON sale_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_sale_line_gross ON public.sale_line IS 'Cites: BI-01, BI-11. The line amount is quantity times price, computed at full precision and rounded half-up once (overview s3.1).';


--
-- Name: CONSTRAINT ck_sale_line_number ON sale_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_sale_line_number ON public.sale_line IS 'Cites: SP-06. Lines are numbered from 1.';


--
-- Name: CONSTRAINT ck_sale_line_price ON sale_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_sale_line_price ON public.sale_line IS 'Cites: PR-34, RT-042. A price is positive.';


--
-- Name: CONSTRAINT ck_sale_line_quantity ON sale_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_sale_line_quantity ON public.sale_line IS 'Cites: SP-15, BI-05. A sale quantity is positive; minus one is a return, never a negative line.';


--
-- Name: CONSTRAINT ck_sale_line_refunded ON sale_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_sale_line_refunded ON public.sale_line IS 'Cites: BI-10, RT-145, RT-147. The refunded amount never exceeds what the line settled.';


--
-- Name: CONSTRAINT ck_sale_line_returned ON sale_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_sale_line_returned ON public.sale_line IS 'Cites: BI-06, BI-16, RT-148. The returned quantity never exceeds the sold quantity: the bound is the counter itself.';


--
-- Name: CONSTRAINT ck_sale_line_settled ON sale_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_sale_line_settled ON public.sale_line IS 'Cites: RT-146, RT-147. The settled amount, stored at completion, is at most the line total; refunds are bounded by it.';


--
-- Name: CONSTRAINT ck_sale_line_tax ON sale_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_sale_line_tax ON public.sale_line IS 'Cites: RT-131, BI-19. A line''s tax and total are never negative.';


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: shift_count; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shift_count (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cash_shift_id uuid NOT NULL,
    store_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    pass_number integer NOT NULL,
    counted_amount bigint NOT NULL,
    expected_amount bigint NOT NULL,
    variance bigint GENERATED ALWAYS AS ((counted_amount - expected_amount)) STORED,
    counted_at timestamp with time zone DEFAULT now() NOT NULL,
    counted_by uuid NOT NULL,
    reason_code_id uuid,
    acknowledged_at timestamp with time zone,
    acknowledged_by uuid,
    CONSTRAINT ck_shift_count_acknowledgement CHECK ((((acknowledged_by IS NULL) AND (acknowledged_at IS NULL) AND (reason_code_id IS NULL)) OR ((acknowledged_by IS NOT NULL) AND (acknowledged_at IS NOT NULL) AND (reason_code_id IS NOT NULL)))),
    CONSTRAINT ck_shift_count_counted CHECK ((counted_amount >= 0))
);


--
-- Name: TABLE shift_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.shift_count IS 'Cites: CD-20, CD-21, CD-22, CD-23, SM-57. One blind counting pass of a reconciling shift. The expected amount is computed by the server at the count, and the variance is derived; neither is entered. A recount is a new pass, and earlier passes stand as history.';


--
-- Name: CONSTRAINT ck_shift_count_acknowledgement ON shift_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_shift_count_acknowledgement ON public.shift_count IS 'Cites: CD-23, CD-24. An acknowledgement records who, when and why together; a variance is acknowledged, never adjusted away.';


--
-- Name: CONSTRAINT ck_shift_count_counted ON shift_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_shift_count_counted ON public.shift_count IS 'Cites: CD-04. A counted amount is an observation of cash, never negative.';


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
-- Name: stock_adjustment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_adjustment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    document_number bigint NOT NULL,
    kind text NOT NULL,
    reason_code_id uuid NOT NULL,
    note public.nonblank_text,
    status text DEFAULT 'Draft'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid NOT NULL,
    submitted_at timestamp with time zone,
    submitted_by uuid,
    approved_at timestamp with time zone,
    approved_by uuid,
    status_changed_at timestamp with time zone DEFAULT now() NOT NULL,
    status_changed_by uuid NOT NULL,
    CONSTRAINT ck_stock_adjustment_approved CHECK (((approved_at IS NULL) = (approved_by IS NULL))),
    CONSTRAINT ck_stock_adjustment_approved_when CHECK (((status <> ALL (ARRAY['Approved'::text, 'Posted'::text, 'Reversed'::text])) OR (approved_by IS NOT NULL))),
    CONSTRAINT ck_stock_adjustment_kind CHECK ((kind = ANY (ARRAY['Adjustment'::text, 'OpeningBalance'::text]))),
    CONSTRAINT ck_stock_adjustment_separation CHECK (((approved_by IS NULL) OR (approved_by <> submitted_by))),
    CONSTRAINT ck_stock_adjustment_status CHECK ((status = ANY (ARRAY['Draft'::text, 'PendingApproval'::text, 'Approved'::text, 'Posted'::text, 'Cancelled'::text, 'Reversed'::text]))),
    CONSTRAINT ck_stock_adjustment_submitted CHECK (((submitted_at IS NULL) = (submitted_by IS NULL))),
    CONSTRAINT ck_stock_adjustment_submitted_when CHECK (((status = ANY (ARRAY['Draft'::text, 'Cancelled'::text])) OR (submitted_by IS NOT NULL)))
);


--
-- Name: TABLE stock_adjustment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.stock_adjustment IS 'Cites: IV-32, IV-33, RT-486, BI-27. A stock adjustment is a document with a state machine and moves no stock until posted. Kind OpeningBalance carries the initial load (OPENING_BALANCE) until import jobs exist.';


--
-- Name: CONSTRAINT ck_stock_adjustment_approved ON stock_adjustment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_stock_adjustment_approved ON public.stock_adjustment IS 'Cites: SM-03, BI-26. An approval records who and when together.';


--
-- Name: CONSTRAINT ck_stock_adjustment_approved_when ON stock_adjustment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_stock_adjustment_approved_when ON public.stock_adjustment IS 'Cites: IV-35, RT-075, BI-27. An approved, posted or reversed adjustment records who approved it.';


--
-- Name: CONSTRAINT ck_stock_adjustment_kind ON stock_adjustment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_stock_adjustment_kind ON public.stock_adjustment IS 'Cites: IV-13, RT-486. A correction, or an opening balance; there is no set-stock document.';


--
-- Name: CONSTRAINT ck_stock_adjustment_separation ON stock_adjustment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_stock_adjustment_separation ON public.stock_adjustment IS 'Cites: BI-26, RT-075, IV-35. The requester cannot approve their own adjustment; a data constraint, not a UI affordance (architecture s8.6).';


--
-- Name: CONSTRAINT ck_stock_adjustment_status ON stock_adjustment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_stock_adjustment_status ON public.stock_adjustment IS 'Cites: IV-32, SM-07. The states of the StockAdjustment machine (state-machines s22.17).';


--
-- Name: CONSTRAINT ck_stock_adjustment_submitted ON stock_adjustment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_stock_adjustment_submitted ON public.stock_adjustment IS 'Cites: SM-03. A submission records who and when together.';


--
-- Name: CONSTRAINT ck_stock_adjustment_submitted_when ON stock_adjustment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_stock_adjustment_submitted_when ON public.stock_adjustment IS 'Cites: IV-32, SM-03. Every adjustment past Draft (other than a cancelled draft) records who submitted it.';


--
-- Name: stock_adjustment_line; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_adjustment_line (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    stock_adjustment_id uuid NOT NULL,
    adjustment_kind text NOT NULL,
    store_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    storage_location_id uuid NOT NULL,
    movement_type text NOT NULL,
    direction text NOT NULL,
    quantity numeric(18,4) NOT NULL,
    counted_quantity numeric(18,4),
    system_quantity numeric(18,4),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_stock_adjustment_line_count CHECK ((((counted_quantity IS NULL) AND (system_quantity IS NULL)) OR ((counted_quantity >= (0)::numeric) AND (system_quantity IS NOT NULL) AND (counted_quantity <> system_quantity) AND (quantity = abs((counted_quantity - system_quantity))) AND (direction =
CASE
    WHEN (counted_quantity > system_quantity) THEN 'In'::text
    ELSE 'Out'::text
END)))),
    CONSTRAINT ck_stock_adjustment_line_positive CHECK ((quantity > (0)::numeric)),
    CONSTRAINT ck_stock_adjustment_line_type CHECK ((((adjustment_kind = 'OpeningBalance'::text) AND (movement_type = 'OPENING_BALANCE'::text)) OR ((adjustment_kind = 'Adjustment'::text) AND (movement_type = ANY (ARRAY['ADJUSTMENT_IN'::text, 'ADJUSTMENT_OUT'::text, 'DAMAGE'::text, 'EXPIRY'::text, 'LOSS'::text, 'FOUND'::text])))))
);


--
-- Name: TABLE stock_adjustment_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.stock_adjustment_line IS 'Cites: IV-34, BI-05, UX-36, UX-37. One directional line per effect with a positive quantity in base units. Where the line was entered as a count, the counted and system quantities are kept as the evidence.';


--
-- Name: CONSTRAINT ck_stock_adjustment_line_count ON stock_adjustment_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_stock_adjustment_line_count ON public.stock_adjustment_line IS 'Cites: UX-36, UX-37, IV-29, IV-34. A line entered as a count carries a non-negative counted quantity and the system quantity beside it, and its directional quantity is exactly their difference.';


--
-- Name: CONSTRAINT ck_stock_adjustment_line_positive ON stock_adjustment_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_stock_adjustment_line_positive ON public.stock_adjustment_line IS 'Cites: IV-34, BI-05. A line quantity is positive; direction comes from the movement type.';


--
-- Name: CONSTRAINT ck_stock_adjustment_line_type ON stock_adjustment_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_stock_adjustment_line_type ON public.stock_adjustment_line IS 'Cites: IV-13, RT-486. An opening balance writes OPENING_BALANCE; an adjustment writes adjustment, damage, expiry, loss or found movements (inventory-domain s5).';


--
-- Name: stock_balance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_balance (
    organization_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    storage_location_id uuid NOT NULL,
    on_hand numeric(18,4) NOT NULL,
    movement_count bigint NOT NULL,
    last_movement_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_stock_balance_count CHECK ((movement_count >= 1))
);


--
-- Name: TABLE stock_balance; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.stock_balance IS 'Cites: BI-02, IV-08, RT-056, RT-057, MS-17, ADR-05. The stock item: one variant at one location, identified by those two and never by a store (MS-17, D-03). A cache of the ledger written only by the movement trigger; the application can read it and nothing else.';


--
-- Name: CONSTRAINT ck_stock_balance_count ON stock_balance; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_stock_balance_count ON public.stock_balance IS 'Cites: IV-02. A stock item exists only because a movement created it.';


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
-- Name: store_payment_method; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_payment_method (
    store_id uuid NOT NULL,
    payment_method_id uuid NOT NULL,
    is_enabled boolean NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    changed_by uuid NOT NULL
);


--
-- Name: TABLE store_payment_method; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.store_payment_method IS 'Cites: PY-04, PY-05. Whether a method may be used at a store. Enablement is prospective: disabling stops new use and historical payments render unchanged.';


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
-- Name: cash_drawer pk_cash_drawer; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_drawer
    ADD CONSTRAINT pk_cash_drawer PRIMARY KEY (id);


--
-- Name: cash_shift pk_cash_shift; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_shift
    ADD CONSTRAINT pk_cash_shift PRIMARY KEY (id);


--
-- Name: cash_transaction pk_cash_transaction; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_transaction
    ADD CONSTRAINT pk_cash_transaction PRIMARY KEY (id);


--
-- Name: category pk_category; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category
    ADD CONSTRAINT pk_category PRIMARY KEY (id);


--
-- Name: checkout pk_checkout; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkout
    ADD CONSTRAINT pk_checkout PRIMARY KEY (id);


--
-- Name: currency pk_currency; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.currency
    ADD CONSTRAINT pk_currency PRIMARY KEY (code);


--
-- Name: customer pk_customer; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer
    ADD CONSTRAINT pk_customer PRIMARY KEY (id);


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
-- Name: inventory_movement pk_inventory_movement; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movement
    ADD CONSTRAINT pk_inventory_movement PRIMARY KEY (id);


--
-- Name: inventory_movement_type pk_inventory_movement_type; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movement_type
    ADD CONSTRAINT pk_inventory_movement_type PRIMARY KEY (code, direction);


--
-- Name: inventory_transaction pk_inventory_transaction; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transaction
    ADD CONSTRAINT pk_inventory_transaction PRIMARY KEY (id);


--
-- Name: organization pk_organization; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization
    ADD CONSTRAINT pk_organization PRIMARY KEY (id);


--
-- Name: payment pk_payment; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment
    ADD CONSTRAINT pk_payment PRIMARY KEY (id);


--
-- Name: payment_method pk_payment_method; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_method
    ADD CONSTRAINT pk_payment_method PRIMARY KEY (id);


--
-- Name: pos_terminal pk_pos_terminal; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_terminal
    ADD CONSTRAINT pk_pos_terminal PRIMARY KEY (id);


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
-- Name: reason_code pk_reason_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reason_code
    ADD CONSTRAINT pk_reason_code PRIMARY KEY (id);


--
-- Name: sale pk_sale; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale
    ADD CONSTRAINT pk_sale PRIMARY KEY (id);


--
-- Name: sale_line pk_sale_line; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_line
    ADD CONSTRAINT pk_sale_line PRIMARY KEY (id);


--
-- Name: shift_count pk_shift_count; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_count
    ADD CONSTRAINT pk_shift_count PRIMARY KEY (id);


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
-- Name: stock_adjustment pk_stock_adjustment; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_adjustment
    ADD CONSTRAINT pk_stock_adjustment PRIMARY KEY (id);


--
-- Name: stock_adjustment_line pk_stock_adjustment_line; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_adjustment_line
    ADD CONSTRAINT pk_stock_adjustment_line PRIMARY KEY (id);


--
-- Name: stock_balance pk_stock_balance; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_balance
    ADD CONSTRAINT pk_stock_balance PRIMARY KEY (variant_id, storage_location_id);


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
-- Name: store_payment_method pk_store_payment_method; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_payment_method
    ADD CONSTRAINT pk_store_payment_method PRIMARY KEY (store_id, payment_method_id);


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
-- Name: cash_drawer uq_cash_drawer_identity; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_drawer
    ADD CONSTRAINT uq_cash_drawer_identity UNIQUE (id, pos_terminal_id, store_id);


--
-- Name: CONSTRAINT uq_cash_drawer_identity ON cash_drawer; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_cash_drawer_identity ON public.cash_drawer IS 'Cites: RT-122, BI-14. Lets a shift prove, by foreign key, that its drawer belongs to its terminal and store.';


--
-- Name: cash_drawer uq_cash_drawer_one_per_terminal; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_drawer
    ADD CONSTRAINT uq_cash_drawer_one_per_terminal UNIQUE (pos_terminal_id);


--
-- Name: CONSTRAINT uq_cash_drawer_one_per_terminal ON cash_drawer; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_cash_drawer_one_per_terminal ON public.cash_drawer IS 'Cites: CD-34. At most one drawer per terminal in v1 (organization-model s1: PosTerminal to CashDrawer is 1 to 0..1).';


--
-- Name: cash_shift uq_cash_shift_drawer_store; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_shift
    ADD CONSTRAINT uq_cash_shift_drawer_store UNIQUE (id, cash_drawer_id, store_id);


--
-- Name: CONSTRAINT uq_cash_shift_drawer_store ON cash_shift; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_cash_shift_drawer_store ON public.cash_shift IS 'Cites: CD-19, BI-14. Lets a cash transaction prove, by foreign key, that its drawer and store are its shift''s.';


--
-- Name: cash_shift uq_cash_shift_id_store; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_shift
    ADD CONSTRAINT uq_cash_shift_id_store UNIQUE (id, store_id);


--
-- Name: CONSTRAINT uq_cash_shift_id_store ON cash_shift; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_cash_shift_id_store ON public.cash_shift IS 'Cites: CD-20, BI-14. Lets a count prove, by foreign key, that it counts a shift of its own store.';


--
-- Name: cash_shift uq_cash_shift_identity; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_shift
    ADD CONSTRAINT uq_cash_shift_identity UNIQUE (id, cash_drawer_id, pos_terminal_id, store_id);


--
-- Name: CONSTRAINT uq_cash_shift_identity ON cash_shift; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_cash_shift_identity ON public.cash_shift IS 'Cites: RT-122, PY-46. Lets a checkout or sale prove, by foreign key, that its shift, drawer, terminal and store agree.';


--
-- Name: cash_transaction uq_cash_transaction_seq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_transaction
    ADD CONSTRAINT uq_cash_transaction_seq UNIQUE (seq);


--
-- Name: CONSTRAINT uq_cash_transaction_seq ON cash_transaction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_cash_transaction_seq ON public.cash_transaction IS 'Cites: CD-19. A total order over the drawer ledger.';


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
-- Name: checkout uq_checkout_id_store; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkout
    ADD CONSTRAINT uq_checkout_id_store UNIQUE (id, store_id);


--
-- Name: CONSTRAINT uq_checkout_id_store ON checkout; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_checkout_id_store ON public.checkout IS 'Cites: RT-001, BI-14. Lets a payment prove, by foreign key, that it settles a checkout of its own store.';


--
-- Name: checkout uq_checkout_identity; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkout
    ADD CONSTRAINT uq_checkout_identity UNIQUE (id, cash_shift_id, cash_drawer_id, pos_terminal_id, store_id, client_operation_id);


--
-- Name: CONSTRAINT uq_checkout_identity ON checkout; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_checkout_identity ON public.checkout IS 'Cites: RT-122, RT-123. Lets a sale prove, by foreign key, that its shift, drawer, terminal, store and operation id are its checkout''s.';


--
-- Name: checkout uq_checkout_operation; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkout
    ADD CONSTRAINT uq_checkout_operation UNIQUE (pos_terminal_id, client_operation_id);


--
-- Name: CONSTRAINT uq_checkout_operation ON checkout; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_checkout_operation ON public.checkout IS 'Cites: BI-28, PY-39, RT-121, SM-04. The cart''s client operation id is unique per terminal, so a retried commit finds the same checkout.';


--
-- Name: customer uq_customer_id_organization; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer
    ADD CONSTRAINT uq_customer_id_organization UNIQUE (id, organization_id);


--
-- Name: CONSTRAINT uq_customer_id_organization ON customer; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_customer_id_organization ON public.customer IS 'Cites: RT-001, BI-14. Lets a sale prove, by foreign key, that its customer is in its own organization.';


--
-- Name: inventory_movement uq_inventory_movement_balance_sequence; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movement
    ADD CONSTRAINT uq_inventory_movement_balance_sequence UNIQUE (variant_id, storage_location_id, balance_sequence);


--
-- Name: CONSTRAINT uq_inventory_movement_balance_sequence ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_inventory_movement_balance_sequence ON public.inventory_movement IS 'Cites: IV-06, IV-09. Each stock item''s history is one gapless sequence, so the ledger can check itself movement by movement.';


--
-- Name: inventory_movement uq_inventory_movement_id_adjustment_line; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movement
    ADD CONSTRAINT uq_inventory_movement_id_adjustment_line UNIQUE (id, stock_adjustment_line_id);


--
-- Name: CONSTRAINT uq_inventory_movement_id_adjustment_line ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_inventory_movement_id_adjustment_line ON public.inventory_movement IS 'Cites: BI-03. Lets a reversal prove, by foreign key, that it answers to the same adjustment line as the movement it reverses.';


--
-- Name: inventory_movement uq_inventory_movement_id_sale_line; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movement
    ADD CONSTRAINT uq_inventory_movement_id_sale_line UNIQUE (id, sale_line_id);


--
-- Name: CONSTRAINT uq_inventory_movement_id_sale_line ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_inventory_movement_id_sale_line ON public.inventory_movement IS 'Cites: BI-03. Lets a reversal prove, by foreign key, that it answers to the same sale line as the movement it reverses.';


--
-- Name: inventory_movement uq_inventory_movement_reverses; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movement
    ADD CONSTRAINT uq_inventory_movement_reverses UNIQUE (reverses_movement_id);


--
-- Name: CONSTRAINT uq_inventory_movement_reverses ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_inventory_movement_reverses ON public.inventory_movement IS 'Cites: BI-15, IV-12, RT-062. A movement is reversed at most once; reversing an already-reversed movement is refused.';


--
-- Name: inventory_movement uq_inventory_movement_seq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movement
    ADD CONSTRAINT uq_inventory_movement_seq UNIQUE (seq);


--
-- Name: CONSTRAINT uq_inventory_movement_seq ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_inventory_movement_seq ON public.inventory_movement IS 'Cites: IV-09. A total order over the whole ledger, for rebuilds and range scans; never returned by an API.';


--
-- Name: inventory_transaction uq_inventory_transaction_id_store; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transaction
    ADD CONSTRAINT uq_inventory_transaction_id_store UNIQUE (id, store_id);


--
-- Name: CONSTRAINT uq_inventory_transaction_id_store ON inventory_transaction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_inventory_transaction_id_store ON public.inventory_transaction IS 'Cites: MS-16, BI-14. Lets a movement prove, by foreign key, that it is attributed to its transaction''s store.';


--
-- Name: payment_method uq_payment_method_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_method
    ADD CONSTRAINT uq_payment_method_code UNIQUE (organization_id, code);


--
-- Name: CONSTRAINT uq_payment_method_code ON payment_method; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_payment_method_code ON public.payment_method IS 'Cites: PY-04. A method code identifies one method within its organization.';


--
-- Name: payment_method uq_payment_method_id_organization; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_method
    ADD CONSTRAINT uq_payment_method_id_organization UNIQUE (id, organization_id);


--
-- Name: CONSTRAINT uq_payment_method_id_organization ON payment_method; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_payment_method_id_organization ON public.payment_method IS 'Cites: PY-03, BI-14. Lets a payment prove, by foreign key, that its method is in its own organization.';


--
-- Name: payment_method uq_payment_method_type; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_method
    ADD CONSTRAINT uq_payment_method_type UNIQUE (id, method_type);


--
-- Name: CONSTRAINT uq_payment_method_type ON payment_method; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_payment_method_type ON public.payment_method IS 'Cites: PY-03, CD-09. Lets a payment prove, by foreign key, which type of method it used.';


--
-- Name: payment uq_payment_provider_reference; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment
    ADD CONSTRAINT uq_payment_provider_reference UNIQUE (provider_transaction_reference);


--
-- Name: CONSTRAINT uq_payment_provider_reference ON payment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_payment_provider_reference ON public.payment IS 'Cites: PY-15, RT-480. A provider transaction is recorded once, so a duplicate callback is idempotent.';


--
-- Name: payment uq_payment_sequence; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment
    ADD CONSTRAINT uq_payment_sequence UNIQUE (checkout_id, sequence_number);


--
-- Name: CONSTRAINT uq_payment_sequence ON payment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_payment_sequence ON public.payment IS 'Cites: PY-20. Payments on a checkout settle in a recorded, deterministic order.';


--
-- Name: pos_terminal uq_pos_terminal_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_terminal
    ADD CONSTRAINT uq_pos_terminal_code UNIQUE (store_id, code);


--
-- Name: CONSTRAINT uq_pos_terminal_code ON pos_terminal; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_pos_terminal_code ON public.pos_terminal IS 'Cites: PT-01. A terminal code identifies one till within its store.';


--
-- Name: pos_terminal uq_pos_terminal_id_store; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_terminal
    ADD CONSTRAINT uq_pos_terminal_id_store UNIQUE (id, store_id);


--
-- Name: CONSTRAINT uq_pos_terminal_id_store ON pos_terminal; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_pos_terminal_id_store ON public.pos_terminal IS 'Cites: PT-02, BI-14. Lets a drawer, shift or sale prove, by foreign key, that it uses a terminal of its own store.';


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
-- Name: reason_code uq_reason_code_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reason_code
    ADD CONSTRAINT uq_reason_code_code UNIQUE (organization_id, code);


--
-- Name: CONSTRAINT uq_reason_code_code ON reason_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_reason_code_code ON public.reason_code IS 'Cites: RT-074. A reason code is unique within its organization.';


--
-- Name: reason_code uq_reason_code_id_organization; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reason_code
    ADD CONSTRAINT uq_reason_code_id_organization UNIQUE (id, organization_id);


--
-- Name: CONSTRAINT uq_reason_code_id_organization ON reason_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_reason_code_id_organization ON public.reason_code IS 'Cites: RT-001, BI-14. Lets a document prove, by foreign key, that its reason is in its own organization.';


--
-- Name: sale uq_sale_checkout; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale
    ADD CONSTRAINT uq_sale_checkout UNIQUE (checkout_id);


--
-- Name: CONSTRAINT uq_sale_checkout ON sale; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_sale_checkout ON public.sale IS 'Cites: BI-28, PY-39. A checkout completes into at most one sale.';


--
-- Name: sale uq_sale_id_shift; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale
    ADD CONSTRAINT uq_sale_id_shift UNIQUE (id, cash_shift_id);


--
-- Name: CONSTRAINT uq_sale_id_shift ON sale; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_sale_id_shift ON public.sale IS 'Cites: CD-18, CD-19. Lets the change disbursement prove, by foreign key, that it is in the sale''s shift.';


--
-- Name: sale uq_sale_id_store; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale
    ADD CONSTRAINT uq_sale_id_store UNIQUE (id, store_id);


--
-- Name: CONSTRAINT uq_sale_id_store ON sale; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_sale_id_store ON public.sale IS 'Cites: RT-001, BI-14. Lets a line or movement prove, by foreign key, that it belongs to the sale''s store.';


--
-- Name: sale_line uq_sale_line_identity; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_line
    ADD CONSTRAINT uq_sale_line_identity UNIQUE (id, sale_id, variant_id, storage_location_id);


--
-- Name: CONSTRAINT uq_sale_line_identity ON sale_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_sale_line_identity ON public.sale_line IS 'Cites: BI-03, RT-060. Lets a movement prove, by foreign key, that it applies this line''s variant at this line''s location.';


--
-- Name: sale_line uq_sale_line_number; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_line
    ADD CONSTRAINT uq_sale_line_number UNIQUE (sale_id, line_number);


--
-- Name: CONSTRAINT uq_sale_line_number ON sale_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_sale_line_number ON public.sale_line IS 'Cites: SP-06. Line numbers are unique within a sale.';


--
-- Name: sale uq_sale_number; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale
    ADD CONSTRAINT uq_sale_number UNIQUE (store_id, document_number);


--
-- Name: CONSTRAINT uq_sale_number ON sale; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_sale_number ON public.sale IS 'Cites: BI-42, RT-479, SP-05. The sale number is unique per store and never reused.';


--
-- Name: sale uq_sale_operation; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale
    ADD CONSTRAINT uq_sale_operation UNIQUE (pos_terminal_id, client_operation_id);


--
-- Name: CONSTRAINT uq_sale_operation ON sale; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_sale_operation ON public.sale IS 'Cites: BI-28, PY-39, RT-121, EC-05. A commit retried with the same operation id creates no second sale.';


--
-- Name: shift_count uq_shift_count_pass; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_count
    ADD CONSTRAINT uq_shift_count_pass UNIQUE (cash_shift_id, pass_number);


--
-- Name: CONSTRAINT uq_shift_count_pass ON shift_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_shift_count_pass ON public.shift_count IS 'Cites: SM-57. Passes are numbered; a new count never overwrites an old one.';


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
-- Name: stock_adjustment uq_stock_adjustment_id_kind; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_adjustment
    ADD CONSTRAINT uq_stock_adjustment_id_kind UNIQUE (id, kind);


--
-- Name: CONSTRAINT uq_stock_adjustment_id_kind ON stock_adjustment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_stock_adjustment_id_kind ON public.stock_adjustment IS 'Cites: IV-13. Lets a line prove, by foreign key, which kind of adjustment it belongs to.';


--
-- Name: stock_adjustment uq_stock_adjustment_id_organization; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_adjustment
    ADD CONSTRAINT uq_stock_adjustment_id_organization UNIQUE (id, organization_id);


--
-- Name: CONSTRAINT uq_stock_adjustment_id_organization ON stock_adjustment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_stock_adjustment_id_organization ON public.stock_adjustment IS 'Cites: RT-001, BI-14. Lets a line prove, by foreign key, that it is in the adjustment''s organization.';


--
-- Name: stock_adjustment uq_stock_adjustment_id_store; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_adjustment
    ADD CONSTRAINT uq_stock_adjustment_id_store UNIQUE (id, store_id);


--
-- Name: CONSTRAINT uq_stock_adjustment_id_store ON stock_adjustment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_stock_adjustment_id_store ON public.stock_adjustment IS 'Cites: RT-001, BI-14. Lets a movement prove, by foreign key, that it is attributed to the adjustment''s store.';


--
-- Name: stock_adjustment_line uq_stock_adjustment_line_identity; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_adjustment_line
    ADD CONSTRAINT uq_stock_adjustment_line_identity UNIQUE (id, stock_adjustment_id, variant_id, storage_location_id);


--
-- Name: CONSTRAINT uq_stock_adjustment_line_identity ON stock_adjustment_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_stock_adjustment_line_identity ON public.stock_adjustment_line IS 'Cites: BI-03, RT-060. Lets a movement prove, by foreign key, that it applies this line''s variant at this line''s location.';


--
-- Name: stock_adjustment uq_stock_adjustment_number; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_adjustment
    ADD CONSTRAINT uq_stock_adjustment_number UNIQUE (store_id, document_number);


--
-- Name: CONSTRAINT uq_stock_adjustment_number ON stock_adjustment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_stock_adjustment_number ON public.stock_adjustment IS 'Cites: BI-42, RT-479. The document number is unique per store for this document type and never reused.';


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
-- Name: storage_location uq_storage_location_id_organization; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_location
    ADD CONSTRAINT uq_storage_location_id_organization UNIQUE (id, organization_id);


--
-- Name: CONSTRAINT uq_storage_location_id_organization ON storage_location; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_storage_location_id_organization ON public.storage_location IS 'Cites: MS-17, RT-057. Lets a balance or movement prove, by foreign key, that its location is in its own organization.';


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
-- Name: store_setting_version uq_store_setting_version_id_store; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_setting_version
    ADD CONSTRAINT uq_store_setting_version_id_store UNIQUE (id, store_id);


--
-- Name: CONSTRAINT uq_store_setting_version_id_store ON store_setting_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_store_setting_version_id_store ON public.store_setting_version IS 'Cites: REQ-AU-06, SP-33. Lets a sale prove, by foreign key, that its settings snapshot is its own store''s.';


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
-- Name: tax_rate uq_tax_rate_id_organization; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_rate
    ADD CONSTRAINT uq_tax_rate_id_organization UNIQUE (id, organization_id);


--
-- Name: CONSTRAINT uq_tax_rate_id_organization ON tax_rate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_tax_rate_id_organization ON public.tax_rate IS 'Cites: BI-18, RT-001. Lets a sale line prove, by foreign key, that its tax rate is in its own organization.';


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
-- Name: ix_payment_checkout; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_payment_checkout ON public.payment USING btree (checkout_id);


--
-- Name: INDEX ix_payment_checkout; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.ix_payment_checkout IS 'Cites: PY-16, SP-40. Finds a checkout''s tenders when completing and reconciling.';


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
-- Name: ix_sale_business_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sale_business_date ON public.sale USING btree (store_id, business_date);


--
-- Name: INDEX ix_sale_business_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.ix_sale_business_date IS 'Cites: RP-14, MS-04. Store-scoped sales by business date, for lists and reports.';


--
-- Name: ix_sale_shift; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sale_shift ON public.sale USING btree (cash_shift_id);


--
-- Name: INDEX ix_sale_shift; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.ix_sale_shift IS 'Cites: CD-06, RT-135. Finds a shift''s sales to compute its expected cash.';


--
-- Name: ix_stock_adjustment_line_document; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_stock_adjustment_line_document ON public.stock_adjustment_line USING btree (stock_adjustment_id);


--
-- Name: INDEX ix_stock_adjustment_line_document; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.ix_stock_adjustment_line_document IS 'Cites: IV-32. Finds an adjustment''s lines.';


--
-- Name: ix_stock_balance_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_stock_balance_location ON public.stock_balance USING btree (storage_location_id);


--
-- Name: INDEX ix_stock_balance_location; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.ix_stock_balance_location IS 'Cites: IV-20, RT-068. Reads stock per location, for the per-location negative-stock report.';


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
-- Name: uq_cash_shift_open_per_drawer; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_cash_shift_open_per_drawer ON public.cash_shift USING btree (cash_drawer_id) WHERE (status = ANY (ARRAY['Open'::text, 'Reconciling'::text]));


--
-- Name: INDEX uq_cash_shift_open_per_drawer; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.uq_cash_shift_open_per_drawer IS 'Cites: CD-01, CD-03, BI-39. At most one open shift per drawer: a uniqueness constraint, not a check-then-act.';


--
-- Name: uq_cash_shift_open_per_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_cash_shift_open_per_employee ON public.cash_shift USING btree (store_id, opened_by) WHERE (status = ANY (ARRAY['Open'::text, 'Reconciling'::text]));


--
-- Name: INDEX uq_cash_shift_open_per_employee; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.uq_cash_shift_open_per_employee IS 'Cites: CD-03, BI-39. At most one open shift per employee per store.';


--
-- Name: uq_cash_transaction_change_once; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_cash_transaction_change_once ON public.cash_transaction USING btree (sale_id) WHERE (type = 'ChangeDisbursed'::text);


--
-- Name: INDEX uq_cash_transaction_change_once; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.uq_cash_transaction_change_once IS 'Cites: CD-18, BI-28. A sale disburses its change once.';


--
-- Name: uq_customer_one_walk_in; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_customer_one_walk_in ON public.customer USING btree (organization_id) WHERE is_walk_in;


--
-- Name: INDEX uq_customer_one_walk_in; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.uq_customer_one_walk_in IS 'Cites: CU-01. One shared walk-in record per organization.';


--
-- Name: uq_inventory_movement_adjustment_line_once; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_inventory_movement_adjustment_line_once ON public.inventory_movement USING btree (stock_adjustment_line_id) WHERE (movement_type <> 'REVERSAL'::text);


--
-- Name: INDEX uq_inventory_movement_adjustment_line_once; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.uq_inventory_movement_adjustment_line_once IS 'Cites: BI-28, RT-486. An adjustment line is applied at most once; posting cannot be repeated.';


--
-- Name: uq_inventory_movement_sale_line_once; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_inventory_movement_sale_line_once ON public.inventory_movement USING btree (sale_line_id) WHERE (movement_type <> 'REVERSAL'::text);


--
-- Name: INDEX uq_inventory_movement_sale_line_once; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.uq_inventory_movement_sale_line_once IS 'Cites: BI-28, RT-121. A sale line moves its stock at most once.';


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
-- Name: cash_shift tg_cash_shift_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_cash_shift_before_write BEFORE INSERT OR UPDATE ON public.cash_shift FOR EACH ROW EXECUTE FUNCTION public.cash_shift_before_write();


--
-- Name: TRIGGER tg_cash_shift_before_write ON cash_shift; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_cash_shift_before_write ON public.cash_shift IS 'Cites: CD-10, SM-03. Opening check and transition stamps.';


--
-- Name: cash_shift tg_cash_shift_close_ready; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_cash_shift_close_ready BEFORE UPDATE OF status ON public.cash_shift FOR EACH ROW EXECUTE FUNCTION public.assert_shift_close_ready();


--
-- Name: TRIGGER tg_cash_shift_close_ready ON cash_shift; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_cash_shift_close_ready ON public.cash_shift IS 'Cites: CD-25. A non-zero variance blocks the close until acknowledged.';


--
-- Name: cash_shift tg_cash_shift_opening_float; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER tg_cash_shift_opening_float AFTER INSERT ON public.cash_shift DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_shift_opening_float();


--
-- Name: TRIGGER tg_cash_shift_opening_float ON cash_shift; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_cash_shift_opening_float ON public.cash_shift IS 'Cites: CD-11. The shift and its opening float are created together.';


--
-- Name: cash_shift tg_cash_shift_state_machine; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_cash_shift_state_machine BEFORE INSERT OR UPDATE OF status ON public.cash_shift FOR EACH ROW EXECUTE FUNCTION public.enforce_state_transition('Shift', 'status');


--
-- Name: TRIGGER tg_cash_shift_state_machine ON cash_shift; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_cash_shift_state_machine ON public.cash_shift IS 'Cites: SM-55, SM-56, SM-02. A shift is created Open and moves only along the edges of state-machines s22.11.';


--
-- Name: cash_transaction tg_cash_transaction_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_cash_transaction_immutable BEFORE DELETE OR UPDATE ON public.cash_transaction FOR EACH ROW EXECUTE FUNCTION public.forbid_ledger_rewrite();


--
-- Name: TRIGGER tg_cash_transaction_immutable ON cash_transaction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_cash_transaction_immutable ON public.cash_transaction IS 'Cites: CD-19, BI-08. A cash movement is never updated or deleted, whatever the role.';


--
-- Name: cash_transaction tg_cash_transaction_no_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_cash_transaction_no_truncate BEFORE TRUNCATE ON public.cash_transaction FOR EACH STATEMENT EXECUTE FUNCTION public.forbid_ledger_rewrite();


--
-- Name: TRIGGER tg_cash_transaction_no_truncate ON cash_transaction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_cash_transaction_no_truncate ON public.cash_transaction IS 'Cites: CD-19, AU-32. The drawer ledger cannot be emptied in bulk.';


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
-- Name: checkout tg_checkout_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_checkout_before_write BEFORE INSERT OR UPDATE ON public.checkout FOR EACH ROW EXECUTE FUNCTION public.checkout_before_write();


--
-- Name: TRIGGER tg_checkout_before_write ON checkout; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_checkout_before_write ON public.checkout IS 'Cites: PT-03, BI-39. Checkout start conditions and one-way closing.';


--
-- Name: checkout tg_checkout_outcome; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER tg_checkout_outcome AFTER UPDATE OF status ON public.checkout DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_checkout_outcome();


--
-- Name: TRIGGER tg_checkout_outcome ON checkout; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_checkout_outcome ON public.checkout IS 'Cites: SP-01. Checked at commit.';


--
-- Name: document_number_sequence tg_document_number_sequence_forward; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_document_number_sequence_forward BEFORE UPDATE ON public.document_number_sequence FOR EACH ROW EXECUTE FUNCTION public.forbid_document_number_decrease();


--
-- Name: TRIGGER tg_document_number_sequence_forward ON document_number_sequence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_document_number_sequence_forward ON public.document_number_sequence IS 'Cites: BI-42. Document-number counters only move forward.';


--
-- Name: inventory_movement tg_inventory_movement_adjustment_state; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_inventory_movement_adjustment_state BEFORE INSERT ON public.inventory_movement FOR EACH ROW EXECUTE FUNCTION public.assert_movement_adjustment_state();


--
-- Name: TRIGGER tg_inventory_movement_adjustment_state ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_inventory_movement_adjustment_state ON public.inventory_movement IS 'Cites: BI-27, RT-486. Only a posted adjustment moves stock.';


--
-- Name: inventory_movement tg_inventory_movement_apply; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_inventory_movement_apply BEFORE INSERT ON public.inventory_movement FOR EACH ROW EXECUTE FUNCTION public.apply_inventory_movement();


--
-- Name: TRIGGER tg_inventory_movement_apply ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_inventory_movement_apply ON public.inventory_movement IS 'Cites: BI-02, IV-08, RT-061. A movement and its balance update are one statement: both happen or neither does.';


--
-- Name: inventory_movement tg_inventory_movement_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_inventory_movement_immutable BEFORE DELETE OR UPDATE ON public.inventory_movement FOR EACH ROW EXECUTE FUNCTION public.forbid_ledger_rewrite();


--
-- Name: TRIGGER tg_inventory_movement_immutable ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_inventory_movement_immutable ON public.inventory_movement IS 'Cites: BI-15, RT-059. A movement is never updated or deleted, at every privilege.';


--
-- Name: inventory_movement tg_inventory_movement_no_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_inventory_movement_no_truncate BEFORE TRUNCATE ON public.inventory_movement FOR EACH STATEMENT EXECUTE FUNCTION public.forbid_ledger_rewrite();


--
-- Name: TRIGGER tg_inventory_movement_no_truncate ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_inventory_movement_no_truncate ON public.inventory_movement IS 'Cites: BI-15, RT-059, AU-32. The ledger cannot be emptied in bulk.';


--
-- Name: inventory_movement tg_inventory_movement_sale_state; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_inventory_movement_sale_state BEFORE INSERT ON public.inventory_movement FOR EACH ROW EXECUTE FUNCTION public.assert_movement_sale_state();


--
-- Name: TRIGGER tg_inventory_movement_sale_state ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_inventory_movement_sale_state ON public.inventory_movement IS 'Cites: IV-15, SM-11. Fires after the apply trigger, by name order.';


--
-- Name: inventory_transaction tg_inventory_transaction_business_date; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_inventory_transaction_business_date BEFORE INSERT ON public.inventory_transaction FOR EACH ROW EXECUTE FUNCTION public.inventory_transaction_business_date();


--
-- Name: TRIGGER tg_inventory_transaction_business_date ON inventory_transaction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_inventory_transaction_business_date ON public.inventory_transaction IS 'Cites: RT-234, RT-353. Stamps the business date from the server clock.';


--
-- Name: inventory_transaction tg_inventory_transaction_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_inventory_transaction_immutable BEFORE DELETE OR UPDATE ON public.inventory_transaction FOR EACH ROW EXECUTE FUNCTION public.forbid_ledger_rewrite();


--
-- Name: TRIGGER tg_inventory_transaction_immutable ON inventory_transaction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_inventory_transaction_immutable ON public.inventory_transaction IS 'Cites: IV-05, BI-15, RT-059. The event a movement belongs to is part of the ledger and is never rewritten.';


--
-- Name: inventory_transaction tg_inventory_transaction_no_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_inventory_transaction_no_truncate BEFORE TRUNCATE ON public.inventory_transaction FOR EACH STATEMENT EXECUTE FUNCTION public.forbid_ledger_rewrite();


--
-- Name: TRIGGER tg_inventory_transaction_no_truncate ON inventory_transaction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_inventory_transaction_no_truncate ON public.inventory_transaction IS 'Cites: IV-05, AU-32. The ledger''s events cannot be emptied in bulk.';


--
-- Name: organization tg_organization_deactivation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_organization_deactivation BEFORE UPDATE ON public.organization FOR EACH ROW EXECUTE FUNCTION public.record_deactivation();


--
-- Name: TRIGGER tg_organization_deactivation ON organization; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_organization_deactivation ON public.organization IS 'Cites: RT-506, BI-40. Records an organization''s deactivation once, with server time.';


--
-- Name: organization tg_organization_money_settings; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_organization_money_settings BEFORE UPDATE OF currency_code, time_zone ON public.organization FOR EACH ROW EXECUTE FUNCTION public.freeze_organization_money_settings();


--
-- Name: TRIGGER tg_organization_money_settings ON organization; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_organization_money_settings ON public.organization IS 'Cites: ORG-01, ORG-02. Closes the domain 1 pending guard.';


--
-- Name: payment tg_payment_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_payment_before_write BEFORE INSERT OR UPDATE ON public.payment FOR EACH ROW EXECUTE FUNCTION public.payment_before_write();


--
-- Name: TRIGGER tg_payment_before_write ON payment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_payment_before_write ON public.payment IS 'Cites: PY-12, PY-54, D-14. Terminal payments are frozen.';


--
-- Name: payment tg_payment_state_machine; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_payment_state_machine BEFORE INSERT OR UPDATE OF status ON public.payment FOR EACH ROW EXECUTE FUNCTION public.enforce_state_transition('Payment', 'status');


--
-- Name: TRIGGER tg_payment_state_machine ON payment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_payment_state_machine ON public.payment IS 'Cites: PY-12, PY-13, PY-54, SM-51. A payment is created Pending and moves only along the edges of state-machines s22.10.';


--
-- Name: pos_terminal tg_pos_terminal_location; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_pos_terminal_location BEFORE INSERT OR UPDATE OF sell_from_location_id ON public.pos_terminal FOR EACH ROW EXECUTE FUNCTION public.assert_terminal_sells_from_own_location();


--
-- Name: TRIGGER tg_pos_terminal_location ON pos_terminal; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_pos_terminal_location ON public.pos_terminal IS 'Cites: WH-01, RT-004. Checks the till''s sell-from location.';


--
-- Name: pos_terminal tg_pos_terminal_state_machine; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_pos_terminal_state_machine BEFORE INSERT OR UPDATE OF status ON public.pos_terminal FOR EACH ROW EXECUTE FUNCTION public.enforce_state_transition('Device', 'status');


--
-- Name: TRIGGER tg_pos_terminal_state_machine ON pos_terminal; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_pos_terminal_state_machine ON public.pos_terminal IS 'Cites: SM-60, HD-08, SM-02. A terminal is registered, activated, disabled and retired only along the Device edges of state-machines s22.12.';


--
-- Name: pos_terminal tg_pos_terminal_status_stamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_pos_terminal_status_stamp BEFORE UPDATE OF status ON public.pos_terminal FOR EACH ROW EXECUTE FUNCTION public.stamp_status_change();


--
-- Name: TRIGGER tg_pos_terminal_status_stamp ON pos_terminal; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_pos_terminal_status_stamp ON public.pos_terminal IS 'Cites: SM-03. Server time for each terminal status change.';


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
-- Name: product_variant tg_product_variant_name; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_product_variant_name BEFORE UPDATE OF name ON public.product_variant FOR EACH ROW EXECUTE FUNCTION public.freeze_referenced_variant_name();


--
-- Name: TRIGGER tg_product_variant_name ON product_variant; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_product_variant_name ON public.product_variant IS 'Cites: PR-03. Closes the domain 2 pending guard.';


--
-- Name: product_variant tg_product_variant_usable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER tg_product_variant_usable AFTER INSERT ON public.product_variant DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_new_variant_usable();


--
-- Name: TRIGGER tg_product_variant_usable ON product_variant; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_product_variant_usable ON public.product_variant IS 'Cites: RT-042, SM-13. Checked at commit, so a variant and its first price are created together.';


--
-- Name: reason_code tg_reason_code_archival; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_reason_code_archival BEFORE UPDATE ON public.reason_code FOR EACH ROW EXECUTE FUNCTION public.record_archival();


--
-- Name: TRIGGER tg_reason_code_archival ON reason_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_reason_code_archival ON public.reason_code IS 'Cites: BI-40. Records a reason code''s archival once, with server time; an archived code takes no new documents.';


--
-- Name: sale tg_sale_before_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_sale_before_insert BEFORE INSERT ON public.sale FOR EACH ROW EXECUTE FUNCTION public.sale_before_insert();


--
-- Name: TRIGGER tg_sale_before_insert ON sale; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_sale_before_insert ON public.sale IS 'Cites: SP-02, RT-118. Completion checks and server-assigned fields.';


--
-- Name: sale tg_sale_complete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER tg_sale_complete AFTER INSERT ON public.sale DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_sale_complete();


--
-- Name: TRIGGER tg_sale_complete ON sale; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_sale_complete ON public.sale IS 'Cites: SP-02, RT-119. The completion transaction is checked whole, at commit.';


--
-- Name: sale_line tg_sale_line_before_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_sale_line_before_insert BEFORE INSERT ON public.sale_line FOR EACH ROW EXECUTE FUNCTION public.sale_line_before_insert();


--
-- Name: TRIGGER tg_sale_line_before_insert ON sale_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_sale_line_before_insert ON public.sale_line IS 'Cites: BI-30, RT-040. A client-supplied price, cost or rate is checked against the server''s own records; a client price is never taken on trust.';


--
-- Name: sale tg_sale_state_machine; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_sale_state_machine BEFORE INSERT OR UPDATE OF status ON public.sale FOR EACH ROW EXECUTE FUNCTION public.enforce_state_transition('Sale', 'status');


--
-- Name: TRIGGER tg_sale_state_machine ON sale; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_sale_state_machine ON public.sale IS 'Cites: SP-01, SM-33, RT-118. A sale is created Completed, and only Completed.';


--
-- Name: shift_count tg_shift_count_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_shift_count_before_write BEFORE INSERT OR UPDATE ON public.shift_count FOR EACH ROW EXECUTE FUNCTION public.shift_count_before_write();


--
-- Name: TRIGGER tg_shift_count_before_write ON shift_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_shift_count_before_write ON public.shift_count IS 'Cites: CD-21, CD-22. Server-computed expected amount and pass number.';


--
-- Name: stock_adjustment tg_stock_adjustment_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_stock_adjustment_before_write BEFORE INSERT OR UPDATE ON public.stock_adjustment FOR EACH ROW EXECUTE FUNCTION public.stock_adjustment_before_write();


--
-- Name: TRIGGER tg_stock_adjustment_before_write ON stock_adjustment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_stock_adjustment_before_write ON public.stock_adjustment IS 'Cites: BI-42, SM-03. Numbering, reason check and transition stamps for stock adjustments.';


--
-- Name: stock_adjustment_line tg_stock_adjustment_line_draft_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_stock_adjustment_line_draft_only BEFORE INSERT OR DELETE OR UPDATE ON public.stock_adjustment_line FOR EACH ROW EXECUTE FUNCTION public.stock_adjustment_line_draft_only();


--
-- Name: TRIGGER tg_stock_adjustment_line_draft_only ON stock_adjustment_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_stock_adjustment_line_draft_only ON public.stock_adjustment_line IS 'Cites: IV-32, BI-08. Freezes an adjustment''s lines once it leaves Draft.';


--
-- Name: stock_adjustment tg_stock_adjustment_posting; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER tg_stock_adjustment_posting AFTER UPDATE OF status ON public.stock_adjustment DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_adjustment_posting_complete();


--
-- Name: TRIGGER tg_stock_adjustment_posting ON stock_adjustment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_stock_adjustment_posting ON public.stock_adjustment IS 'Cites: RT-486, BI-04. Posting and reversal are all or nothing, checked at commit.';


--
-- Name: stock_adjustment tg_stock_adjustment_state_machine; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_stock_adjustment_state_machine BEFORE INSERT OR UPDATE OF status ON public.stock_adjustment FOR EACH ROW EXECUTE FUNCTION public.enforce_state_transition('StockAdjustment', 'status');


--
-- Name: TRIGGER tg_stock_adjustment_state_machine ON stock_adjustment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_stock_adjustment_state_machine ON public.stock_adjustment IS 'Cites: IV-32, SM-02, RT-486. An adjustment is created Draft and moves only along the edges of state-machines s22.17.';


--
-- Name: store tg_store_deactivation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_store_deactivation BEFORE UPDATE ON public.store FOR EACH ROW EXECUTE FUNCTION public.record_deactivation();


--
-- Name: TRIGGER tg_store_deactivation ON store; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_store_deactivation ON public.store IS 'Cites: RT-508, ORG-05. Records a store''s deactivation once, with server time.';


--
-- Name: store tg_store_deactivation_open_shift; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_store_deactivation_open_shift BEFORE UPDATE OF deactivated_by ON public.store FOR EACH ROW EXECUTE FUNCTION public.forbid_store_deactivation_with_open_shift();


--
-- Name: TRIGGER tg_store_deactivation_open_shift ON store; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_store_deactivation_open_shift ON public.store IS 'Cites: ORG-05, EC-89. Closes the domain 1 pending guard for shifts.';


--
-- Name: store tg_store_deactivation_stock; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_store_deactivation_stock BEFORE UPDATE OF deactivated_by ON public.store FOR EACH ROW EXECUTE FUNCTION public.forbid_store_deactivation_with_stock();


--
-- Name: TRIGGER tg_store_deactivation_stock ON store; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_store_deactivation_stock ON public.store IS 'Cites: ORG-05, RT-445. Closes the domain 1 pending guard for stock.';


--
-- Name: store_payment_method tg_store_payment_method_stamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_store_payment_method_stamp BEFORE UPDATE ON public.store_payment_method FOR EACH ROW EXECUTE FUNCTION public.stamp_changed_at();


--
-- Name: TRIGGER tg_store_payment_method_stamp ON store_payment_method; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_store_payment_method_stamp ON public.store_payment_method IS 'Cites: PY-05. Server time for each enablement change.';


--
-- Name: store_setting_version tg_store_setting_version_tax_mode; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_store_setting_version_tax_mode BEFORE INSERT ON public.store_setting_version FOR EACH ROW EXECUTE FUNCTION public.freeze_tax_mode_after_sale();


--
-- Name: TRIGGER tg_store_setting_version_tax_mode ON store_setting_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_store_setting_version_tax_mode ON public.store_setting_version IS 'Cites: SP-33, PR-38. Closes the domain 1 pending guard.';


--
-- Name: unit tg_unit_quantity_kind; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_unit_quantity_kind BEFORE UPDATE OF quantity_kind ON public.unit FOR EACH ROW EXECUTE FUNCTION public.freeze_used_quantity_kind();


--
-- Name: TRIGGER tg_unit_quantity_kind ON unit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_unit_quantity_kind ON public.unit IS 'Cites: PR-14, RT-491. Closes the domain 2 pending guard.';


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
-- Name: cash_drawer fk_cash_drawer_currency; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_drawer
    ADD CONSTRAINT fk_cash_drawer_currency FOREIGN KEY (store_id, currency_code) REFERENCES public.store(id, currency_code);


--
-- Name: CONSTRAINT fk_cash_drawer_currency ON cash_drawer; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_cash_drawer_currency ON public.cash_drawer IS 'Cites: CD-36, BI-01. A drawer holds one currency, the store''s.';


--
-- Name: cash_drawer fk_cash_drawer_terminal; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_drawer
    ADD CONSTRAINT fk_cash_drawer_terminal FOREIGN KEY (pos_terminal_id, store_id) REFERENCES public.pos_terminal(id, store_id);


--
-- Name: CONSTRAINT fk_cash_drawer_terminal ON cash_drawer; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_cash_drawer_terminal ON public.cash_drawer IS 'Cites: CD-01, RT-005. A drawer belongs to one terminal of its store.';


--
-- Name: cash_shift fk_cash_shift_drawer; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_shift
    ADD CONSTRAINT fk_cash_shift_drawer FOREIGN KEY (cash_drawer_id, pos_terminal_id, store_id) REFERENCES public.cash_drawer(id, pos_terminal_id, store_id);


--
-- Name: CONSTRAINT fk_cash_shift_drawer ON cash_shift; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_cash_shift_drawer ON public.cash_shift IS 'Cites: CD-05, RT-005, RT-122. A cash shift needs a drawer, and the drawer belongs to the shift''s terminal and store. A terminal without a drawer has no cash shift.';


--
-- Name: cash_transaction fk_cash_transaction_currency; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_transaction
    ADD CONSTRAINT fk_cash_transaction_currency FOREIGN KEY (store_id, currency_code) REFERENCES public.store(id, currency_code);


--
-- Name: CONSTRAINT fk_cash_transaction_currency ON cash_transaction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_cash_transaction_currency ON public.cash_transaction IS 'Cites: CD-36, BI-01. Cash is in the store''s currency, as integer minor units.';


--
-- Name: cash_transaction fk_cash_transaction_sale; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_transaction
    ADD CONSTRAINT fk_cash_transaction_sale FOREIGN KEY (sale_id, cash_shift_id) REFERENCES public.sale(id, cash_shift_id);


--
-- Name: CONSTRAINT fk_cash_transaction_sale ON cash_transaction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_cash_transaction_sale ON public.cash_transaction IS 'Cites: CD-18, RT-135. Change given belongs to one sale in the same shift.';


--
-- Name: cash_transaction fk_cash_transaction_shift; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_transaction
    ADD CONSTRAINT fk_cash_transaction_shift FOREIGN KEY (cash_shift_id, cash_drawer_id, store_id) REFERENCES public.cash_shift(id, cash_drawer_id, store_id);


--
-- Name: CONSTRAINT fk_cash_transaction_shift ON cash_transaction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_cash_transaction_shift ON public.cash_transaction IS 'Cites: CD-19, PY-46. A cash movement belongs to one shift, and its drawer and store are the shift''s.';


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
-- Name: checkout fk_checkout_currency; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkout
    ADD CONSTRAINT fk_checkout_currency FOREIGN KEY (store_id, currency_code) REFERENCES public.store(id, currency_code);


--
-- Name: CONSTRAINT fk_checkout_currency ON checkout; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_checkout_currency ON public.checkout IS 'Cites: PY-52, BI-01. A checkout settles in the store''s single currency.';


--
-- Name: checkout fk_checkout_shift; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkout
    ADD CONSTRAINT fk_checkout_shift FOREIGN KEY (cash_shift_id, cash_drawer_id, pos_terminal_id, store_id) REFERENCES public.cash_shift(id, cash_drawer_id, pos_terminal_id, store_id);


--
-- Name: CONSTRAINT fk_checkout_shift ON checkout; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_checkout_shift ON public.checkout IS 'Cites: PY-46, RT-122, BI-39. A checkout happens in one open shift, whose drawer, terminal and store it shares.';


--
-- Name: customer fk_customer_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer
    ADD CONSTRAINT fk_customer_organization FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: CONSTRAINT fk_customer_organization ON customer; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_customer_organization ON public.customer IS 'Cites: CU-01, CU-06. Customers are organization-global (organization-model s8.1).';


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
-- Name: inventory_movement fk_inventory_movement_adjustment_line; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movement
    ADD CONSTRAINT fk_inventory_movement_adjustment_line FOREIGN KEY (stock_adjustment_line_id, stock_adjustment_id, variant_id, storage_location_id) REFERENCES public.stock_adjustment_line(id, stock_adjustment_id, variant_id, storage_location_id);


--
-- Name: CONSTRAINT fk_inventory_movement_adjustment_line ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_inventory_movement_adjustment_line ON public.inventory_movement IS 'Cites: BI-03, RT-060, IV-14. The causing adjustment line, with its variant and location proven to match.';


--
-- Name: inventory_movement fk_inventory_movement_adjustment_store; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movement
    ADD CONSTRAINT fk_inventory_movement_adjustment_store FOREIGN KEY (stock_adjustment_id, store_id) REFERENCES public.stock_adjustment(id, store_id);


--
-- Name: CONSTRAINT fk_inventory_movement_adjustment_store ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_inventory_movement_adjustment_store ON public.inventory_movement IS 'Cites: MS-16, BI-14. An adjustment''s movements are attributed to the adjustment''s store.';


--
-- Name: inventory_movement fk_inventory_movement_location; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movement
    ADD CONSTRAINT fk_inventory_movement_location FOREIGN KEY (storage_location_id, organization_id) REFERENCES public.storage_location(id, organization_id);


--
-- Name: CONSTRAINT fk_inventory_movement_location ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_inventory_movement_location ON public.inventory_movement IS 'Cites: IV-01, MS-17. Stock moves at a location.';


--
-- Name: inventory_movement fk_inventory_movement_reverses; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movement
    ADD CONSTRAINT fk_inventory_movement_reverses FOREIGN KEY (reverses_movement_id) REFERENCES public.inventory_movement(id);


--
-- Name: CONSTRAINT fk_inventory_movement_reverses ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_inventory_movement_reverses ON public.inventory_movement IS 'Cites: IV-12, RT-062. A reversal references the movement it compensates.';


--
-- Name: inventory_movement fk_inventory_movement_reverses_same_adjustment_line; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movement
    ADD CONSTRAINT fk_inventory_movement_reverses_same_adjustment_line FOREIGN KEY (reverses_movement_id, stock_adjustment_line_id) REFERENCES public.inventory_movement(id, stock_adjustment_line_id);


--
-- Name: CONSTRAINT fk_inventory_movement_reverses_same_adjustment_line ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_inventory_movement_reverses_same_adjustment_line ON public.inventory_movement IS 'Cites: BI-03, IV-12. A reversal names the same adjustment line as what it reverses.';


--
-- Name: inventory_movement fk_inventory_movement_reverses_same_sale_line; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movement
    ADD CONSTRAINT fk_inventory_movement_reverses_same_sale_line FOREIGN KEY (reverses_movement_id, sale_line_id) REFERENCES public.inventory_movement(id, sale_line_id);


--
-- Name: CONSTRAINT fk_inventory_movement_reverses_same_sale_line ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_inventory_movement_reverses_same_sale_line ON public.inventory_movement IS 'Cites: BI-03, IV-12, SP-53. A reversal of a sale movement names the same sale line.';


--
-- Name: inventory_movement fk_inventory_movement_sale_line; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movement
    ADD CONSTRAINT fk_inventory_movement_sale_line FOREIGN KEY (sale_line_id, sale_id, variant_id, storage_location_id) REFERENCES public.sale_line(id, sale_id, variant_id, storage_location_id);


--
-- Name: CONSTRAINT fk_inventory_movement_sale_line ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_inventory_movement_sale_line ON public.inventory_movement IS 'Cites: BI-03, RT-060, IV-15. The causing sale line, with its variant and location proven to match.';


--
-- Name: inventory_movement fk_inventory_movement_sale_store; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movement
    ADD CONSTRAINT fk_inventory_movement_sale_store FOREIGN KEY (sale_id, store_id) REFERENCES public.sale(id, store_id);


--
-- Name: CONSTRAINT fk_inventory_movement_sale_store ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_inventory_movement_sale_store ON public.inventory_movement IS 'Cites: MS-16, BI-14. A sale''s movements are attributed to the sale''s store.';


--
-- Name: inventory_movement fk_inventory_movement_store; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movement
    ADD CONSTRAINT fk_inventory_movement_store FOREIGN KEY (store_id, organization_id) REFERENCES public.store(id, organization_id);


--
-- Name: CONSTRAINT fk_inventory_movement_store ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_inventory_movement_store ON public.inventory_movement IS 'Cites: MS-16, RT-001. Every movement is attributed to a store of its organization: the store is the reason it happened.';


--
-- Name: inventory_movement fk_inventory_movement_transaction; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movement
    ADD CONSTRAINT fk_inventory_movement_transaction FOREIGN KEY (inventory_transaction_id, store_id) REFERENCES public.inventory_transaction(id, store_id);


--
-- Name: CONSTRAINT fk_inventory_movement_transaction ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_inventory_movement_transaction ON public.inventory_movement IS 'Cites: BI-03, IV-05, RT-060. Every movement belongs to exactly one inventory transaction, attributed to the same store.';


--
-- Name: inventory_movement fk_inventory_movement_type; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movement
    ADD CONSTRAINT fk_inventory_movement_type FOREIGN KEY (movement_type, direction) REFERENCES public.inventory_movement_type(code, direction);


--
-- Name: CONSTRAINT fk_inventory_movement_type ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_inventory_movement_type ON public.inventory_movement IS 'Cites: RT-058, IV-11, IV-12, IV-13. The type is from the closed enumeration, in a direction that type allows.';


--
-- Name: inventory_movement fk_inventory_movement_variant; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movement
    ADD CONSTRAINT fk_inventory_movement_variant FOREIGN KEY (variant_id, organization_id) REFERENCES public.product_variant(id, organization_id);


--
-- Name: CONSTRAINT fk_inventory_movement_variant ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_inventory_movement_variant ON public.inventory_movement IS 'Cites: PR-01, RT-021. Only a variant moves.';


--
-- Name: inventory_transaction fk_inventory_transaction_store; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transaction
    ADD CONSTRAINT fk_inventory_transaction_store FOREIGN KEY (store_id) REFERENCES public.store(id);


--
-- Name: CONSTRAINT fk_inventory_transaction_store ON inventory_transaction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_inventory_transaction_store ON public.inventory_transaction IS 'Cites: MS-16, RT-001. The store the event is attributed to: the store is the reason stock moved.';


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
-- Name: payment fk_payment_checkout; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment
    ADD CONSTRAINT fk_payment_checkout FOREIGN KEY (checkout_id, store_id) REFERENCES public.checkout(id, store_id);


--
-- Name: CONSTRAINT fk_payment_checkout ON payment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_payment_checkout ON public.payment IS 'Cites: PY-46, PY-54, RT-122. An attempt belongs to one checkout, so to its terminal, drawer, shift and store.';


--
-- Name: payment fk_payment_currency; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment
    ADD CONSTRAINT fk_payment_currency FOREIGN KEY (store_id, currency_code) REFERENCES public.store(id, currency_code);


--
-- Name: CONSTRAINT fk_payment_currency ON payment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_payment_currency ON public.payment IS 'Cites: PY-52, BI-01. A payment is in the store''s currency, as integer minor units.';


--
-- Name: payment fk_payment_method; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment
    ADD CONSTRAINT fk_payment_method FOREIGN KEY (payment_method_id, organization_id) REFERENCES public.payment_method(id, organization_id);


--
-- Name: CONSTRAINT fk_payment_method ON payment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_payment_method ON public.payment IS 'Cites: PY-03, PY-04. A payment uses a method of its own organization.';


--
-- Name: payment_method fk_payment_method_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_method
    ADD CONSTRAINT fk_payment_method_organization FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: CONSTRAINT fk_payment_method_organization ON payment_method; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_payment_method_organization ON public.payment_method IS 'Cites: PY-03. Methods are configured per organization.';


--
-- Name: payment fk_payment_method_type; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment
    ADD CONSTRAINT fk_payment_method_type FOREIGN KEY (payment_method_id, method_type) REFERENCES public.payment_method(id, method_type);


--
-- Name: CONSTRAINT fk_payment_method_type ON payment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_payment_method_type ON public.payment IS 'Cites: PY-03, CD-09. The payment carries its method''s type, proven by foreign key, so cash is recognisable without a join.';


--
-- Name: payment fk_payment_store; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment
    ADD CONSTRAINT fk_payment_store FOREIGN KEY (store_id, organization_id) REFERENCES public.store(id, organization_id);


--
-- Name: CONSTRAINT fk_payment_store ON payment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_payment_store ON public.payment IS 'Cites: RT-001, BI-14. A payment is in its store''s organization.';


--
-- Name: pos_terminal fk_pos_terminal_location; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_terminal
    ADD CONSTRAINT fk_pos_terminal_location FOREIGN KEY (sell_from_location_id, organization_id) REFERENCES public.storage_location(id, organization_id);


--
-- Name: CONSTRAINT fk_pos_terminal_location ON pos_terminal; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_pos_terminal_location ON public.pos_terminal IS 'Cites: WH-01, RT-004. The sellable location this till sells from, in its own organization (which location a till sells from: OQ-019).';


--
-- Name: pos_terminal fk_pos_terminal_store; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_terminal
    ADD CONSTRAINT fk_pos_terminal_store FOREIGN KEY (store_id, organization_id) REFERENCES public.store(id, organization_id);


--
-- Name: CONSTRAINT fk_pos_terminal_store ON pos_terminal; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_pos_terminal_store ON public.pos_terminal IS 'Cites: PT-02, RT-001. A terminal belongs to one store, always; the application cannot move it.';


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
-- Name: reason_code fk_reason_code_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reason_code
    ADD CONSTRAINT fk_reason_code_organization FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: CONSTRAINT fk_reason_code_organization ON reason_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_reason_code_organization ON public.reason_code IS 'Cites: BI-25. Reason codes are per organization.';


--
-- Name: sale fk_sale_checkout; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale
    ADD CONSTRAINT fk_sale_checkout FOREIGN KEY (checkout_id, cash_shift_id, cash_drawer_id, pos_terminal_id, store_id, client_operation_id) REFERENCES public.checkout(id, cash_shift_id, cash_drawer_id, pos_terminal_id, store_id, client_operation_id);


--
-- Name: CONSTRAINT fk_sale_checkout ON sale; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_sale_checkout ON public.sale IS 'Cites: RT-122, RT-123, PT-01, BI-39. A sale is its checkout completed: the same shift, drawer, terminal, store and client operation id.';


--
-- Name: sale fk_sale_currency; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale
    ADD CONSTRAINT fk_sale_currency FOREIGN KEY (store_id, currency_code) REFERENCES public.store(id, currency_code);


--
-- Name: CONSTRAINT fk_sale_currency ON sale; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_sale_currency ON public.sale IS 'Cites: BI-01, PY-52. A sale is in the store''s currency, as integer minor units.';


--
-- Name: sale fk_sale_customer; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale
    ADD CONSTRAINT fk_sale_customer FOREIGN KEY (customer_id, organization_id) REFERENCES public.customer(id, organization_id);


--
-- Name: CONSTRAINT fk_sale_customer ON sale; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_sale_customer ON public.sale IS 'Cites: CU-01. Never null: a walk-in is a customer record of the same organization.';


--
-- Name: sale_line fk_sale_line_location; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_line
    ADD CONSTRAINT fk_sale_line_location FOREIGN KEY (storage_location_id, organization_id) REFERENCES public.storage_location(id, organization_id);


--
-- Name: CONSTRAINT fk_sale_line_location ON sale_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_sale_line_location ON public.sale_line IS 'Cites: WH-01, IV-01. The location the stock is sold from.';


--
-- Name: sale_line fk_sale_line_sale; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_line
    ADD CONSTRAINT fk_sale_line_sale FOREIGN KEY (sale_id, store_id) REFERENCES public.sale(id, store_id);


--
-- Name: CONSTRAINT fk_sale_line_sale ON sale_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_sale_line_sale ON public.sale_line IS 'Cites: RT-001, SP-02. A line belongs to one sale and carries its store.';


--
-- Name: sale_line fk_sale_line_tax_rate; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_line
    ADD CONSTRAINT fk_sale_line_tax_rate FOREIGN KEY (tax_rate_id, organization_id) REFERENCES public.tax_rate(id, organization_id);


--
-- Name: CONSTRAINT fk_sale_line_tax_rate ON sale_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_sale_line_tax_rate ON public.sale_line IS 'Cites: BI-18, RT-130. The tax rate version the line was taxed at; rate versions are immutable, so this is the snapshot.';


--
-- Name: sale_line fk_sale_line_variant; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_line
    ADD CONSTRAINT fk_sale_line_variant FOREIGN KEY (variant_id, organization_id) REFERENCES public.product_variant(id, organization_id);


--
-- Name: CONSTRAINT fk_sale_line_variant ON sale_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_sale_line_variant ON public.sale_line IS 'Cites: PR-01, RT-021. Only a variant is sold, never a product.';


--
-- Name: sale fk_sale_settings; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale
    ADD CONSTRAINT fk_sale_settings FOREIGN KEY (store_setting_version_id, store_id) REFERENCES public.store_setting_version(id, store_id);


--
-- Name: CONSTRAINT fk_sale_settings ON sale; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_sale_settings ON public.sale IS 'Cites: REQ-AU-06, SP-33. The store settings version the totals were computed under; versions are immutable, so the reference is the snapshot.';


--
-- Name: sale fk_sale_store; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale
    ADD CONSTRAINT fk_sale_store FOREIGN KEY (store_id, organization_id) REFERENCES public.store(id, organization_id);


--
-- Name: CONSTRAINT fk_sale_store ON sale; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_sale_store ON public.sale IS 'Cites: RT-001, ORG-04, RT-507. A sale belongs to a store; there is no sale without one.';


--
-- Name: shift_count fk_shift_count_reason; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_count
    ADD CONSTRAINT fk_shift_count_reason FOREIGN KEY (reason_code_id, organization_id) REFERENCES public.reason_code(id, organization_id);


--
-- Name: CONSTRAINT fk_shift_count_reason ON shift_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_shift_count_reason ON public.shift_count IS 'Cites: CD-23, BI-25. An acknowledged variance carries a reason code of the organization.';


--
-- Name: shift_count fk_shift_count_shift; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_count
    ADD CONSTRAINT fk_shift_count_shift FOREIGN KEY (cash_shift_id, store_id) REFERENCES public.cash_shift(id, store_id);


--
-- Name: CONSTRAINT fk_shift_count_shift ON shift_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_shift_count_shift ON public.shift_count IS 'Cites: CD-20. A count counts one shift of its store.';


--
-- Name: shift_count fk_shift_count_store; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_count
    ADD CONSTRAINT fk_shift_count_store FOREIGN KEY (store_id, organization_id) REFERENCES public.store(id, organization_id);


--
-- Name: CONSTRAINT fk_shift_count_store ON shift_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_shift_count_store ON public.shift_count IS 'Cites: RT-001. A count is in its store''s organization.';


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
-- Name: stock_adjustment_line fk_stock_adjustment_line_document; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_adjustment_line
    ADD CONSTRAINT fk_stock_adjustment_line_document FOREIGN KEY (stock_adjustment_id, adjustment_kind) REFERENCES public.stock_adjustment(id, kind);


--
-- Name: CONSTRAINT fk_stock_adjustment_line_document ON stock_adjustment_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_stock_adjustment_line_document ON public.stock_adjustment_line IS 'Cites: IV-32. A line belongs to one adjustment, and knows its kind.';


--
-- Name: stock_adjustment_line fk_stock_adjustment_line_location; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_adjustment_line
    ADD CONSTRAINT fk_stock_adjustment_line_location FOREIGN KEY (storage_location_id, organization_id) REFERENCES public.storage_location(id, organization_id);


--
-- Name: CONSTRAINT fk_stock_adjustment_line_location ON stock_adjustment_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_stock_adjustment_line_location ON public.stock_adjustment_line IS 'Cites: IV-01, MS-17. Stock is adjusted at a location.';


--
-- Name: stock_adjustment_line fk_stock_adjustment_line_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_adjustment_line
    ADD CONSTRAINT fk_stock_adjustment_line_organization FOREIGN KEY (stock_adjustment_id, organization_id) REFERENCES public.stock_adjustment(id, organization_id);


--
-- Name: CONSTRAINT fk_stock_adjustment_line_organization ON stock_adjustment_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_stock_adjustment_line_organization ON public.stock_adjustment_line IS 'Cites: RT-001, BI-14. A line is in its adjustment''s organization.';


--
-- Name: stock_adjustment_line fk_stock_adjustment_line_store; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_adjustment_line
    ADD CONSTRAINT fk_stock_adjustment_line_store FOREIGN KEY (stock_adjustment_id, store_id) REFERENCES public.stock_adjustment(id, store_id);


--
-- Name: CONSTRAINT fk_stock_adjustment_line_store ON stock_adjustment_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_stock_adjustment_line_store ON public.stock_adjustment_line IS 'Cites: RT-001, MS-01, MS-04. A line carries its adjustment''s store, so the store predicate applies to lines directly.';


--
-- Name: stock_adjustment_line fk_stock_adjustment_line_type; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_adjustment_line
    ADD CONSTRAINT fk_stock_adjustment_line_type FOREIGN KEY (movement_type, direction) REFERENCES public.inventory_movement_type(code, direction);


--
-- Name: CONSTRAINT fk_stock_adjustment_line_type ON stock_adjustment_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_stock_adjustment_line_type ON public.stock_adjustment_line IS 'Cites: RT-058, BI-05. The line''s movement type and its fixed direction.';


--
-- Name: stock_adjustment_line fk_stock_adjustment_line_variant; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_adjustment_line
    ADD CONSTRAINT fk_stock_adjustment_line_variant FOREIGN KEY (variant_id, organization_id) REFERENCES public.product_variant(id, organization_id);


--
-- Name: CONSTRAINT fk_stock_adjustment_line_variant ON stock_adjustment_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_stock_adjustment_line_variant ON public.stock_adjustment_line IS 'Cites: PR-01, RT-021. Only a variant is adjusted, never a product.';


--
-- Name: stock_adjustment fk_stock_adjustment_reason; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_adjustment
    ADD CONSTRAINT fk_stock_adjustment_reason FOREIGN KEY (reason_code_id, organization_id) REFERENCES public.reason_code(id, organization_id);


--
-- Name: CONSTRAINT fk_stock_adjustment_reason ON stock_adjustment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_stock_adjustment_reason ON public.stock_adjustment IS 'Cites: IV-33, RT-074, BI-25. An adjustment always carries a reason code from its organization''s list.';


--
-- Name: stock_adjustment fk_stock_adjustment_store; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_adjustment
    ADD CONSTRAINT fk_stock_adjustment_store FOREIGN KEY (store_id, organization_id) REFERENCES public.store(id, organization_id);


--
-- Name: CONSTRAINT fk_stock_adjustment_store ON stock_adjustment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_stock_adjustment_store ON public.stock_adjustment IS 'Cites: RT-001, MS-01. An adjustment belongs to one store.';


--
-- Name: stock_balance fk_stock_balance_location; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_balance
    ADD CONSTRAINT fk_stock_balance_location FOREIGN KEY (storage_location_id, organization_id) REFERENCES public.storage_location(id, organization_id);


--
-- Name: CONSTRAINT fk_stock_balance_location ON stock_balance; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_stock_balance_location ON public.stock_balance IS 'Cites: IV-01, RT-057. Stock exists only at a location.';


--
-- Name: stock_balance fk_stock_balance_variant; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_balance
    ADD CONSTRAINT fk_stock_balance_variant FOREIGN KEY (variant_id, organization_id) REFERENCES public.product_variant(id, organization_id);


--
-- Name: CONSTRAINT fk_stock_balance_variant ON stock_balance; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_stock_balance_variant ON public.stock_balance IS 'Cites: PR-01, RT-021. Only a variant is stocked.';


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
-- Name: store_payment_method fk_store_payment_method_method; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_payment_method
    ADD CONSTRAINT fk_store_payment_method_method FOREIGN KEY (payment_method_id) REFERENCES public.payment_method(id);


--
-- Name: CONSTRAINT fk_store_payment_method_method ON store_payment_method; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_store_payment_method_method ON public.store_payment_method IS 'Cites: PY-04. Of a configured method.';


--
-- Name: store_payment_method fk_store_payment_method_store; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_payment_method
    ADD CONSTRAINT fk_store_payment_method_store FOREIGN KEY (store_id) REFERENCES public.store(id);


--
-- Name: CONSTRAINT fk_store_payment_method_store ON store_payment_method; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_store_payment_method_store ON public.store_payment_method IS 'Cites: PY-04, RT-001. Enablement is per store.';


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
    ('20260930140000'),
    ('20260930150000'),
    ('20260930160000'),
    ('20260930161000');
