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
-- Name: apply_refund_hold(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_refund_hold() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_line record;
  v_left bigint;
BEGIN
  IF NEW.sale_id IS NULL THEN
    IF NEW.status = 'Processing' AND OLD.status = 'Approved' THEN
      -- PY-37: a sale made from this payment since the refund was drafted would be paid for twice.
      IF EXISTS (SELECT 1 FROM payment p JOIN sale s ON s.checkout_id = p.checkout_id WHERE p.id = NEW.payment_id) THEN
        RAISE EXCEPTION 'payment % has become a sale: refund the sale', NEW.payment_id USING ERRCODE = 'SS059';
      END IF;
      -- One conditional increment: it affects no row if the payment would give back more than it took (PY-22).
      UPDATE payment SET refunded_amount = refunded_amount + NEW.amount
      WHERE id = NEW.payment_id AND refunded_amount + NEW.amount <= amount;
      IF NOT FOUND THEN
        SELECT amount - refunded_amount INTO v_left FROM payment WHERE id = NEW.payment_id;
        RAISE EXCEPTION 'only % of that payment can still be given back', v_left USING ERRCODE = 'SS058', DETAIL = v_left::text;
      END IF;
    ELSIF NEW.status = 'Cancelled' AND OLD.status = 'Processing' THEN
      UPDATE payment SET refunded_amount = refunded_amount - NEW.amount WHERE id = NEW.payment_id;
    END IF;
    RETURN NULL;
  END IF;
  IF NEW.status = 'Processing' AND OLD.status = 'Approved' THEN
    IF NEW.customer_return_id IS NOT NULL AND (
         NOT EXISTS (SELECT 1 FROM customer_return WHERE id = NEW.customer_return_id AND status = 'Posted')
         OR EXISTS (SELECT 1 FROM refund_line f
                    WHERE f.refund_id = NEW.id
                      AND NOT EXISTS (SELECT 1 FROM customer_return_line r
                                      WHERE r.customer_return_id = NEW.customer_return_id
                                        AND r.sale_line_id = f.sale_line_id))) THEN
      RAISE EXCEPTION 'a refund for a return pays only for lines that the posted return took back' USING ERRCODE = 'SS051';
    END IF;
    FOR v_line IN SELECT sale_line_id, amount, tax_amount FROM refund_line WHERE refund_id = NEW.id ORDER BY sale_line_id LOOP
      -- RR-03, RR-24: one conditional increment holds the amount; it affects no row past the bound. The tax it carries
      -- keeps the line's refunded tax at the line's stored tax in proportion to its refunded amount (RR-06, RR-42).
      UPDATE sale_line
        SET refunded_amount = refunded_amount + v_line.amount,
            refunded_tax_amount = refunded_tax_amount + v_line.tax_amount
      WHERE id = v_line.sale_line_id
        AND refunded_amount + v_line.amount <= settled_amount
        AND refunded_tax_amount + v_line.tax_amount
            = round(tax_amount::numeric * (refunded_amount + v_line.amount) / NULLIF(settled_amount, 0));
      IF NOT FOUND THEN
        SELECT settled_amount - refunded_amount INTO v_left FROM sale_line WHERE id = v_line.sale_line_id;
        IF v_line.amount > v_left THEN
          RAISE EXCEPTION 'only % of that line can still be refunded', v_left USING ERRCODE = 'SS049', DETAIL = v_left::text;
        END IF;
        RAISE EXCEPTION 'refund tax must be the line''s stored tax in proportion to the amount refunded'
          USING ERRCODE = 'SS052';
      END IF;
    END LOOP;
  ELSIF NEW.status = 'Cancelled' AND OLD.status = 'Processing' THEN
    UPDATE sale_line l
      SET refunded_amount = l.refunded_amount - r.amount,
          refunded_tax_amount = l.refunded_tax_amount - r.tax_amount
    FROM refund_line r
    WHERE r.refund_id = NEW.id AND l.id = r.sale_line_id;
  END IF;
  RETURN NULL;
END
$$;


--
-- Name: FUNCTION apply_refund_hold(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.apply_refund_hold() IS 'Cites: RR-03, RR-06, RR-24, RR-42, BI-10, SM-40, SM-41, PY-22, PY-23, PY-37, D-18. Entering Processing takes the hold with one conditional increment: on each sold line, which affects no row past its settled amount or its proportional tax; or, for a refund with no sale, on the payment, which affects no row past what the payment took. Failed and Completed keep it, and only a cancellation releases it. A refund for a return pays only the lines the posted return took back. A payment that has become a sale is no longer refunded without it.';


--
-- Name: apply_return_posting(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_return_posting() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_line    record;
  v_left    numeric;
  v_status  text;
  v_derived text;
BEGIN
  IF NEW.status = 'Posted' AND OLD.status = 'Draft' THEN
    FOR v_line IN SELECT sale_line_id, sum(quantity) AS quantity FROM customer_return_line
                  WHERE customer_return_id = NEW.id GROUP BY sale_line_id ORDER BY sale_line_id LOOP
      -- RR-14: one conditional increment; it affects no row if the sold quantity would be passed.
      UPDATE sale_line SET returned_quantity = returned_quantity + v_line.quantity
      WHERE id = v_line.sale_line_id AND returned_quantity + v_line.quantity <= quantity;
      IF NOT FOUND THEN
        SELECT quantity - returned_quantity INTO v_left FROM sale_line WHERE id = v_line.sale_line_id;
        RAISE EXCEPTION 'only % of that line can still be returned', v_left USING ERRCODE = 'SS046', DETAIL = v_left::text;
      END IF;
    END LOOP;

    -- SP-66: the status caches the counters, moving along the contracted edges of s22.6 only, so a return that takes
    -- everything back at once passes through PartiallyReturned.
    SELECT status INTO v_status FROM sale WHERE id = NEW.sale_id FOR UPDATE;
    SELECT CASE WHEN bool_and(returned_quantity = quantity) THEN 'Returned'
                WHEN bool_or(returned_quantity > 0) THEN 'PartiallyReturned' ELSE 'Completed' END
      INTO v_derived
    FROM sale_line WHERE sale_id = NEW.sale_id;
    IF v_derived <> 'Completed' AND v_status = 'Completed' THEN
      UPDATE sale SET status = 'PartiallyReturned' WHERE id = NEW.sale_id;
    END IF;
    IF v_derived = 'Returned' AND v_status <> 'Returned' THEN
      UPDATE sale SET status = 'Returned' WHERE id = NEW.sale_id;
    END IF;
  END IF;
  RETURN NULL;
END
$$;


--
-- Name: FUNCTION apply_return_posting(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.apply_return_posting() IS 'Cites: RR-14, BI-06, BI-16, RT-148, SP-66, SM-35, SM-35a. Posting a return increments each sold line''s returned counter with one conditional update that refuses to pass the sold quantity and names the remainder, then moves the sale''s status to what its counters say.';


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
-- Name: assert_count_reason_live(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_count_reason_live() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM assert_reason_code_live(NEW.reason_code_id);
  RETURN NEW;
END
$$;


--
-- Name: FUNCTION assert_count_reason_live(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.assert_count_reason_live() IS 'Cites: CD-23, BI-25, BI-40, RT-245. A variance is acknowledged with a live reason code: an archived one is kept for history and takes no new use (SS024), as on every other reasoned row.';


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
-- Name: assert_movement_return_state(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_movement_return_state() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.customer_return_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.movement_type <> 'SALE_RETURN'
     OR NOT EXISTS (SELECT 1 FROM customer_return WHERE id = NEW.customer_return_id AND status = 'Posted') THEN
    RAISE EXCEPTION 'a return moves stock only as SALE_RETURN, when it is posted' USING ERRCODE = 'SS016';
  END IF;
  RETURN NEW;
END
$$;


--
-- Name: FUNCTION assert_movement_return_state(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.assert_movement_return_state() IS 'Cites: BI-27, IV-14, RR-17, SM-38. A return moves stock only as SALE_RETURN and only once posted. It is never reversed: a correction is a further reason-bearing movement.';


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
-- Name: assert_reason_code_live(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_reason_code_live(p_reason_code_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM reason_code WHERE id = p_reason_code_id AND archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'reason code % is archived and takes no new documents', p_reason_code_id USING ERRCODE = 'SS024';
  END IF;
END
$$;


--
-- Name: FUNCTION assert_reason_code_live(p_reason_code_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.assert_reason_code_live(p_reason_code_id uuid) IS 'Cites: BI-40, BI-25. An archived reason code is kept for history and takes no new use.';


--
-- Name: assert_refund_payout_completes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_refund_payout_completes() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM refund WHERE id = NEW.refund_id AND status = 'Completed') THEN
    RAISE EXCEPTION 'cash left the drawer for refund %, which did not complete', NEW.refund_id USING ERRCODE = 'SS053';
  END IF;
  RETURN NULL;
END
$$;


--
-- Name: FUNCTION assert_refund_payout_completes(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.assert_refund_payout_completes() IS 'Cites: PY-27, BI-04, RT-156. At commit, cash paid out for a refund belongs to a refund that completed in the same transaction: the payout and the completion are one event.';


--
-- Name: assert_refund_whole(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_refund_whole() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_lines  integer;
  v_amount bigint;
  v_tax    bigint;
BEGIN
  IF NEW.sale_id IS NOT NULL THEN
    SELECT count(*), coalesce(sum(amount), 0), coalesce(sum(tax_amount), 0) INTO v_lines, v_amount, v_tax
    FROM refund_line WHERE refund_id = NEW.id;
    IF v_lines = 0 OR v_amount <> NEW.amount OR v_tax <> NEW.tax_amount THEN
      RAISE EXCEPTION 'refund % must equal the sum of its lines', NEW.id USING ERRCODE = 'SS053';
    END IF;
  END IF;
  IF NEW.status = 'Completed' AND NEW.disbursement = 'Drawer' AND NEW.amount IS DISTINCT FROM (
       SELECT amount FROM cash_transaction WHERE refund_id = NEW.id) THEN
    RAISE EXCEPTION 'cash refund % completed without being paid out of the drawer', NEW.id USING ERRCODE = 'SS053';
  END IF;
  RETURN NULL;
END
$$;


--
-- Name: FUNCTION assert_refund_whole(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.assert_refund_whole() IS 'Cites: RR-43, PY-27, CD-19, BI-04, RT-156, D-18. At commit, a refund that has left Draft equals the sum of its lines, tax included (a refund with no sale has no lines), and a completed cash refund has left the drawer as a recorded disbursement of exactly its amount.';


--
-- Name: assert_reprint_reason_live(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_reprint_reason_live() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM assert_reason_code_live(NEW.reason_code_id);
  RETURN NEW;
END
$$;


--
-- Name: FUNCTION assert_reprint_reason_live(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.assert_reprint_reason_live() IS 'Cites: BI-25, BI-40. A reprint takes only a live reason code: an archived one is kept for history and takes no new use (SS024).';


--
-- Name: assert_return_posting_complete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_return_posting_complete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status = 'Posted' AND OLD.status = 'Draft' AND (
       NOT EXISTS (SELECT 1 FROM customer_return_line WHERE customer_return_id = NEW.id)
       OR EXISTS (SELECT 1 FROM customer_return_line l
                  WHERE l.customer_return_id = NEW.id
                    AND NOT EXISTS (SELECT 1 FROM inventory_movement m
                                    WHERE m.customer_return_line_id = l.id AND m.quantity = l.quantity))) THEN
    RAISE EXCEPTION 'return % was posted without exactly one movement per line', NEW.id USING ERRCODE = 'SS022';
  END IF;
  RETURN NULL;
END
$$;


--
-- Name: FUNCTION assert_return_posting_complete(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.assert_return_posting_complete() IS 'Cites: RR-17, SM-43, BI-04, RT-153. At commit, a posted return has lines and has brought each one back, whole, into its dispositioned location.';


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
  -- D-18, PY-37: a payment that is being given back, or has been, does not pay for goods.
  IF EXISTS (SELECT 1 FROM refund r JOIN payment p ON p.id = r.payment_id
             WHERE p.checkout_id = s.checkout_id AND r.sale_id IS NULL AND r.status <> 'Cancelled') THEN
    RAISE EXCEPTION 'a payment of sale % is being refunded without it', s.id USING ERRCODE = 'SS059';
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

COMMENT ON FUNCTION public.assert_sale_complete() IS 'Cites: SP-02, SP-36, SP-40, BI-04, BI-18, RT-119, RT-133, RT-135, RT-136, RT-146, IV-15, PY-37, D-18. At commit, a sale is whole: at least one line; totals are the sums of its lines and follow the tax mode; the settled amounts sum to the total due; no tender is left pending; captured tenders equal the total due; no payment of it is being refunded without it; change equals cash tendered beyond cash applied and is disbursed from the drawer; and every stocked line moved exactly its quantity.';


--
-- Name: assert_shift_actors_fixed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_shift_actors_fixed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND (NEW.status_changed_by IS DISTINCT FROM OLD.status_changed_by OR NEW.closed_by IS DISTINCT FROM OLD.closed_by) THEN
    RAISE EXCEPTION 'who changed shift % and who closed it are recorded by its transitions and cannot be rewritten', OLD.id
      USING ERRCODE = 'SS001';
  END IF;
  RETURN NEW;
END
$$;


--
-- Name: FUNCTION assert_shift_actors_fixed(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.assert_shift_actors_fixed() IS 'Cites: SM-57, AU-05, CD-20, BI-08. A shift''s actors are written by its transitions alone: who last changed its status, and who closed it, change only together with the status. A closed shift''s record therefore cannot be rewritten, at any privilege.';


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
-- Name: audit_chain_breaks(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_chain_breaks(p_organization_id uuid) RETURNS TABLE(chain_seq bigint, audit_event_id uuid, problem text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
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


--
-- Name: FUNCTION audit_chain_breaks(p_organization_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.audit_chain_breaks(p_organization_id uuid) IS 'Cites: AU-29, AU-30, EC-76, RT-302. Walks an organization''s chain and returns every break: a missing link, a link that does not continue from its predecessor, an altered event, an unlinked event, or an end short of the recorded head. It never repairs; an empty result is the proof, and anything else is an incident.';


--
-- Name: audit_chain_genesis(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_chain_genesis(p_organization_id uuid) RETURNS bytea
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT sha256(convert_to('smartstore-audit-chain:' || p_organization_id::text, 'UTF8'))
$$;


--
-- Name: FUNCTION audit_chain_genesis(p_organization_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.audit_chain_genesis(p_organization_id uuid) IS 'Cites: AU-29. The hash an organization''s chain starts from.';


--
-- Name: audit_device_mode(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_device_mode() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
  PERFORM write_audit_event('Device.ModeChange', TG_TABLE_NAME, to_jsonb(OLD), to_jsonb(NEW), NEW.mode <> 'Training');
  RETURN NULL;
END
$$;


--
-- Name: FUNCTION audit_device_mode(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.audit_device_mode() IS 'Cites: PT-03, SM-59, D-06. A mode change records Device.ModeChange; setting Maintenance or restoring Standard needs a reason (s22.12).';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_event (
    seq bigint NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    store_id uuid,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    event_type text NOT NULL,
    entity_type public.nonblank_text NOT NULL,
    entity_id uuid,
    actor_id uuid,
    effective_actor_id uuid,
    role_used public.nonblank_text,
    source text NOT NULL,
    terminal_id uuid,
    correlation_id uuid NOT NULL,
    client_operation_id uuid,
    ip_address inet,
    reason_code_id uuid,
    before jsonb,
    after jsonb,
    CONSTRAINT ck_audit_event_actor CHECK (((actor_id IS NOT NULL) OR (event_type = 'Security.LoginFailed'::text))),
    CONSTRAINT ck_audit_event_impersonation CHECK (((effective_actor_id IS NULL) OR (effective_actor_id <> actor_id))),
    CONSTRAINT ck_audit_event_source CHECK ((source = ANY (ARRAY['UI'::text, 'API'::text, 'Job'::text, 'Device'::text, 'OfflineSync'::text, 'Terminal'::text])))
);


--
-- Name: TABLE audit_event; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.audit_event IS 'Cites: AU-01, AU-02, AU-04, AU-07, AU-08, AU-10, BI-24, RT-290, RT-291, RT-464. One audit event, written in the same transaction as the change it records and never updated or deleted by any role. Organization-global with the store on it when the entity has one (MS-29).';


--
-- Name: CONSTRAINT ck_audit_event_actor ON audit_event; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_audit_event_actor ON public.audit_event IS 'Cites: AU-05, RT-293. Every event names the authenticated actor; only a failed sign-in, which by definition has none, may not.';


--
-- Name: CONSTRAINT ck_audit_event_impersonation ON audit_event; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_audit_event_impersonation ON public.audit_event IS 'Cites: AU-06, RT-294. Under impersonation both principals are recorded, and they differ.';


--
-- Name: CONSTRAINT ck_audit_event_source ON audit_event; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_audit_event_source ON public.audit_event IS 'Cites: AU-10. Where the change came from: UI, API, job, device, offline sync, or terminal (audit-domain s2).';


--
-- Name: audit_event_canonical(public.audit_event); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_event_canonical(e public.audit_event) RETURNS bytea
    LANGUAGE sql STABLE
    AS $$
  SELECT convert_to(jsonb_build_array(
    e.id, e.organization_id, e.store_id, to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    e.event_type, e.entity_type, e.entity_id, e.actor_id, e.effective_actor_id, e.role_used, e.source, e.terminal_id,
    e.correlation_id, e.client_operation_id, host(e.ip_address), e.reason_code_id, e.before, e.after)::text, 'UTF8')
$$;


--
-- Name: FUNCTION audit_event_canonical(e public.audit_event); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.audit_event_canonical(e public.audit_event) IS 'Cites: AU-29. The event''s content in one fixed, unambiguous form, independent of the session''s time zone, for hashing.';


--
-- Name: audit_ledger_row(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_ledger_row() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
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


--
-- Name: FUNCTION audit_ledger_row(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.audit_ledger_row() IS 'Cites: AU-03, AU-04, RT-292. Every stock movement records Inventory.Movement with its resulting balance; every cash transaction records Cash.In or Cash.PayOut by its direction; every price records Price.Change.';


--
-- Name: audit_redact(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_redact(p_entity_type text, p_values jsonb) RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  SELECT jsonb_object_agg(e.key, CASE WHEN f.field IS NULL OR e.value = 'null'::jsonb THEN e.value
                                      ELSE to_jsonb('[redacted]'::text) END)
  FROM jsonb_each(p_values) e
  LEFT JOIN audit_redacted_field f ON f.entity_type = p_entity_type AND f.field = e.key
$$;


--
-- Name: FUNCTION audit_redact(p_entity_type text, p_values jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.audit_redact(p_entity_type text, p_values jsonb) IS 'Cites: AU-09, CU-35, RT-295. Replaces the value of each personal field with a marker, so the event shows that it changed and never what it holds.';


--
-- Name: audit_role_assignment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_role_assignment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
  PERFORM write_audit_event('Security.Role.Assign', TG_TABLE_NAME,
    CASE TG_OP WHEN 'INSERT' THEN NULL ELSE to_jsonb(OLD) END, to_jsonb(NEW), false);
  RETURN NULL;
END
$$;


--
-- Name: FUNCTION audit_role_assignment(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.audit_role_assignment() IS 'Cites: AU-03, RT-020, PC-01. Every role assignment and every removal records Security.Role.Assign, naming the role and scope on the entity and the prior state in before.';


--
-- Name: audit_setting(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_setting(p_name text) RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT NULLIF(current_setting('smartstore.' || p_name, true), '')
$$;


--
-- Name: FUNCTION audit_setting(p_name text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.audit_setting(p_name text) IS 'Cites: AU-05, AU-10. One value of the request context the application set for this transaction, or null.';


--
-- Name: audit_state_transition(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_state_transition() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
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


--
-- Name: FUNCTION audit_state_transition(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.audit_state_transition() IS 'Cites: AU-01, AU-03, AU-12, D-06, SM-02, RT-290, RT-292. Records the event the s22 contract names for a creation or an edge, in the same transaction; the event of an edge that needs a reason carries one or the change is refused.';


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
-- Name: customer_return_before_write(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.customer_return_before_write() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_closes date;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM assert_reason_code_live(NEW.late_reason_code_id);
    NEW.document_number := allocate_document_number(NEW.store_id, 'CustomerReturn');
    RETURN NEW;
  END IF;
  IF OLD.status <> 'Draft' AND (NEW.posted_by IS DISTINCT FROM OLD.posted_by
       OR NEW.late_approved_by IS DISTINCT FROM OLD.late_approved_by
       OR NEW.late_reason_code_id IS DISTINCT FROM OLD.late_reason_code_id
       OR NEW.cancel_reason_code_id IS DISTINCT FROM OLD.cancel_reason_code_id) THEN
    RAISE EXCEPTION 'return % is % and its record of who and why is fixed', OLD.id, OLD.status USING ERRCODE = 'SS001';
  END IF;
  IF NEW.late_reason_code_id IS DISTINCT FROM OLD.late_reason_code_id THEN
    PERFORM assert_reason_code_live(NEW.late_reason_code_id);
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
    IF NEW.status = 'Cancelled' THEN
      PERFORM assert_reason_code_live(NEW.cancel_reason_code_id);
    END IF;
    IF NEW.status = 'Posted' THEN
      NEW.posted_at := now();
      SELECT (now() AT TIME ZONE s.time_zone)::date INTO NEW.business_date FROM store s WHERE s.id = NEW.store_id;
      SELECT sa.business_date + v.return_window_days INTO v_closes
      FROM sale sa, LATERAL (SELECT return_window_days FROM store_setting_version
                             WHERE store_id = NEW.store_id AND effective_from <= now()
                             ORDER BY effective_from DESC LIMIT 1) v
      WHERE sa.id = NEW.sale_id;
      IF NEW.business_date > v_closes AND NEW.late_approved_by IS NULL THEN
        RAISE EXCEPTION 'the return window for this sale closed on %', v_closes
          USING ERRCODE = 'SS048', DETAIL = to_char(v_closes, 'YYYY-MM-DD');
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;


--
-- Name: FUNCTION customer_return_before_write(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.customer_return_before_write() IS 'Cites: BI-42, RR-10, RR-11, SM-03, RT-234, RT-150. Allocates the return number; stamps posting with server time and business date; beyond the store''s return window a return needs an approver and a reason, and the refusal names the date the window closed; once a return leaves Draft its who and why are fixed.';


--
-- Name: customer_return_line_rules(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.customer_return_line_rules() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_status   text;
  v_type     text;
  v_sellable boolean;
  v_left     numeric;
BEGIN
  SELECT status INTO v_status FROM customer_return
  WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.customer_return_id ELSE NEW.customer_return_id END
  FOR SHARE;
  IF v_status IS DISTINCT FROM 'Draft' THEN
    RAISE EXCEPTION 'document lines change only while the document is a draft (it is %)', v_status USING ERRCODE = 'SS018';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  -- An unknown or missing disposition is left to the column's CHECK and NOT NULL.
  SELECT location_type, is_sellable INTO v_type, v_sellable FROM storage_location WHERE id = NEW.storage_location_id;
  IF (CASE NEW.disposition
        WHEN 'Sellable' THEN NOT v_sellable
        WHEN 'Quarantine' THEN v_type <> 'Quarantine'
        WHEN 'Damaged' THEN v_type <> 'Damaged'
        WHEN 'Expired' THEN v_type <> 'ExpiredHold'
      END) THEN
    RAISE EXCEPTION 'a % return cannot go to a % location', NEW.disposition, v_type USING ERRCODE = 'SS047';
  END IF;

  -- s12.1: a draft is bounded as it is built. The atomic bound is taken when the return is posted (RR-14).
  SELECT l.quantity - l.returned_quantity
         - coalesce((SELECT sum(r.quantity) FROM customer_return_line r
                     WHERE r.customer_return_id = NEW.customer_return_id AND r.sale_line_id = l.id AND r.id <> NEW.id), 0)
    INTO v_left
  FROM sale_line l WHERE l.id = NEW.sale_line_id;
  IF NEW.quantity > v_left THEN
    RAISE EXCEPTION 'only % of that line can still be returned', v_left USING ERRCODE = 'SS046', DETAIL = v_left::text;
  END IF;
  RETURN NEW;
END
$$;


--
-- Name: FUNCTION customer_return_line_rules(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.customer_return_line_rules() IS 'Cites: RR-14, RR-17, RR-19, BI-17, WH-01, BI-08, RT-148. Lines change only while the return is a draft; each disposition sends the goods to its own kind of location, and only Sellable to a sellable one (batch-expiry-fefo s6); a draft never holds more than is still returnable, naming the remainder.';


--
-- Name: employee_holds_permission(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.employee_holds_permission(p_employee_id uuid, p_store_id uuid, p_permission text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM employee_role_assignment a
    JOIN role r ON r.id = a.role_id AND r.archived_at IS NULL
    JOIN role_permission g ON g.role_id = r.id AND g.permission_key = p_permission AND g.revoked_at IS NULL
    WHERE a.employee_id = p_employee_id AND a.revoked_at IS NULL
      AND CASE WHEN p_store_id IS NULL THEN a.store_id IS NULL
               ELSE (a.store_id IS NULL OR a.store_id = p_store_id)
                    AND EXISTS (SELECT 1 FROM employee_store_access s
                                WHERE s.employee_id = p_employee_id AND s.store_id = p_store_id AND s.revoked_at IS NULL
                                  AND (s.valid_from IS NULL OR s.valid_from <= now())
                                  AND (s.valid_to IS NULL OR s.valid_to > now()))
          END)
$$;


--
-- Name: FUNCTION employee_holds_permission(p_employee_id uuid, p_store_id uuid, p_permission text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.employee_holds_permission(p_employee_id uuid, p_store_id uuid, p_permission text) IS 'Cites: AC-01, AC-02, EM-13, MS-11, MS-12, BI-14. Whether an employee''s grants give a permission in a store: a live assignment, of a live role holding the exact key, in that store or organization-wide, intersected with live store access. An organization-level action (no store) needs an organization-wide assignment (OQ-025). Default deny. The one authorization gate also checks the employee''s status and session on every request (architecture s7.5, s8.2).';


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
-- Name: forbid_termination_with_open_shift(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.forbid_termination_with_open_shift() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status = 'Terminated' AND OLD.status IS DISTINCT FROM 'Terminated'
     AND EXISTS (SELECT 1 FROM cash_shift WHERE opened_by = NEW.id AND status <> 'Closed') THEN
    RAISE EXCEPTION 'employee % has a till shift that is not closed; close it first', NEW.id USING ERRCODE = 'SS057';
  END IF;
  RETURN NEW;
END
$$;


--
-- Name: FUNCTION forbid_termination_with_open_shift(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.forbid_termination_with_open_shift() IS 'Cites: EM-10, BI-39, CD-01. Termination is refused while the employee has a till shift that is not closed.';


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
    IF v_first IS NULL THEN
      SELECT l.id INTO v_first FROM sale_line l JOIN product_variant v ON v.id = l.variant_id
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

COMMENT ON FUNCTION public.freeze_used_quantity_kind() IS 'Cites: PR-14, RT-491. A unit''s quantity kind is frozen once any movement or document line uses it: a movement, a stock adjustment line, or a sale line, which the return and refund lines of a sale follow. The refusal names the first use.';


--
-- Name: grant_to_complete_roles(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.grant_to_complete_roles(p_keys text[]) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_granted integer;
BEGIN
  INSERT INTO role_permission (role_id, organization_id, permission_key, granted_by)
  SELECT r.id, r.organization_id, k.key,
         (SELECT g.granted_by FROM role_permission g WHERE g.role_id = r.id ORDER BY g.granted_at, g.id LIMIT 1)
  FROM role r CROSS JOIN unnest(p_keys) AS k(key)
  WHERE r.archived_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM role_permission g
                    WHERE g.role_id = r.id AND g.permission_key = k.key AND g.revoked_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM permission p
                    WHERE p.key <> ALL (p_keys)
                      AND NOT EXISTS (SELECT 1 FROM role_permission g
                                      WHERE g.role_id = r.id AND g.permission_key = p.key AND g.revoked_at IS NULL));
  GET DIAGNOSTICS v_granted = ROW_COUNT;
  RETURN v_granted;
END
$$;


--
-- Name: FUNCTION grant_to_complete_roles(p_keys text[]); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.grant_to_complete_roles(p_keys text[]) IS 'Cites: AC-01, AC-02, D-01, D-16. Gives every live role that holds every other catalogue key the keys named, so that a role holding everything (the Owner''s, actors-and-roles s3.2, s4) still does when keys are added. Each grant names whoever granted the role its first key, as onboarding records the Owner granting their own. For migrations only.';


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
-- Name: link_audit_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.link_audit_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
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


--
-- Name: FUNCTION link_audit_event(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.link_audit_event() IS 'Cites: AU-29, RT-302. Links each event into its organization''s chain at commit. Linking last, after every business lock is held, means the chain head is never waited for while holding it, so it cannot deadlock with the business rows; it serialises the organization''s commits for the moment of linking.';


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
  IF OLD.status IN ('Captured', 'Declined', 'Voided', 'Failed')
     AND (to_jsonb(NEW) - 'refunded_amount') IS DISTINCT FROM (to_jsonb(OLD) - 'refunded_amount') THEN
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
-- Name: payment_refund_drift(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.payment_refund_drift() RETURNS TABLE(payment_id uuid, problem text, recorded bigint, expected bigint)
    LANGUAGE sql STABLE
    AS $$
  SELECT p.id, 'refunded amount differs from the refunds holding it', p.refunded_amount, coalesce(h.amount, 0)::bigint
  FROM payment p
  LEFT JOIN LATERAL (SELECT sum(r.amount) AS amount FROM refund r
                     WHERE r.payment_id = p.id AND r.sale_id IS NULL AND r.status IN ('Processing', 'Failed', 'Completed')) h ON true
  WHERE p.refunded_amount <> coalesce(h.amount, 0)
$$;


--
-- Name: FUNCTION payment_refund_drift(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.payment_refund_drift() IS 'Cites: PY-22, RR-24, D-18, SP-66. Rebuilds every payment''s refunded amount from the refunds with no sale that hold money (Processing, Failed, Completed) and returns each disagreement. It never repairs; an empty result is the proof.';


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
-- Name: record_audit_event(text, uuid, uuid, text, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_audit_event(p_event_type text, p_organization_id uuid, p_store_id uuid, p_entity_type text, p_entity_id uuid, p_after jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
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


--
-- Name: FUNCTION record_audit_event(p_event_type text, p_organization_id uuid, p_store_id uuid, p_entity_type text, p_entity_id uuid, p_after jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.record_audit_event(p_event_type text, p_organization_id uuid, p_store_id uuid, p_entity_type text, p_entity_id uuid, p_after jsonb) IS 'Cites: AU-03, AU-05, AU-12a, AU-14, AU-15, RT-296. The application''s only way to write an event: an Application type (sign-in, sign-out, session end, failed sign-in, denial, export and the like), with the actor and request context from the authenticated session, never from its arguments.';


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
-- Name: record_revocation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_revocation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.revoked_by IS NOT NULL THEN
    IF NEW.revoked_by IS DISTINCT FROM OLD.revoked_by OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
      RAISE EXCEPTION '% % is already revoked; who revoked it and when cannot be changed', TG_TABLE_NAME, OLD.id
        USING ERRCODE = 'SS001';
    END IF;
  ELSIF NEW.revoked_by IS NOT NULL THEN
    NEW.revoked_at := now();
  END IF;
  RETURN NEW;
END
$$;


--
-- Name: FUNCTION record_revocation(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.record_revocation() IS 'Cites: BI-40, PC-01, EM-15, RT-353. A grant is revoked once, recording who and when with server time; the grant row stays as history, so the permission set as it stood at any time can be rebuilt.';


--
-- Name: record_session_end(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_session_end() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.end_reason IS NOT NULL THEN
    RAISE EXCEPTION 'session % has ended; how and when cannot be changed', OLD.id USING ERRCODE = 'SS001';
  END IF;
  IF NEW.end_reason IS NOT NULL THEN
    NEW.ended_at := now();
  END IF;
  RETURN NEW;
END
$$;


--
-- Name: FUNCTION record_session_end(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.record_session_end() IS 'Cites: AU-12a, SM-03, RT-353. A session ends once, stamped with server time.';


--
-- Name: refund_before_write(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refund_before_write() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_method_type text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.method = 'OriginalTender' AND NEW.sale_id IS NULL THEN
      -- D-18: the return to the card of a captured card payment that has no sale.
      SELECT p.method_type INTO v_method_type
      FROM payment p
      WHERE p.id = NEW.payment_id AND p.status = 'Captured' AND p.store_id = NEW.store_id AND p.currency_code = NEW.currency_code;
      IF v_method_type IS NULL THEN
        RAISE EXCEPTION 'payment % is not a captured payment of this store and currency', NEW.payment_id USING ERRCODE = 'SS050';
      END IF;
      IF v_method_type <> 'Card' THEN
        RAISE EXCEPTION 'only a card payment is taken back without its sale' USING ERRCODE = 'SS059';
      END IF;
      IF EXISTS (SELECT 1 FROM payment p JOIN sale s ON s.checkout_id = p.checkout_id WHERE p.id = NEW.payment_id) THEN
        RAISE EXCEPTION 'payment % belongs to a sale: refund the sale', NEW.payment_id USING ERRCODE = 'SS059';
      END IF;
      NEW.disbursement := 'Provider';
    ELSIF NEW.method = 'OriginalTender' THEN
      SELECT p.method_type INTO v_method_type
      FROM payment p JOIN sale s ON s.checkout_id = p.checkout_id
      WHERE p.id = NEW.payment_id AND s.id = NEW.sale_id AND p.status = 'Captured';
      IF v_method_type IS NULL THEN
        RAISE EXCEPTION 'payment % is not a captured tender of this sale', NEW.payment_id USING ERRCODE = 'SS050';
      END IF;
      NEW.disbursement := CASE v_method_type WHEN 'Cash' THEN 'Drawer' ELSE 'Provider' END;
    ELSE
      NEW.disbursement := 'Drawer';
    END IF;
    PERFORM assert_reason_code_live(NEW.reason_code_id);
    NEW.document_number := allocate_document_number(NEW.store_id, 'Refund');
    RETURN NEW;
  END IF;
  IF OLD.status IN ('Completed', 'Cancelled') THEN
    RAISE EXCEPTION 'refund % is % and is never changed; a correction is a further linked refund', OLD.id, OLD.status
      USING ERRCODE = 'SS035';
  END IF;
  IF (OLD.submitted_by IS NOT NULL AND NEW.submitted_by IS DISTINCT FROM OLD.submitted_by)
     OR (OLD.approved_by IS NOT NULL AND NEW.approved_by IS DISTINCT FROM OLD.approved_by) THEN
    RAISE EXCEPTION 'who submitted or approved refund % cannot be changed', OLD.id USING ERRCODE = 'SS001';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
    IF NEW.status = 'PendingApproval' THEN
      NEW.submitted_at := now();
    ELSIF NEW.status = 'Approved' THEN
      NEW.approved_at := now();
    ELSIF NEW.status = 'Cancelled' THEN
      PERFORM assert_reason_code_live(NEW.cancel_reason_code_id);
    ELSIF NEW.status = 'Completed' AND NEW.disbursement = 'Drawer' THEN
      IF NOT EXISTS (SELECT 1 FROM pos_terminal WHERE id = NEW.pos_terminal_id AND status = 'Active' AND mode <> 'Training') THEN
        RAISE EXCEPTION 'terminal % may not pay out a real refund', NEW.pos_terminal_id USING ERRCODE = 'SS025';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM cash_shift WHERE id = NEW.cash_shift_id AND status = 'Open') THEN
        RAISE EXCEPTION 'shift % is not open', NEW.cash_shift_id USING ERRCODE = 'SS026';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;


--
-- Name: FUNCTION refund_before_write(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.refund_before_write() IS 'Cites: RR-22, RR-23, RR-25, PY-25, PY-27, PT-03, BI-09, BI-42, SM-03, PY-37, D-18. A refund to the original tender goes back to a captured tender of the same sale, cash through the drawer and card through the provider; or, with no sale, to a captured card payment of this store and currency that has no sale (D-18); numbering; transition stamps; a completed or cancelled refund is frozen; drawer cash is paid out only at a till in service and not in training, during an open shift.';


--
-- Name: refund_line_rules(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refund_line_rules() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM refund
  WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.refund_id ELSE NEW.refund_id END
  FOR SHARE;
  IF v_status IS DISTINCT FROM 'Draft' THEN
    RAISE EXCEPTION 'document lines change only while the document is a draft (it is %)', v_status USING ERRCODE = 'SS018';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;


--
-- Name: FUNCTION refund_line_rules(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.refund_line_rules() IS 'Cites: BI-08, BI-27, AP-03. A refund''s allocation is fixed once it is submitted for approval, so the approver approves what is paid; a draft line may be deleted (overview s3.6).';


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
-- Name: sale_counter_drift(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sale_counter_drift() RETURNS TABLE(sale_id uuid, sale_line_id uuid, problem text, recorded numeric, expected numeric)
    LANGUAGE sql STABLE
    AS $$
  WITH rebuilt AS (
    SELECT l.sale_id, l.id, l.quantity, l.returned_quantity, l.refunded_amount, l.refunded_tax_amount,
           coalesce((SELECT sum(r.quantity) FROM customer_return_line r JOIN customer_return c ON c.id = r.customer_return_id
                     WHERE r.sale_line_id = l.id AND c.status IN ('Posted', 'Settled', 'Closed')), 0) AS returned,
           coalesce(h.amount, 0) AS refunded,
           coalesce(h.tax, 0) AS refunded_tax
    FROM sale_line l
    LEFT JOIN LATERAL (SELECT sum(r.amount) AS amount, sum(r.tax_amount) AS tax
                       FROM refund_line r JOIN refund f ON f.id = r.refund_id
                       WHERE r.sale_line_id = l.id AND f.status IN ('Processing', 'Failed', 'Completed')) h ON true
  ), derived AS (
    SELECT rb.sale_id, CASE WHEN bool_and(rb.returned = rb.quantity) THEN 'Returned'
                            WHEN bool_or(rb.returned > 0) THEN 'PartiallyReturned' ELSE 'Completed' END AS status
    FROM rebuilt rb GROUP BY rb.sale_id
  )
  SELECT rb.sale_id, rb.id, 'returned quantity differs from the posted returns', rb.returned_quantity, rb.returned
  FROM rebuilt rb WHERE rb.returned_quantity <> rb.returned
  UNION ALL
  SELECT rb.sale_id, rb.id, 'refunded amount differs from the refunds holding it', rb.refunded_amount, rb.refunded
  FROM rebuilt rb WHERE rb.refunded_amount <> rb.refunded
  UNION ALL
  SELECT rb.sale_id, rb.id, 'refunded tax differs from the refunds holding it', rb.refunded_tax_amount, rb.refunded_tax
  FROM rebuilt rb WHERE rb.refunded_tax_amount <> rb.refunded_tax
  UNION ALL
  SELECT s.id, NULL, 'sale status is ' || s.status || ' but its returns make it ' || d.status, NULL, NULL
  FROM sale s JOIN derived d ON d.sale_id = s.id
  WHERE s.status <> d.status
$$;


--
-- Name: FUNCTION sale_counter_drift(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.sale_counter_drift() IS 'Cites: SP-66, SM-35a, RR-14, RR-24. Rebuilds every line''s returned and refunded counters from the returns and refunds, and every sale''s status from the rebuilt counters, and returns each disagreement. It never repairs; an empty result is the proof.';


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
       - coalesce((SELECT sum(amount) FROM cash_transaction WHERE cash_shift_id = p_shift_id AND type = 'RefundFromDrawer'), 0)
$$;


--
-- Name: FUNCTION shift_expected_cash(p_shift_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.shift_expected_cash(p_shift_id uuid) IS 'Cites: CD-06, CD-08, CD-09, PY-27, RT-135, RT-156. What should be in the drawer, derived and never stored: the opening float, plus the cash applied to the shift''s sales (net of change), minus cash refunded out of it. CD-06 writes the refund term with a plus; cash-management s5 gives RefundFromDrawer the direction Out, and PY-27 says an unrecorded refund leaves the count short, so it is subtracted (OQ-015).';


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
-- Name: stamp_password_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.stamp_password_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
    NEW.password_changed_at := now();
  END IF;
  RETURN NEW;
END
$$;


--
-- Name: FUNCTION stamp_password_change(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.stamp_password_change() IS 'Cites: EM-04, RT-353. Records when a credential last changed, with server time.';


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


--
-- Name: write_audit_event(text, text, jsonb, jsonb, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.write_audit_event(p_event_type text, p_entity_type text, p_old jsonb, p_new jsonb, p_needs_reason boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
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
          v_corr, audit_setting('client_operation_id')::uuid, audit_setting('ip_address')::inet, v_reason,
          audit_redact(p_entity_type, v_before), audit_redact(p_entity_type, v_after));
END
$$;


--
-- Name: FUNCTION write_audit_event(p_event_type text, p_entity_type text, p_old jsonb, p_new jsonb, p_needs_reason boolean); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.write_audit_event(p_event_type text, p_entity_type text, p_old jsonb, p_new jsonb, p_needs_reason boolean) IS 'Cites: AU-01, AU-04, AU-05, AU-06, AU-07, AU-08, AU-09, AU-10, RT-290, RT-293, RT-295, RT-464. Writes one event in the transaction of the change: the actor, source and correlation id from the authenticated context, refusing the change without them; the store and organization from the entity; the reason from the entity or the context, refusing a transition that needs one without it; the whole created row, or only the fields that changed, with personal fields redacted at write time.';


--
-- Name: audit_chain_head; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_chain_head (
    organization_id uuid NOT NULL,
    last_seq bigint NOT NULL,
    last_hash bytea NOT NULL
);


--
-- Name: TABLE audit_chain_head; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.audit_chain_head IS 'Cites: AU-29, RT-302. The tip of an organization''s audit chain, so a removal at the end is detectable too. Written only by the linking trigger.';


--
-- Name: audit_chain_link; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_chain_link (
    organization_id uuid NOT NULL,
    chain_seq bigint NOT NULL,
    audit_event_id uuid NOT NULL,
    prev_hash bytea NOT NULL,
    hash bytea NOT NULL
);


--
-- Name: TABLE audit_chain_link; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.audit_chain_link IS 'Cites: AU-29, AU-31, RT-302, RT-467. Each event''s place in its organization''s hash chain: the previous link''s hash and the hash of that with the event''s canonical content. Append-only at every privilege.';


--
-- Name: audit_event_seq_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.audit_event ALTER COLUMN seq ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.audit_event_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: audit_event_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_event_type (
    code public.nonblank_text NOT NULL,
    origin text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_audit_event_type_origin CHECK ((origin = ANY (ARRAY['Database'::text, 'Application'::text])))
);


--
-- Name: TABLE audit_event_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.audit_event_type IS 'Cites: AU-11, AU-12, AU-12b, AU-12c, AU-13, D-06, RT-465. The closed, versioned event vocabulary. A type is added only by a migration, and only when a rule requires the event. Database types are written by the schema''s own triggers as part of the change; Application types (sign-in, export and the like) are recorded by the application through record_audit_event().';


--
-- Name: CONSTRAINT ck_audit_event_type_origin ON audit_event_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_audit_event_type_origin ON public.audit_event_type IS 'Cites: AU-01, AU-05. Whether the database writes the event itself, in the transaction of the change, or the application records it.';


--
-- Name: audit_redacted_field; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_redacted_field (
    entity_type public.nonblank_text NOT NULL,
    field public.nonblank_text NOT NULL
);


--
-- Name: TABLE audit_redacted_field; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.audit_redacted_field IS 'Cites: AU-09, CU-33, CU-35, RT-295. The personal fields of each entity that an audit event records only as changed, never with their value.';


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
    refund_id uuid,
    CONSTRAINT ck_cash_transaction_amount CHECK (((amount > 0) OR ((amount = 0) AND (type = ANY (ARRAY['OpeningFloat'::text, 'ClosingFloat'::text]))))),
    CONSTRAINT ck_cash_transaction_direction CHECK ((direction =
CASE type
    WHEN 'OpeningFloat'::text THEN 'In'::text
    ELSE 'Out'::text
END)),
    CONSTRAINT ck_cash_transaction_refund CHECK (((type = 'RefundFromDrawer'::text) = (refund_id IS NOT NULL))),
    CONSTRAINT ck_cash_transaction_sale CHECK (((type = 'ChangeDisbursed'::text) = (sale_id IS NOT NULL))),
    CONSTRAINT ck_cash_transaction_type CHECK ((type = ANY (ARRAY['OpeningFloat'::text, 'ChangeDisbursed'::text, 'ClosingFloat'::text, 'RefundFromDrawer'::text])))
);


--
-- Name: TABLE cash_transaction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.cash_transaction IS 'Cites: CD-11, CD-18, CD-19, PY-27, RT-135. The drawer''s ledger: every cash movement is a row, never a field update. v1 writes the opening float, change given, cash refunds and the closing float; the other types of cash-management s5 arrive with their flows.';


--
-- Name: CONSTRAINT ck_cash_transaction_amount ON cash_transaction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_cash_transaction_amount ON public.cash_transaction IS 'Cites: CD-14, CD-18. A float may be zero (CD-14); change given is a positive disbursement.';


--
-- Name: CONSTRAINT ck_cash_transaction_direction ON cash_transaction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_cash_transaction_direction ON public.cash_transaction IS 'Cites: CD-19, BI-05. Each type has its fixed direction; an amount is never signed.';


--
-- Name: CONSTRAINT ck_cash_transaction_refund ON cash_transaction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_cash_transaction_refund ON public.cash_transaction IS 'Cites: PY-27. A cash refund, and only a cash refund, names its refund.';


--
-- Name: CONSTRAINT ck_cash_transaction_sale ON cash_transaction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_cash_transaction_sale ON public.cash_transaction IS 'Cites: CD-18. Change given, and only change given, names its sale.';


--
-- Name: CONSTRAINT ck_cash_transaction_type ON cash_transaction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_cash_transaction_type ON public.cash_transaction IS 'Cites: CD-11, CD-18, CD-20, PY-27. The cash transaction types v1 writes (cash-management s5).';


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
-- Name: customer_return; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_return (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    sale_id uuid NOT NULL,
    document_number bigint NOT NULL,
    client_operation_id uuid NOT NULL,
    status text DEFAULT 'Draft'::text NOT NULL,
    business_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid NOT NULL,
    posted_at timestamp with time zone,
    posted_by uuid,
    late_approved_by uuid,
    late_reason_code_id uuid,
    cancel_reason_code_id uuid,
    status_changed_at timestamp with time zone DEFAULT now() NOT NULL,
    status_changed_by uuid NOT NULL,
    correlation_id uuid,
    CONSTRAINT ck_customer_return_cancelled CHECK (((status = 'Cancelled'::text) = (cancel_reason_code_id IS NOT NULL))),
    CONSTRAINT ck_customer_return_late CHECK (((late_approved_by IS NULL) = (late_reason_code_id IS NULL))),
    CONSTRAINT ck_customer_return_late_separation CHECK (((late_approved_by IS NULL) OR ((late_approved_by <> created_by) AND (late_approved_by IS DISTINCT FROM posted_by)))),
    CONSTRAINT ck_customer_return_posted CHECK (((posted_at IS NULL) = (posted_by IS NULL))),
    CONSTRAINT ck_customer_return_posted_when CHECK (((status = ANY (ARRAY['Draft'::text, 'Cancelled'::text])) = (posted_by IS NULL))),
    CONSTRAINT ck_customer_return_status CHECK ((status = ANY (ARRAY['Draft'::text, 'Posted'::text, 'Settled'::text, 'Closed'::text, 'Cancelled'::text])))
);


--
-- Name: TABLE customer_return; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.customer_return IS 'Cites: RR-01, RR-08, RR-13, RR-15, RT-144, RT-148, RT-149. Goods coming back against exactly one sale. Stock moves only when it is posted, and the sold-quantity bound is taken atomically then.';


--
-- Name: CONSTRAINT ck_customer_return_cancelled ON customer_return; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_customer_return_cancelled ON public.customer_return IS 'Cites: SM-42, BI-25. A return is cancelled with a reason, and only a cancelled return carries one.';


--
-- Name: CONSTRAINT ck_customer_return_late ON customer_return; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_customer_return_late ON public.customer_return IS 'Cites: RR-11. A late return is approved by someone, for a reason, together.';


--
-- Name: CONSTRAINT ck_customer_return_late_separation ON customer_return; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_customer_return_late_separation ON public.customer_return IS 'Cites: AP-08, BI-26. The approver of a late return is neither the employee who opened it nor the one who posts it.';


--
-- Name: CONSTRAINT ck_customer_return_posted ON customer_return; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_customer_return_posted ON public.customer_return IS 'Cites: SM-03. Posting records who and when together.';


--
-- Name: CONSTRAINT ck_customer_return_posted_when ON customer_return; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_customer_return_posted_when ON public.customer_return IS 'Cites: BI-27, SM-03. A return records who posted it exactly when it has been posted.';


--
-- Name: CONSTRAINT ck_customer_return_status ON customer_return; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_customer_return_status ON public.customer_return IS 'Cites: SM-43a. The return states of returns-refunds s12.1; a refusal is Cancelled from Draft (SM-42).';


--
-- Name: customer_return_line; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_return_line (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_return_id uuid NOT NULL,
    store_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    sale_id uuid NOT NULL,
    sale_line_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    quantity numeric(18,4) NOT NULL,
    disposition text NOT NULL,
    storage_location_id uuid NOT NULL,
    client_operation_id uuid NOT NULL,
    CONSTRAINT ck_customer_return_line_disposition CHECK ((disposition = ANY (ARRAY['Sellable'::text, 'Quarantine'::text, 'Damaged'::text, 'Expired'::text]))),
    CONSTRAINT ck_customer_return_line_quantity CHECK ((quantity > (0)::numeric))
);


--
-- Name: TABLE customer_return_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.customer_return_line IS 'Cites: RR-08, RR-14, RR-16, RR-17, RR-19, BI-17, RT-151. One returned quantity of one sold line, with its mandatory disposition and the location that disposition sends it to.';


--
-- Name: CONSTRAINT ck_customer_return_line_disposition ON customer_return_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_customer_return_line_disposition ON public.customer_return_line IS 'Cites: RR-17, BI-17. Every return line resolves to exactly one of the four dispositions.';


--
-- Name: CONSTRAINT ck_customer_return_line_quantity ON customer_return_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_customer_return_line_quantity ON public.customer_return_line IS 'Cites: BI-05. A returned quantity is positive.';


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
-- Name: employee; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    employee_number public.nonblank_text NOT NULL,
    first_name public.nonblank_text NOT NULL,
    last_name public.nonblank_text NOT NULL,
    preferred_name public.nonblank_text,
    email public.nonblank_text,
    phone public.nonblank_text,
    start_date date,
    employment_type public.nonblank_text,
    home_store_id uuid,
    department public.nonblank_text,
    "position" public.nonblank_text,
    status text DEFAULT 'Active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status_changed_at timestamp with time zone DEFAULT now() NOT NULL,
    status_changed_by uuid NOT NULL,
    CONSTRAINT ck_employee_status CHECK ((status = ANY (ARRAY['Active'::text, 'OnLeave'::text, 'Suspended'::text, 'Terminated'::text, 'Archived'::text])))
);


--
-- Name: TABLE employee; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.employee IS 'Cites: EM-01, EM-05, EM-06, EM-08, EM-11, SM-48, SM-48a, RT-009. A person the organization employs, with or without a login. Kept for ever once created: documents name their employees, and a terminated employee stays answerable for what they did (never a delete).';


--
-- Name: CONSTRAINT ck_employee_status ON employee; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_employee_status ON public.employee IS 'Cites: SM-48a, EM-09. The employee statuses of employee-domain s3, verbatim.';


--
-- Name: employee_role_assignment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_role_assignment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    role_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    store_id uuid,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_by uuid NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    CONSTRAINT ck_employee_role_assignment_revoked CHECK (((revoked_at IS NULL) = (revoked_by IS NULL)))
);


--
-- Name: TABLE employee_role_assignment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.employee_role_assignment IS 'Cites: MS-11, MS-12, EM-13, RT-020. Which role an employee holds, and where: organization-wide (no store) or in one store. An organization-wide assignment broadens the stores a role applies to and never bypasses store access or default deny.';


--
-- Name: CONSTRAINT ck_employee_role_assignment_revoked ON employee_role_assignment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_employee_role_assignment_revoked ON public.employee_role_assignment IS 'Cites: RT-020, SM-03. A removal records who and when together.';


--
-- Name: employee_store_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_store_access (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    store_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    valid_from timestamp with time zone,
    valid_to timestamp with time zone,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    granted_by uuid NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    CONSTRAINT ck_employee_store_access_revoked CHECK (((revoked_at IS NULL) = (revoked_by IS NULL))),
    CONSTRAINT ck_employee_store_access_window CHECK (((valid_to IS NULL) OR (valid_from IS NULL) OR (valid_to > valid_from)))
);


--
-- Name: TABLE employee_store_access; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.employee_store_access IS 'Cites: EM-12, EM-13, EM-14, EM-15, MS-03, RT-002. An employee''s access to a store, with optional dates. Access and a role are separate facts, and a role without access grants nothing. Revocation records a fact and keeps the row, so the scope before and after is recoverable (not yet an audit event: OQ-025).';


--
-- Name: CONSTRAINT ck_employee_store_access_revoked ON employee_store_access; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_employee_store_access_revoked ON public.employee_store_access IS 'Cites: EM-15, SM-03. A revocation records who and when together.';


--
-- Name: CONSTRAINT ck_employee_store_access_window ON employee_store_access; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_employee_store_access_window ON public.employee_store_access IS 'Cites: EM-12. The optional access window ends after it starts.';


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
    customer_return_id uuid,
    customer_return_line_id uuid,
    disposition text,
    CONSTRAINT ck_inventory_movement_adjustment_pair CHECK (((stock_adjustment_id IS NULL) = (stock_adjustment_line_id IS NULL))),
    CONSTRAINT ck_inventory_movement_one_cause CHECK ((num_nonnulls(stock_adjustment_line_id, sale_line_id, customer_return_line_id) = 1)),
    CONSTRAINT ck_inventory_movement_positive CHECK ((quantity > (0)::numeric)),
    CONSTRAINT ck_inventory_movement_return_triple CHECK ((num_nulls(customer_return_id, customer_return_line_id, disposition) = ANY (ARRAY[0, 3]))),
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

COMMENT ON CONSTRAINT ck_inventory_movement_one_cause ON public.inventory_movement IS 'Cites: BI-03, RT-060, IV-14. Exactly one causing document line: an adjustment line, a sale line or a return line. Later domains add their line columns to this count.';


--
-- Name: CONSTRAINT ck_inventory_movement_positive ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_inventory_movement_positive ON public.inventory_movement IS 'Cites: BI-05. A movement quantity is positive; its effect''s sign comes from its direction.';


--
-- Name: CONSTRAINT ck_inventory_movement_return_triple ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_inventory_movement_return_triple ON public.inventory_movement IS 'Cites: BI-03, BE-36. A return line is always named with its return and its disposition, and a disposition only with a return line.';


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
    refunded_amount bigint DEFAULT 0 NOT NULL,
    CONSTRAINT ck_payment_positive CHECK ((amount > 0)),
    CONSTRAINT ck_payment_provider_outcome CHECK ((provider_outcome = ANY (ARRAY['Approved'::text, 'Declined'::text, 'Pending'::text, 'Failed'::text, 'Errored'::text, 'Timeout'::text]))),
    CONSTRAINT ck_payment_refunded CHECK (((refunded_amount >= 0) AND (refunded_amount <= amount) AND ((refunded_amount = 0) OR (status = 'Captured'::text)))),
    CONSTRAINT ck_payment_sequence CHECK ((sequence_number >= 1)),
    CONSTRAINT ck_payment_status CHECK ((status = ANY (ARRAY['Pending'::text, 'Authorized'::text, 'Captured'::text, 'Declined'::text, 'Voided'::text, 'Failed'::text]))),
    CONSTRAINT ck_payment_tendered CHECK ((((method_type = 'Cash'::text) AND (tendered_amount IS NOT NULL) AND (tendered_amount >= amount)) OR ((method_type <> 'Cash'::text) AND (tendered_amount IS NULL))))
);


--
-- Name: TABLE payment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.payment IS 'Cites: PY-02, PY-12, PY-42, PY-46, PY-54, D-14, ADR-09. One payment attempt: the amount applied to the sale, never the amount handed over. Every attempt is its own row; a retry is a new row, and Captured, Declined, Voided and Failed are terminal for the row.';


--
-- Name: COLUMN payment.refunded_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payment.refunded_amount IS 'Cites: PY-22, PY-23, RR-24, D-18. What refunds that have no sale are holding back to this payment: raised when such a refund enters Processing, kept through Failed and Completed, lowered only by a cancellation. Written only by the owner''s hold trigger; never more than the payment took. A refund of a sold line is bounded on the line, not here.';


--
-- Name: CONSTRAINT ck_payment_positive ON payment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_payment_positive ON public.payment IS 'Cites: PY-02, SP-39. A tender applies a positive amount. The zero-value payment of a credit sale (PY-01) arrives with credit.';


--
-- Name: CONSTRAINT ck_payment_provider_outcome ON payment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_payment_provider_outcome ON public.payment IS 'Cites: PY-10, PY-11. The provider''s response normalised to six outcomes; the raw code is kept beside it.';


--
-- Name: CONSTRAINT ck_payment_refunded ON payment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_payment_refunded ON public.payment IS 'Cites: PY-22, BI-10, D-18. A payment never gives back more than it took, and only a captured payment gives anything back.';


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
-- Name: permission; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permission (
    key public.nonblank_text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_permission_key CHECK (((key)::text ~ '^[A-Z][A-Za-z]*(\.[A-Z][A-Za-z]*)+$'::text))
);


--
-- Name: TABLE permission; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.permission IS 'Cites: AC-02, D-01, RT-009. The permission catalogue of actors-and-roles s2: 117 opaque dotted keys, matched only for equality. A key is added only by a migration.';


--
-- Name: CONSTRAINT ck_permission_key ON permission; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_permission_key ON public.permission IS 'Cites: AC-02. A key is a dotted name of capitalised parts; there are no wildcards.';


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
-- Name: receipt_reprint; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.receipt_reprint (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sale_id uuid NOT NULL,
    store_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    reason_code_id uuid NOT NULL,
    reprinted_at timestamp with time zone DEFAULT now() NOT NULL,
    reprinted_by uuid NOT NULL
);


--
-- Name: TABLE receipt_reprint; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.receipt_reprint IS 'Cites: SP-57, SP-58, RT-140, UX-22, BI-25. One reprint of a sale''s receipt: who, when and why. The copy repeats the stored sale''s numbers under a reprint banner (SP-57); a failed first print is recovered this way (SP-58). The reason is mandatory by the owner''s instruction of 2026-10-01.';


--
-- Name: refund; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refund (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    sale_id uuid,
    customer_return_id uuid,
    document_number bigint NOT NULL,
    client_operation_id uuid NOT NULL,
    method text NOT NULL,
    payment_id uuid,
    disbursement text NOT NULL,
    pos_terminal_id uuid,
    cash_drawer_id uuid,
    cash_shift_id uuid,
    amount bigint NOT NULL,
    tax_amount bigint NOT NULL,
    currency_code text NOT NULL,
    reason_code_id uuid,
    cancel_reason_code_id uuid,
    status text DEFAULT 'Draft'::text NOT NULL,
    provider_transaction_reference text,
    provider_outcome text,
    provider_raw_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid NOT NULL,
    submitted_at timestamp with time zone,
    submitted_by uuid,
    approved_at timestamp with time zone,
    approved_by uuid,
    status_changed_at timestamp with time zone DEFAULT now() NOT NULL,
    status_changed_by uuid NOT NULL,
    correlation_id uuid,
    CONSTRAINT ck_refund_amounts CHECK (((amount > 0) AND (tax_amount >= 0) AND (tax_amount <= amount))),
    CONSTRAINT ck_refund_approved CHECK (((approved_at IS NULL) = (approved_by IS NULL))),
    CONSTRAINT ck_refund_approved_when CHECK (((status <> ALL (ARRAY['Approved'::text, 'Processing'::text, 'Completed'::text, 'Failed'::text])) OR (approved_by IS NOT NULL))),
    CONSTRAINT ck_refund_cancelled CHECK (((status = 'Cancelled'::text) = (cancel_reason_code_id IS NOT NULL))),
    CONSTRAINT ck_refund_disbursement CHECK ((disbursement = ANY (ARRAY['Drawer'::text, 'Provider'::text]))),
    CONSTRAINT ck_refund_drawer CHECK (((disbursement = 'Drawer'::text) = (cash_shift_id IS NOT NULL))),
    CONSTRAINT ck_refund_goodwill_reason CHECK (((customer_return_id IS NOT NULL) OR (reason_code_id IS NOT NULL))),
    CONSTRAINT ck_refund_method CHECK ((method = ANY (ARRAY['OriginalTender'::text, 'Cash'::text]))),
    CONSTRAINT ck_refund_method_payment CHECK (((method = 'OriginalTender'::text) = (payment_id IS NOT NULL))),
    CONSTRAINT ck_refund_provider_outcome CHECK ((provider_outcome = ANY (ARRAY['Approved'::text, 'Declined'::text, 'Pending'::text, 'Failed'::text, 'Errored'::text, 'Timeout'::text]))),
    CONSTRAINT ck_refund_sale_or_payment CHECK (((sale_id IS NOT NULL) OR ((method = 'OriginalTender'::text) AND (payment_id IS NOT NULL) AND (customer_return_id IS NULL) AND (tax_amount = 0) AND (reason_code_id IS NOT NULL)))),
    CONSTRAINT ck_refund_separation CHECK (((approved_by IS NULL) OR ((approved_by <> created_by) AND (approved_by <> submitted_by)))),
    CONSTRAINT ck_refund_status CHECK ((status = ANY (ARRAY['Draft'::text, 'PendingApproval'::text, 'Approved'::text, 'Processing'::text, 'Completed'::text, 'Failed'::text, 'Cancelled'::text]))),
    CONSTRAINT ck_refund_submitted CHECK (((submitted_at IS NULL) = (submitted_by IS NULL))),
    CONSTRAINT ck_refund_submitted_when CHECK (((status = 'Draft'::text) OR (submitted_by IS NOT NULL) OR ((status = 'Cancelled'::text) AND (approved_by IS NULL)))),
    CONSTRAINT ck_refund_till CHECK ((num_nulls(pos_terminal_id, cash_drawer_id, cash_shift_id) = ANY (ARRAY[0, 3])))
);


--
-- Name: TABLE refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.refund IS 'Cites: RR-01, RR-03, RR-22, RR-23, RR-24, RR-35, RR-43, PY-21, PY-22, PY-23, PY-25, PY-26, PY-27, BI-09, BI-10, RT-144, RT-145, RT-154, RT-157. Money going back: a new, linked document with its own lifecycle, bounded per line by what each line settled and holding its amount while in flight. Linked to a return where there is one; without one it is a goodwill refund and carries a reason.';


--
-- Name: CONSTRAINT ck_refund_amounts ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_refund_amounts ON public.refund IS 'Cites: RR-06, RR-43, BI-10. A refund is positive and carries its own tax total, which is part of it.';


--
-- Name: CONSTRAINT ck_refund_approved ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_refund_approved ON public.refund IS 'Cites: SM-03, BI-26. Approval records who and when together.';


--
-- Name: CONSTRAINT ck_refund_approved_when ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_refund_approved_when ON public.refund IS 'Cites: BI-27, RR-35. No refund is processed, completed or failed without an approver on record.';


--
-- Name: CONSTRAINT ck_refund_cancelled ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_refund_cancelled ON public.refund IS 'Cites: BI-25, SM-40. A refund is cancelled with a reason, and only a cancelled refund carries one.';


--
-- Name: CONSTRAINT ck_refund_disbursement ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_refund_disbursement ON public.refund IS 'Cites: RR-23, PY-25, PY-27. The money leaves through the drawer or through the provider.';


--
-- Name: CONSTRAINT ck_refund_drawer ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_refund_drawer ON public.refund IS 'Cites: PY-27, CD-19. A drawer refund names the shift it is paid in; a provider refund names none.';


--
-- Name: CONSTRAINT ck_refund_goodwill_reason ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_refund_goodwill_reason ON public.refund IS 'Cites: RR-35, PY-26, RT-157. A refund with no return is a goodwill refund and always carries a reason.';


--
-- Name: CONSTRAINT ck_refund_method ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_refund_method ON public.refund IS 'Cites: RR-22. The refund methods v1 pays: back to the original tender, or cash out of the drawer. Store credit and exchange arrive with customer credit.';


--
-- Name: CONSTRAINT ck_refund_method_payment ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_refund_method_payment ON public.refund IS 'Cites: RR-22, RR-23. A refund to the original tender names that tender, and only such a refund does.';


--
-- Name: CONSTRAINT ck_refund_provider_outcome ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_refund_provider_outcome ON public.refund IS 'Cites: PY-10. The provider''s response normalised, with the raw code kept.';


--
-- Name: CONSTRAINT ck_refund_sale_or_payment ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_refund_sale_or_payment ON public.refund IS 'Cites: RR-01, RR-35, PY-21, PY-37, D-18. A refund is of a sale, or it is the return to the card of a payment that never became one: then it names that payment, has no return and no tax (no sale charged any), and a reason (it is goodwill in the sense of RR-35). Its lines cannot exist: a line names a sale.';


--
-- Name: CONSTRAINT ck_refund_separation ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_refund_separation ON public.refund IS 'Cites: BI-26, AP-08, RR-35. The approver is neither the employee who drafted the refund nor the one who submitted it (s22.7: approver differs from issuer).';


--
-- Name: CONSTRAINT ck_refund_status ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_refund_status ON public.refund IS 'Cites: SM-43a, SM-40, SM-41. The refund states of returns-refunds s12.2.';


--
-- Name: CONSTRAINT ck_refund_submitted ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_refund_submitted ON public.refund IS 'Cites: SM-03. Submission records who and when together.';


--
-- Name: CONSTRAINT ck_refund_submitted_when ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_refund_submitted_when ON public.refund IS 'Cites: SM-03, D-17. Every refund past Draft records who submitted it, except a withdrawn draft, which was never submitted.';


--
-- Name: CONSTRAINT ck_refund_till ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_refund_till ON public.refund IS 'Cites: PY-27, RT-122. The till, drawer and shift of a drawer refund are named together, or not at all.';


--
-- Name: refund_line; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refund_line (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    refund_id uuid NOT NULL,
    store_id uuid NOT NULL,
    sale_id uuid NOT NULL,
    sale_line_id uuid NOT NULL,
    amount bigint NOT NULL,
    tax_amount bigint NOT NULL,
    CONSTRAINT ck_refund_line_amounts CHECK (((amount > 0) AND (tax_amount >= 0) AND (tax_amount <= amount)))
);


--
-- Name: TABLE refund_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.refund_line IS 'Cites: RR-03, RR-06, RR-42, RR-43, RT-161. The refund''s allocation to the sold lines, each with its tax taken from the line''s stored tax; these are the refund''s own tax lines.';


--
-- Name: CONSTRAINT ck_refund_line_amounts ON refund_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_refund_line_amounts ON public.refund_line IS 'Cites: RR-05, RR-06. A positive amount (a free item refunds nothing), with its tax part.';


--
-- Name: role; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name public.nonblank_text NOT NULL,
    description public.nonblank_text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    archived_by uuid,
    CONSTRAINT ck_role_archival CHECK (((archived_at IS NULL) = (archived_by IS NULL)))
);


--
-- Name: TABLE role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.role IS 'Cites: AC-01, AC-04, EM-06, RT-009. A named permission set of the organization. Custom roles are permitted; templates are a starting point (actors-and-roles s4, OQ-025), and there are no nested roles.';


--
-- Name: CONSTRAINT ck_role_archival ON role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_role_archival ON public.role IS 'Cites: BI-40. An archived role records who and when together; a role is never deleted.';


--
-- Name: role_permission; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permission (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    role_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    permission_key text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    granted_by uuid NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    CONSTRAINT ck_role_permission_revoked CHECK (((revoked_at IS NULL) = (revoked_by IS NULL)))
);


--
-- Name: TABLE role_permission; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.role_permission IS 'Cites: AC-02, PC-01, D-01, RT-020. A permission granted to a role: an exact catalogue key, never a pattern. Removing it records a revocation and keeps the row, so a role''s before and after permission sets are always recoverable.';


--
-- Name: CONSTRAINT ck_role_permission_revoked ON role_permission; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_role_permission_revoked ON public.role_permission IS 'Cites: PC-01, SM-03. A revocation records who and when together.';


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
    refunded_tax_amount bigint DEFAULT 0 NOT NULL,
    CONSTRAINT ck_sale_line_cost CHECK ((unit_cost >= 0)),
    CONSTRAINT ck_sale_line_entry CHECK ((((entry_method = 'Scanned'::text) AND (scanned_barcode IS NOT NULL)) OR ((entry_method = 'Selected'::text) AND (scanned_barcode IS NULL)))),
    CONSTRAINT ck_sale_line_gross CHECK (((gross_amount)::numeric = round((quantity * (unit_price)::numeric)))),
    CONSTRAINT ck_sale_line_number CHECK ((line_number >= 1)),
    CONSTRAINT ck_sale_line_price CHECK ((unit_price > 0)),
    CONSTRAINT ck_sale_line_quantity CHECK ((quantity > (0)::numeric)),
    CONSTRAINT ck_sale_line_refunded CHECK (((refunded_amount >= 0) AND (refunded_amount <= settled_amount))),
    CONSTRAINT ck_sale_line_refunded_tax CHECK (((refunded_tax_amount >= 0) AND (refunded_tax_amount <= tax_amount))),
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
-- Name: CONSTRAINT ck_sale_line_refunded_tax ON sale_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_sale_line_refunded_tax ON public.sale_line IS 'Cites: RR-06, RR-42, RT-161. The tax refunded against a line never exceeds the tax it was charged.';


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
    audit_event_type text,
    requires_reason boolean DEFAULT false NOT NULL,
    permission_rule text NOT NULL,
    permission_key text,
    CONSTRAINT ck_state_machine_edge_not_loop CHECK (((from_state)::text <> (to_state)::text)),
    CONSTRAINT ck_state_machine_edge_permission CHECK (((permission_rule = ANY (ARRAY['Key'::text, 'System'::text, 'OpenDecision'::text])) AND ((permission_rule = 'Key'::text) = (permission_key IS NOT NULL))))
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
-- Name: CONSTRAINT ck_state_machine_edge_permission ON state_machine_edge; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_state_machine_edge_permission ON public.state_machine_edge IS 'Cites: SM-02d, D-01, AC-01. What authorizes an edge (the s22 Permission column): a catalogue key; the system (a provider, telemetry); or OPEN DECISION, which the one authorization gate refuses until the owner names a key (architecture s8.4).';


--
-- Name: state_machine_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.state_machine_state (
    machine public.nonblank_text NOT NULL,
    state public.nonblank_text NOT NULL,
    is_initial boolean NOT NULL,
    creation_audit_event_type text,
    creation_permission_rule text,
    creation_permission_key text,
    CONSTRAINT ck_state_machine_state_permission CHECK (((creation_permission_rule = ANY (ARRAY['Key'::text, 'System'::text, 'OpenDecision'::text])) AND ((creation_permission_rule = 'Key'::text) = (creation_permission_key IS NOT NULL))))
);


--
-- Name: TABLE state_machine_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.state_machine_state IS 'Cites: SM-07, ADR-19, ADR-21. The closed state set of each lifecycle machine; a state is added only by a reviewed migration.';


--
-- Name: CONSTRAINT ck_state_machine_state_permission ON state_machine_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_state_machine_state_permission ON public.state_machine_state IS 'Cites: SM-02d, D-01. What authorizes a creation, where s22 contracts one: a catalogue key, the system, or an undecided key, which refuses.';


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
    CONSTRAINT ck_storage_location_type CHECK ((location_type = ANY (ARRAY['Default'::text, 'Receiving'::text, 'Quarantine'::text, 'Damaged'::text, 'ReturnsPending'::text, 'Transit'::text, 'ExpiredHold'::text])))
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

COMMENT ON CONSTRAINT ck_storage_location_type ON public.storage_location IS 'Cites: WH-04, RT-510, BE-24, BE-36. The standard location types of organization-model s5, plus ExpiredHold, where an Expired disposition goes (batch-expiry-fefo s6; organization-model s5 names the IsExpiredHold flag).';


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
    return_window_days smallint DEFAULT 30 NOT NULL,
    default_return_disposition text DEFAULT 'Quarantine'::text NOT NULL,
    CONSTRAINT ck_store_setting_version_negative_stock CHECK ((negative_stock_policy = ANY (ARRAY['AllowNegative'::text, 'BlockNegative'::text]))),
    CONSTRAINT ck_store_setting_version_prospective CHECK ((effective_from >= created_at)),
    CONSTRAINT ck_store_setting_version_return_disposition CHECK ((default_return_disposition = ANY (ARRAY['Sellable'::text, 'Quarantine'::text]))),
    CONSTRAINT ck_store_setting_version_return_window CHECK ((return_window_days >= 0)),
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
-- Name: CONSTRAINT ck_store_setting_version_return_disposition ON store_setting_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_store_setting_version_return_disposition ON public.store_setting_version IS 'Cites: RR-18, BI-17. The disposition the return screen pre-fills and never applies by itself: Sellable or Quarantine (organization-model s3), Quarantine unless set, as Quarantine holds customer returns by default (organization-model s5).';


--
-- Name: CONSTRAINT ck_store_setting_version_return_window ON store_setting_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_store_setting_version_return_window ON public.store_setting_version IS 'Cites: RR-10, RT-150. The return window is a store setting in days, measured on the business date; the documented default is 30.';


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
-- Name: user_account; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_account (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    username public.nonblank_text NOT NULL,
    password_hash text NOT NULL,
    password_changed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_user_account_password_hash CHECK (((password_hash ~ '^\$argon2id\$'::text) OR (password_hash ~ '^\$2[aby]\$(1[2-9]|[23][0-9])\$'::text)))
);


--
-- Name: TABLE user_account; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_account IS 'Cites: EM-01, EM-02, EM-04, RT-293. A login credential, optional for an employee and belonging to exactly one. The password is kept only as a slow salted hash made by the application.';


--
-- Name: CONSTRAINT ck_user_account_password_hash ON user_account; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_user_account_password_hash ON public.user_account IS 'Cites: EM-04, ADR-12. Only an Argon2id hash, or a bcrypt hash of cost 12 or more, is stored (architecture s7.3); a password is never stored in a form that could be shown.';


--
-- Name: user_session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_session (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    user_account_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    token_hash bytea NOT NULL,
    pos_terminal_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    end_reason text,
    CONSTRAINT ck_user_session_end CHECK (((ended_at IS NULL) = (end_reason IS NULL))),
    CONSTRAINT ck_user_session_end_reason CHECK ((end_reason = ANY (ARRAY['Logout'::text, 'Expired'::text, 'Revoked'::text, 'Rotated'::text]))),
    CONSTRAINT ck_user_session_expiry CHECK ((expires_at > created_at)),
    CONSTRAINT ck_user_session_token CHECK ((octet_length(token_hash) = 32))
);


--
-- Name: TABLE user_session; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_session IS 'Cites: ADR-12, AU-12a, EM-16, RT-293. A server-held session (architecture s7.1): only a hash of its opaque token is kept, so a copy of the database cannot be replayed as a login. Ended once, with the cause, and kept.';


--
-- Name: CONSTRAINT ck_user_session_end ON user_session; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_user_session_end ON public.user_session IS 'Cites: AU-12a, SM-03. An end records when and why together.';


--
-- Name: CONSTRAINT ck_user_session_end_reason ON user_session; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_user_session_end_reason ON public.user_session IS 'Cites: AU-12a, EM-16, SM-47. A sign-out is Logout; an expiry, a revocation (suspension, access removed) or a rotation on a privilege change are session ends with their cause (architecture s7.1).';


--
-- Name: CONSTRAINT ck_user_session_expiry ON user_session; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_user_session_expiry ON public.user_session IS 'Cites: ADR-12. A session expires after it starts.';


--
-- Name: CONSTRAINT ck_user_session_token ON user_session; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ck_user_session_token ON public.user_session IS 'Cites: ADR-12. The token is kept as its SHA-256 hash, never itself.';


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
-- Name: audit_chain_head pk_audit_chain_head; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_chain_head
    ADD CONSTRAINT pk_audit_chain_head PRIMARY KEY (organization_id);


--
-- Name: audit_chain_link pk_audit_chain_link; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_chain_link
    ADD CONSTRAINT pk_audit_chain_link PRIMARY KEY (organization_id, chain_seq);


--
-- Name: audit_event pk_audit_event; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_event
    ADD CONSTRAINT pk_audit_event PRIMARY KEY (id);


--
-- Name: audit_event_type pk_audit_event_type; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_event_type
    ADD CONSTRAINT pk_audit_event_type PRIMARY KEY (code);


--
-- Name: audit_redacted_field pk_audit_redacted_field; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_redacted_field
    ADD CONSTRAINT pk_audit_redacted_field PRIMARY KEY (entity_type, field);


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
-- Name: customer_return pk_customer_return; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_return
    ADD CONSTRAINT pk_customer_return PRIMARY KEY (id);


--
-- Name: customer_return_line pk_customer_return_line; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_return_line
    ADD CONSTRAINT pk_customer_return_line PRIMARY KEY (id);


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
-- Name: employee pk_employee; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee
    ADD CONSTRAINT pk_employee PRIMARY KEY (id);


--
-- Name: employee_role_assignment pk_employee_role_assignment; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_role_assignment
    ADD CONSTRAINT pk_employee_role_assignment PRIMARY KEY (id);


--
-- Name: employee_store_access pk_employee_store_access; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_store_access
    ADD CONSTRAINT pk_employee_store_access PRIMARY KEY (id);


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
-- Name: permission pk_permission; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission
    ADD CONSTRAINT pk_permission PRIMARY KEY (key);


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
-- Name: receipt_reprint pk_receipt_reprint; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt_reprint
    ADD CONSTRAINT pk_receipt_reprint PRIMARY KEY (id);


--
-- Name: refund pk_refund; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund
    ADD CONSTRAINT pk_refund PRIMARY KEY (id);


--
-- Name: refund_line pk_refund_line; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_line
    ADD CONSTRAINT pk_refund_line PRIMARY KEY (id);


--
-- Name: role pk_role; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role
    ADD CONSTRAINT pk_role PRIMARY KEY (id);


--
-- Name: role_permission pk_role_permission; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permission
    ADD CONSTRAINT pk_role_permission PRIMARY KEY (id);


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
-- Name: user_account pk_user_account; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_account
    ADD CONSTRAINT pk_user_account PRIMARY KEY (id);


--
-- Name: user_session pk_user_session; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_session
    ADD CONSTRAINT pk_user_session PRIMARY KEY (id);


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
-- Name: audit_chain_link uq_audit_chain_link_event; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_chain_link
    ADD CONSTRAINT uq_audit_chain_link_event UNIQUE (audit_event_id);


--
-- Name: CONSTRAINT uq_audit_chain_link_event ON audit_chain_link; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_audit_chain_link_event ON public.audit_chain_link IS 'Cites: AU-29. An event is linked once.';


--
-- Name: audit_event uq_audit_event_seq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_event
    ADD CONSTRAINT uq_audit_event_seq UNIQUE (seq);


--
-- Name: CONSTRAINT uq_audit_event_seq ON audit_event; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_audit_event_seq ON public.audit_event IS 'Cites: AU-01. The order events were written in.';


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
-- Name: cash_transaction uq_cash_transaction_refund; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_transaction
    ADD CONSTRAINT uq_cash_transaction_refund UNIQUE (refund_id);


--
-- Name: CONSTRAINT uq_cash_transaction_refund ON cash_transaction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_cash_transaction_refund ON public.cash_transaction IS 'Cites: PY-27, BI-28. A refund is paid out of the drawer once.';


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
-- Name: customer_return uq_customer_return_id_store; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_return
    ADD CONSTRAINT uq_customer_return_id_store UNIQUE (id, store_id);


--
-- Name: CONSTRAINT uq_customer_return_id_store ON customer_return; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_customer_return_id_store ON public.customer_return IS 'Cites: RT-001, BI-14. Lets a movement prove, by foreign key, that it belongs to the return''s store.';


--
-- Name: customer_return uq_customer_return_identity; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_return
    ADD CONSTRAINT uq_customer_return_identity UNIQUE (id, sale_id, store_id);


--
-- Name: CONSTRAINT uq_customer_return_identity ON customer_return; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_customer_return_identity ON public.customer_return IS 'Cites: RR-13, SM-39. Lets a return line or a refund prove, by foreign key, that it concerns the return''s one sale and store.';


--
-- Name: customer_return_line uq_customer_return_line_identity; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_return_line
    ADD CONSTRAINT uq_customer_return_line_identity UNIQUE (id, customer_return_id, variant_id, storage_location_id, disposition);


--
-- Name: CONSTRAINT uq_customer_return_line_identity ON customer_return_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_customer_return_line_identity ON public.customer_return_line IS 'Cites: BI-03, RT-096. Lets a movement prove, by foreign key, that it applies this line''s variant at this line''s location, naming this line''s disposition.';


--
-- Name: customer_return_line uq_customer_return_line_operation; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_return_line
    ADD CONSTRAINT uq_customer_return_line_operation UNIQUE (store_id, client_operation_id);


--
-- Name: CONSTRAINT uq_customer_return_line_operation ON customer_return_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_customer_return_line_operation ON public.customer_return_line IS 'Cites: RR-16, BI-07. Each return line carries its own operation reference, so a retried line is not re-applied.';


--
-- Name: customer_return uq_customer_return_number; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_return
    ADD CONSTRAINT uq_customer_return_number UNIQUE (store_id, document_number);


--
-- Name: CONSTRAINT uq_customer_return_number ON customer_return; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_customer_return_number ON public.customer_return IS 'Cites: BI-42, RT-479. The return number is unique per store and never reused.';


--
-- Name: customer_return uq_customer_return_operation; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_return
    ADD CONSTRAINT uq_customer_return_operation UNIQUE (store_id, client_operation_id);


--
-- Name: CONSTRAINT uq_customer_return_operation ON customer_return; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_customer_return_operation ON public.customer_return IS 'Cites: RR-15, BI-07, RT-149. A return is processed exactly once: a replay with the same operation id finds the original.';


--
-- Name: employee uq_employee_id_organization; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee
    ADD CONSTRAINT uq_employee_id_organization UNIQUE (id, organization_id);


--
-- Name: CONSTRAINT uq_employee_id_organization ON employee; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_employee_id_organization ON public.employee IS 'Cites: BI-14. Lets an account, assignment or grant prove, by foreign key, that its employee is of its organization.';


--
-- Name: employee uq_employee_number; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee
    ADD CONSTRAINT uq_employee_number UNIQUE (organization_id, employee_number);


--
-- Name: CONSTRAINT uq_employee_number ON employee; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_employee_number ON public.employee IS 'Cites: EM-05. The employee number is unique per organization (employee-domain s2).';


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
-- Name: inventory_movement uq_inventory_movement_return_line; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movement
    ADD CONSTRAINT uq_inventory_movement_return_line UNIQUE (customer_return_line_id);


--
-- Name: CONSTRAINT uq_inventory_movement_return_line ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_inventory_movement_return_line ON public.inventory_movement IS 'Cites: BI-07, RR-15, RT-149. A return line brings its goods back once; a posted return is never reversed (SM-38).';


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
-- Name: pos_terminal uq_pos_terminal_id_organization; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_terminal
    ADD CONSTRAINT uq_pos_terminal_id_organization UNIQUE (id, organization_id);


--
-- Name: CONSTRAINT uq_pos_terminal_id_organization ON pos_terminal; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_pos_terminal_id_organization ON public.pos_terminal IS 'Cites: BI-14. Lets a till session prove, by foreign key, that its terminal is of its organization.';


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
-- Name: refund uq_refund_id_sale; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund
    ADD CONSTRAINT uq_refund_id_sale UNIQUE (id, sale_id);


--
-- Name: CONSTRAINT uq_refund_id_sale ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_refund_id_sale ON public.refund IS 'Cites: RR-03. Lets a refund line prove, by foreign key, that it refunds the refund''s own sale.';


--
-- Name: refund uq_refund_id_shift; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund
    ADD CONSTRAINT uq_refund_id_shift UNIQUE (id, cash_shift_id);


--
-- Name: CONSTRAINT uq_refund_id_shift ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_refund_id_shift ON public.refund IS 'Cites: PY-27. Lets the drawer payout prove, by foreign key, that it is in the refund''s shift.';


--
-- Name: refund_line uq_refund_line_per_sale_line; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_line
    ADD CONSTRAINT uq_refund_line_per_sale_line UNIQUE (refund_id, sale_line_id);


--
-- Name: CONSTRAINT uq_refund_line_per_sale_line ON refund_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_refund_line_per_sale_line ON public.refund_line IS 'Cites: RR-03. One allocation per sold line per refund.';


--
-- Name: refund uq_refund_number; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund
    ADD CONSTRAINT uq_refund_number UNIQUE (store_id, document_number);


--
-- Name: CONSTRAINT uq_refund_number ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_refund_number ON public.refund IS 'Cites: BI-42, RT-479. The refund number is unique per store and never reused.';


--
-- Name: refund uq_refund_operation; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund
    ADD CONSTRAINT uq_refund_operation UNIQUE (store_id, client_operation_id);


--
-- Name: CONSTRAINT uq_refund_operation ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_refund_operation ON public.refund IS 'Cites: BI-28, PY-39. A refund request replayed with the same operation id finds the original.';


--
-- Name: refund uq_refund_provider_reference; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund
    ADD CONSTRAINT uq_refund_provider_reference UNIQUE (provider_transaction_reference);


--
-- Name: CONSTRAINT uq_refund_provider_reference ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_refund_provider_reference ON public.refund IS 'Cites: PY-15, RT-480. A provider refund transaction is recorded once.';


--
-- Name: role uq_role_id_organization; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role
    ADD CONSTRAINT uq_role_id_organization UNIQUE (id, organization_id);


--
-- Name: CONSTRAINT uq_role_id_organization ON role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_role_id_organization ON public.role IS 'Cites: BI-14. Lets a grant or assignment prove, by foreign key, that its role is of its organization.';


--
-- Name: role uq_role_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role
    ADD CONSTRAINT uq_role_name UNIQUE (organization_id, name);


--
-- Name: CONSTRAINT uq_role_name ON role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_role_name ON public.role IS 'Cites: AC-04. A role name identifies one role in its organization.';


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
-- Name: sale_line uq_sale_line_id_sale; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_line
    ADD CONSTRAINT uq_sale_line_id_sale UNIQUE (id, sale_id);


--
-- Name: CONSTRAINT uq_sale_line_id_sale ON sale_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_sale_line_id_sale ON public.sale_line IS 'Cites: RR-03, RT-145. Lets a refund line prove, by foreign key, that it refunds a line of the refund''s own sale.';


--
-- Name: sale_line uq_sale_line_id_sale_variant; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_line
    ADD CONSTRAINT uq_sale_line_id_sale_variant UNIQUE (id, sale_id, variant_id);


--
-- Name: CONSTRAINT uq_sale_line_id_sale_variant ON sale_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_sale_line_id_sale_variant ON public.sale_line IS 'Cites: RR-08, BI-16. Lets a return line prove, by foreign key, that it returns this line''s variant from the return''s sale.';


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
-- Name: user_account uq_user_account_employee; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_account
    ADD CONSTRAINT uq_user_account_employee UNIQUE (employee_id);


--
-- Name: CONSTRAINT uq_user_account_employee ON user_account; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_user_account_employee ON public.user_account IS 'Cites: EM-01, EM-02. At most one login per employee.';


--
-- Name: user_account uq_user_account_identity; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_account
    ADD CONSTRAINT uq_user_account_identity UNIQUE (id, employee_id, organization_id);


--
-- Name: CONSTRAINT uq_user_account_identity ON user_account; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_user_account_identity ON public.user_account IS 'Cites: EM-02. Lets a session prove, by foreign key, whose login it is.';


--
-- Name: user_session uq_user_session_token; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_session
    ADD CONSTRAINT uq_user_session_token UNIQUE (token_hash);


--
-- Name: CONSTRAINT uq_user_session_token ON user_session; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT uq_user_session_token ON public.user_session IS 'Cites: ADR-12. One session per token.';


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
-- Name: ix_audit_event_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_audit_event_entity ON public.audit_event USING btree (entity_id);


--
-- Name: INDEX ix_audit_event_entity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.ix_audit_event_entity IS 'Cites: AU-10, AU-28. Everything that happened to one entity.';


--
-- Name: ix_audit_event_store_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_audit_event_store_time ON public.audit_event USING btree (organization_id, store_id, occurred_at);


--
-- Name: INDEX ix_audit_event_store_time; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.ix_audit_event_store_time IS 'Cites: MS-29, AU-27. The store-filtered, time-ordered read an investigation starts from.';


--
-- Name: ix_category_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_category_parent ON public.category USING btree (parent_id);


--
-- Name: INDEX ix_category_parent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.ix_category_parent IS 'Cites: PR-04, RT-026. Walks the tree from a parent to its children.';


--
-- Name: ix_customer_return_line_return; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_customer_return_line_return ON public.customer_return_line USING btree (customer_return_id);


--
-- Name: INDEX ix_customer_return_line_return; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.ix_customer_return_line_return IS 'Cites: RR-14. Finds a return''s lines when posting it.';


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
-- Name: ix_receipt_reprint_sale; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_receipt_reprint_sale ON public.receipt_reprint USING btree (sale_id);


--
-- Name: INDEX ix_receipt_reprint_sale; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.ix_receipt_reprint_sale IS 'Cites: SP-57. A sale''s reprints, found by the sale.';


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
-- Name: ix_user_session_employee_live; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_user_session_employee_live ON public.user_session USING btree (employee_id) WHERE (ended_at IS NULL);


--
-- Name: INDEX ix_user_session_employee_live; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.ix_user_session_employee_live IS 'Cites: EM-16, SM-47. Finds an employee''s live sessions to end them at once.';


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
-- Name: uq_employee_role_assignment_live; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_employee_role_assignment_live ON public.employee_role_assignment USING btree (employee_id, role_id, store_id) NULLS NOT DISTINCT WHERE (revoked_at IS NULL);


--
-- Name: INDEX uq_employee_role_assignment_live; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.uq_employee_role_assignment_live IS 'Cites: MS-11. An employee holds a role in a given scope at most once at a time.';


--
-- Name: uq_employee_store_access_live; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_employee_store_access_live ON public.employee_store_access USING btree (employee_id, store_id) WHERE (revoked_at IS NULL);


--
-- Name: INDEX uq_employee_store_access_live; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.uq_employee_store_access_live IS 'Cites: EM-12. One live access per employee per store.';


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
-- Name: uq_role_permission_live; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_role_permission_live ON public.role_permission USING btree (role_id, permission_key) WHERE (revoked_at IS NULL);


--
-- Name: INDEX uq_role_permission_live; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.uq_role_permission_live IS 'Cites: AC-02. A role holds a key at most once at a time.';


--
-- Name: uq_storage_location_one_default; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_storage_location_one_default ON public.storage_location USING btree (warehouse_id) WHERE (location_type = 'Default'::text);


--
-- Name: INDEX uq_storage_location_one_default; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.uq_storage_location_one_default IS 'Cites: MS-17, RT-057. At most one Default location per warehouse (organization-model s5: one per warehouse).';


--
-- Name: uq_user_account_username; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_user_account_username ON public.user_account USING btree (organization_id, lower((username)::text));


--
-- Name: INDEX uq_user_account_username; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.uq_user_account_username IS 'Cites: EM-02. A username identifies one login in its organization, whatever its case (OQ-025).';


--
-- Name: audit_chain_link tg_audit_chain_link_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_audit_chain_link_immutable BEFORE DELETE OR UPDATE ON public.audit_chain_link FOR EACH ROW EXECUTE FUNCTION public.forbid_ledger_rewrite();


--
-- Name: TRIGGER tg_audit_chain_link_immutable ON audit_chain_link; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_audit_chain_link_immutable ON public.audit_chain_link IS 'Cites: AU-29, BI-24. The chain is append-only at every privilege.';


--
-- Name: audit_chain_link tg_audit_chain_link_no_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_audit_chain_link_no_truncate BEFORE TRUNCATE ON public.audit_chain_link FOR EACH STATEMENT EXECUTE FUNCTION public.forbid_ledger_rewrite();


--
-- Name: TRIGGER tg_audit_chain_link_no_truncate ON audit_chain_link; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_audit_chain_link_no_truncate ON public.audit_chain_link IS 'Cites: AU-32. The chain cannot be emptied in bulk.';


--
-- Name: audit_event tg_audit_event_chain; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER tg_audit_event_chain AFTER INSERT ON public.audit_event DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.link_audit_event();


--
-- Name: TRIGGER tg_audit_event_chain ON audit_event; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_audit_event_chain ON public.audit_event IS 'Cites: AU-29. Every event is linked into the chain when its transaction commits.';


--
-- Name: audit_event tg_audit_event_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_audit_event_immutable BEFORE DELETE OR UPDATE ON public.audit_event FOR EACH ROW EXECUTE FUNCTION public.forbid_ledger_rewrite();


--
-- Name: TRIGGER tg_audit_event_immutable ON audit_event; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_audit_event_immutable ON public.audit_event IS 'Cites: AU-02, BI-24, RT-291. No update and no delete on an audit event, at any privilege.';


--
-- Name: audit_event tg_audit_event_no_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_audit_event_no_truncate BEFORE TRUNCATE ON public.audit_event FOR EACH STATEMENT EXECUTE FUNCTION public.forbid_ledger_rewrite();


--
-- Name: TRIGGER tg_audit_event_no_truncate ON audit_event; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_audit_event_no_truncate ON public.audit_event IS 'Cites: AU-32, RT-291. The log cannot be emptied in bulk.';


--
-- Name: cash_shift tg_cash_shift_actors_fixed; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_cash_shift_actors_fixed BEFORE UPDATE OF status_changed_by, closed_by ON public.cash_shift FOR EACH ROW EXECUTE FUNCTION public.assert_shift_actors_fixed();


--
-- Name: TRIGGER tg_cash_shift_actors_fixed ON cash_shift; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_cash_shift_actors_fixed ON public.cash_shift IS 'Cites: SM-57, AU-05. Rewriting who acted on a shift, without a transition, is refused (SS001).';


--
-- Name: cash_shift tg_cash_shift_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_cash_shift_audit AFTER INSERT OR UPDATE OF status ON public.cash_shift FOR EACH ROW EXECUTE FUNCTION public.audit_state_transition('Shift');


--
-- Name: TRIGGER tg_cash_shift_audit ON cash_shift; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_cash_shift_audit ON public.cash_shift IS 'Cites: CD-21, SM-55. Shift.StateChange and Shift.Close (s22.11).';


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
-- Name: cash_transaction tg_cash_transaction_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_cash_transaction_audit AFTER INSERT ON public.cash_transaction FOR EACH ROW EXECUTE FUNCTION public.audit_ledger_row();


--
-- Name: TRIGGER tg_cash_transaction_audit ON cash_transaction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_cash_transaction_audit ON public.cash_transaction IS 'Cites: AU-03, CD-19. Every cash transaction is audited.';


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
-- Name: cash_transaction tg_cash_transaction_refund_completes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER tg_cash_transaction_refund_completes AFTER INSERT ON public.cash_transaction DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN ((new.refund_id IS NOT NULL)) EXECUTE FUNCTION public.assert_refund_payout_completes();


--
-- Name: TRIGGER tg_cash_transaction_refund_completes ON cash_transaction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_cash_transaction_refund_completes ON public.cash_transaction IS 'Cites: PY-27, BI-04. Checked at commit.';


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
-- Name: customer_return tg_customer_return_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_customer_return_audit AFTER INSERT OR UPDATE OF status ON public.customer_return FOR EACH ROW EXECUTE FUNCTION public.audit_state_transition('CustomerReturn');


--
-- Name: TRIGGER tg_customer_return_audit ON customer_return; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_customer_return_audit ON public.customer_return IS 'Cites: SM-42, D-06. Return.StateChange (s22.7).';


--
-- Name: customer_return tg_customer_return_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_customer_return_before_write BEFORE INSERT OR UPDATE ON public.customer_return FOR EACH ROW EXECUTE FUNCTION public.customer_return_before_write();


--
-- Name: TRIGGER tg_customer_return_before_write ON customer_return; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_customer_return_before_write ON public.customer_return IS 'Cites: RR-10, RR-11. Numbering, stamps and the return window.';


--
-- Name: customer_return_line tg_customer_return_line_rules; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_customer_return_line_rules BEFORE INSERT OR DELETE OR UPDATE ON public.customer_return_line FOR EACH ROW EXECUTE FUNCTION public.customer_return_line_rules();


--
-- Name: TRIGGER tg_customer_return_line_rules ON customer_return_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_customer_return_line_rules ON public.customer_return_line IS 'Cites: RR-17, RR-19. Disposition and destination are checked at entry.';


--
-- Name: customer_return tg_customer_return_posting; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_customer_return_posting AFTER UPDATE OF status ON public.customer_return FOR EACH ROW EXECUTE FUNCTION public.apply_return_posting();


--
-- Name: TRIGGER tg_customer_return_posting ON customer_return; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_customer_return_posting ON public.customer_return IS 'Cites: RR-14, BI-06. The atomic sold-quantity bound, taken when the goods are accepted.';


--
-- Name: customer_return tg_customer_return_posting_complete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER tg_customer_return_posting_complete AFTER UPDATE OF status ON public.customer_return DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_return_posting_complete();


--
-- Name: TRIGGER tg_customer_return_posting_complete ON customer_return; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_customer_return_posting_complete ON public.customer_return IS 'Cites: SM-43, BI-04. Posting is all or nothing, checked at commit.';


--
-- Name: customer_return tg_customer_return_state_machine; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_customer_return_state_machine BEFORE INSERT OR UPDATE OF status ON public.customer_return FOR EACH ROW EXECUTE FUNCTION public.enforce_state_transition('CustomerReturn', 'status');


--
-- Name: TRIGGER tg_customer_return_state_machine ON customer_return; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_customer_return_state_machine ON public.customer_return IS 'Cites: SM-43a, SM-02. A return is created Draft and moves only along the edges of state-machines s22.7.';


--
-- Name: document_number_sequence tg_document_number_sequence_forward; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_document_number_sequence_forward BEFORE UPDATE ON public.document_number_sequence FOR EACH ROW EXECUTE FUNCTION public.forbid_document_number_decrease();


--
-- Name: TRIGGER tg_document_number_sequence_forward ON document_number_sequence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_document_number_sequence_forward ON public.document_number_sequence IS 'Cites: BI-42. Document-number counters only move forward.';


--
-- Name: employee tg_employee_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_employee_audit AFTER INSERT OR UPDATE OF status ON public.employee FOR EACH ROW EXECUTE FUNCTION public.audit_state_transition('Employee');


--
-- Name: TRIGGER tg_employee_audit ON employee; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_employee_audit ON public.employee IS 'Cites: D-06, EM-10, SM-50. Employee.StateChange and Employee.Terminate (s22.9).';


--
-- Name: employee_role_assignment tg_employee_role_assignment_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_employee_role_assignment_audit AFTER INSERT OR UPDATE OF revoked_by ON public.employee_role_assignment FOR EACH ROW EXECUTE FUNCTION public.audit_role_assignment();


--
-- Name: TRIGGER tg_employee_role_assignment_audit ON employee_role_assignment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_employee_role_assignment_audit ON public.employee_role_assignment IS 'Cites: AU-03, RT-020. Every permission change of an employee is audited.';


--
-- Name: employee_role_assignment tg_employee_role_assignment_revocation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_employee_role_assignment_revocation BEFORE UPDATE ON public.employee_role_assignment FOR EACH ROW EXECUTE FUNCTION public.record_revocation();


--
-- Name: TRIGGER tg_employee_role_assignment_revocation ON employee_role_assignment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_employee_role_assignment_revocation ON public.employee_role_assignment IS 'Cites: RT-020, BI-40. A removal is recorded once.';


--
-- Name: employee tg_employee_state_machine; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_employee_state_machine BEFORE INSERT OR UPDATE OF status ON public.employee FOR EACH ROW EXECUTE FUNCTION public.enforce_state_transition('Employee', 'status');


--
-- Name: TRIGGER tg_employee_state_machine ON employee; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_employee_state_machine ON public.employee IS 'Cites: SM-48a, SM-02, EM-08. An employee is created Active and moves only along the edges of state-machines s22.9; Terminated leads only to Archived.';


--
-- Name: employee tg_employee_status_stamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_employee_status_stamp BEFORE UPDATE OF status ON public.employee FOR EACH ROW EXECUTE FUNCTION public.stamp_status_change();


--
-- Name: TRIGGER tg_employee_status_stamp ON employee; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_employee_status_stamp ON public.employee IS 'Cites: SM-03, RT-353. Server time for each status change.';


--
-- Name: employee_store_access tg_employee_store_access_revocation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_employee_store_access_revocation BEFORE UPDATE ON public.employee_store_access FOR EACH ROW EXECUTE FUNCTION public.record_revocation();


--
-- Name: TRIGGER tg_employee_store_access_revocation ON employee_store_access; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_employee_store_access_revocation ON public.employee_store_access IS 'Cites: EM-15, BI-40. A revocation is recorded once.';


--
-- Name: employee tg_employee_termination; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_employee_termination BEFORE UPDATE OF status ON public.employee FOR EACH ROW EXECUTE FUNCTION public.forbid_termination_with_open_shift();


--
-- Name: TRIGGER tg_employee_termination ON employee; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_employee_termination ON public.employee IS 'Cites: EM-10. No termination with an open drawer.';


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
-- Name: inventory_movement tg_inventory_movement_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_inventory_movement_audit AFTER INSERT ON public.inventory_movement FOR EACH ROW EXECUTE FUNCTION public.audit_ledger_row();


--
-- Name: TRIGGER tg_inventory_movement_audit ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_inventory_movement_audit ON public.inventory_movement IS 'Cites: AU-03, IV-08. Every stock movement is audited.';


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
-- Name: inventory_movement tg_inventory_movement_return_state; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_inventory_movement_return_state BEFORE INSERT ON public.inventory_movement FOR EACH ROW EXECUTE FUNCTION public.assert_movement_return_state();


--
-- Name: TRIGGER tg_inventory_movement_return_state ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_inventory_movement_return_state ON public.inventory_movement IS 'Cites: BI-27, RR-17. Only a posted return brings goods back.';


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
-- Name: payment tg_payment_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_payment_audit AFTER INSERT OR UPDATE OF status ON public.payment FOR EACH ROW EXECUTE FUNCTION public.audit_state_transition('Payment');


--
-- Name: TRIGGER tg_payment_audit ON payment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_payment_audit ON public.payment IS 'Cites: AU-03, PY-13, PY-54. Every payment state change: Payment.StateChange and Payment.Capture (s22.10).';


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
-- Name: pos_terminal tg_pos_terminal_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_pos_terminal_audit AFTER INSERT OR UPDATE OF status ON public.pos_terminal FOR EACH ROW EXECUTE FUNCTION public.audit_state_transition('Device');


--
-- Name: TRIGGER tg_pos_terminal_audit ON pos_terminal; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_pos_terminal_audit ON public.pos_terminal IS 'Cites: SM-60b, HD-08. Device.StateChange (s22.12).';


--
-- Name: pos_terminal tg_pos_terminal_location; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_pos_terminal_location BEFORE INSERT OR UPDATE OF sell_from_location_id ON public.pos_terminal FOR EACH ROW EXECUTE FUNCTION public.assert_terminal_sells_from_own_location();


--
-- Name: TRIGGER tg_pos_terminal_location ON pos_terminal; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_pos_terminal_location ON public.pos_terminal IS 'Cites: WH-01, RT-004. Checks the till''s sell-from location.';


--
-- Name: pos_terminal tg_pos_terminal_mode_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_pos_terminal_mode_audit AFTER UPDATE OF mode ON public.pos_terminal FOR EACH ROW WHEN ((old.mode IS DISTINCT FROM new.mode)) EXECUTE FUNCTION public.audit_device_mode();


--
-- Name: TRIGGER tg_pos_terminal_mode_audit ON pos_terminal; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_pos_terminal_mode_audit ON public.pos_terminal IS 'Cites: SM-59. Changing a till''s mode is audited.';


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
-- Name: product tg_product_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_product_audit AFTER INSERT OR UPDATE OF status ON public.product FOR EACH ROW EXECUTE FUNCTION public.audit_state_transition('Product');


--
-- Name: TRIGGER tg_product_audit ON product; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_product_audit ON public.product IS 'Cites: D-06, PR-47. Product.StateChange and Product.Archive (s22.1).';


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
-- Name: receipt_reprint tg_receipt_reprint_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_receipt_reprint_immutable BEFORE DELETE OR UPDATE ON public.receipt_reprint FOR EACH ROW EXECUTE FUNCTION public.forbid_ledger_rewrite();


--
-- Name: TRIGGER tg_receipt_reprint_immutable ON receipt_reprint; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_receipt_reprint_immutable ON public.receipt_reprint IS 'Cites: BI-08, AU-32. A reprint record is never updated or deleted, at every privilege.';


--
-- Name: receipt_reprint tg_receipt_reprint_no_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_receipt_reprint_no_truncate BEFORE TRUNCATE ON public.receipt_reprint FOR EACH STATEMENT EXECUTE FUNCTION public.forbid_ledger_rewrite();


--
-- Name: TRIGGER tg_receipt_reprint_no_truncate ON receipt_reprint; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_receipt_reprint_no_truncate ON public.receipt_reprint IS 'Cites: AU-32. The reprint record cannot be emptied in bulk.';


--
-- Name: receipt_reprint tg_receipt_reprint_reason_live; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_receipt_reprint_reason_live BEFORE INSERT ON public.receipt_reprint FOR EACH ROW EXECUTE FUNCTION public.assert_reprint_reason_live();


--
-- Name: TRIGGER tg_receipt_reprint_reason_live ON receipt_reprint; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_receipt_reprint_reason_live ON public.receipt_reprint IS 'Cites: BI-40. A reprint with an archived reason code is refused (SS024).';


--
-- Name: refund tg_refund_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_refund_audit AFTER INSERT OR UPDATE OF status ON public.refund FOR EACH ROW EXECUTE FUNCTION public.audit_state_transition('Refund');


--
-- Name: TRIGGER tg_refund_audit ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_refund_audit ON public.refund IS 'Cites: AU-03, SM-40, RR-24. Approval.Decided, Payment.Refund and Refund.StateChange: every refund (s22.7).';


--
-- Name: refund tg_refund_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_refund_before_write BEFORE INSERT OR UPDATE ON public.refund FOR EACH ROW EXECUTE FUNCTION public.refund_before_write();


--
-- Name: TRIGGER tg_refund_before_write ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_refund_before_write ON public.refund IS 'Cites: RR-23, BI-09. Refund routing, numbering and freezing.';


--
-- Name: refund tg_refund_hold; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_refund_hold AFTER UPDATE OF status ON public.refund FOR EACH ROW EXECUTE FUNCTION public.apply_refund_hold();


--
-- Name: TRIGGER tg_refund_hold ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_refund_hold ON public.refund IS 'Cites: RR-24, SM-40. Two refunds of the same money cannot both be in flight.';


--
-- Name: refund_line tg_refund_line_rules; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_refund_line_rules BEFORE INSERT OR DELETE OR UPDATE ON public.refund_line FOR EACH ROW EXECUTE FUNCTION public.refund_line_rules();


--
-- Name: TRIGGER tg_refund_line_rules ON refund_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_refund_line_rules ON public.refund_line IS 'Cites: BI-27, AP-03. Freezes the allocation after Draft.';


--
-- Name: refund tg_refund_state_machine; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_refund_state_machine BEFORE INSERT OR UPDATE OF status ON public.refund FOR EACH ROW EXECUTE FUNCTION public.enforce_state_transition('Refund', 'status');


--
-- Name: TRIGGER tg_refund_state_machine ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_refund_state_machine ON public.refund IS 'Cites: SM-43a, SM-02. A refund is created Draft and moves only along the edges of state-machines s22.7.';


--
-- Name: refund tg_refund_whole; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER tg_refund_whole AFTER UPDATE OF status ON public.refund DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_refund_whole();


--
-- Name: TRIGGER tg_refund_whole ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_refund_whole ON public.refund IS 'Cites: RR-43, PY-27. Checked at commit.';


--
-- Name: role tg_role_archival; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_role_archival BEFORE UPDATE ON public.role FOR EACH ROW EXECUTE FUNCTION public.record_archival();


--
-- Name: TRIGGER tg_role_archival ON role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_role_archival ON public.role IS 'Cites: BI-40. A role''s archival is recorded once, with server time.';


--
-- Name: role_permission tg_role_permission_revocation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_role_permission_revocation BEFORE UPDATE ON public.role_permission FOR EACH ROW EXECUTE FUNCTION public.record_revocation();


--
-- Name: TRIGGER tg_role_permission_revocation ON role_permission; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_role_permission_revocation ON public.role_permission IS 'Cites: PC-01, BI-40. A revocation is recorded once.';


--
-- Name: sale tg_sale_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_sale_audit AFTER INSERT OR UPDATE OF status ON public.sale FOR EACH ROW EXECUTE FUNCTION public.audit_state_transition('Sale');


--
-- Name: TRIGGER tg_sale_audit ON sale; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_sale_audit ON public.sale IS 'Cites: SP-02, D-06. Sale.Completed at completion (s22.6).';


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
-- Name: shift_count tg_shift_count_reason_live; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_shift_count_reason_live BEFORE UPDATE OF reason_code_id ON public.shift_count FOR EACH ROW WHEN ((new.reason_code_id IS NOT NULL)) EXECUTE FUNCTION public.assert_count_reason_live();


--
-- Name: TRIGGER tg_shift_count_reason_live ON shift_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_shift_count_reason_live ON public.shift_count IS 'Cites: CD-23, BI-40. An acknowledgement with an archived reason code is refused (SS024).';


--
-- Name: stock_adjustment tg_stock_adjustment_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_stock_adjustment_audit AFTER INSERT OR UPDATE OF status ON public.stock_adjustment FOR EACH ROW EXECUTE FUNCTION public.audit_state_transition('StockAdjustment');


--
-- Name: TRIGGER tg_stock_adjustment_audit ON stock_adjustment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_stock_adjustment_audit ON public.stock_adjustment IS 'Cites: AU-03, IV-33. Approval.Decided and Inventory.Adjustment (s22.17).';


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
-- Name: store_variant_price tg_store_variant_price_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_store_variant_price_audit AFTER INSERT ON public.store_variant_price FOR EACH ROW EXECUTE FUNCTION public.audit_ledger_row();


--
-- Name: TRIGGER tg_store_variant_price_audit ON store_variant_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_store_variant_price_audit ON public.store_variant_price IS 'Cites: AU-03, PR-30. Every store price change is audited.';


--
-- Name: unit tg_unit_quantity_kind; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_unit_quantity_kind BEFORE UPDATE OF quantity_kind ON public.unit FOR EACH ROW EXECUTE FUNCTION public.freeze_used_quantity_kind();


--
-- Name: TRIGGER tg_unit_quantity_kind ON unit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_unit_quantity_kind ON public.unit IS 'Cites: PR-14, RT-491. Closes the domain 2 pending guard.';


--
-- Name: user_account tg_user_account_password; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_user_account_password BEFORE UPDATE OF password_hash ON public.user_account FOR EACH ROW EXECUTE FUNCTION public.stamp_password_change();


--
-- Name: TRIGGER tg_user_account_password ON user_account; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_user_account_password ON public.user_account IS 'Cites: EM-04. Server time for each password change.';


--
-- Name: user_session tg_user_session_end; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_user_session_end BEFORE UPDATE ON public.user_session FOR EACH ROW EXECUTE FUNCTION public.record_session_end();


--
-- Name: TRIGGER tg_user_session_end ON user_session; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_user_session_end ON public.user_session IS 'Cites: AU-12a. The end of a session is written once.';


--
-- Name: variant_price tg_variant_price_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_variant_price_audit AFTER INSERT ON public.variant_price FOR EACH ROW EXECUTE FUNCTION public.audit_ledger_row();


--
-- Name: TRIGGER tg_variant_price_audit ON variant_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_variant_price_audit ON public.variant_price IS 'Cites: AU-03, PR-30. Every price change is audited.';


--
-- Name: warehouse tg_warehouse_default_location; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER tg_warehouse_default_location AFTER INSERT ON public.warehouse DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_warehouse_has_default_location();


--
-- Name: TRIGGER tg_warehouse_default_location ON warehouse; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER tg_warehouse_default_location ON public.warehouse IS 'Cites: MS-17, RT-057. Checked at commit, so the warehouse and its Default location are created together.';


--
-- Name: audit_chain_head fk_audit_chain_head_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_chain_head
    ADD CONSTRAINT fk_audit_chain_head_organization FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: CONSTRAINT fk_audit_chain_head_organization ON audit_chain_head; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_audit_chain_head_organization ON public.audit_chain_head IS 'Cites: AU-29. One chain per organization.';


--
-- Name: audit_chain_link fk_audit_chain_link_event; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_chain_link
    ADD CONSTRAINT fk_audit_chain_link_event FOREIGN KEY (audit_event_id) REFERENCES public.audit_event(id);


--
-- Name: CONSTRAINT fk_audit_chain_link_event ON audit_chain_link; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_audit_chain_link_event ON public.audit_chain_link IS 'Cites: AU-29, AU-32. A link names an event that exists.';


--
-- Name: audit_chain_link fk_audit_chain_link_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_chain_link
    ADD CONSTRAINT fk_audit_chain_link_organization FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: CONSTRAINT fk_audit_chain_link_organization ON audit_chain_link; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_audit_chain_link_organization ON public.audit_chain_link IS 'Cites: AU-29. A chain is per organization.';


--
-- Name: audit_event fk_audit_event_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_event
    ADD CONSTRAINT fk_audit_event_organization FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: CONSTRAINT fk_audit_event_organization ON audit_event; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_audit_event_organization ON public.audit_event IS 'Cites: MS-29. The log is global within the organization.';


--
-- Name: audit_event fk_audit_event_reason; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_event
    ADD CONSTRAINT fk_audit_event_reason FOREIGN KEY (reason_code_id, organization_id) REFERENCES public.reason_code(id, organization_id);


--
-- Name: CONSTRAINT fk_audit_event_reason ON audit_event; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_audit_event_reason ON public.audit_event IS 'Cites: BI-25. A reason is a reason code of the organization.';


--
-- Name: audit_event fk_audit_event_store; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_event
    ADD CONSTRAINT fk_audit_event_store FOREIGN KEY (store_id, organization_id) REFERENCES public.store(id, organization_id);


--
-- Name: CONSTRAINT fk_audit_event_store ON audit_event; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_audit_event_store ON public.audit_event IS 'Cites: AU-07, MS-29. The store of the affected entity, in the same organization, so the log filters by store without a join.';


--
-- Name: audit_event fk_audit_event_type; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_event
    ADD CONSTRAINT fk_audit_event_type FOREIGN KEY (event_type) REFERENCES public.audit_event_type(code);


--
-- Name: CONSTRAINT fk_audit_event_type ON audit_event; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_audit_event_type ON public.audit_event IS 'Cites: AU-11, RT-465. A free-text or placeholder event type is refused.';


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
-- Name: cash_shift fk_cash_shift_closed_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_shift
    ADD CONSTRAINT fk_cash_shift_closed_by FOREIGN KEY (closed_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_cash_shift_closed_by ON cash_shift; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_cash_shift_closed_by ON public.cash_shift IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


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
-- Name: cash_shift fk_cash_shift_opened_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_shift
    ADD CONSTRAINT fk_cash_shift_opened_by FOREIGN KEY (opened_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_cash_shift_opened_by ON cash_shift; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_cash_shift_opened_by ON public.cash_shift IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


--
-- Name: cash_shift fk_cash_shift_status_changed_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_shift
    ADD CONSTRAINT fk_cash_shift_status_changed_by FOREIGN KEY (status_changed_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_cash_shift_status_changed_by ON cash_shift; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_cash_shift_status_changed_by ON public.cash_shift IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


--
-- Name: cash_transaction fk_cash_transaction_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_transaction
    ADD CONSTRAINT fk_cash_transaction_created_by FOREIGN KEY (created_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_cash_transaction_created_by ON cash_transaction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_cash_transaction_created_by ON public.cash_transaction IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


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
-- Name: cash_transaction fk_cash_transaction_refund; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_transaction
    ADD CONSTRAINT fk_cash_transaction_refund FOREIGN KEY (refund_id, cash_shift_id) REFERENCES public.refund(id, cash_shift_id);


--
-- Name: CONSTRAINT fk_cash_transaction_refund ON cash_transaction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_cash_transaction_refund ON public.cash_transaction IS 'Cites: PY-27, RT-156. A cash refund belongs to one refund, paid in that refund''s shift.';


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
-- Name: category fk_category_archived_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category
    ADD CONSTRAINT fk_category_archived_by FOREIGN KEY (archived_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_category_archived_by ON category; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_category_archived_by ON public.category IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


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
-- Name: checkout fk_checkout_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkout
    ADD CONSTRAINT fk_checkout_created_by FOREIGN KEY (created_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_checkout_created_by ON checkout; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_checkout_created_by ON public.checkout IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


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
-- Name: customer_return fk_customer_return_cancel_reason; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_return
    ADD CONSTRAINT fk_customer_return_cancel_reason FOREIGN KEY (cancel_reason_code_id, organization_id) REFERENCES public.reason_code(id, organization_id);


--
-- Name: CONSTRAINT fk_customer_return_cancel_reason ON customer_return; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_customer_return_cancel_reason ON public.customer_return IS 'Cites: SM-42, BI-25. A refused or withdrawn return carries a reason code of the organization.';


--
-- Name: customer_return fk_customer_return_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_return
    ADD CONSTRAINT fk_customer_return_created_by FOREIGN KEY (created_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_customer_return_created_by ON customer_return; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_customer_return_created_by ON public.customer_return IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


--
-- Name: customer_return fk_customer_return_late_approved_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_return
    ADD CONSTRAINT fk_customer_return_late_approved_by FOREIGN KEY (late_approved_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_customer_return_late_approved_by ON customer_return; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_customer_return_late_approved_by ON public.customer_return IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


--
-- Name: customer_return fk_customer_return_late_reason; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_return
    ADD CONSTRAINT fk_customer_return_late_reason FOREIGN KEY (late_reason_code_id, organization_id) REFERENCES public.reason_code(id, organization_id);


--
-- Name: CONSTRAINT fk_customer_return_late_reason ON customer_return; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_customer_return_late_reason ON public.customer_return IS 'Cites: RR-11, BI-25. A late return carries a reason code of the organization.';


--
-- Name: customer_return_line fk_customer_return_line_location; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_return_line
    ADD CONSTRAINT fk_customer_return_line_location FOREIGN KEY (storage_location_id, organization_id) REFERENCES public.storage_location(id, organization_id);


--
-- Name: CONSTRAINT fk_customer_return_line_location ON customer_return_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_customer_return_line_location ON public.customer_return_line IS 'Cites: RR-19. The destination location, in the same organization.';


--
-- Name: customer_return_line fk_customer_return_line_return; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_return_line
    ADD CONSTRAINT fk_customer_return_line_return FOREIGN KEY (customer_return_id, sale_id, store_id) REFERENCES public.customer_return(id, sale_id, store_id);


--
-- Name: CONSTRAINT fk_customer_return_line_return ON customer_return_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_customer_return_line_return ON public.customer_return_line IS 'Cites: RR-13, RT-001. A line belongs to its return, and to that return''s one sale and store.';


--
-- Name: customer_return_line fk_customer_return_line_sale_line; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_return_line
    ADD CONSTRAINT fk_customer_return_line_sale_line FOREIGN KEY (sale_line_id, sale_id, variant_id) REFERENCES public.sale_line(id, sale_id, variant_id);


--
-- Name: CONSTRAINT fk_customer_return_line_sale_line ON customer_return_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_customer_return_line_sale_line ON public.customer_return_line IS 'Cites: RR-08, BI-16. A return line names the sold line it returns, and that line''s variant.';


--
-- Name: customer_return fk_customer_return_posted_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_return
    ADD CONSTRAINT fk_customer_return_posted_by FOREIGN KEY (posted_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_customer_return_posted_by ON customer_return; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_customer_return_posted_by ON public.customer_return IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


--
-- Name: customer_return fk_customer_return_sale; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_return
    ADD CONSTRAINT fk_customer_return_sale FOREIGN KEY (sale_id, store_id) REFERENCES public.sale(id, store_id);


--
-- Name: CONSTRAINT fk_customer_return_sale ON customer_return; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_customer_return_sale ON public.customer_return IS 'Cites: RR-08, RR-13, BI-16. A return references exactly one sale, of the same store.';


--
-- Name: customer_return fk_customer_return_status_changed_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_return
    ADD CONSTRAINT fk_customer_return_status_changed_by FOREIGN KEY (status_changed_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_customer_return_status_changed_by ON customer_return; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_customer_return_status_changed_by ON public.customer_return IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


--
-- Name: customer_return fk_customer_return_store; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_return
    ADD CONSTRAINT fk_customer_return_store FOREIGN KEY (store_id, organization_id) REFERENCES public.store(id, organization_id);


--
-- Name: CONSTRAINT fk_customer_return_store ON customer_return; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_customer_return_store ON public.customer_return IS 'Cites: RT-001. A return belongs to a store of its organization.';


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
-- Name: employee fk_employee_home_store; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee
    ADD CONSTRAINT fk_employee_home_store FOREIGN KEY (home_store_id, organization_id) REFERENCES public.store(id, organization_id);


--
-- Name: CONSTRAINT fk_employee_home_store ON employee; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_employee_home_store ON public.employee IS 'Cites: BI-14. A home store of the employee''s own organization; descriptive, granting nothing (EM-06).';


--
-- Name: employee fk_employee_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee
    ADD CONSTRAINT fk_employee_organization FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: CONSTRAINT fk_employee_organization ON employee; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_employee_organization ON public.employee IS 'Cites: RT-001. An employee belongs to one organization.';


--
-- Name: employee_role_assignment fk_employee_role_assignment_assigned_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_role_assignment
    ADD CONSTRAINT fk_employee_role_assignment_assigned_by FOREIGN KEY (assigned_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_employee_role_assignment_assigned_by ON employee_role_assignment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_employee_role_assignment_assigned_by ON public.employee_role_assignment IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


--
-- Name: employee_role_assignment fk_employee_role_assignment_employee; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_role_assignment
    ADD CONSTRAINT fk_employee_role_assignment_employee FOREIGN KEY (employee_id, organization_id) REFERENCES public.employee(id, organization_id);


--
-- Name: CONSTRAINT fk_employee_role_assignment_employee ON employee_role_assignment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_employee_role_assignment_employee ON public.employee_role_assignment IS 'Cites: BI-14. The employee is of the assignment''s organization.';


--
-- Name: employee_role_assignment fk_employee_role_assignment_revoked_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_role_assignment
    ADD CONSTRAINT fk_employee_role_assignment_revoked_by FOREIGN KEY (revoked_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_employee_role_assignment_revoked_by ON employee_role_assignment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_employee_role_assignment_revoked_by ON public.employee_role_assignment IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


--
-- Name: employee_role_assignment fk_employee_role_assignment_role; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_role_assignment
    ADD CONSTRAINT fk_employee_role_assignment_role FOREIGN KEY (role_id, organization_id) REFERENCES public.role(id, organization_id);


--
-- Name: CONSTRAINT fk_employee_role_assignment_role ON employee_role_assignment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_employee_role_assignment_role ON public.employee_role_assignment IS 'Cites: BI-14. The role is of the assignment''s organization.';


--
-- Name: employee_role_assignment fk_employee_role_assignment_store; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_role_assignment
    ADD CONSTRAINT fk_employee_role_assignment_store FOREIGN KEY (store_id, organization_id) REFERENCES public.store(id, organization_id);


--
-- Name: CONSTRAINT fk_employee_role_assignment_store ON employee_role_assignment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_employee_role_assignment_store ON public.employee_role_assignment IS 'Cites: MS-11, BI-14. A store-scoped assignment names a store of the organization; none means organization-wide.';


--
-- Name: employee fk_employee_status_changed_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee
    ADD CONSTRAINT fk_employee_status_changed_by FOREIGN KEY (status_changed_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_employee_status_changed_by ON employee; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_employee_status_changed_by ON public.employee IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


--
-- Name: employee_store_access fk_employee_store_access_employee; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_store_access
    ADD CONSTRAINT fk_employee_store_access_employee FOREIGN KEY (employee_id, organization_id) REFERENCES public.employee(id, organization_id);


--
-- Name: CONSTRAINT fk_employee_store_access_employee ON employee_store_access; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_employee_store_access_employee ON public.employee_store_access IS 'Cites: BI-14. The employee is of the store''s organization.';


--
-- Name: employee_store_access fk_employee_store_access_granted_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_store_access
    ADD CONSTRAINT fk_employee_store_access_granted_by FOREIGN KEY (granted_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_employee_store_access_granted_by ON employee_store_access; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_employee_store_access_granted_by ON public.employee_store_access IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


--
-- Name: employee_store_access fk_employee_store_access_revoked_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_store_access
    ADD CONSTRAINT fk_employee_store_access_revoked_by FOREIGN KEY (revoked_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_employee_store_access_revoked_by ON employee_store_access; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_employee_store_access_revoked_by ON public.employee_store_access IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


--
-- Name: employee_store_access fk_employee_store_access_store; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_store_access
    ADD CONSTRAINT fk_employee_store_access_store FOREIGN KEY (store_id, organization_id) REFERENCES public.store(id, organization_id);


--
-- Name: CONSTRAINT fk_employee_store_access_store ON employee_store_access; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_employee_store_access_store ON public.employee_store_access IS 'Cites: EM-12, RT-001. Access to one store of the organization.';


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
-- Name: inventory_movement fk_inventory_movement_return_line; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movement
    ADD CONSTRAINT fk_inventory_movement_return_line FOREIGN KEY (customer_return_line_id, customer_return_id, variant_id, storage_location_id, disposition) REFERENCES public.customer_return_line(id, customer_return_id, variant_id, storage_location_id, disposition);


--
-- Name: CONSTRAINT fk_inventory_movement_return_line ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_inventory_movement_return_line ON public.inventory_movement IS 'Cites: BI-03, RT-096, RR-17, BE-36. The causing return line, with its variant, destination and disposition proven to match: the movement names its disposition.';


--
-- Name: inventory_movement fk_inventory_movement_return_store; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movement
    ADD CONSTRAINT fk_inventory_movement_return_store FOREIGN KEY (customer_return_id, store_id) REFERENCES public.customer_return(id, store_id);


--
-- Name: CONSTRAINT fk_inventory_movement_return_store ON inventory_movement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_inventory_movement_return_store ON public.inventory_movement IS 'Cites: MS-16, BI-14. A return''s movements are attributed to the return''s store.';


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
-- Name: inventory_transaction fk_inventory_transaction_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transaction
    ADD CONSTRAINT fk_inventory_transaction_created_by FOREIGN KEY (created_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_inventory_transaction_created_by ON inventory_transaction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_inventory_transaction_created_by ON public.inventory_transaction IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


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
-- Name: organization fk_organization_deactivated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization
    ADD CONSTRAINT fk_organization_deactivated_by FOREIGN KEY (deactivated_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_organization_deactivated_by ON organization; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_organization_deactivated_by ON public.organization IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


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
-- Name: payment fk_payment_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment
    ADD CONSTRAINT fk_payment_created_by FOREIGN KEY (created_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_payment_created_by ON payment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_payment_created_by ON public.payment IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


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
-- Name: payment fk_payment_status_changed_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment
    ADD CONSTRAINT fk_payment_status_changed_by FOREIGN KEY (status_changed_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_payment_status_changed_by ON payment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_payment_status_changed_by ON public.payment IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


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
-- Name: pos_terminal fk_pos_terminal_status_changed_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_terminal
    ADD CONSTRAINT fk_pos_terminal_status_changed_by FOREIGN KEY (status_changed_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_pos_terminal_status_changed_by ON pos_terminal; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_pos_terminal_status_changed_by ON public.pos_terminal IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


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
-- Name: product_barcode fk_product_barcode_archived_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_barcode
    ADD CONSTRAINT fk_product_barcode_archived_by FOREIGN KEY (archived_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_product_barcode_archived_by ON product_barcode; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_product_barcode_archived_by ON public.product_barcode IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


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
-- Name: product fk_product_status_changed_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT fk_product_status_changed_by FOREIGN KEY (status_changed_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_product_status_changed_by ON product; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_product_status_changed_by ON public.product IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


--
-- Name: product_variant fk_product_variant_archived_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variant
    ADD CONSTRAINT fk_product_variant_archived_by FOREIGN KEY (archived_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_product_variant_archived_by ON product_variant; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_product_variant_archived_by ON public.product_variant IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


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
-- Name: reason_code fk_reason_code_archived_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reason_code
    ADD CONSTRAINT fk_reason_code_archived_by FOREIGN KEY (archived_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_reason_code_archived_by ON reason_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_reason_code_archived_by ON public.reason_code IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


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
-- Name: receipt_reprint fk_receipt_reprint_reason; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt_reprint
    ADD CONSTRAINT fk_receipt_reprint_reason FOREIGN KEY (reason_code_id, organization_id) REFERENCES public.reason_code(id, organization_id);


--
-- Name: CONSTRAINT fk_receipt_reprint_reason ON receipt_reprint; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_receipt_reprint_reason ON public.receipt_reprint IS 'Cites: BI-25. A reprint carries a reason code of the organization.';


--
-- Name: receipt_reprint fk_receipt_reprint_reprinted_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt_reprint
    ADD CONSTRAINT fk_receipt_reprint_reprinted_by FOREIGN KEY (reprinted_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_receipt_reprint_reprinted_by ON receipt_reprint; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_receipt_reprint_reprinted_by ON public.receipt_reprint IS 'Cites: BI-23, EM-11, AU-05. Who reprinted is an employee of record.';


--
-- Name: receipt_reprint fk_receipt_reprint_sale; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt_reprint
    ADD CONSTRAINT fk_receipt_reprint_sale FOREIGN KEY (sale_id, store_id) REFERENCES public.sale(id, store_id);


--
-- Name: CONSTRAINT fk_receipt_reprint_sale ON receipt_reprint; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_receipt_reprint_sale ON public.receipt_reprint IS 'Cites: SP-57, RT-001. A reprint is of one sale of its store.';


--
-- Name: receipt_reprint fk_receipt_reprint_store; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt_reprint
    ADD CONSTRAINT fk_receipt_reprint_store FOREIGN KEY (store_id, organization_id) REFERENCES public.store(id, organization_id);


--
-- Name: CONSTRAINT fk_receipt_reprint_store ON receipt_reprint; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_receipt_reprint_store ON public.receipt_reprint IS 'Cites: RT-001. A reprint is in its store''s organization.';


--
-- Name: refund fk_refund_approved_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund
    ADD CONSTRAINT fk_refund_approved_by FOREIGN KEY (approved_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_refund_approved_by ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_refund_approved_by ON public.refund IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


--
-- Name: refund fk_refund_cancel_reason; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund
    ADD CONSTRAINT fk_refund_cancel_reason FOREIGN KEY (cancel_reason_code_id, organization_id) REFERENCES public.reason_code(id, organization_id);


--
-- Name: CONSTRAINT fk_refund_cancel_reason ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_refund_cancel_reason ON public.refund IS 'Cites: BI-25. A cancelled refund carries a reason code of the organization (s22.7: cancel needs a reason).';


--
-- Name: refund fk_refund_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund
    ADD CONSTRAINT fk_refund_created_by FOREIGN KEY (created_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_refund_created_by ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_refund_created_by ON public.refund IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


--
-- Name: refund fk_refund_currency; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund
    ADD CONSTRAINT fk_refund_currency FOREIGN KEY (store_id, currency_code) REFERENCES public.store(id, currency_code);


--
-- Name: CONSTRAINT fk_refund_currency ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_refund_currency ON public.refund IS 'Cites: BI-01. A refund is in the store''s currency, as integer minor units.';


--
-- Name: refund_line fk_refund_line_refund; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_line
    ADD CONSTRAINT fk_refund_line_refund FOREIGN KEY (refund_id, sale_id) REFERENCES public.refund(id, sale_id);


--
-- Name: CONSTRAINT fk_refund_line_refund ON refund_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_refund_line_refund ON public.refund_line IS 'Cites: RR-03. A line belongs to its refund and to that refund''s sale.';


--
-- Name: refund_line fk_refund_line_sale_line; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_line
    ADD CONSTRAINT fk_refund_line_sale_line FOREIGN KEY (sale_line_id, sale_id) REFERENCES public.sale_line(id, sale_id);


--
-- Name: CONSTRAINT fk_refund_line_sale_line ON refund_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_refund_line_sale_line ON public.refund_line IS 'Cites: RR-03, RT-145. A line refunds a sold line of the same sale.';


--
-- Name: refund_line fk_refund_line_store; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_line
    ADD CONSTRAINT fk_refund_line_store FOREIGN KEY (sale_id, store_id) REFERENCES public.sale(id, store_id);


--
-- Name: CONSTRAINT fk_refund_line_store ON refund_line; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_refund_line_store ON public.refund_line IS 'Cites: RT-001, MS-01. A line carries its sale''s store.';


--
-- Name: refund fk_refund_payment; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund
    ADD CONSTRAINT fk_refund_payment FOREIGN KEY (payment_id) REFERENCES public.payment(id);


--
-- Name: CONSTRAINT fk_refund_payment ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_refund_payment ON public.refund IS 'Cites: RR-22, RR-23, BI-09. For a refund to the original tender, the payment it goes back to.';


--
-- Name: refund fk_refund_reason; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund
    ADD CONSTRAINT fk_refund_reason FOREIGN KEY (reason_code_id, organization_id) REFERENCES public.reason_code(id, organization_id);


--
-- Name: CONSTRAINT fk_refund_reason ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_refund_reason ON public.refund IS 'Cites: RR-35, BI-25. A reason code of the organization.';


--
-- Name: refund fk_refund_return; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund
    ADD CONSTRAINT fk_refund_return FOREIGN KEY (customer_return_id, sale_id, store_id) REFERENCES public.customer_return(id, sale_id, store_id);


--
-- Name: CONSTRAINT fk_refund_return ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_refund_return ON public.refund IS 'Cites: RR-01, SM-39. The originating return, where there is one, of the same sale and store; a return may have several refunds.';


--
-- Name: refund fk_refund_sale; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund
    ADD CONSTRAINT fk_refund_sale FOREIGN KEY (sale_id, store_id) REFERENCES public.sale(id, store_id);


--
-- Name: CONSTRAINT fk_refund_sale ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_refund_sale ON public.refund IS 'Cites: BI-10, RT-145. A refund is bounded against one sale of the same store.';


--
-- Name: refund fk_refund_shift; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund
    ADD CONSTRAINT fk_refund_shift FOREIGN KEY (cash_shift_id, cash_drawer_id, pos_terminal_id, store_id) REFERENCES public.cash_shift(id, cash_drawer_id, pos_terminal_id, store_id);


--
-- Name: CONSTRAINT fk_refund_shift ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_refund_shift ON public.refund IS 'Cites: PY-27, CD-19. Cash paid out of a drawer is paid in one shift of one till of the store.';


--
-- Name: refund fk_refund_status_changed_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund
    ADD CONSTRAINT fk_refund_status_changed_by FOREIGN KEY (status_changed_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_refund_status_changed_by ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_refund_status_changed_by ON public.refund IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


--
-- Name: refund fk_refund_store; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund
    ADD CONSTRAINT fk_refund_store FOREIGN KEY (store_id, organization_id) REFERENCES public.store(id, organization_id);


--
-- Name: CONSTRAINT fk_refund_store ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_refund_store ON public.refund IS 'Cites: RT-001. A refund belongs to a store of its organization.';


--
-- Name: refund fk_refund_submitted_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund
    ADD CONSTRAINT fk_refund_submitted_by FOREIGN KEY (submitted_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_refund_submitted_by ON refund; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_refund_submitted_by ON public.refund IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


--
-- Name: role fk_role_archived_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role
    ADD CONSTRAINT fk_role_archived_by FOREIGN KEY (archived_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_role_archived_by ON role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_role_archived_by ON public.role IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


--
-- Name: role fk_role_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role
    ADD CONSTRAINT fk_role_organization FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: CONSTRAINT fk_role_organization ON role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_role_organization ON public.role IS 'Cites: RT-001. A role belongs to one organization.';


--
-- Name: role_permission fk_role_permission_granted_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permission
    ADD CONSTRAINT fk_role_permission_granted_by FOREIGN KEY (granted_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_role_permission_granted_by ON role_permission; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_role_permission_granted_by ON public.role_permission IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


--
-- Name: role_permission fk_role_permission_key; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permission
    ADD CONSTRAINT fk_role_permission_key FOREIGN KEY (permission_key) REFERENCES public.permission(key);


--
-- Name: CONSTRAINT fk_role_permission_key ON role_permission; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_role_permission_key ON public.role_permission IS 'Cites: AC-02, D-01. Only a catalogue key can be granted.';


--
-- Name: role_permission fk_role_permission_revoked_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permission
    ADD CONSTRAINT fk_role_permission_revoked_by FOREIGN KEY (revoked_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_role_permission_revoked_by ON role_permission; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_role_permission_revoked_by ON public.role_permission IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


--
-- Name: role_permission fk_role_permission_role; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permission
    ADD CONSTRAINT fk_role_permission_role FOREIGN KEY (role_id, organization_id) REFERENCES public.role(id, organization_id);


--
-- Name: CONSTRAINT fk_role_permission_role ON role_permission; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_role_permission_role ON public.role_permission IS 'Cites: RT-001. A grant belongs to a role of its organization.';


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
-- Name: sale fk_sale_employee; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale
    ADD CONSTRAINT fk_sale_employee FOREIGN KEY (employee_id) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_sale_employee ON sale; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_sale_employee ON public.sale IS 'Cites: RT-122, BI-23. The employee who made the sale is an employee of record.';


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
-- Name: shift_count fk_shift_count_acknowledged_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_count
    ADD CONSTRAINT fk_shift_count_acknowledged_by FOREIGN KEY (acknowledged_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_shift_count_acknowledged_by ON shift_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_shift_count_acknowledged_by ON public.shift_count IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


--
-- Name: shift_count fk_shift_count_counted_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_count
    ADD CONSTRAINT fk_shift_count_counted_by FOREIGN KEY (counted_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_shift_count_counted_by ON shift_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_shift_count_counted_by ON public.shift_count IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


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
-- Name: state_machine_edge fk_state_machine_edge_audit_type; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_machine_edge
    ADD CONSTRAINT fk_state_machine_edge_audit_type FOREIGN KEY (audit_event_type) REFERENCES public.audit_event_type(code);


--
-- Name: CONSTRAINT fk_state_machine_edge_audit_type ON state_machine_edge; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_state_machine_edge_audit_type ON public.state_machine_edge IS 'Cites: AU-12, D-06, SM-02. The event an edge records, from the s22 Audit column; null where the contract records none or another row records it.';


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
-- Name: state_machine_edge fk_state_machine_edge_permission; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_machine_edge
    ADD CONSTRAINT fk_state_machine_edge_permission FOREIGN KEY (permission_key) REFERENCES public.permission(key);


--
-- Name: CONSTRAINT fk_state_machine_edge_permission ON state_machine_edge; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_state_machine_edge_permission ON public.state_machine_edge IS 'Cites: AC-02, D-01. Only a catalogue key.';


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
-- Name: state_machine_state fk_state_machine_state_audit_type; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_machine_state
    ADD CONSTRAINT fk_state_machine_state_audit_type FOREIGN KEY (creation_audit_event_type) REFERENCES public.audit_event_type(code);


--
-- Name: CONSTRAINT fk_state_machine_state_audit_type ON state_machine_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_state_machine_state_audit_type ON public.state_machine_state IS 'Cites: AU-12, D-06. The event a creation records, from the s22 Audit column; null where the contract records none.';


--
-- Name: state_machine_state fk_state_machine_state_permission; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_machine_state
    ADD CONSTRAINT fk_state_machine_state_permission FOREIGN KEY (creation_permission_key) REFERENCES public.permission(key);


--
-- Name: CONSTRAINT fk_state_machine_state_permission ON state_machine_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_state_machine_state_permission ON public.state_machine_state IS 'Cites: AC-02, D-01. Only a catalogue key.';


--
-- Name: stock_adjustment fk_stock_adjustment_approved_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_adjustment
    ADD CONSTRAINT fk_stock_adjustment_approved_by FOREIGN KEY (approved_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_stock_adjustment_approved_by ON stock_adjustment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_stock_adjustment_approved_by ON public.stock_adjustment IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


--
-- Name: stock_adjustment fk_stock_adjustment_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_adjustment
    ADD CONSTRAINT fk_stock_adjustment_created_by FOREIGN KEY (created_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_stock_adjustment_created_by ON stock_adjustment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_stock_adjustment_created_by ON public.stock_adjustment IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


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
-- Name: stock_adjustment fk_stock_adjustment_status_changed_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_adjustment
    ADD CONSTRAINT fk_stock_adjustment_status_changed_by FOREIGN KEY (status_changed_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_stock_adjustment_status_changed_by ON stock_adjustment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_stock_adjustment_status_changed_by ON public.stock_adjustment IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


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
-- Name: stock_adjustment fk_stock_adjustment_submitted_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_adjustment
    ADD CONSTRAINT fk_stock_adjustment_submitted_by FOREIGN KEY (submitted_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_stock_adjustment_submitted_by ON stock_adjustment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_stock_adjustment_submitted_by ON public.stock_adjustment IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


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
-- Name: storage_location_attribution fk_storage_location_attribution_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_location_attribution
    ADD CONSTRAINT fk_storage_location_attribution_created_by FOREIGN KEY (created_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_storage_location_attribution_created_by ON storage_location_attribution; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_storage_location_attribution_created_by ON public.storage_location_attribution IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


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
-- Name: store fk_store_deactivated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store
    ADD CONSTRAINT fk_store_deactivated_by FOREIGN KEY (deactivated_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_store_deactivated_by ON store; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_store_deactivated_by ON public.store IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


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
-- Name: store_payment_method fk_store_payment_method_changed_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_payment_method
    ADD CONSTRAINT fk_store_payment_method_changed_by FOREIGN KEY (changed_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_store_payment_method_changed_by ON store_payment_method; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_store_payment_method_changed_by ON public.store_payment_method IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


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
-- Name: store_setting_version fk_store_setting_version_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_setting_version
    ADD CONSTRAINT fk_store_setting_version_created_by FOREIGN KEY (created_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_store_setting_version_created_by ON store_setting_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_store_setting_version_created_by ON public.store_setting_version IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


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
-- Name: store_variant_price fk_store_variant_price_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_variant_price
    ADD CONSTRAINT fk_store_variant_price_created_by FOREIGN KEY (created_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_store_variant_price_created_by ON store_variant_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_store_variant_price_created_by ON public.store_variant_price IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


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
-- Name: tax_rate fk_tax_rate_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_rate
    ADD CONSTRAINT fk_tax_rate_created_by FOREIGN KEY (created_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_tax_rate_created_by ON tax_rate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_tax_rate_created_by ON public.tax_rate IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


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
-- Name: user_account fk_user_account_employee; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_account
    ADD CONSTRAINT fk_user_account_employee FOREIGN KEY (employee_id, organization_id) REFERENCES public.employee(id, organization_id);


--
-- Name: CONSTRAINT fk_user_account_employee ON user_account; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_user_account_employee ON public.user_account IS 'Cites: EM-02, BI-23. A login belongs to one employee of its organization: never a shared account.';


--
-- Name: user_session fk_user_session_account; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_session
    ADD CONSTRAINT fk_user_session_account FOREIGN KEY (user_account_id, employee_id, organization_id) REFERENCES public.user_account(id, employee_id, organization_id);


--
-- Name: CONSTRAINT fk_user_session_account ON user_session; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_user_session_account ON public.user_session IS 'Cites: EM-02, AU-05. A session is one login''s, and so one employee''s.';


--
-- Name: user_session fk_user_session_terminal; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_session
    ADD CONSTRAINT fk_user_session_terminal FOREIGN KEY (pos_terminal_id, organization_id) REFERENCES public.pos_terminal(id, organization_id);


--
-- Name: CONSTRAINT fk_user_session_terminal ON user_session; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_user_session_terminal ON public.user_session IS 'Cites: AU-10, HD-18. The till a session was opened at, in its organization.';


--
-- Name: variant_price fk_variant_price_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.variant_price
    ADD CONSTRAINT fk_variant_price_created_by FOREIGN KEY (created_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_variant_price_created_by ON variant_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_variant_price_created_by ON public.variant_price IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


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
-- Name: variant_standard_cost fk_variant_standard_cost_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.variant_standard_cost
    ADD CONSTRAINT fk_variant_standard_cost_created_by FOREIGN KEY (created_by) REFERENCES public.employee(id);


--
-- Name: CONSTRAINT fk_variant_standard_cost_created_by ON variant_standard_cost; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT fk_variant_standard_cost_created_by ON public.variant_standard_cost IS 'Cites: BI-23, EM-11, AU-05. Who did it is an employee of record; employees are never deleted, so the reference holds.';


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
    ('20260930161000'),
    ('20260930170000'),
    ('20261001100000'),
    ('20261001110000'),
    ('20261001120000'),
    ('20261001120100'),
    ('20261001130000'),
    ('20261001140000'),
    ('20261002100000'),
    ('20261002120000'),
    ('20261002130000');
