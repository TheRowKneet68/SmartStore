-- SmartStore database bootstrap (ADR-31 s6). Run as a PostgreSQL superuser. Idempotent.
--
-- Normally run for you by scripts/db-setup.ps1, which supplies the psql variables:
--   owner_password, app_password, dbname, reset_passwords ('true' or 'false')
--
-- smartstore_owner  owns the schema and runs migrations. CREATEDB lets the test harness clone databases from a
--                   template. That is a development convenience: a production owner role does not need CREATEDB.
-- smartstore_app    the runtime role. Not a superuser, cannot create databases or objects, owns nothing. What it may
--                   do is granted table by table in the migrations, and append-only tables get no UPDATE or DELETE
--                   (ADR-11, PHASE-2-ARCHITECTURE s14.1).

SELECT format('CREATE ROLE smartstore_owner LOGIN CREATEDB PASSWORD %L', :'owner_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smartstore_owner') \gexec

SELECT format('CREATE ROLE smartstore_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smartstore_app') \gexec

SELECT format('ALTER ROLE smartstore_owner PASSWORD %L', :'owner_password')
WHERE :'reset_passwords' = 'true' \gexec

SELECT format('ALTER ROLE smartstore_app PASSWORD %L', :'app_password')
WHERE :'reset_passwords' = 'true' \gexec

-- template0 so the encoding is UTF-8 whatever the cluster's default locale is.
SELECT format('CREATE DATABASE %I OWNER smartstore_owner TEMPLATE template0 ENCODING ''UTF8''', :'dbname')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'dbname') \gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO smartstore_app', :'dbname') \gexec

\connect :"dbname"

-- The application role can use the schema but never create objects in it.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO smartstore_app;
