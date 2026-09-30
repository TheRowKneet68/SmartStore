-- migrate:up

-- Shared foundations (docs/database/CONVENTIONS.md). Every later migration builds on these.

CREATE DOMAIN nonblank_text AS text
  CONSTRAINT ck_nonblank_text CHECK (VALUE = btrim(VALUE) AND VALUE <> '');

COMMENT ON DOMAIN nonblank_text IS
  'Cites: ADR-31, PR-12. Text with no leading or trailing whitespace and never empty, for codes, names and labels; identifiers that look like numbers are text, so a leading zero is data (CONVENTIONS s6).';

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'Migrations are forward-only and are never rolled back (docs/database/CONVENTIONS.md s14).'; END $$;
