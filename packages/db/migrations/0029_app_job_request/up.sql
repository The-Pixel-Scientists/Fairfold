-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0029, up: job requests, the platform's queues and the release
-- email handler's grants (ADR 0009, "Jobs that act for a user", S11-67).
--
-- A job request is what a job acting for a member trusts: who asked, under
-- which permission, with which filters and fields. app_api writes it after
-- authorising the request under the session, and the job's payload holds
-- only its id. Nothing app_worker can do widens it: the worker changes only
-- the status, failure code and output file, and the database sets every
-- time. The output is kept 7 days from completion, then the row goes.

CREATE TABLE app.job_request (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN (
    'subject_access', 'erasure', 'audit_log_export', 'view_csv_export', 'board_pack')),
  requested_by uuid NOT NULL,
  permission text NOT NULL
    CHECK (permission ~ '^[a-z][a-z0-9_]{0,62}\.[a-z][a-z0-9_]{0,62}\.[a-z][a-z0-9_]{0,62}$'),
  -- Ids, enums, dates and integers only, which the route schemas enforce;
  -- they stay the main control. The backstop: an object of at most 8 KiB
  -- whose keys are identifiers and whose strings are short tokens. A space,
  -- comma or @ never fits, but a short token such as a surname still does.
  filters jsonb NOT NULL
    CONSTRAINT job_request_filters CHECK (
      jsonb_typeof(filters) = 'object'
      AND octet_length(filters::text) <= 8192
      AND NOT jsonb_path_exists(filters,
        '$.** ? (@.type() == "string" && !(@ like_regex "^[A-Za-z0-9_.:+-]{1,64}$"))')
      AND NOT jsonb_path_exists(filters,
        '$.** ? (@.type() == "object").keyvalue() ? (!(@.key like_regex "^[a-z][A-Za-z0-9_]{0,63}$"))')),
  -- Column field ids (<schema>.<table>.<column>) and form answer field ids.
  field_ids text[] NOT NULL
    CONSTRAINT job_request_field_ids CHECK (
      array_ndims(field_ids) = 1
      AND cardinality(field_ids) BETWEEN 1 AND 500
      AND array_to_string(field_ids, ' ', '*') ~ ('^(?:[a-z][a-z0-9_]{0,62}\.[a-z][a-z0-9_]{0,62}\.[a-z][a-z0-9_]{0,62}|f_[a-z0-9]{1,32})'
        '(?: (?:[a-z][a-z0-9_]{0,62}\.[a-z][a-z0-9_]{0,62}\.[a-z][a-z0-9_]{0,62}|f_[a-z0-9]{1,32}))*$')),
  output_sensitivity text NOT NULL
    CHECK (output_sensitivity IN ('public', 'internal', 'personal', 'special_category')),
  request_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'ready', 'failed', 'expired')),
  failure_code text
    CHECK (failure_code IN ('invalid_payload', 'precondition_failed', 'not_found', 'internal')),
  output_file_id uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz,
  UNIQUE (tenant_id, id),
  CONSTRAINT job_request_failure CHECK ((status = 'failed') = (failure_code IS NOT NULL)),
  CONSTRAINT job_request_output CHECK ((status = 'ready') = (output_file_id IS NOT NULL)),
  CONSTRAINT job_request_completion
    CHECK ((status IN ('queued', 'running')) = (completed_at IS NULL)),
  CONSTRAINT job_request_lasts_7_days
    CHECK (expires_at IS NOT DISTINCT FROM completed_at + interval '7 days'),
  FOREIGN KEY (tenant_id, requested_by)
    REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, output_file_id) REFERENCES app.file (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX job_request_expiry ON app.job_request (tenant_id, expires_at);

SELECT app.enable_tenant_rls('app.job_request');
-- app_worker deletes only rows past their expiry; no other app role deletes.
CREATE POLICY expired_delete ON app.job_request AS RESTRICTIVE FOR DELETE TO app_worker
  USING (expires_at < now());
CREATE POLICY deny_delete ON app.job_request AS RESTRICTIVE FOR DELETE
  TO app_api, app_queue, app_auth USING (false);

-- A new request is queued, requested now, with no outcome, whatever the
-- insert supplied. After that only the status moves, queued to running,
-- running to ready or failed, and ready to expired, which lets the output
-- file go. Completion and expiry are set when a request becomes ready or
-- failed. An update that changes nothing passes.
CREATE FUNCTION app.keep_job_request()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'queued';
    NEW.failure_code := NULL;
    NEW.output_file_id := NULL;
    NEW.requested_at := pg_catalog.now();
    NEW.updated_at := NEW.requested_at;
    NEW.completed_at := NULL;
    NEW.expires_at := NULL;
    RETURN NEW;
  END IF;
  IF NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NEW;
  END IF;
  IF (NEW.tenant_id, NEW.id, NEW.kind, NEW.requested_by, NEW.permission, NEW.filters,
      NEW.field_ids, NEW.output_sensitivity, NEW.request_id, NEW.requested_at)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.id, OLD.kind, OLD.requested_by, OLD.permission, OLD.filters,
      OLD.field_ids, OLD.output_sensitivity, OLD.request_id, OLD.requested_at) THEN
    RAISE EXCEPTION 'Only the status, failure code and output file of job request % can change.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF (OLD.status, NEW.status) NOT IN (('queued', 'running'), ('running', 'ready'),
                                      ('running', 'failed'), ('ready', 'expired')) THEN
    RAISE EXCEPTION 'Job request % cannot move from % to %.', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  NEW.updated_at := pg_catalog.now();
  IF NEW.status IN ('ready', 'failed') THEN
    NEW.completed_at := NEW.updated_at;
    NEW.expires_at := NEW.completed_at + interval '7 days';
  ELSE
    NEW.completed_at := OLD.completed_at;
    NEW.expires_at := OLD.expires_at;
  END IF;
  IF NEW.status = 'expired' THEN
    NEW.output_file_id := NULL;
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER keep_job_request BEFORE INSERT OR UPDATE ON app.job_request
  FOR EACH ROW EXECUTE FUNCTION app.keep_job_request();

-- app_api writes the request; the requester and request id come from the
-- session. app_worker runs it and deletes it once expired. completed_at is
-- granted so a handler may name it, but the trigger sets it.
GRANT SELECT,
      INSERT (tenant_id, id, kind, requested_by, permission, filters, field_ids,
              output_sensitivity, request_id)
   ON app.job_request TO app_api;
GRANT SELECT, UPDATE (status, failure_code, output_file_id, completed_at), DELETE
   ON app.job_request TO app_worker;

-- The platform's queues, each with a dead-letter queue of the same kind
-- named <queue>.dead, in pgboss's shared job table, so no new table needs
-- grants. Platform queues carry no tenant; the rest run in one tenant.
-- A module's own queues come with its schema migration.
DO $$
DECLARE
  queue record;
BEGIN
  FOR queue IN SELECT * FROM (VALUES
      ('platform.fan_out', 'platform'),
      ('platform.audit_purge', 'platform'),
      ('platform.file_scan', 'tenant'),
      ('platform.idempotency_purge', 'tenant'),
      ('platform.subject_access_export', 'tenant'),
      ('platform.erasure', 'tenant'),
      ('platform.job_request_expiry', 'tenant'),
      ('platform.retention_sweep', 'tenant'),
      ('platform.view_csv_export', 'tenant'),
      ('platform.audit_log_export', 'tenant'),
      ('platform.board_pack', 'tenant'),
      ('grants.release_email', 'tenant'),
      ('events.crm', 'tenant'),
      ('events.assure', 'tenant')) AS q(name, kind)
  LOOP
    PERFORM pgboss.create_queue(queue.name || '.dead', '{"policy": "standard"}');
    PERFORM pgboss.create_queue(queue.name,
      jsonb_build_object('policy', 'standard', 'deadLetter', queue.name || '.dead'));
    INSERT INTO app.job_queue (name, kind)
      VALUES (queue.name || '.dead', queue.kind), (queue.name, queue.kind);
  END LOOP;
END
$$;

-- The release email handler (S11-92), in the decision's tenant: it reads
-- the released decision, its release event and the template version, the
-- recipient's given name and address, and records each sending attempt.
-- The standard tenant policies already apply to every role.
GRANT USAGE ON SCHEMA grants, party TO app_worker;
GRANT SELECT ON grants.decision, grants.email_template_version, app.audit_event TO app_worker;
GRANT SELECT, UPDATE (status, error_code) ON grants.decision_email TO app_worker;
GRANT SELECT (tenant_id, id, given_name, email) ON party.person TO app_worker;
