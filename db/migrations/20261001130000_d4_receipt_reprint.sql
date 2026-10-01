-- migrate:up

-- Domain 4: a receipt reprint is recorded, with who, when and why. The owner's brief of 2026-10-01 makes the reason
-- mandatory ("reprint with a mandatory reason"). The receipt itself is a rendering of the stored sale and is not
-- stored (SP-57): only the act of reprinting is. Design: docs/database/D4-SALE-PAYMENT.md s10.

CREATE TABLE receipt_reprint (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  sale_id         uuid        NOT NULL,
  store_id        uuid        NOT NULL,
  organization_id uuid        NOT NULL,
  reason_code_id  uuid        NOT NULL,
  reprinted_at    timestamptz NOT NULL DEFAULT now(),
  reprinted_by    uuid        NOT NULL,
  CONSTRAINT pk_receipt_reprint PRIMARY KEY (id),
  CONSTRAINT fk_receipt_reprint_sale FOREIGN KEY (sale_id, store_id) REFERENCES sale (id, store_id),
  CONSTRAINT fk_receipt_reprint_store FOREIGN KEY (store_id, organization_id) REFERENCES store (id, organization_id),
  CONSTRAINT fk_receipt_reprint_reason FOREIGN KEY (reason_code_id, organization_id)
    REFERENCES reason_code (id, organization_id),
  CONSTRAINT fk_receipt_reprint_reprinted_by FOREIGN KEY (reprinted_by) REFERENCES employee (id)
);

CREATE INDEX ix_receipt_reprint_sale ON receipt_reprint (sale_id);

COMMENT ON TABLE receipt_reprint IS
  'Cites: SP-57, SP-58, RT-140, UX-22, BI-25. One reprint of a sale''s receipt: who, when and why. The copy repeats the stored sale''s numbers under a reprint banner (SP-57); a failed first print is recovered this way (SP-58). The reason is mandatory by the owner''s instruction of 2026-10-01.';
COMMENT ON CONSTRAINT fk_receipt_reprint_sale ON receipt_reprint IS
  'Cites: SP-57, RT-001. A reprint is of one sale of its store.';
COMMENT ON CONSTRAINT fk_receipt_reprint_store ON receipt_reprint IS
  'Cites: RT-001. A reprint is in its store''s organization.';
COMMENT ON CONSTRAINT fk_receipt_reprint_reason ON receipt_reprint IS
  'Cites: BI-25. A reprint carries a reason code of the organization.';
COMMENT ON CONSTRAINT fk_receipt_reprint_reprinted_by ON receipt_reprint IS
  'Cites: BI-23, EM-11, AU-05. Who reprinted is an employee of record.';
COMMENT ON INDEX ix_receipt_reprint_sale IS
  'Cites: SP-57. A sale''s reprints, found by the sale.';

CREATE FUNCTION assert_reprint_reason_live() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM assert_reason_code_live(NEW.reason_code_id);
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION assert_reprint_reason_live() IS
  'Cites: BI-25, BI-40. A reprint takes only a live reason code: an archived one is kept for history and takes no new use (SS024).';

CREATE TRIGGER tg_receipt_reprint_reason_live BEFORE INSERT ON receipt_reprint
  FOR EACH ROW EXECUTE FUNCTION assert_reprint_reason_live();
COMMENT ON TRIGGER tg_receipt_reprint_reason_live ON receipt_reprint IS
  'Cites: BI-40. A reprint with an archived reason code is refused (SS024).';

CREATE TRIGGER tg_receipt_reprint_immutable BEFORE UPDATE OR DELETE ON receipt_reprint
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_rewrite();
COMMENT ON TRIGGER tg_receipt_reprint_immutable ON receipt_reprint IS
  'Cites: BI-08, AU-32. A reprint record is never updated or deleted, at every privilege.';

CREATE TRIGGER tg_receipt_reprint_no_truncate BEFORE TRUNCATE ON receipt_reprint
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_ledger_rewrite();
COMMENT ON TRIGGER tg_receipt_reprint_no_truncate ON receipt_reprint IS
  'Cites: AU-32. The reprint record cannot be emptied in bulk.';

-- reprinted_at is not insertable, so it is always server time (RT-353).
GRANT SELECT ON receipt_reprint TO smartstore_app;
GRANT INSERT (sale_id, store_id, organization_id, reason_code_id, reprinted_by) ON receipt_reprint TO smartstore_app;

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'Migrations are forward-only and are never rolled back (docs/database/CONVENTIONS.md s14).'; END $$;
