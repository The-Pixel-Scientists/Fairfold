-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0094, up: approval requests (S12-69, ADR 0038). A request is
-- one ask for one approval step on one record. It pins the definition
-- version it was made under and holds ids, codes, counts and times only:
-- no subject column, amount or free text (ADR 0027). The status and
-- withdrawal lists, the count limit and the patterns copy
-- packages/domain/src/workflow.
--
-- Subjects are linked by their module, never here: a module owns a link
-- table per kind of subject, such as finance.payment_run_approval
-- (tenant_id, payment_run_id, approval_request_id, definition_key, step_id),
-- with composite foreign keys to its subject and to
-- app.approval_request (tenant_id, id, definition_key, step_id), both
-- ON DELETE RESTRICT, a unique key on the request, and a BEFORE INSERT
-- trigger running app.check_approval_link() (migration 0096).
--
-- app_api inserts only the version, step and requester. The insert trigger
-- refuses a requester other than app.session_actor()'s membership, and a
-- version that is not its definition's latest or lacks the step, and
-- copies the key, the count and the due date from the pinned version, so
-- nothing the caller supplies decides them. No app role deletes a request;
-- migration 0096 adds the only update, closing one. retain_until is set
-- when a request closes, and a pending request has none, so it is never
-- purged. The service writes platform.approval.requested and the closing
-- events; these migrations write no audit event.

CREATE TABLE app.approval_request (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_version_id uuid NOT NULL,
  definition_key text NOT NULL
    CONSTRAINT approval_request_definition_key_format
      CHECK (definition_key ~ '^[a-z]+\.[a-z][a-z_]{0,62}$'),
  step_id text NOT NULL
    CONSTRAINT approval_request_step_id_format CHECK (step_id ~ '^[a-z][a-z0-9_]{0,62}$'),
  required_approvals integer NOT NULL
    CONSTRAINT approval_request_required_approvals CHECK (required_approvals BETWEEN 1 AND 5),
  status text NOT NULL DEFAULT 'pending' CONSTRAINT approval_request_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz,
  closed_by uuid,
  close_reason text CONSTRAINT approval_request_close_reason_check
    CHECK (close_reason IN ('no_longer_needed', 'made_in_error', 'changes_needed', 'requester_removed')),
  closed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  retain_until timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, id, definition_key, step_id),
  CONSTRAINT approval_request_closed CHECK (
    (status = 'pending') = (closed_at IS NULL)
    AND (closed_at IS NULL) = (closed_by IS NULL)
    AND (closed_at IS NULL) = (retain_until IS NULL)),
  CONSTRAINT approval_request_close_reason CHECK ((status = 'withdrawn') = (close_reason IS NOT NULL)),
  CONSTRAINT approval_request_due CHECK (due_at > requested_at),
  CONSTRAINT approval_request_retention_floor CHECK (
    retain_until >= ((closed_at AT TIME ZONE 'UTC') + interval '12 months') AT TIME ZONE 'UTC'),
  FOREIGN KEY (tenant_id, definition_version_id)
    REFERENCES app.workflow_definition_version (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, requested_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, closed_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('app.approval_request');
SELECT app.deny_command('app.approval_request', 'DELETE');

CREATE FUNCTION app.check_approval_request()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  pinned record;
  step jsonb;
BEGIN
  IF NOT EXISTS (SELECT FROM app.session_actor() a WHERE a.membership_id = NEW.requested_by) THEN
    RAISE EXCEPTION 'Only the member of this session can ask for an approval.'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'approval_request_actor';
  END IF;
  SELECT d.key, v.document INTO pinned
    FROM app.workflow_definition_version v
    JOIN app.workflow_definition d ON d.tenant_id = v.tenant_id AND d.id = v.definition_id
   WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.definition_version_id
     AND NOT EXISTS (SELECT FROM app.workflow_definition_version l
                      WHERE l.tenant_id = v.tenant_id AND l.definition_id = v.definition_id
                        AND l.version > v.version);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A request pins the latest version of its definition.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_request_latest_version';
  END IF;
  SELECT s INTO step FROM pg_catalog.jsonb_array_elements(pinned.document -> 'approvalSteps') s
   WHERE s ->> 'id' = NEW.step_id;
  IF step IS NULL THEN
    RAISE EXCEPTION 'The pinned version has no such approval step.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_request_step';
  END IF;
  NEW.definition_key := pinned.key;
  NEW.required_approvals := (step ->> 'approvers')::integer;
  NEW.status := 'pending';
  NEW.requested_at := pg_catalog.now();
  NEW.updated_at := NEW.requested_at;
  NEW.due_at := NEW.requested_at
    + pg_catalog.make_interval(days => (step ->> 'dueAfterDays')::integer);
  NEW.closed_by := NULL;
  NEW.close_reason := NULL;
  NEW.closed_at := NULL;
  NEW.retain_until := NULL;
  RETURN NEW;
END
$function$;
CREATE TRIGGER check_approval_request BEFORE INSERT ON app.approval_request
  FOR EACH ROW EXECUTE FUNCTION app.check_approval_request();

GRANT SELECT, INSERT (tenant_id, definition_version_id, step_id, requested_by)
   ON app.approval_request TO app_api;
-- The subject access export (ADR 0027) reads every classified column of a
-- member's requests as app_worker, in the tenant set. SELECT only.
GRANT SELECT (tenant_id, id, definition_version_id, definition_key, step_id, required_approvals,
              status, requested_by, requested_at, due_at, closed_by, close_reason, closed_at,
              updated_at, retain_until)
   ON app.approval_request TO app_worker;
