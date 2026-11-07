-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Fairfold Grants database roles, version 4 (ADR 0003), part 2 of 2: the rights
-- in one database.
--
-- Run connected to a Fairfold Grants database, after roles.sql, in the same
-- mode (tps.admin_mode). It is safe to run any number of times. Only the
-- six login roles may connect; function owners never log in. PUBLIC loses
-- CONNECT and TEMP on the database, CREATE on every schema and EXECUTE on
-- every routine, including those migrator creates later. backup_reader gets
-- USAGE on every schema and SELECT on every table and sequence, including
-- those migrator creates later, so that pg_dump reads what a migration adds.
--
-- pg_trgm lives in its own schema, ext, which belongs to the role running
-- this script, so that no migration can change it (ADR 0025). migrator,
-- app_api and app_worker may use it.
--
-- In managed mode the running role is not a superuser and the database
-- belongs to migrator, so for the database and migrator's objects it acts
-- as migrator, through a SET-only membership that this transaction grants
-- and revokes. roles.ts then checks the result.

BEGIN;

-- Privileges are per database, so runs in different databases do not
-- conflict. This lock serialises runs in the same one.
SELECT pg_catalog.pg_advisory_xact_lock(4917734305101002002);

DO $privileges$
DECLARE
  managed CONSTANT boolean := current_setting('tps.admin_mode', true) = 'managed';
  admin CONSTANT text := current_user;
  schema_name text;
BEGIN
  IF NOT (SELECT rolsuper OR (managed AND rolcreaterole) FROM pg_catalog.pg_roles WHERE rolname = admin) THEN
    RAISE EXCEPTION 'Run the database privileges script as a superuser, or in managed mode as a role with CREATEROLE.';
  END IF;
  IF current_database() IN ('postgres', 'template0', 'template1') THEN
    RAISE EXCEPTION 'Run the database privileges script in a Fairfold Grants database, not %.', current_database();
  END IF;

  IF managed THEN
    EXECUTE format('GRANT migrator TO %I WITH ADMIN FALSE, INHERIT FALSE, SET TRUE', admin);
    SET LOCAL ROLE migrator;
    -- The running role keeps CONNECT once PUBLIC loses it, and may create
    -- schema ext and the extension until the end of this transaction.
    EXECUTE format('GRANT CONNECT, CREATE ON DATABASE %I TO %I', current_database(), admin);
    RESET ROLE;
  END IF;

  CREATE SCHEMA IF NOT EXISTS ext;
  IF (SELECT nspowner::regrole::text FROM pg_catalog.pg_namespace WHERE nspname = 'ext') <> admin THEN
    RAISE EXCEPTION 'Schema ext must belong to %, the role running this script.', admin;
  END IF;
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA ext;
  EXCEPTION WHEN feature_not_supported THEN
    RAISE EXCEPTION 'This server does not have the pg_trgm extension. Install PostgreSQL''s contrib modules, which the official Docker image includes, then run this script again.';
  END;
  IF (SELECT extnamespace::regnamespace::text FROM pg_catalog.pg_extension WHERE extname = 'pg_trgm') <> 'ext' THEN
    RAISE EXCEPTION 'pg_trgm is installed in another schema. Move it to schema ext with ALTER EXTENSION pg_trgm SET SCHEMA ext.';
  END IF;
  GRANT USAGE ON SCHEMA ext TO migrator, app_api, app_worker;
  -- Where the bootstrap superuser owns pg_trgm's functions, as on a managed
  -- database, these only warn, and PUBLIC keeps EXECUTE (ADR 0025).
  REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA ext FROM PUBLIC;
  GRANT EXECUTE ON ALL ROUTINES IN SCHEMA ext TO app_api, app_worker;

  IF managed THEN
    SET LOCAL ROLE migrator;
    EXECUTE format('REVOKE CREATE ON DATABASE %I FROM %I', current_database(), admin);
  END IF;

  EXECUTE format('REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO migrator, app_api, app_worker, app_auth, app_queue, backup_reader',
    current_database());

  -- In managed mode, a schema migrator cannot use is left for roles.ts to
  -- report; a superuser can use every schema.
  FOR schema_name IN
    SELECT nspname
    FROM pg_catalog.pg_namespace
    WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'ext')
      AND nspname NOT LIKE 'pg\_temp\_%'
      AND nspname NOT LIKE 'pg\_toast\_temp\_%'
      AND pg_catalog.has_schema_privilege(oid, 'USAGE')
  LOOP
    EXECUTE format('REVOKE CREATE ON SCHEMA %I FROM PUBLIC', schema_name);
    EXECUTE format('REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA %I FROM PUBLIC', schema_name);
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO backup_reader', schema_name);
    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO backup_reader', schema_name);
    EXECUTE format('GRANT SELECT ON ALL SEQUENCES IN SCHEMA %I TO backup_reader', schema_name);
  END LOOP;

  -- Functions that later migrations create, pg-boss's included, start with
  -- no EXECUTE for PUBLIC, and their schemas, tables and sequences can be
  -- read by backup_reader.
  ALTER DEFAULT PRIVILEGES FOR ROLE migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
  ALTER DEFAULT PRIVILEGES FOR ROLE migrator GRANT USAGE ON SCHEMAS TO backup_reader;
  ALTER DEFAULT PRIVILEGES FOR ROLE migrator GRANT SELECT ON TABLES TO backup_reader;
  ALTER DEFAULT PRIVILEGES FOR ROLE migrator GRANT SELECT ON SEQUENCES TO backup_reader;

  IF managed THEN
    RESET ROLE;
    EXECUTE format('REVOKE migrator FROM %I GRANTED BY %I', admin, admin);
  END IF;
END
$privileges$;

COMMIT;
