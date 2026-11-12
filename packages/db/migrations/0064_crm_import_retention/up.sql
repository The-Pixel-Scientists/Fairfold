-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0064, up: retention of CSV imports (S12-25, ADR 0003, S11-102).
--
-- Import rows hold a spreadsheet's names, emails and phone numbers as read,
-- so they are kept 30 days after their job last changed (it finished,
-- failed, or was left unconfirmed), and import jobs 90 days, as the record
-- of who imported what, once none of their rows is left. Each is a tenant
-- policy with that platform minimum, as the classification map says: an
-- admin may keep them longer, never shorter, and never past a ceiling. A
-- row that matched or created no party has no subject path, so erasure and
-- subject access cannot reach it: rows are kept at most 90 days, and jobs,
-- which keep the uploaded file, at most 366, the limit for data with no
-- subject path.
--
-- app.apply_retention() gains these two targets, as migration 0032 planned.
-- In the tenant set, it deletes rows past the tenant's setting or the
-- minimum, at most 1000 a call (the sweep calls again while a call deletes
-- any), and writes one platform.retention.applied event when it deletes
-- anything. Its owner gets only the rights that needs. A restrictive policy
-- on each table holds even the owner to rows past the platform minimum, and
-- one on app.audit_event to its own event. Deleting a job releases the file
-- it linked when it was added (ADR 0030), so the file sweep removes the
-- upload; a file backs one job.
-- No app role deletes either table. Every right and policy is listed in
-- test/catalogue/app.ts.

ALTER TABLE app.retention_policy
  DROP CONSTRAINT retention_policy_policy_check,
  ADD CONSTRAINT retention_policy_policy_check
    CHECK (policy IN ('audit', 'crm_import_jobs', 'crm_import_rows')),
  ADD CONSTRAINT retention_policy_crm_import_jobs_minimum
    CHECK (policy <> 'crm_import_jobs' OR days >= 90),
  ADD CONSTRAINT retention_policy_crm_import_rows_minimum
    CHECK (policy <> 'crm_import_rows' OR days >= 30),
  ADD CONSTRAINT retention_policy_crm_import_jobs_maximum
    CHECK (policy <> 'crm_import_jobs' OR days <= 366),
  ADD CONSTRAINT retention_policy_crm_import_rows_maximum
    CHECK (policy <> 'crm_import_rows' OR days <= 90);

ALTER TABLE crm.import_job ADD CONSTRAINT import_job_one_file UNIQUE (tenant_id, file_id);

CREATE FUNCTION crm.release_import_file()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  PERFORM app.release_file(OLD.file_id);
  RETURN NULL;
END
$function$;
CREATE TRIGGER release_import_file AFTER DELETE ON crm.import_job
  FOR EACH ROW EXECUTE FUNCTION crm.release_import_file();

GRANT USAGE ON SCHEMA crm TO owner_app_apply_retention;
GRANT SELECT (tenant_id, policy, days) ON app.retention_policy TO owner_app_apply_retention;
GRANT SELECT (tenant_id, id, job_id), DELETE ON crm.import_row TO owner_app_apply_retention;
GRANT SELECT (tenant_id, id, updated_at), DELETE ON crm.import_job TO owner_app_apply_retention;
-- The job trigger's app.release_file(), as the caller.
GRANT EXECUTE ON FUNCTION app.release_file(uuid) TO owner_app_apply_retention;
GRANT SELECT (tenant_id, id, released_at), UPDATE (released_at)
   ON app.file TO owner_app_apply_retention;
GRANT INSERT (tenant_id, request_id, actor_kind, action, entity_type, entity_id, changes)
   ON app.audit_event TO owner_app_apply_retention;

-- The tenant policies, TO PUBLIC, admit the owner within the tenant; these
-- narrow it further.
CREATE POLICY retention_delete ON crm.import_row AS RESTRICTIVE FOR DELETE
  TO owner_app_apply_retention
  USING (created_at < now() - interval '30 days');
CREATE POLICY retention_delete ON crm.import_job AS RESTRICTIVE FOR DELETE
  TO owner_app_apply_retention
  USING (updated_at < now() - interval '90 days');
CREATE POLICY retention_insert ON app.audit_event AS RESTRICTIVE FOR INSERT
  TO owner_app_apply_retention
  WITH CHECK (action = 'platform.retention.applied' AND actor_kind = 'system');

-- Replaced as its owner, so it keeps its owner and grants (ADR 0023).
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
