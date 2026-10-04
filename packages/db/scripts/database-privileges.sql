-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Fairfold Grants database roles, version 2 (ADR 0003), part 2 of 2: the rights
-- PUBLIC holds in one database.
--
-- Run as a superuser, connected to a Fairfold Grants database, after roles.sql.
-- It is safe to run any number of times. Only the five login roles may
-- connect; function owners never log in. PUBLIC loses CONNECT and TEMP on
-- the database, CREATE on every schema and EXECUTE on every routine,
-- including those migrator creates later.

BEGIN;

-- Privileges are per database, so runs in different databases do not
-- conflict. This lock serialises runs in the same one.
SELECT pg_catalog.pg_advisory_xact_lock(4917734305101002002);

DO $privileges$
DECLARE
  schema_name text;
BEGIN
  IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Run the database privileges script as a superuser.';
  END IF;
  IF current_database() IN ('postgres', 'template0', 'template1') THEN
    RAISE EXCEPTION 'Run the database privileges script in a Fairfold Grants database, not %.', current_database();
  END IF;

  EXECUTE format('REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO migrator, app_api, app_worker, app_auth, app_queue',
    current_database());

  FOR schema_name IN
    SELECT nspname
    FROM pg_catalog.pg_namespace
    WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND nspname NOT LIKE 'pg\_temp\_%'
      AND nspname NOT LIKE 'pg\_toast\_temp\_%'
  LOOP
    EXECUTE format('REVOKE CREATE ON SCHEMA %I FROM PUBLIC', schema_name);
    EXECUTE format('REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA %I FROM PUBLIC', schema_name);
  END LOOP;
END
$privileges$;

-- Functions that later migrations create, pg-boss's included, start with no
-- EXECUTE for PUBLIC.
ALTER DEFAULT PRIVILEGES FOR ROLE migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMIT;
