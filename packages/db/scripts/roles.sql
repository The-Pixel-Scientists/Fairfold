-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- PixelGrant database roles, version 1 (ADR 0003), part 1 of 2: the roles.
--
-- Creates the login roles and resets their attributes, memberships, settings
-- and passwords. Roles belong to the whole server, so this runs as a
-- superuser connected to the maintenance database (postgres). Part 2,
-- database-privileges.sql, then runs in each PixelGrant database. Both are
-- safe to run any number of times. They run when the server is first created
-- and again before every migration run; migrations never create or alter a
-- role.
--
-- Passwords never reach this file or the server in clear. Before running it,
-- the caller computes a SCRAM-SHA-256 verifier for each role's password and
-- sets it as a session setting:
--   pixelgrant.scram_verifier_migrator
--   pixelgrant.scram_verifier_app_api
--   pixelgrant.scram_verifier_app_worker
--   pixelgrant.scram_verifier_app_auth
--   pixelgrant.scram_verifier_app_queue
-- The script clears them before it commits. The callers are
-- packages/db/scripts/roles.ts (Node.js) and
-- infra/compose/postgres/initdb/10-roles.sh (psql, on the first start).
--
-- Function-owner roles (ADR 0003, "Approved definer functions") are added
-- here, with a new version number, in the change that adds their function.
--
-- Known limitation: this needs a true superuser, which managed services such
-- as Cloud SQL do not provide; see S01-02 and ADR 0012.

BEGIN;

-- Two sessions changing roles at once fail with "tuple concurrently
-- updated", even from different databases. pg_authid is shared by every
-- database, so this lock serialises every run of this script on the server.
LOCK TABLE pg_catalog.pg_authid IN SHARE ROW EXCLUSIVE MODE;

DO $roles$
DECLARE
  roles_version CONSTANT text := '1';
  role_name text;
  role_verifier text;
  membership record;
  role_setting record;
BEGIN
  IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Run the roles script as a superuser.';
  END IF;

  FOREACH role_name IN ARRAY ARRAY['migrator', 'app_api', 'app_worker', 'app_auth', 'app_queue']
  LOOP
    role_verifier := current_setting('pixelgrant.scram_verifier_' || role_name, true);
    IF role_verifier IS NULL OR role_verifier !~
        '^SCRAM-SHA-256\$[0-9]+:[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$' THEN
      RAISE EXCEPTION 'Set a SCRAM-SHA-256 verifier for role % before running the roles script.', role_name;
    END IF;

    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I', role_name);
    END IF;

    -- Every attribute is set explicitly, so a role changed by hand is reset.
    EXECUTE format(
      'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT '
        'NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1 VALID UNTIL %L',
      role_name, 'infinity');

    -- The role belongs to no other role, and no other role belongs to it.
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
    EXECUTE format('COMMENT ON ROLE %I IS %L', role_name, 'pixelgrant-roles-version=' || roles_version);

    -- The password statement runs on its own, and a failure is reported
    -- without the statement text, so the verifier never reaches an error
    -- message or the server log.
    BEGIN
      EXECUTE format('ALTER ROLE %I PASSWORD %L', role_name, role_verifier);
    EXCEPTION WHEN OTHERS OR query_canceled THEN
      RAISE EXCEPTION 'Could not set the password for role % (SQLSTATE %).', role_name, SQLSTATE;
    END;
  END LOOP;
END
$roles$;

RESET pixelgrant.scram_verifier_migrator;
RESET pixelgrant.scram_verifier_app_api;
RESET pixelgrant.scram_verifier_app_worker;
RESET pixelgrant.scram_verifier_app_auth;
RESET pixelgrant.scram_verifier_app_queue;

COMMIT;
