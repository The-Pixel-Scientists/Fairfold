-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0032, up: tenant retention settings that admins may change, and
-- app.apply_retention(), the one approved function for every retention
-- action other than the audit purge (ADR 0003, "Audit retention"; S11-102).
--
-- app.retention_policy keeps 0003's checks: its policy CHECK admits audit,
-- the one policy the classification map names, and retention_policy_audit_
-- minimum keeps it at 365 days or more; test/retention fails if the map and
-- the checks disagree. app_api may now add and change its tenant's settings
-- once the server has checked the permission and step-up. Nothing removes
-- one, since no row means the platform minimum.
--
-- No column outside the audit tables has a tenant_policy rule yet, so the
-- function has no targets and changes nothing: it refuses a call with no
-- tenant set, audit (app.purge_expired_audit() applies it) and every other
-- policy. The migration that first puts columns under another policy
-- replaces it with that policy's targets, each acting in bounded batches on
-- rows past the tenant's setting or the minimum, deleting rows or, where a
-- row is referenced, anonymising it (ADR 0027), returning one row per target
-- and writing one platform.retention.applied event when anything changed.
-- That migration grants the owner only its targets' rights, which
-- test/catalogue/app.ts lists.

-- Admins' settings, within the tenant (tenant_insert and tenant_update,
-- from app.enable_tenant_rls() in 0003). The acting membership comes from
-- the session. An update changes only days and updated_by, never the
-- setting's tenant, policy or author.
DROP POLICY deny_insert ON app.retention_policy;
DROP POLICY deny_update ON app.retention_policy;
GRANT INSERT (tenant_id, policy, days, created_by, updated_by), UPDATE (days, updated_by)
   ON app.retention_policy TO app_api;

CREATE FUNCTION app.apply_retention(policy text)
  RETURNS TABLE (target text, deleted integer, anonymised integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF app.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'Retention applies only with a tenant set.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF policy = 'audit' THEN
    RAISE EXCEPTION 'The audit policy is applied by app.purge_expired_audit().'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RAISE EXCEPTION 'No retention targets exist for this policy.'
    USING ERRCODE = 'invalid_parameter_value';
END
$function$;

GRANT USAGE ON SCHEMA app TO owner_app_apply_retention;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO owner_app_apply_retention;

-- Hand the function to its owner (ADR 0023), with app_worker alone able
-- to call it.
REVOKE ALL ON FUNCTION app.apply_retention(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.apply_retention(text) TO app_worker;
GRANT CREATE ON SCHEMA app TO owner_app_apply_retention;
ALTER FUNCTION app.apply_retention(text) OWNER TO owner_app_apply_retention;
REVOKE CREATE ON SCHEMA app FROM owner_app_apply_retention;
