-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0113, down: put back app.apply_retention() as migration 0064
-- wrote it, with the crm import targets alone, and remove its owner's forms
-- rights and the two forms policies. Rows the function deleted stay deleted.

GRANT CREATE ON SCHEMA app TO owner_app_apply_retention;
SET LOCAL ROLE owner_app_apply_retention;

CREATE OR REPLACE FUNCTION app.apply_retention(policy text)
  RETURNS TABLE (target text, deleted integer, anonymised integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  retention_tenant CONSTANT uuid := app.current_tenant_id();
  batch_size CONSTANT integer := 1000;
  minimum_days integer;
  setting_days integer;
  cut_off timestamptz;
  removed integer;
BEGIN
  IF retention_tenant IS NULL THEN
    RAISE EXCEPTION 'Retention applies only with a tenant set.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF policy = 'audit' THEN
    RAISE EXCEPTION 'The audit policy is applied by app.purge_expired_audit().'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  minimum_days := CASE policy WHEN 'crm_import_rows' THEN 30 WHEN 'crm_import_jobs' THEN 90 END;
  IF minimum_days IS NULL THEN
    RAISE EXCEPTION 'No retention targets exist for this policy.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT p.days INTO setting_days
    FROM app.retention_policy p
   WHERE p.tenant_id = retention_tenant AND p.policy = apply_retention.policy;
  cut_off := pg_catalog.now()
    - pg_catalog.make_interval(days => GREATEST(minimum_days, COALESCE(setting_days, 0)));

  IF policy = 'crm_import_rows' THEN
    target := 'crm.import_row';
    DELETE FROM crm.import_row
     WHERE id = ANY (ARRAY(SELECT r.id FROM crm.import_row r
                             JOIN crm.import_job j ON j.tenant_id = r.tenant_id AND j.id = r.job_id
                            WHERE r.tenant_id = retention_tenant AND j.updated_at < cut_off
                            LIMIT batch_size));
  ELSE
    target := 'crm.import_job';
    DELETE FROM crm.import_job
     WHERE id = ANY (ARRAY(SELECT j.id FROM crm.import_job j
                            WHERE j.tenant_id = retention_tenant AND j.updated_at < cut_off
                              AND NOT EXISTS (SELECT FROM crm.import_row r
                                               WHERE r.tenant_id = j.tenant_id AND r.job_id = j.id)
                            LIMIT batch_size));
  END IF;
  GET DIAGNOSTICS removed = ROW_COUNT;

  IF removed > 0 THEN
    INSERT INTO app.audit_event
      (tenant_id, request_id, actor_kind, action, entity_type, entity_id, changes)
    VALUES (retention_tenant, pg_catalog.gen_random_uuid(), 'system', 'platform.retention.applied',
            'platform.retention', retention_tenant,
            pg_catalog.jsonb_build_object('policy', policy, 'target', target, 'deleted', removed));
  END IF;
  deleted := removed;
  anonymised := 0;
  RETURN NEXT;
END
$function$;

RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM owner_app_apply_retention;

DROP POLICY retention_delete ON forms.response;
DROP POLICY retention_delete ON forms.respondent_token;

REVOKE ALL ON forms.response, forms.respondent_token FROM owner_app_apply_retention;
REVOKE USAGE ON SCHEMA forms FROM owner_app_apply_retention;
