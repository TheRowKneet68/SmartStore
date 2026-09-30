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


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- PostgreSQL database dump complete
--

\unrestrict dbmate


--
-- Dbmate schema migrations
--

INSERT INTO public.schema_migrations (version) VALUES
    ('20260930120000');
