-- migrate:up

-- Owner decision D-18 (2026-10-02): a refund may be tied to a captured card payment that never became a sale (OQ-036 item 2,
-- part B, option 1). The refund machine, its second-person approval, its provider round trip and its audit are reused
-- unchanged; the keys are the refund's own (Sale.Refund, Sale.Refund.Large.Approve, Refund.Pay). What changes is what a
-- refund must name and what bounds it. Design: docs/database/D5-RETURNS-REFUNDS.md s13.
--
-- A sale-bound refund is bounded by its sold lines (RR-03) and is untouched. A payment-bound refund has no sale and no
-- lines, and is bounded by what the payment took less what has been held back to the card: the same conditional-counter
-- shape as the lines (PY-22, RR-24). It exists only while the payment has no sale, and a sale cannot be made from a
-- payment while one is open: money taken back and goods sold on it at once would be paid for twice (PY-37).

-- ============================================================================ what a payment has given back

ALTER TABLE payment ADD COLUMN refunded_amount bigint NOT NULL DEFAULT 0;
ALTER TABLE payment ADD CONSTRAINT ck_payment_refunded
  CHECK (refunded_amount >= 0 AND refunded_amount <= amount AND (refunded_amount = 0 OR status = 'Captured'));
COMMENT ON COLUMN payment.refunded_amount IS
  'Cites: PY-22, PY-23, RR-24, D-18. What refunds that have no sale are holding back to this payment: raised when such a refund enters Processing, kept through Failed and Completed, lowered only by a cancellation. Written only by the owner''s hold trigger; never more than the payment took. A refund of a sold line is bounded on the line, not here.';
COMMENT ON CONSTRAINT ck_payment_refunded ON payment IS
  'Cites: PY-22, BI-10, D-18. A payment never gives back more than it took, and only a captured payment gives anything back.';

-- A captured payment is never edited (PY-12, SS035). Its refunded counter is the one thing the hold may move.
CREATE OR REPLACE FUNCTION payment_before_write() RETURNS trigger
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

-- ============================================================================ a refund need not name a sale

ALTER TABLE refund ALTER COLUMN sale_id DROP NOT NULL;
ALTER TABLE refund ADD CONSTRAINT ck_refund_sale_or_payment
  CHECK (sale_id IS NOT NULL
         OR (method = 'OriginalTender' AND payment_id IS NOT NULL AND customer_return_id IS NULL
             AND tax_amount = 0 AND reason_code_id IS NOT NULL));
COMMENT ON CONSTRAINT ck_refund_sale_or_payment ON refund IS
  'Cites: RR-01, RR-35, PY-21, PY-37, D-18. A refund is of a sale, or it is the return to the card of a payment that never became one: then it names that payment, has no return and no tax (no sale charged any), and a reason (it is goodwill in the sense of RR-35). Its lines cannot exist: a line names a sale.';

-- SS058: a payment-bound refund asks for more than the payment has left to give back. SS059: a payment and a sale or a
-- refund contradict each other (a payment with a sale is refunded through the sale; a payment being refunded cannot make one).

CREATE OR REPLACE FUNCTION refund_before_write() RETURNS trigger
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

COMMENT ON FUNCTION refund_before_write() IS
  'Cites: RR-22, RR-23, RR-25, PY-25, PY-27, PT-03, BI-09, BI-42, SM-03, PY-37, D-18. A refund to the original tender goes back to a captured tender of the same sale, cash through the drawer and card through the provider; or, with no sale, to a captured card payment of this store and currency that has no sale (D-18); numbering; transition stamps; a completed or cancelled refund is frozen; drawer cash is paid out only at a till in service and not in training, during an open shift.';

-- The hold: a sale-bound refund holds its sold lines (RR-24); a payment-bound one holds its payment, the same way.
CREATE OR REPLACE FUNCTION apply_refund_hold() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
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

COMMENT ON FUNCTION apply_refund_hold() IS
  'Cites: RR-03, RR-06, RR-24, RR-42, BI-10, SM-40, SM-41, PY-22, PY-23, PY-37, D-18. Entering Processing takes the hold with one conditional increment: on each sold line, which affects no row past its settled amount or its proportional tax; or, for a refund with no sale, on the payment, which affects no row past what the payment took. Failed and Completed keep it, and only a cancellation releases it. A refund for a return pays only the lines the posted return took back. A payment that has become a sale is no longer refunded without it.';

-- At commit, a refund that has left Draft equals the sum of its lines, tax included; a payment-bound refund has none.
CREATE OR REPLACE FUNCTION assert_refund_whole() RETURNS trigger
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

COMMENT ON FUNCTION assert_refund_whole() IS
  'Cites: RR-43, PY-27, CD-19, BI-04, RT-156, D-18. At commit, a refund that has left Draft equals the sum of its lines, tax included (a refund with no sale has no lines), and a completed cash refund has left the drawer as a recorded disbursement of exactly its amount.';

-- ============================================================================ a sale cannot be made from a payment being refunded

CREATE OR REPLACE FUNCTION assert_sale_complete() RETURNS trigger
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

COMMENT ON FUNCTION assert_sale_complete() IS
  'Cites: SP-02, SP-36, SP-40, BI-04, BI-18, RT-119, RT-133, RT-135, RT-136, RT-146, IV-15, PY-37, D-18. At commit, a sale is whole: at least one line; totals are the sums of its lines and follow the tax mode; the settled amounts sum to the total due; no tender is left pending; captured tenders equal the total due; no payment of it is being refunded without it; change equals cash tendered beyond cash applied and is disbursed from the drawer; and every stocked line moved exactly its quantity.';

-- ============================================================================ the payment counter, rebuilt

CREATE FUNCTION payment_refund_drift() RETURNS TABLE (payment_id uuid, problem text, recorded bigint, expected bigint)
  LANGUAGE sql STABLE
AS $$
  SELECT p.id, 'refunded amount differs from the refunds holding it', p.refunded_amount, coalesce(h.amount, 0)::bigint
  FROM payment p
  LEFT JOIN LATERAL (SELECT sum(r.amount) AS amount FROM refund r
                     WHERE r.payment_id = p.id AND r.sale_id IS NULL AND r.status IN ('Processing', 'Failed', 'Completed')) h ON true
  WHERE p.refunded_amount <> coalesce(h.amount, 0)
$$;

COMMENT ON FUNCTION payment_refund_drift() IS
  'Cites: PY-22, RR-24, D-18, SP-66. Rebuilds every payment''s refunded amount from the refunds with no sale that hold money (Processing, Failed, Completed) and returns each disagreement. It never repairs; an empty result is the proof.';

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'Migrations are forward-only and are never rolled back (docs/database/CONVENTIONS.md s14).'; END $$;
