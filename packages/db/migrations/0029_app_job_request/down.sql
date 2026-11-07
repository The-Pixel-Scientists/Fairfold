-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0029, down: take back the release email handler's grants,
-- remove the platform's queues with any jobs on them, and drop
-- app.job_request with its trigger. Job requests and queued jobs cannot
-- come back, so a rollback loses any that are waiting; a member asks again.

REVOKE SELECT (tenant_id, id, given_name, email) ON party.person FROM app_worker;
REVOKE SELECT, UPDATE (status, error_code) ON grants.decision_email FROM app_worker;
REVOKE SELECT ON grants.decision, grants.email_template_version, app.audit_event FROM app_worker;
REVOKE USAGE ON SCHEMA grants, party FROM app_worker;

DO $$
DECLARE
  queue text;
BEGIN
  FOREACH queue IN ARRAY ARRAY[
      'platform.fan_out', 'platform.audit_purge', 'platform.file_scan',
      'platform.idempotency_purge', 'platform.subject_access_export', 'platform.erasure',
      'platform.job_request_expiry', 'platform.retention_sweep', 'platform.view_csv_export',
      'platform.audit_log_export', 'platform.board_pack', 'grants.release_email',
      'events.crm', 'events.assure']
  LOOP
    DELETE FROM app.job_queue WHERE name IN (queue, queue || '.dead');
    PERFORM pgboss.delete_queue(queue);
    PERFORM pgboss.delete_queue(queue || '.dead');
  END LOOP;
END
$$;

DROP TRIGGER keep_job_request ON app.job_request;
DROP TABLE app.job_request;
DROP FUNCTION app.keep_job_request();
