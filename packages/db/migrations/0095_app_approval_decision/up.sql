-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0095, up: approval decisions and the separation of duties the
-- database enforces whatever the server does (S12-69, ADR 0038). A decision
-- is one member's approve or reject on one request, with a rejection reason
-- code and no free text. The outcome and reason lists copy
-- packages/domain/src/workflow.
--
-- Decisions are INSERT and SELECT only for every app role, and app_api
-- inserts only the request, decider, outcome and reason; decided_at and
-- retain_until are the database's, from the tenant's audit rule, never under
-- 12 months. The unique key refuses a second decision by one member. The
-- insert trigger locks the request row, so decisions on one request are
-- taken one at a time, then refuses: a decider other than
-- app.session_actor()'s membership, or one whose session has not
-- re-authenticated in the last 5 minutes (ADR 0010); the requester; a
-- request that is not pending or already has a rejection; and an approval
-- once the required approvals exist. A rejection must close its request as
-- rejected by its decider before commit (the deferred trigger). Reaching
-- the count changes nothing: a named member closes the request (rule 9).
-- The service writes platform.approval.approved and
-- platform.approval.rejected when it closes one.

CREATE TABLE app.approval_decision (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  decided_by uuid NOT NULL,
  outcome text NOT NULL
    CONSTRAINT approval_decision_outcome_check CHECK (outcome IN ('approve', 'reject')),
  reason_code text CONSTRAINT approval_decision_reason_code_check CHECK (reason_code IN (
    'incorrect_details', 'missing_evidence', 'outside_policy', 'duplicate', 'other')),
  decided_at timestamptz NOT NULL DEFAULT now(),
  retain_until timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  CONSTRAINT approval_decision_once UNIQUE (tenant_id, request_id, decided_by),
  CONSTRAINT approval_decision_reason CHECK ((outcome = 'reject') = (reason_code IS NOT NULL)),
  CONSTRAINT approval_decision_retention_floor CHECK (
    retain_until >= ((decided_at AT TIME ZONE 'UTC') + interval '12 months') AT TIME ZONE 'UTC'),
  FOREIGN KEY (tenant_id, request_id)
    REFERENCES app.approval_request (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, decided_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('app.approval_decision');
SELECT app.deny_command('app.approval_decision', 'UPDATE');
SELECT app.deny_command('app.approval_decision', 'DELETE');

CREATE FUNCTION app.check_approval_decision()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  request app.approval_request;
  audit_days integer;
  decided timestamp;
BEGIN
  IF NOT EXISTS (SELECT FROM app.session_actor() a WHERE a.membership_id = NEW.decided_by) THEN
    RAISE EXCEPTION 'Only the member of this session can decide.'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'approval_decision_actor';
  END IF;
  IF NOT EXISTS (SELECT FROM app.session_actor() a
                  WHERE a.reauthenticated_at >= pg_catalog.now() - interval '5 minutes') THEN
    RAISE EXCEPTION 'A decision needs the member to have signed in again in the last 5 minutes.'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'approval_decision_step_up';
  END IF;
  SELECT r.* INTO request FROM app.approval_request r
   WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.request_id
     FOR UPDATE;
  -- No such request in this tenant: the foreign key refuses it.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF request.requested_by = NEW.decided_by THEN
    RAISE EXCEPTION 'The member who asked cannot decide the request.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_decision_requester';
  END IF;
  IF request.status <> 'pending' THEN
    RAISE EXCEPTION 'The request is already closed.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_decision_pending';
  END IF;
  IF EXISTS (SELECT FROM app.approval_decision d
              WHERE d.tenant_id = NEW.tenant_id AND d.request_id = NEW.request_id
                AND d.outcome = 'reject') THEN
    RAISE EXCEPTION 'The request is already rejected.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_decision_rejected';
  END IF;
  IF NEW.outcome = 'approve' AND (SELECT pg_catalog.count(*) FROM app.approval_decision d
                                   WHERE d.tenant_id = NEW.tenant_id
                                     AND d.request_id = NEW.request_id
                                     AND d.outcome = 'approve') >= request.required_approvals THEN
    RAISE EXCEPTION 'The request already has the approvals it needs.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_decision_complete';
  END IF;

  SELECT p.days INTO audit_days
    FROM app.retention_policy p
   WHERE p.tenant_id = NEW.tenant_id AND p.policy = 'audit';
  NEW.decided_at := pg_catalog.now();
  decided := NEW.decided_at AT TIME ZONE 'UTC';
  NEW.retain_until := (GREATEST(
    decided + interval '12 months',
    decided + pg_catalog.make_interval(days => COALESCE(audit_days, 0))
  )) AT TIME ZONE 'UTC';
  RETURN NEW;
END
$function$;
CREATE TRIGGER check_approval_decision BEFORE INSERT ON app.approval_decision
  FOR EACH ROW EXECUTE FUNCTION app.check_approval_decision();

CREATE FUNCTION app.check_rejection_closed()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NOT EXISTS (SELECT FROM app.approval_request r
                  WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.request_id
                    AND r.status = 'rejected' AND r.closed_by = NEW.decided_by) THEN
    RAISE EXCEPTION 'A rejection closes its request as rejected in the same transaction.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_decision_rejection_closes';
  END IF;
  RETURN NULL;
END
$function$;
CREATE CONSTRAINT TRIGGER check_rejection_closed AFTER INSERT ON app.approval_decision
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.outcome = 'reject') EXECUTE FUNCTION app.check_rejection_closed();

GRANT SELECT, INSERT (tenant_id, request_id, decided_by, outcome, reason_code)
   ON app.approval_decision TO app_api;
-- The subject access export (ADR 0027) reads every classified column of a
-- member's decisions as app_worker, in the tenant set. SELECT only.
GRANT SELECT (tenant_id, id, request_id, decided_by, outcome, reason_code, decided_at, retain_until)
   ON app.approval_decision TO app_worker;
