-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Fairfold Grants database roles, version 4 (ADR 0003), part 1 of 2: the roles.
--
-- Creates the login roles and the function-owner roles, and resets their
-- attributes, memberships, settings and passwords. Roles belong to the
-- whole server, so this runs connected to the maintenance database
-- (postgres). Part 2, database-privileges.sql, then runs in each Fairfold
-- Grants database. Both are safe to run any number of times. They run when
-- the server is first created and again before every migration run;
-- migrations never create or alter a role.
--
-- Two modes, chosen by the caller in the session setting tps.admin_mode:
-- - superuser (the default): run as a true superuser.
-- - managed: run as a managed database's admin role, which has CREATEROLE
--   but is not a superuser (on Cloud SQL, a member of cloudsqlsuperuser).
--   PostgreSQL lets it set only the attributes it holds itself, so it sets
--   those and roles.ts then checks every role. PostgreSQL gives it ADMIN
--   OPTION, and nothing more, on each role it creates; that grant stays,
--   and any other membership it holds in these roles is revoked.
--
-- Passwords never reach this file or the server in clear. Before running it,
-- the caller computes a SCRAM-SHA-256 verifier for each role's password and
-- sets it as a session setting:
--   tps.scram_verifier_migrator
--   tps.scram_verifier_app_api
--   tps.scram_verifier_app_worker
--   tps.scram_verifier_app_auth
--   tps.scram_verifier_app_queue
--   tps.scram_verifier_backup_reader
-- The script clears them before it commits. The callers are
-- packages/db/scripts/roles.ts (Node.js) and
-- infra/compose/postgres/initdb/10-roles.sh (psql, on the first start).
--
-- backup_reader is the one role that bypasses row-level security, so that
-- pg_dump reads every row of every table (ADR 0011). It only reads: part 2
-- grants it SELECT and nothing else, and no role belongs to it.
--
-- Each approved definer function (ADR 0003, "Approved definer functions",
-- and ADR 0019) has its own NOLOGIN owner role, listed below, which owns
-- that function and nothing else. Owners of functions that later tasks add
-- are created ahead, so that no migration waits on a new version of this
-- script; each owns nothing until its migration hands it its function. A
-- new owner role comes with a new version number. The one membership any
-- role holds is migrator's in each owner, with SET but not INHERIT:
-- migrator can hand a function to its owner, or replace it as that owner,
-- but never holds the owner's rights (ADR 0023).

BEGIN;

-- Keep the statements below, which handle password verifiers, out of
-- pg_stat_statements if the server loads it. A run that may not turn it
-- off fails here.
SET LOCAL pg_stat_statements.track = 'none';

-- A run that cannot get its lock within 30 seconds fails rather than waiting.
SET LOCAL lock_timeout = '30s';

DO $roles$
DECLARE
  roles_version CONSTANT text := '4';
  managed CONSTANT boolean := current_setting('tps.admin_mode', true) = 'managed';
  backup_role CONSTANT text := 'backup_reader';
  login_roles CONSTANT text[] := ARRAY['migrator', 'app_api', 'app_worker', 'app_auth', 'app_queue', backup_role];
  owner_roles CONSTANT text[] := ARRAY[
    'owner_auth_session_context',              -- auth.session_context()
    'owner_auth_session_memberships',          -- auth.session_memberships()
    'owner_app_public_tenant',                 -- app.public_tenant()
    'owner_app_public_tenant_logo',            -- app.public_tenant_logo()
    'owner_app_create_tenant',                 -- app.create_tenant()
    'owner_app_tenant_ids',                    -- app.tenant_ids(), S11-48
    'owner_auth_sso_providers_by_key_version', -- S11-60
    'owner_app_purge_expired_audit',           -- S11-97
    'owner_app_apply_retention',               -- app.apply_retention(policy), S11-102
    'owner_party_erase_party',                 -- S11-106
    'owner_grants_clear_answer_fields',        -- S11-106
    'owner_app_destroy_subject_key',           -- S11-106, only if ADR 0027 chooses crypto-shredding
    'owner_app_reapply_erasure_ledger',        -- S11-109
    'owner_app_erase_notes',                   -- S12-13
    'owner_assure_erase_subject',              -- S12-14
    'owner_privacy_erase_subject',             -- S12-18
    'owner_grants_erase_reminders',            -- S12-21
    'owner_crm_erase_subject',                 -- S12-25
    'owner_forms_submit_public_response',      -- S12-44
    'owner_forms_erase_subject',               -- S12-44
    'owner_grants_public_open_rounds',         -- S12-48
    'owner_app_embed_origins',                 -- S12-48
    'owner_party_record_unsubscribe',          -- S12-53
    'owner_app_resolve_signature_callback',    -- S12-62
    'owner_app_erase_documents'                -- S12-62
  ];
  admin record;
  refused text;
  is_login boolean;
  role_name text;
  role_verifier text;
  verifier_parts text[];
  membership record;
  role_setting record;
BEGIN
  SELECT oid, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls INTO admin
  FROM pg_catalog.pg_roles WHERE rolname = current_user;

  IF NOT managed THEN
    IF NOT admin.rolsuper THEN
      RAISE EXCEPTION 'Run the roles script as a superuser.';
    END IF;
    -- Two sessions changing roles at once fail with "tuple concurrently
    -- updated", even from different databases. pg_authid is shared by every
    -- database, so this lock serialises every run of this script on the server.
    LOCK TABLE pg_catalog.pg_authid IN SHARE ROW EXCLUSIVE MODE;
  ELSE
    IF NOT admin.rolcreaterole THEN
      RAISE EXCEPTION 'Run the roles script in managed mode as a role with CREATEROLE.';
    END IF;
    IF NOT (admin.rolsuper OR admin.rolbypassrls) THEN
      RAISE EXCEPTION 'Role % needs BYPASSRLS so that pg_dump reads every row, and role % cannot grant it without BYPASSRLS itself.',
        backup_role, current_user;
    END IF;
    -- Only a superuser can change a superuser, and only a role holding ADMIN
    -- OPTION on a role, as its creator does, can change it at all.
    SELECT string_agg(r.rolname, ', ' ORDER BY r.rolname) INTO refused
    FROM pg_catalog.pg_roles r
    WHERE r.rolname = ANY (login_roles || owner_roles)
      AND (r.rolsuper OR NOT EXISTS (
        SELECT FROM pg_catalog.pg_auth_members m
        WHERE m.roleid = r.oid AND m.member = admin.oid AND m.admin_option));
    IF refused IS NOT NULL THEN
      RAISE EXCEPTION 'Role % cannot change roles %: each is a superuser, or % has no ADMIN OPTION on it.',
        current_user, refused, current_user;
    END IF;
    -- pg_authid is not readable here. Runs in the same database wait for
    -- each other; the callers run this in the maintenance database.
    PERFORM pg_catalog.pg_advisory_xact_lock(4917734305101002001);
  END IF;

  FOREACH role_name IN ARRAY login_roles || owner_roles
  LOOP
    is_login := role_name = ANY (login_roles);

    IF is_login THEN
      -- A verifier in PostgreSQL's stored format: at least 4096 iterations, a
      -- salt of at least 16 bytes, and 32-byte stored and server keys.
      role_verifier := current_setting('tps.scram_verifier_' || role_name, true);
      verifier_parts := regexp_match(role_verifier,
        '^SCRAM-SHA-256\$([0-9]{4,9}):([A-Za-z0-9+/]{22,}={0,2})\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$');
      IF verifier_parts IS NULL OR verifier_parts[1]::integer < 4096 THEN
        RAISE EXCEPTION 'Set a SCRAM-SHA-256 verifier with at least 4096 iterations for role % before running the roles script.', role_name;
      END IF;
    END IF;

    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I', role_name);
    END IF;

    -- Every attribute the running role may set is set explicitly, so a role
    -- changed by hand is reset. A superuser sets them all.
    EXECUTE format('ALTER ROLE %I WITH %s', role_name, concat_ws(' ',
      CASE WHEN is_login THEN 'LOGIN' ELSE 'NOLOGIN' END,
      CASE WHEN admin.rolsuper THEN 'NOSUPERUSER' END,
      CASE WHEN admin.rolsuper OR admin.rolcreatedb THEN 'NOCREATEDB' END,
      'NOCREATEROLE INHERIT',
      CASE WHEN admin.rolsuper OR admin.rolreplication THEN 'NOREPLICATION' END,
      CASE WHEN role_name = backup_role THEN 'BYPASSRLS' ELSE 'NOBYPASSRLS' END,
      format('CONNECTION LIMIT -1 VALID UNTIL %L', 'infinity')));

    -- The role belongs to no other role, and no other role belongs to it.
    -- migrator's memberships in the owners are granted again below. In
    -- managed mode the running role keeps the ADMIN OPTION it holds as the
    -- role's creator, and a grant it may not revoke is left for roles.ts
    -- to report.
    FOR membership IN
      SELECT granted.rolname AS granted_role, member.rolname AS member_role, grantor.rolname AS grantor_role
      FROM pg_catalog.pg_auth_members m
      JOIN pg_catalog.pg_roles granted ON granted.oid = m.roleid
      JOIN pg_catalog.pg_roles member ON member.oid = m.member
      JOIN pg_catalog.pg_roles grantor ON grantor.oid = m.grantor
      WHERE (member.rolname = role_name OR granted.rolname = role_name)
        AND NOT (managed AND m.member = admin.oid
                 AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option)
    LOOP
      BEGIN
        EXECUTE format('REVOKE %I FROM %I GRANTED BY %I CASCADE',
          membership.granted_role, membership.member_role, membership.grantor_role);
      EXCEPTION WHEN insufficient_privilege THEN
        IF NOT managed THEN
          RAISE;
        END IF;
      END;
    END LOOP;

    -- No per-role settings, such as a search_path, in any database.
    FOR role_setting IN
      SELECT d.datname AS database_name
      FROM pg_catalog.pg_db_role_setting s
      JOIN pg_catalog.pg_roles r ON r.oid = s.setrole
      LEFT JOIN pg_catalog.pg_database d ON d.oid = s.setdatabase
      WHERE r.rolname = role_name
    LOOP
      IF role_setting.database_name IS NULL THEN
        EXECUTE format('ALTER ROLE %I RESET ALL', role_name);
      ELSE
        EXECUTE format('ALTER ROLE %I IN DATABASE %I RESET ALL', role_name, role_setting.database_name);
      END IF;
    END LOOP;

    -- The migrate job reads this at start-up and refuses to run against
    -- roles from another version of this script.
    EXECUTE format('COMMENT ON ROLE %I IS %L', role_name, 'tps-roles-version=' || roles_version);

    -- A function owner never logs in, so it has no password at all.
    IF NOT is_login THEN
      EXECUTE format('ALTER ROLE %I PASSWORD NULL', role_name);
      CONTINUE;
    END IF;

    -- In managed mode pg_authid is not readable, so the check after the
    -- password statement cannot run. Check instead that the salt decodes,
    -- as PostgreSQL checks before it stores a verifier as given.
    IF managed THEN
      BEGIN
        PERFORM pg_catalog.decode(verifier_parts[2], 'base64');
      EXCEPTION WHEN invalid_parameter_value THEN
        RAISE EXCEPTION 'Set a SCRAM-SHA-256 verifier with at least 4096 iterations for role % before running the roles script.', role_name;
      END;
    END IF;

    -- The password statement runs on its own, and a failure is reported
    -- without the statement text, so the verifier never reaches an error
    -- message or the server log.
    BEGIN
      EXECUTE format('ALTER ROLE %I PASSWORD %L', role_name, role_verifier);
    EXCEPTION WHEN OTHERS OR query_canceled THEN
      RAISE EXCEPTION 'Could not set the password for role % (SQLSTATE %).', role_name, SQLSTATE;
    END;

    -- PostgreSQL stores a well-formed verifier as given and hashes anything
    -- else as if it were a password, so check it kept exactly this one.
    IF NOT managed AND (SELECT rolpassword FROM pg_catalog.pg_authid WHERE rolname = role_name)
        IS DISTINCT FROM role_verifier THEN
      RAISE EXCEPTION 'The password for role % was not stored as the verifier given.', role_name;
    END IF;
  END LOOP;

  FOREACH role_name IN ARRAY owner_roles
  LOOP
    EXECUTE format('GRANT %I TO migrator WITH ADMIN FALSE, INHERIT FALSE, SET TRUE', role_name);
  END LOOP;
END
$roles$;

RESET tps.scram_verifier_migrator;
RESET tps.scram_verifier_app_api;
RESET tps.scram_verifier_app_worker;
RESET tps.scram_verifier_app_auth;
RESET tps.scram_verifier_app_queue;
RESET tps.scram_verifier_backup_reader;

COMMIT;
