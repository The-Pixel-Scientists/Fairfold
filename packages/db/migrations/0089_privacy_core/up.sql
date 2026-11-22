-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0089, up: the privacy schema (ADR 0016), with rights requests,
-- their clock events and tasks, and the deadline reminder's queues. Lists,
-- caps and codes copy modules/privacy/src/contracts, and text patterns
-- migration 0009; test/privacy reads them back. Migrations 0090 to 0092 add
-- the breach log, the DPIA register and records of processing, and the
-- erasure function.
--
-- Every privacy table is a tenant table under app.enable_tenant_rls(), with
-- column grants, and no app role deletes a row but a link. Times no member
-- may choose come from the database. The legal clocks stay in the
-- contracts: the server writes a request's clock_state and due_on from
-- rightsRequestClock() after each event, and the database only refuses an
-- event the clock cannot follow. Nothing here decides for a person (rule
-- 9): closing a request or starting an export or erasure is a write by
-- app_api after a named member's action. No migration of the schema writes
-- an audit event or config version, and no trigger does (rules 4, 6 and
-- 10); the only rows written register the deadline reminder's queues.

CREATE SCHEMA privacy AUTHORIZATION migrator;
REVOKE ALL ON SCHEMA privacy FROM PUBLIC;
GRANT USAGE ON SCHEMA privacy TO app_api, app_worker;

-- "Erased is final" (ADR 0027): text about an erased person is never
-- written again. The argument names the column; clearing it, to null or to
-- 'erased' as privacy.erase_subject does, reads nothing. A task's person is
-- its request's, read as the caller.
CREATE FUNCTION privacy.refuse_erased_text()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  written CONSTANT text := pg_catalog.to_jsonb(NEW) ->> TG_ARGV[0];
  person uuid;
BEGIN
  IF written IS NULL OR written = 'erased' THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'rights_request' THEN
    person := NEW.subject_person_id;
  ELSE
    SELECT r.subject_person_id INTO person
      FROM privacy.rights_request r
     WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.request_id;
  END IF;
  IF party.is_erased(NEW.tenant_id, person) THEN
    RAISE EXCEPTION 'An erased person''s data never changes.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END
$function$;

-- A rights request (UK GDPR Articles 15 to 22, or a complaint under the
-- DUAA 2025) from a person in party. received_on is the received time's
-- date in the tenant's time zone, which the server derives. clock_state and
-- due_on are what rightsRequestClock() last gave: due_on is null exactly
-- while a pause is open, and overdue is read from due_on and today rather
-- than stored. Erasure clears the summary; the request is kept as evidence
-- of compliance. A job request it started is forgotten once that expires.
CREATE TABLE privacy.rights_request (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('access', 'rectification', 'erasure', 'restriction',
    'portability', 'objection', 'automated_decision', 'complaint')),
  subject_person_id uuid NOT NULL,
  received_at timestamptz NOT NULL,
  received_on date NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'post', 'phone', 'in_person', 'web_form',
    'social_media', 'other')),
  summary text CHECK (char_length(summary) BETWEEN 1 AND 2000)
    CONSTRAINT rights_request_summary_text CHECK (summary !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  identity_check text NOT NULL CHECK (identity_check IN ('not_started', 'requested', 'verified',
    'not_needed', 'failed')),
  clock_state text NOT NULL DEFAULT 'running'
    CHECK (clock_state IN ('running', 'paused', 'extended', 'closed')),
  due_on date,
  export_job_request_id uuid,
  erasure_job_request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  UNIQUE (tenant_id, id),
  CONSTRAINT rights_request_due_unless_paused CHECK ((clock_state = 'paused') = (due_on IS NULL)),
  FOREIGN KEY (tenant_id, subject_person_id) REFERENCES party.person (tenant_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, export_job_request_id) REFERENCES app.job_request (tenant_id, id)
    ON DELETE SET NULL (export_job_request_id),
  FOREIGN KEY (tenant_id, erasure_job_request_id) REFERENCES app.job_request (tenant_id, id)
    ON DELETE SET NULL (erasure_job_request_id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX rights_request_open ON privacy.rights_request (tenant_id, due_on)
  WHERE clock_state <> 'closed';
CREATE INDEX rights_request_subject ON privacy.rights_request (tenant_id, subject_person_id);
CREATE INDEX rights_request_export ON privacy.rights_request (tenant_id, export_job_request_id)
  WHERE export_job_request_id IS NOT NULL;
CREATE INDEX rights_request_erasure ON privacy.rights_request (tenant_id, erasure_job_request_id)
  WHERE erasure_job_request_id IS NOT NULL;
SELECT app.enable_tenant_rls('privacy.rights_request');
SELECT app.deny_command('privacy.rights_request', 'DELETE');
CREATE TRIGGER set_created_at BEFORE INSERT ON privacy.rights_request
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON privacy.rights_request
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER refuse_erased_party
  BEFORE INSERT OR UPDATE OF subject_person_id ON privacy.rights_request
  FOR EACH ROW EXECUTE FUNCTION party.refuse_erased_party('subject_person_id');
CREATE TRIGGER refuse_erased_text BEFORE INSERT OR UPDATE OF summary ON privacy.rights_request
  FOR EACH ROW EXECUTE FUNCTION privacy.refuse_erased_text('summary');
GRANT SELECT,
      INSERT (tenant_id, kind, subject_person_id, received_at, received_on, channel, summary,
              identity_check, due_on, created_by, updated_by),
      UPDATE (kind, channel, summary, identity_check, clock_state, due_on, export_job_request_id,
              erasure_job_request_id, updated_by)
   ON privacy.rights_request TO app_api;
GRANT SELECT (tenant_id, id, kind, received_on, clock_state, due_on, created_by)
   ON privacy.rights_request TO app_worker;

-- A change to a request's clock, by the member who recorded it, dated the
-- day they say it happened in the tenant's time zone. Events are never
-- changed or removed, and a request has at most one extension and one close.
CREATE TABLE privacy.request_clock_event (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('paused', 'resumed', 'extended', 'closed')),
  occurred_on date NOT NULL,
  months smallint CHECK (months IN (1, 2)),
  reason_code text NOT NULL,
  recorded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT request_clock_event_months CHECK ((kind = 'extended') = (months IS NOT NULL)),
  CONSTRAINT request_clock_event_pause_reason
    CHECK (kind <> 'paused' OR reason_code IN ('identity_proof', 'clarification')),
  CONSTRAINT request_clock_event_resume_reason
    CHECK (kind <> 'resumed' OR reason_code IN ('information_received', 'no_longer_needed')),
  CONSTRAINT request_clock_event_extension_reason
    CHECK (kind <> 'extended' OR reason_code IN ('complex', 'numerous')),
  CONSTRAINT request_clock_event_close_reason
    CHECK (kind <> 'closed' OR reason_code IN ('completed', 'refused', 'withdrawn',
      'identity_not_confirmed')),
  FOREIGN KEY (tenant_id, request_id) REFERENCES privacy.rights_request (tenant_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, recorded_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX request_clock_event_request
  ON privacy.request_clock_event (tenant_id, request_id, created_at);
CREATE UNIQUE INDEX request_clock_event_once
  ON privacy.request_clock_event (tenant_id, request_id, kind) WHERE kind IN ('extended', 'closed');
SELECT app.enable_tenant_rls('privacy.request_clock_event');
SELECT app.deny_command('privacy.request_clock_event', 'UPDATE');
SELECT app.deny_command('privacy.request_clock_event', 'DELETE');

-- The clock takes an event only in an order it can follow: none after the
-- close, none dated before the request arrived or before an earlier event,
-- no pause while one is open and no resume without one. Whether an event is
-- late is rightsRequestClock()'s to say. Locks the request, as the caller,
-- so two members' events are checked one after the other.
CREATE FUNCTION privacy.check_clock_event()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  received date;
  latest date;
  closed boolean;
  paused boolean;
BEGIN
  SELECT r.received_on INTO received
    FROM privacy.rights_request r
   WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.request_id
     FOR UPDATE;
  SELECT pg_catalog.max(e.occurred_on), pg_catalog.bool_or(e.kind = 'closed'),
         pg_catalog.count(*) FILTER (WHERE e.kind = 'paused')
           > pg_catalog.count(*) FILTER (WHERE e.kind = 'resumed')
    INTO latest, closed, paused
    FROM privacy.request_clock_event e
   WHERE e.tenant_id = NEW.tenant_id AND e.request_id = NEW.request_id;
  IF closed THEN
    RAISE EXCEPTION 'A closed request''s clock takes no more events.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF NEW.occurred_on < GREATEST(received, latest) THEN
    RAISE EXCEPTION 'A clock event is dated no earlier than the request and the events before it.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF NEW.kind = 'paused' AND paused THEN
    RAISE EXCEPTION 'The clock is already paused.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF NEW.kind = 'resumed' AND NOT paused THEN
    RAISE EXCEPTION 'The clock is not paused.' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER set_created_at BEFORE INSERT ON privacy.request_clock_event
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER check_clock_event BEFORE INSERT ON privacy.request_clock_event
  FOR EACH ROW EXECUTE FUNCTION privacy.check_clock_event();
GRANT SELECT,
      INSERT (tenant_id, request_id, kind, occurred_on, months, reason_code, recorded_by)
   ON privacy.request_clock_event TO app_api;
GRANT SELECT ON privacy.request_clock_event TO app_worker;

-- The work a request needs, such as checking another tool's records, for a
-- member and the tool whose records it concerns. A task is completed by a
-- member, at a time the database sets, and stays completed.
CREATE TABLE privacy.request_task (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200)
    CONSTRAINT request_task_title_text CHECK (title !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  assigned_to uuid,
  module_id text CHECK (module_id IN ('platform', 'party', 'grants', 'crm', 'assure', 'forms',
    'privacy', 'insight', 'impact')),
  due_on date,
  completed_by uuid,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  UNIQUE (tenant_id, id),
  CONSTRAINT request_task_completion CHECK ((completed_by IS NULL) = (completed_at IS NULL)),
  FOREIGN KEY (tenant_id, request_id) REFERENCES privacy.rights_request (tenant_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, assigned_to) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, completed_by) REFERENCES app.membership (tenant_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX request_task_request ON privacy.request_task (tenant_id, request_id, created_at);
CREATE INDEX request_task_open ON privacy.request_task (tenant_id, assigned_to, due_on)
  WHERE completed_at IS NULL;
SELECT app.enable_tenant_rls('privacy.request_task');
SELECT app.deny_command('privacy.request_task', 'DELETE');

CREATE FUNCTION privacy.stamp_completion()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF OLD.completed_by IS NOT NULL AND NEW.completed_by IS DISTINCT FROM OLD.completed_by THEN
    RAISE EXCEPTION 'A completed task stays completed.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  NEW.completed_at := CASE WHEN NEW.completed_by IS NULL THEN NULL
                           WHEN OLD.completed_by IS NULL THEN pg_catalog.now()
                           ELSE OLD.completed_at END;
  RETURN NEW;
END
$function$;
CREATE TRIGGER set_created_at BEFORE INSERT ON privacy.request_task
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON privacy.request_task
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER stamp_completion BEFORE UPDATE ON privacy.request_task
  FOR EACH ROW EXECUTE FUNCTION privacy.stamp_completion();
CREATE TRIGGER refuse_erased_text BEFORE INSERT OR UPDATE OF title ON privacy.request_task
  FOR EACH ROW EXECUTE FUNCTION privacy.refuse_erased_text('title');
GRANT SELECT,
      INSERT (tenant_id, request_id, title, assigned_to, module_id, due_on, created_by,
              updated_by),
      UPDATE (title, assigned_to, module_id, due_on, completed_by, updated_by)
   ON privacy.request_task TO app_api;
GRANT SELECT (tenant_id, id, request_id, assigned_to, module_id, due_on, completed_at)
   ON privacy.request_task TO app_worker;

-- The deadline reminder (S12-27), one job a tenant.
SELECT pgboss.create_queue('privacy.deadline_reminder.dead', '{"policy": "standard"}');
SELECT pgboss.create_queue('privacy.deadline_reminder',
  '{"policy": "standard", "deadLetter": "privacy.deadline_reminder.dead"}');
INSERT INTO app.job_queue (name, kind)
  VALUES ('privacy.deadline_reminder.dead', 'tenant'), ('privacy.deadline_reminder', 'tenant');
