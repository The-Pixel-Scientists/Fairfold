-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- One tenant's databases and roles on the BI PostgreSQL server (ADR 0039),
-- run by provision.sh as the server's superuser, connected to postgres,
-- with the psql variable `tenant` set to the tenant's BI key. Safe to run
-- again: it creates what is missing and resets every attribute, privilege
-- and password. For key <t>:
--
--   tps_bi_<t>_warehouse  loaded from the tenant's snapshot by load.sh; its
--                         tables are in schema warehouse.
--   tps_bi_<t>_metadata   Superset's own database: users, roles, saved
--                         queries and dashboards.
--   tps_bi_<t>_owner      loads the warehouse. It owns schema warehouse and
--                         nothing else, and cannot create anything outside it.
--   tps_bi_<t>_reader     Superset's data connection: CONNECT on the
--                         warehouse, USAGE on its schema and SELECT on its
--                         tables, read-only, and nothing else.
--   tps_bi_<t>_superset   Superset's metadata connection; owns the metadata
--                         database and may connect to nothing else.
--
-- No role is a superuser or belongs to another role, and CONNECT and TEMP on
-- both databases, and on postgres and template1, are revoked from PUBLIC, so
-- no role reaches another tenant's database or any other. No role but the
-- superuser may create a large object in the warehouse, which only drops
-- tables. dblink and postgres_fdw are never installed here.

\set warehouse tps_bi_ :tenant _warehouse
\set metadata tps_bi_ :tenant _metadata
\set owner tps_bi_ :tenant _owner
\set reader tps_bi_ :tenant _reader
\set superset tps_bi_ :tenant _superset

-- Keep the password verifiers out of the server's logs.
SET log_statement = 'none';
SET log_min_duration_statement = -1;
SET log_min_duration_sample = -1;
SET log_transaction_sample_rate = 0;
SET log_min_error_statement = panic;
SET log_parameter_max_length = 0;
SET log_parameter_max_length_on_error = 0;
\getenv verifier_owner TPS_BI_OWNER_VERIFIER
\getenv verifier_reader TPS_BI_READER_VERIFIER
\getenv verifier_superset TPS_BI_SUPERSET_VERIFIER
\o /dev/null
SELECT pg_catalog.set_config($1, $2, false) \bind tps.bi_role_owner :owner \g
SELECT pg_catalog.set_config($1, $2, false) \bind tps.bi_role_reader :reader \g
SELECT pg_catalog.set_config($1, $2, false) \bind tps.bi_role_superset :superset \g
SELECT pg_catalog.set_config($1, $2, false) \bind tps.bi_verifier_owner :verifier_owner \g
SELECT pg_catalog.set_config($1, $2, false) \bind tps.bi_verifier_reader :verifier_reader \g
SELECT pg_catalog.set_config($1, $2, false) \bind tps.bi_verifier_superset :verifier_superset \g
\o
\unset verifier_owner
\unset verifier_reader
\unset verifier_superset

DO $roles$
DECLARE
  kind text;
  role_name text;
BEGIN
  FOREACH kind IN ARRAY ARRAY['owner', 'reader', 'superset'] LOOP
    role_name := current_setting('tps.bi_role_' || kind);
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I', role_name);
    END IF;
    IF EXISTS (SELECT FROM pg_catalog.pg_auth_members WHERE member = role_name::regrole) THEN
      RAISE EXCEPTION 'The role % belongs to another role. Remove that membership first.', role_name;
    END IF;
    EXECUTE format(
      'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION '
      'NOBYPASSRLS PASSWORD %L',
      role_name, current_setting('tps.bi_verifier_' || kind));
    EXECUTE format('ALTER ROLE %I RESET ALL', role_name);
    PERFORM pg_catalog.set_config('tps.bi_verifier_' || kind, '', false);
  END LOOP;
END
$roles$;

SELECT format('CREATE DATABASE %I', :'warehouse')
  WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_database WHERE datname = :'warehouse') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'metadata', :'superset')
  WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_database WHERE datname = :'metadata') \gexec

-- The superuser keeps the warehouse database, so its owner role cannot
-- change who may connect or create a schema of its own.
ALTER DATABASE :"warehouse" OWNER TO CURRENT_USER;
ALTER DATABASE :"metadata" OWNER TO :"superset";
REVOKE ALL ON DATABASE :"warehouse" FROM PUBLIC;
REVOKE ALL ON DATABASE :"metadata" FROM PUBLIC;
REVOKE CONNECT, TEMPORARY ON DATABASE postgres, template1 FROM PUBLIC;
GRANT CONNECT ON DATABASE :"warehouse" TO :"owner", :"reader";
ALTER ROLE :"owner" IN DATABASE :"warehouse" SET search_path = warehouse;
ALTER ROLE :"reader" IN DATABASE :"warehouse" SET search_path = warehouse;
ALTER ROLE :"reader" IN DATABASE :"warehouse" SET default_transaction_read_only = on;
ALTER ROLE :"reader" IN DATABASE :"warehouse" SET statement_timeout = '60s';

\connect :warehouse
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA IF NOT EXISTS warehouse;
ALTER SCHEMA warehouse OWNER TO :"owner";
REVOKE ALL ON SCHEMA warehouse FROM PUBLIC;
GRANT USAGE ON SCHEMA warehouse TO :"reader";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA warehouse GRANT SELECT ON TABLES TO :"reader";
GRANT SELECT ON ALL TABLES IN SCHEMA warehouse TO :"reader";
-- A large object is a write that SELECT alone can make, and outlives a load.
REVOKE EXECUTE ON FUNCTION
  pg_catalog.lo_create(oid), pg_catalog.lo_creat(integer), pg_catalog.lo_from_bytea(oid, bytea),
  pg_catalog.lo_put(oid, bigint, bytea), pg_catalog.lowrite(integer, bytea),
  pg_catalog.lo_import(text), pg_catalog.lo_import(text, oid)
  FROM PUBLIC;
DO $unlink$
BEGIN
  PERFORM pg_catalog.lo_unlink(oid) FROM pg_catalog.pg_largeobject_metadata;
END
$unlink$;

\connect :metadata
REVOKE ALL ON SCHEMA public FROM PUBLIC;
