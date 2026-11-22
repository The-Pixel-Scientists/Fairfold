-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0096, up: closing approval requests, and the check every module
-- link table runs (S12-69, ADR 0038).
--
-- app_api may update a request's status, closed_by and close_reason, and
-- only to close it while it is pending. The update trigger fixes every
-- other column and allows just these closings, each with closed_by the
-- membership app.session_actor() returns: approved once exactly the
-- required approvals and no rejection exist, one of them closed_by's;
-- rejected by the member who rejected it; withdrawn by the requester with
-- any code but requester_removed, or with requester_removed once the
-- requester's membership is removed, by the member who removed it. It sets
-- closed_at, updated_at and retain_until, from the tenant's audit rule and
-- never under 12 months. An update that leaves a request pending changes
-- nothing else, and a closed request never changes. The database checks
-- closings; it never closes a request by itself (rule 9).
--
-- app.check_approval_link() is for the module link tables that migration
-- 0094 describes: BEFORE INSERT, it locks the request (FOR SHARE, so it
-- waits for a decision or closing in progress) and refuses one that is not
-- pending or already has a decision, so a request is linked once, when it
-- is made. A request in no tenant row the caller can see is left to the
-- link's foreign key.

CREATE FUNCTION app.check_approval_closing()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  decisions record;
  allowed boolean;
  audit_days integer;
  closed timestamp;
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'A closed approval request never changes.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_request_final';
  END IF;
  IF (NEW.tenant_id, NEW.id, NEW.definition_version_id, NEW.definition_key, NEW.step_id,
      NEW.required_approvals, NEW.requested_by, NEW.requested_at, NEW.due_at)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.id, OLD.definition_version_id, OLD.definition_key, OLD.step_id,
      OLD.required_approvals, OLD.requested_by, OLD.requested_at, OLD.due_at) THEN
    RAISE EXCEPTION 'Only the status and who closed a request, and why, can change.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_request_fixed';
  END IF;
  NEW.updated_at := pg_catalog.now();
  NEW.closed_at := NULL;
  NEW.retain_until := NULL;
  IF NEW.status = 'pending' AND NEW.closed_by IS NULL AND NEW.close_reason IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (SELECT FROM app.session_actor() a WHERE a.membership_id = NEW.closed_by) THEN
    RAISE EXCEPTION 'Only the member of this session can close an approval request.'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'approval_request_actor';
  END IF;
  SELECT pg_catalog.count(*) FILTER (WHERE d.outcome = 'approve') AS approvals,
         pg_catalog.count(*) FILTER (WHERE d.outcome = 'reject') AS rejections,
         pg_catalog.bool_or(d.decided_by = NEW.closed_by AND d.outcome = 'approve') AS closer_approved,
         pg_catalog.bool_or(d.decided_by = NEW.closed_by AND d.outcome = 'reject') AS closer_rejected
    INTO decisions
    FROM app.approval_decision d
   WHERE d.tenant_id = NEW.tenant_id AND d.request_id = NEW.id;
  allowed := CASE NEW.status
    WHEN 'approved' THEN NEW.close_reason IS NULL AND decisions.rejections = 0
      AND decisions.approvals = NEW.required_approvals AND decisions.closer_approved
    WHEN 'rejected' THEN NEW.close_reason IS NULL AND decisions.closer_rejected
    WHEN 'withdrawn' THEN
      (NEW.closed_by = NEW.requested_by AND NEW.close_reason <> 'requester_removed')
      OR (NEW.close_reason = 'requester_removed'
          AND EXISTS (SELECT FROM app.membership m
                       WHERE m.tenant_id = NEW.tenant_id AND m.id = NEW.requested_by
                         AND m.status = 'removed'))
    ELSE false
  END;
  IF allowed IS NOT TRUE THEN
    RAISE EXCEPTION 'This closing is not allowed for this request.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_request_closing';
  END IF;

  SELECT p.days INTO audit_days
    FROM app.retention_policy p
   WHERE p.tenant_id = NEW.tenant_id AND p.policy = 'audit';
  NEW.closed_at := NEW.updated_at;
  closed := NEW.closed_at AT TIME ZONE 'UTC';
  NEW.retain_until := (GREATEST(
    closed + interval '12 months',
    closed + pg_catalog.make_interval(days => COALESCE(audit_days, 0))
  )) AT TIME ZONE 'UTC';
  RETURN NEW;
END
$function$;
CREATE TRIGGER check_approval_closing BEFORE UPDATE ON app.approval_request
  FOR EACH ROW EXECUTE FUNCTION app.check_approval_closing();

GRANT UPDATE (status, closed_by, close_reason) ON app.approval_request TO app_api;

CREATE FUNCTION app.check_approval_link()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  request_status text;
BEGIN
  SELECT r.status INTO request_status FROM app.approval_request r
   WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.approval_request_id
     FOR SHARE;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF request_status <> 'pending'
     OR EXISTS (SELECT FROM app.approval_decision d
                 WHERE d.tenant_id = NEW.tenant_id AND d.request_id = NEW.approval_request_id) THEN
    RAISE EXCEPTION 'Only a pending request that nobody has decided can be linked.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approval_link_undecided';
  END IF;
  RETURN NEW;
END
$function$;
