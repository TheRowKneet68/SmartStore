-- migrate:up

-- Owner decision D-19 (2026-10-02): a failed refund can be cancelled (OQ-038). Design: docs/database/D5-RETURNS-REFUNDS.md s14.
--
-- s22.7 contracted Failed -> Processing (retry) and Approved|Processing -> Cancelled, and no cancel from Failed, though SM-41
-- and RR-24 say the hold of a failed refund stays until it is cancelled. A refund the provider kept declining therefore kept
-- its money held for ever. As for the draft (D-17), it is the refund's own `cancel` event with the key, the reason and the
-- audit type of the other cancels (D-16 Q9: Sale.Refund; SM-42, BI-40; Refund.StateChange). No new key.

INSERT INTO state_machine_edge (machine, from_state, to_state, event, audit_event_type, requires_reason, permission_rule, permission_key)
SELECT 'Refund', 'Failed', 'Cancelled', 'cancel', audit_event_type, requires_reason, permission_rule, permission_key
FROM state_machine_edge
WHERE machine = 'Refund' AND from_state = 'Approved' AND event = 'cancel';

-- The hold a refund took entering Processing, and kept through Failed (RR-24), is released by a cancellation from either state:
-- on each sold line, or on the payment of a refund that has no sale (D-18).
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
    ELSIF NEW.status = 'Cancelled' AND OLD.status IN ('Processing', 'Failed') THEN
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
  ELSIF NEW.status = 'Cancelled' AND OLD.status IN ('Processing', 'Failed') THEN
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
  'Cites: RR-03, RR-06, RR-24, RR-42, BI-10, SM-40, SM-41, PY-22, PY-23, PY-37, D-18, D-19. Entering Processing takes the hold with one conditional increment: on each sold line, which affects no row past its settled amount or its proportional tax; or, for a refund with no sale, on the payment, which affects no row past what the payment took. Failed and Completed keep it, and only a cancellation, from Processing or from Failed, releases it. A refund for a return pays only the lines the posted return took back. A payment that has become a sale is no longer refunded without it.';

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'Migrations are forward-only and are never rolled back (docs/database/CONVENTIONS.md s14).'; END $$;
