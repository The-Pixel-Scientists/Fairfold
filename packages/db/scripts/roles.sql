-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Fairfold Grants database roles, version 2 (ADR 0003), part 1 of 2: the roles.
--
-- Creates the login roles and the function-owner roles, and resets their
-- attributes, memberships, settings and passwords. Roles belong to the
-- whole server, so this runs as a superuser connected to the maintenance
-- database (postgres). Part 2, database-privileges.sql, then runs in each
-- Fairfold Grants database. Both are safe to run any number of times. They run
-- when the server is first created and again before every migration run;
-- migrations never create or alter a role.
--
-- Passwords never reach this file or the server in clear. Before running it,
-- the caller computes a SCRAM-SHA-256 verifier for each role's password and
-- sets it as a session setting:
--   tps.scram_verifier_migrator
--   tps.scram_verifier_app_api
--   tps.scram_verifier_app_worker
--   tps.scram_verifier_app_auth
--   tps.scram_verifier_app_queue
-- The script clears them before it commits. The callers are
-- packages/db/scripts/roles.ts (Node.js) and
-- infra/compose/postgres/initdb/10-roles.sh (psql, on the first start).
--
-- Each approved definer function (ADR 0003, "Approved definer functions",
-- and ADR 0019) has its own NOLOGIN owner role, listed below, which owns
-- that function and nothing else. A new owner role comes with a new version
-- number. The one membership any role holds is migrator's in each owner,
-- with SET but not INHERIT: migrator can hand a function to its owner, or
-- replace it as that owner, but never holds the owner's rights (ADR 0023).
--
-- Known limitation: this needs a true superuser, which managed services such
-- as Cloud SQL do not provide; see S01-02 and ADR 0012.

BEGIN;

-- Keep the statements below, which handle password verifiers, out of
-- pg_stat_statements if the server loads it.
SET LOCAL pg_stat_statements.track = 'none';

-- Two sessions changing roles at once fail with "tuple concurrently
-- updated", even from different databases. pg_authid is shared by every
-- database, so this lock serialises every run of this script on the server.
-- A run that cannot get it within 30 seconds fails rather than waiting.
SET LOCAL lock_timeout = '30s';
LOCK TABLE pg_catalog.pg_authid IN SHARE ROW EXCLUSIVE MODE;

DO $roles$
DECLARE
  roles_version CONSTANT text := '2';
  login_roles CONSTANT text[] := ARRAY['migrator', 'app_api', 'app_worker', 'app_auth', 'app_queue'];
  owner_roles CONSTANT text[] := ARRAY[
    'owner_auth_session_context',   -- auth.session_context()
    'owner_app_public_tenant',      -- app.public_tenant()
    'owner_app_public_tenant_logo', -- app.public_tenant_logo()
    'owner_app_create_tenant'       -- app.create_tenant()
  ];
  is_login boolean;
  role_name text;
  role_verifier text;
  verifier_parts text[];
  membership record;
  role_setting record;
BEGIN
  IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Run the roles script as a superuser.';
  END IF;

  FOREACH role_name IN ARRAY login_roles || owner_roles
  LOOP
    is_login := role_name = ANY (login_roles);

    IF is_login THEN
      -- A verifier in PostgreSQL's stored format: at least 4096 iterations, a
      -- salt of at least 16 bytes, and 32-byte stored and server keys.
      role_verifier := current_setting('tps.scram_verifier_' || role_name, true);
      verifier_parts := regexp_match(role_verifier,
        '^SCRAM-SHA-256\$([0-9]{4,9}):[A-Za-z0-9+/]{22,}={0,2}\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$');
      IF verifier_parts IS NULL OR verifier_parts[1]::integer < 4096 THEN
        RAISE EXCEPTION 'Set a SCRAM-SHA-256 verifier with at least 4096 iterations for role % before running the roles script.', role_name;
      END IF;
    END IF;

    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I', role_name);
    END IF;

    -- Every attribute is set explicitly, so a role changed by hand is reset.
    EXECUTE format(
      'ALTER ROLE %I WITH %s NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT '
        'NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1 VALID UNTIL %L',
      role_name, CASE WHEN is_login THEN 'LOGIN' ELSE 'NOLOGIN' END, 'infinity');

    -- The role belongs to no other role, and no other role belongs to it.
    -- migrator's memberships in the owners are granted again below.
    FOR membership IN
      SELECT granted.rolname AS granted_role, member.rolname AS member_role, grantor.rolname AS grantor_role
      FROM pg_catalog.pg_auth_members m
      JOIN pg_catalog.pg_roles granted ON granted.oid = m.roleid
      JOIN pg_catalog.pg_roles member ON member.oid = m.member
      JOIN pg_catalog.pg_roles grantor ON grantor.oid = m.grantor
      WHERE member.rolname = role_name OR granted.rolname = role_name
    LOOP
      EXECUTE format('REVOKE %I FROM %I GRANTED BY %I CASCADE',
        membership.granted_role, membership.member_role, membership.grantor_role);
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

    -- The migrate job, API and worker read this at start-up and refuse to
    -- run against roles from another version of this script.
    EXECUTE format('COMMENT ON ROLE %I IS %L', role_name, 'tps-roles-version=' || roles_version);

    -- A function owner never logs in, so it has no password at all.
    IF NOT is_login THEN
      EXECUTE format('ALTER ROLE %I PASSWORD NULL', role_name);
      CONTINUE;
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
    IF (SELECT rolpassword FROM pg_catalog.pg_authid WHERE rolname = role_name)
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

COMMIT;
