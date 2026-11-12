-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0064, down: put back app.apply_retention() as migration 0032
-- wrote it, with no targets, and remove its owner's crm, file and audit
-- rights, the job file release, the import periods' bounds and the two
-- import policies. Rows the function deleted stay deleted. While any tenant
-- has set an import period, restoring 0003's policy check fails and this
-- changes nothing; outside development, an admin's setting is not removed
-- for a rollback.

GRANT CREATE ON SCHEMA app TO owner_app_apply_retention;
SET LOCAL ROLE owner_app_apply_retention;

CREATE OR REPLACE FUNCTION app.apply_retention(policy text)
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

RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM owner_app_apply_retention;

DROP POLICY retention_insert ON app.audit_event;
DROP POLICY retention_delete ON crm.import_job;
DROP POLICY retention_delete ON crm.import_row;

REVOKE ALL ON app.audit_event, app.file, app.retention_policy, crm.import_job, crm.import_row
  FROM owner_app_apply_retention;
REVOKE EXECUTE ON FUNCTION app.release_file(uuid) FROM owner_app_apply_retention;
REVOKE USAGE ON SCHEMA crm FROM owner_app_apply_retention;

DROP TRIGGER release_import_file ON crm.import_job;
DROP FUNCTION crm.release_import_file();
ALTER TABLE crm.import_job DROP CONSTRAINT import_job_one_file;

ALTER TABLE app.retention_policy
  DROP CONSTRAINT retention_policy_crm_import_rows_maximum,
  DROP CONSTRAINT retention_policy_crm_import_jobs_maximum,
  DROP CONSTRAINT retention_policy_crm_import_rows_minimum,
  DROP CONSTRAINT retention_policy_crm_import_jobs_minimum,
  DROP CONSTRAINT retention_policy_policy_check,
  ADD CONSTRAINT retention_policy_policy_check CHECK (policy IN ('audit'));
