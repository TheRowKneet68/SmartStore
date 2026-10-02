-- migrate:up

-- Domain 4, found after its mutation check (2026-10-01): a unit's quantity kind is frozen once "any movement or
-- document" uses it (PR-14, RT-491). Domain 3's guard checks movements and stock adjustment lines. A sale line is a
-- document line too, and a service, which moves no stock, is used only there. A return line or a refund line always
-- follows a sale line of the same variant, so the sale line covers them. Design: docs/database/D4-SALE-PAYMENT.md s12.

CREATE OR REPLACE FUNCTION freeze_used_quantity_kind() RETURNS trigger
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

COMMENT ON FUNCTION freeze_used_quantity_kind() IS
  'Cites: PR-14, RT-491. A unit''s quantity kind is frozen once any movement or document line uses it: a movement, a stock adjustment line, or a sale line, which the return and refund lines of a sale follow. The refusal names the first use.';

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'Migrations are forward-only and are never rolled back (docs/database/CONVENTIONS.md s14).'; END $$;
