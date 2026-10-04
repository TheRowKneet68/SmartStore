-- migrate:up

-- Drop the unique indexes on customer phone/email that were created by mistake in d10.
-- CU-05 (force:true creates anyway) proves uniqueness is app-level only.
-- The indexes are replaced by non-unique ix_customer_phone / ix_customer_email in the
-- same migration; these DROPs handle environments where the old UNIQUE versions were
-- applied before the correction was made.
-- Cites: CU-04, CU-05.

DROP INDEX IF EXISTS uq_customer_phone;
DROP INDEX IF EXISTS uq_customer_email;

-- migrate:down

-- (intentionally empty — forward-only migrations)
