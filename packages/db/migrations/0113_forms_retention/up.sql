-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0113, up: retention of form responses (B15-03, ADR 0003, ADR
-- 0036), as migration 0079 planned. A submitted response is kept until its
-- retain_until, which the database set from the form's retention months
-- when it was submitted and no app role changes; its token expires with it.
-- The classification map keeps each a day past that time, under the
-- forms_responses policy.
--
-- app.apply_retention('forms_responses') gains these two targets: in the
-- tenant set, it deletes tokens a day past their expires_at, then responses
-- a day past their retain_until that no token still refers to, at most 1000
-- of each a call, so a caller calls again while a call deletes any, and
-- writes one platform.retention.applied event for each target it deletes
-- from. Nothing is deleted until the retention sweep calls this policy, as
-- it must every policy the map names. The periods are the rows' own, so no tenant setting applies and
-- app.retention_policy is unchanged. A draft has no retain_until and is
-- never taken here. Its owner gets only the rights that needs, and a
-- restrictive policy on each table holds even the owner to rows past their
-- time. No app role deletes either table. Every right and policy is listed
-- in test/catalogue/app.ts.

GRANT USAGE ON SCHEMA forms TO owner_app_apply_retention;
GRANT SELECT (tenant_id, id, response_id, expires_at), DELETE
   ON forms.respondent_token TO owner_app_apply_retention;
GRANT SELECT (tenant_id, id, retain_until), DELETE ON forms.response TO owner_app_apply_retention;

-- The tenant policies, TO PUBLIC, admit the owner within the tenant; these
-- narrow it further.
CREATE POLICY retention_delete ON forms.respondent_token AS RESTRICTIVE FOR DELETE
  TO owner_app_apply_retention
  USING (expires_at < now() - interval '1 day');
CREATE POLICY retention_delete ON forms.response AS RESTRICTIVE FOR DELETE
  TO owner_app_apply_retention
  USING (retain_until < now() - interval '1 day');

-- Replaced as its owner, so it keeps its owner and grants (ADR 0023). The
-- crm import targets are as migration 0064 wrote them.
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

  IF policy = 'forms_responses' THEN
    cut_off := pg_catalog.now() - interval '1 day';
    target := 'forms.respondent_token';
    DELETE FROM forms.respondent_token
     WHERE id = ANY (ARRAY(SELECT t.id FROM forms.respondent_token t
                            WHERE t.tenant_id = retention_tenant AND t.expires_at < cut_off
                            LIMIT batch_size));
    GET DIAGNOSTICS removed = ROW_COUNT;
    IF removed > 0 THEN
      INSERT INTO app.audit_event
        (tenant_id, request_id, actor_kind, action, entity_type, entity_id, changes)
      VALUES (retention_tenant, pg_catalog.gen_random_uuid(), 'system',
              'platform.retention.applied', 'platform.retention', retention_tenant,
              pg_catalog.jsonb_build_object('policy', policy, 'target', target, 'deleted', removed));
    END IF;
    deleted := removed;
    anonymised := 0;
    RETURN NEXT;

    target := 'forms.response';
    DELETE FROM forms.response
     WHERE id = ANY (ARRAY(SELECT r.id FROM forms.response r
                            WHERE r.tenant_id = retention_tenant AND r.retain_until < cut_off
                              AND NOT EXISTS (SELECT FROM forms.respondent_token t
                                               WHERE t.tenant_id = r.tenant_id
                                                 AND t.response_id = r.id)
                            LIMIT batch_size));
  ELSE
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
