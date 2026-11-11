-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0061, up: the reminder outbox (S12-21, E9), the reads the
-- reminder jobs need, and their queues. The outbox records each reminder that
-- fell due, what happened to it and when; it holds ids and codes only, never
-- an address, subject line or body. Values copy
-- modules/grants/src/contracts/reminders. Reminders only remind (rule 9): no
-- trigger here writes another table, and every foreign key restricts. The
-- server chooses the recipient (S12-50): the applicant of a draft, or the
-- reviewer's own person for an assignment.

-- One row per reminder due: a draft's for each number of days before it
-- closes, an assignment's for each repeat. It starts pending; each update of
-- its status is one attempt, and a sent or skipped reminder never changes.
-- Erasure clears the recipient and keeps the rest.
CREATE TABLE grants.reminder_email (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('draft_closing', 'review_overdue')),
  application_id uuid,
  assignment_id uuid,
  recipient_person_id uuid,
  template_version_id uuid NOT NULL,
  occurrence integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped', 'failed')),
  outcome_code text CHECK (outcome_code IN (
    'superseded', 'not_needed', 'switched_off', 'closed', 'no_recipient', 'delivery_failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT reminder_email_subject CHECK (
    (kind = 'draft_closing') = (application_id IS NOT NULL)
    AND (kind = 'review_overdue') = (assignment_id IS NOT NULL)),
  CONSTRAINT reminder_email_occurrence CHECK (
    CASE kind WHEN 'draft_closing' THEN occurrence BETWEEN 1 AND 30
              ELSE occurrence BETWEEN 1 AND 3 END),
  CONSTRAINT reminder_email_outcome CHECK (
    (status IN ('skipped', 'failed')) = (outcome_code IS NOT NULL)),
  CONSTRAINT reminder_email_sent CHECK ((status = 'sent') = (sent_at IS NOT NULL)),
  CONSTRAINT reminder_email_attempts CHECK (
    ((status = 'pending') = (attempts = 0)) AND ((attempts = 0) = (last_attempt_at IS NULL))),
  FOREIGN KEY (tenant_id, application_id)
    REFERENCES grants.application (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, assignment_id)
    REFERENCES grants.assignment (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, recipient_person_id)
    REFERENCES party.person (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, template_version_id)
    REFERENCES grants.email_template_version (tenant_id, id) ON DELETE RESTRICT
);
-- A retried job finds the row it wrote, so no reminder is sent twice.
CREATE UNIQUE INDEX reminder_email_application_once
  ON grants.reminder_email (tenant_id, application_id, kind, occurrence)
  WHERE application_id IS NOT NULL;
CREATE UNIQUE INDEX reminder_email_assignment_once
  ON grants.reminder_email (tenant_id, assignment_id, kind, occurrence)
  WHERE assignment_id IS NOT NULL;
CREATE INDEX reminder_email_recipient ON grants.reminder_email (tenant_id, recipient_person_id);
SELECT app.enable_tenant_rls('grants.reminder_email');
SELECT app.deny_command('grants.reminder_email', 'DELETE');
CREATE TRIGGER set_created_at BEFORE INSERT ON grants.reminder_email
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
-- Clearing the recipient, as erasure does, is the one write naming no party.
CREATE TRIGGER refuse_erased_party
  BEFORE INSERT OR UPDATE OF recipient_person_id ON grants.reminder_email
  FOR EACH ROW WHEN (NEW.recipient_person_id IS NOT NULL)
  EXECUTE FUNCTION party.refuse_erased_party('recipient_person_id');

-- What a reminder is about never changes, its recipient only to none, and
-- its attempt count and times only through an attempt (below).
CREATE FUNCTION grants.keep_reminder_email()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF (NEW.tenant_id, NEW.id, NEW.kind, NEW.application_id, NEW.assignment_id,
      NEW.template_version_id, NEW.occurrence, NEW.created_at) IS DISTINCT FROM
     (OLD.tenant_id, OLD.id, OLD.kind, OLD.application_id, OLD.assignment_id,
      OLD.template_version_id, OLD.occurrence, OLD.created_at)
     OR (NEW.recipient_person_id IS DISTINCT FROM OLD.recipient_person_id
         AND NEW.recipient_person_id IS NOT NULL) THEN
    RAISE EXCEPTION 'What a reminder is about, and who it is for, never change.'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.attempts := OLD.attempts;
  NEW.last_attempt_at := OLD.last_attempt_at;
  NEW.sent_at := OLD.sent_at;
  RETURN NEW;
END
$function$;
CREATE TRIGGER keep_reminder_email BEFORE UPDATE ON grants.reminder_email
  FOR EACH ROW EXECUTE FUNCTION grants.keep_reminder_email();

-- Each attempt ends sent, skipped or failed; only a failed one is tried again.
-- Named to run after keep_reminder_email.
CREATE FUNCTION grants.record_reminder_attempt()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF OLD.status IN ('sent', 'skipped') THEN
    RAISE EXCEPTION 'A sent or skipped reminder never changes.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF NEW.status = 'pending' THEN
    RAISE EXCEPTION 'An attempt to send a reminder ends sent, skipped or failed.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  NEW.attempts := OLD.attempts + 1;
  NEW.last_attempt_at := pg_catalog.now();
  NEW.sent_at := CASE WHEN NEW.status = 'sent' THEN pg_catalog.now() END;
  RETURN NEW;
END
$function$;
CREATE TRIGGER record_reminder_attempt BEFORE UPDATE OF status, outcome_code
  ON grants.reminder_email
  FOR EACH ROW EXECUTE FUNCTION grants.record_reminder_attempt();

-- The reminder jobs (S12-50), in the tenant's transaction (the setting came
-- with 0060): each draft's effective closing time (its round's and any live
-- extension's), each assignment's reviewer, whose own person
-- (party.person.user_id, granted in 0044) is the recipient, and the outbox
-- row it writes and deals with.
GRANT SELECT,
      INSERT (tenant_id, kind, application_id, assignment_id, recipient_person_id,
              template_version_id, occurrence),
      UPDATE (status, outcome_code)
   ON grants.reminder_email TO app_worker;
-- The round's reminder history (S12-50) reads the outbox; staff never write it.
GRANT SELECT ON grants.reminder_email TO app_api;
GRANT SELECT (closes_at) ON grants.round TO app_worker;
GRANT SELECT (tenant_id, id, round_id, organisation_id, application_id, kind, closes_at,
              revoked_at)
   ON grants.adjustment TO app_worker;
GRANT SELECT (reviewer_membership_id) ON grants.assignment TO app_worker;

-- The scan is reached from the hourly platform.fan_out; the exclusive policy
-- allows one waiting send job per outbox row (see 0045).
SELECT pgboss.create_queue('grants.reminder_scan.dead', '{"policy": "standard"}');
SELECT pgboss.create_queue('grants.reminder_scan',
  '{"policy": "standard", "deadLetter": "grants.reminder_scan.dead"}');
SELECT pgboss.create_queue('grants.reminder_send.dead', '{"policy": "standard"}');
SELECT pgboss.create_queue('grants.reminder_send',
  '{"policy": "exclusive", "deadLetter": "grants.reminder_send.dead"}');
INSERT INTO app.job_queue (name, kind)
  VALUES ('grants.reminder_scan.dead', 'tenant'), ('grants.reminder_scan', 'tenant'),
         ('grants.reminder_send.dead', 'tenant'), ('grants.reminder_send', 'tenant');
