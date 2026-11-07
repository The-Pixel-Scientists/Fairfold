-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0040, up: operator commands get their own role, app_operator
-- (ADR 0009, ADR 0024; Aaron, 29 October 2026).
--
-- The roles script creates app_operator NOLOGIN and makes app_worker a
-- member with SET but not INHERIT, so app_worker holds none of these rights
-- until withOperator() runs SET LOCAL ROLE app_operator inside a tenant's
-- transaction. The module switch rights 0039 gave app_worker move here, and
-- app_operator records the operator's own audit events. app_worker keeps its
-- audit grants, which jobs and the operator's invitation still use.
--
-- The tenant policies, TO PUBLIC, already limit app_operator to the tenant
-- set. The restrictive policies below also hold its new rows to that
-- tenant and to the operator as author, a switch to on, and an event to no
-- subject. No grant lets it change or remove a row.
--
-- The migration stops first unless the roles script has set app_operator
-- up so: no role may inherit its rights, and app_worker alone may set it.
-- A managed admin's creator grant, ADMIN only, is the one other membership
-- allowed, as in the roles script.

DO $check$
DECLARE
  bad text;
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_operator') THEN
    RAISE EXCEPTION 'Role app_operator does not exist. Run a roles script that creates it before migration 0040.';
  END IF;

  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_operator'
             AND (rolcanlogin OR rolbypassrls OR rolsuper OR rolcreaterole
                  OR rolcreatedb OR rolreplication)) THEN
    RAISE EXCEPTION 'Role app_operator must be NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION.';
  END IF;

  IF NOT EXISTS (SELECT FROM pg_catalog.pg_auth_members
                 WHERE roleid = 'app_operator'::regrole AND member = 'app_worker'::regrole
                   AND set_option AND NOT inherit_option AND NOT admin_option) THEN
    RAISE EXCEPTION 'app_worker must be a member of app_operator WITH INHERIT FALSE, SET TRUE, ADMIN FALSE.';
  END IF;

  SELECT string_agg(format('%s in %s', member::regrole, roleid::regrole), ', ') INTO bad
  FROM pg_catalog.pg_auth_members
  WHERE member = 'app_operator'::regrole
     OR (roleid = 'app_operator'::regrole
         AND (inherit_option
              OR (member = 'app_worker'::regrole AND admin_option)
              OR (member <> 'app_worker'::regrole AND set_option)));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Role app_operator has a membership the roles script does not allow: %.', bad;
  END IF;
END
$check$;

GRANT USAGE ON SCHEMA app TO app_operator;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO app_operator;

REVOKE SELECT, INSERT (tenant_id, module, enabled, updated_by_kind)
    ON app.tenant_module FROM app_worker;
GRANT SELECT, INSERT (tenant_id, module, enabled, updated_by_kind)
   ON app.tenant_module TO app_operator;
ALTER POLICY operator_switch_insert ON app.tenant_module TO app_operator;

REVOKE SELECT, INSERT (tenant_id, entity_type, entity_id, version, author_kind, diff)
    ON app.config_version FROM app_worker;
GRANT SELECT, INSERT (tenant_id, entity_type, entity_id, version, author_kind, diff)
   ON app.config_version TO app_operator;
ALTER POLICY operator_version_insert ON app.config_version TO app_operator;

-- The retention trigger runs with the inserting role's rights, so
-- app_operator reads the tenant's retention settings, as app_worker does.
-- subject_party_id is in every insert the writer makes; the policy keeps
-- it null.
GRANT INSERT (tenant_id, request_id, actor_kind, actor_id, action, entity_type, entity_id,
              changes, subject_party_id)
   ON app.audit_event TO app_operator;
GRANT SELECT ON app.retention_policy TO app_operator;
CREATE POLICY operator_audit_insert ON app.audit_event AS RESTRICTIVE FOR INSERT
  TO app_operator
  WITH CHECK (tenant_id = app.current_tenant_id()
              AND actor_kind = 'operator' AND actor_id IS NULL
              AND subject_party_id IS NULL);
