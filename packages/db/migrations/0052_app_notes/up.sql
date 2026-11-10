-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0052, up: staff notes with mentions, applicant and funder message
-- threads, and tenant tags (S12-13, ADR 0030 "notes, messages and tags follow
-- the same pattern"), with grants' join tables and the message notification
-- outbox.
--
-- Notes, messages and tags are platform tables under forced row-level
-- security, and grants links them to its applications through its own join
-- tables with composite foreign keys, ON DELETE RESTRICT: never a polymorphic
-- owner column (ADR 0030). Notes and messages are append-only for every app
-- role; only app.erase_subject_notes rewrites a body, on erasure (ADR 0027).
-- Limits and sides copy packages/domain/src/notes. Whether a mentioned member
-- holds the permission is checked by the server at write time (S12-32), not
-- here. Triggers read other tables as the caller, under its row-level
-- security. Every created_at, and each read time, is set by the database.
--
-- Join and mention tables carry an id too, since the schema lint and the
-- cross-tenant test need UNIQUE (tenant_id, id) on every tenant table.

CREATE FUNCTION app.set_created_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  NEW.created_at := pg_catalog.now();
  RETURN NEW;
END
$function$;

-- The trimmed checks refuse the white space a JavaScript trim removes, and the
-- not-blank checks also the zero-width characters that show nothing, as the
-- domain's body and label schemas count them.
CREATE TABLE app.note (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  body text NOT NULL
    CONSTRAINT note_body_length CHECK (char_length(body) BETWEEN 1 AND 5000)
    CONSTRAINT note_body_trimmed CHECK (body !~ '^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]|[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]$')
    CONSTRAINT note_body_not_blank CHECK (body ~ '[^\t\n\v\f\r \u00a0\u00ad\u1680\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]'),
  author_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, author_id) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('app.note');
SELECT app.deny_command('app.note', 'UPDATE');
SELECT app.deny_command('app.note', 'DELETE');
CREATE TRIGGER set_created_at BEFORE INSERT ON app.note
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();

-- Mentions are rows, so each is a real foreign key (rule 3).
CREATE TABLE app.note_mention (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, note_id, membership_id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, note_id) REFERENCES app.note (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, membership_id)
    REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX note_mention_membership ON app.note_mention (tenant_id, membership_id);
SELECT app.enable_tenant_rls('app.note_mention');
SELECT app.deny_command('app.note_mention', 'UPDATE');
SELECT app.deny_command('app.note_mention', 'DELETE');
CREATE TRIGGER set_created_at BEFORE INSERT ON app.note_mention
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();

-- At most MAX_MENTIONS mentions per note. The advisory lock makes concurrent
-- inserts on one note wait for each other, so the count cannot be raced.
CREATE FUNCTION app.check_note_mention_cap()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(NEW.note_id::text, 0));
  IF (SELECT pg_catalog.count(*) FROM app.note_mention m
       WHERE m.tenant_id = NEW.tenant_id AND m.note_id = NEW.note_id) >= 10 THEN
    RAISE EXCEPTION 'A note can mention at most 10 members.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER check_note_mention_cap BEFORE INSERT ON app.note_mention
  FOR EACH ROW EXECUTE FUNCTION app.check_note_mention_cap();

-- Nothing new is attached to an erased applicant's application (ADR 0027,
-- "erased is final"): erasure runs once, so text added afterwards would never
-- be cleared. A note or thread is attached through its join row, so the join
-- is where this is refused, whichever order the rows are written in. The
-- applicant is read with the caller's rights, and party.is_erased takes the
-- lock that serialises with erasure.
CREATE FUNCTION grants.refuse_erased_applicant_link()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  applicant uuid;
BEGIN
  SELECT a.applicant_person_id INTO applicant
    FROM grants.application a
   WHERE a.tenant_id = NEW.tenant_id AND a.id = NEW.application_id;
  IF party.is_erased(NEW.tenant_id, applicant) THEN
    RAISE EXCEPTION 'Nothing new is attached to an erased applicant''s application.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END
$function$;

-- A note belongs to exactly one application.
CREATE TABLE grants.application_note (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL,
  application_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, note_id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, note_id) REFERENCES app.note (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, application_id)
    REFERENCES grants.application (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX application_note_application ON grants.application_note (tenant_id, application_id);
SELECT app.enable_tenant_rls('grants.application_note');
SELECT app.deny_command('grants.application_note', 'UPDATE');
SELECT app.deny_command('grants.application_note', 'DELETE');
CREATE TRIGGER set_created_at BEFORE INSERT ON grants.application_note
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER refuse_erased_applicant BEFORE INSERT ON grants.application_note
  FOR EACH ROW EXECUTE FUNCTION grants.refuse_erased_applicant_link();

-- A body on an erased applicant's application changes only to the erased
-- marker, so a cleared note is not written back. No app role updates a note;
-- this binds migrator, and lets app.erase_subject_notes through.
CREATE FUNCTION app.refuse_erased_applicant_note()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  applicant uuid;
BEGIN
  IF NEW.body = 'erased' THEN
    RETURN NEW;
  END IF;
  SELECT a.applicant_person_id INTO applicant
    FROM grants.application_note l
    JOIN grants.application a ON a.tenant_id = l.tenant_id AND a.id = l.application_id
   WHERE l.tenant_id = NEW.tenant_id AND l.note_id = NEW.id;
  IF party.is_erased(NEW.tenant_id, applicant) THEN
    RAISE EXCEPTION 'An erased applicant''s notes never change.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER refuse_erased_applicant_note BEFORE UPDATE OF body ON app.note
  FOR EACH ROW EXECUTE FUNCTION app.refuse_erased_applicant_note();

-- Unread state per side, each side's last-read time, never per member.
CREATE TABLE app.message_thread (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_read_at timestamptz,
  staff_read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
SELECT app.enable_tenant_rls('app.message_thread');
SELECT app.deny_command('app.message_thread', 'DELETE');
CREATE TRIGGER set_created_at BEFORE INSERT ON app.message_thread
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();

-- Only the read times change, and only forwards: a changed one is set to the
-- database's time, whatever the caller sent.
CREATE FUNCTION app.keep_message_thread()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF (NEW.tenant_id, NEW.id, NEW.created_at) IS DISTINCT FROM
     (OLD.tenant_id, OLD.id, OLD.created_at) THEN
    RAISE EXCEPTION 'Only the read times of a message thread can change.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.applicant_read_at IS DISTINCT FROM OLD.applicant_read_at THEN
    NEW.applicant_read_at := GREATEST(pg_catalog.now(), OLD.applicant_read_at);
  END IF;
  IF NEW.staff_read_at IS DISTINCT FROM OLD.staff_read_at THEN
    NEW.staff_read_at := GREATEST(pg_catalog.now(), OLD.staff_read_at);
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER keep_message_thread BEFORE UPDATE ON app.message_thread
  FOR EACH ROW EXECUTE FUNCTION app.keep_message_thread();

CREATE TABLE app.message (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL,
  side text NOT NULL CHECK (side IN ('applicant', 'staff')),
  body text NOT NULL
    CONSTRAINT message_body_length CHECK (char_length(body) BETWEEN 1 AND 2000)
    CONSTRAINT message_body_trimmed CHECK (body !~ '^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]|[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]$')
    CONSTRAINT message_body_not_blank CHECK (body ~ '[^\t\n\v\f\r \u00a0\u00ad\u1680\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]'),
  author_membership_id uuid,
  author_person_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT message_author_matches_side CHECK (
    (side = 'staff') = (author_membership_id IS NOT NULL)
    AND (side = 'applicant') = (author_person_id IS NOT NULL)),
  FOREIGN KEY (tenant_id, thread_id)
    REFERENCES app.message_thread (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, author_membership_id)
    REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, author_person_id)
    REFERENCES party.person (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX message_thread_created ON app.message (tenant_id, thread_id, created_at);
SELECT app.enable_tenant_rls('app.message');
SELECT app.deny_command('app.message', 'UPDATE');
SELECT app.deny_command('app.message', 'DELETE');
CREATE TRIGGER set_created_at BEFORE INSERT ON app.message
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER refuse_erased_party BEFORE INSERT OR UPDATE OF author_person_id ON app.message
  FOR EACH ROW EXECUTE FUNCTION party.refuse_erased_party('author_person_id');

-- One thread per application, and a thread belongs to one application.
CREATE TABLE grants.application_message (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, application_id),
  UNIQUE (tenant_id, thread_id),
  FOREIGN KEY (tenant_id, application_id)
    REFERENCES grants.application (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, thread_id)
    REFERENCES app.message_thread (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('grants.application_message');
SELECT app.deny_command('grants.application_message', 'UPDATE');
SELECT app.deny_command('grants.application_message', 'DELETE');
CREATE TRIGGER set_created_at BEFORE INSERT ON grants.application_message
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER refuse_erased_applicant BEFORE INSERT ON grants.application_message
  FOR EACH ROW EXECUTE FUNCTION grants.refuse_erased_applicant_link();

-- No message, from either side, joins a thread on an erased applicant's
-- application, and a body there changes only to the erased marker, which lets
-- app.erase_subject_notes through. Read as the caller; a thread with no join
-- has no applicant yet, and its join row is refused above.
CREATE FUNCTION app.refuse_erased_applicant_message()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  applicant uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.body = 'erased' THEN
    RETURN NEW;
  END IF;
  SELECT a.applicant_person_id INTO applicant
    FROM grants.application_message l
    JOIN grants.application a ON a.tenant_id = l.tenant_id AND a.id = l.application_id
   WHERE l.tenant_id = NEW.tenant_id AND l.thread_id = NEW.thread_id;
  IF party.is_erased(NEW.tenant_id, applicant) THEN
    RAISE EXCEPTION 'An erased applicant''s messages never change.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER refuse_erased_applicant_message BEFORE INSERT OR UPDATE OF thread_id, body
  ON app.message
  FOR EACH ROW EXECUTE FUNCTION app.refuse_erased_applicant_message();

-- The backstop for the server's own_application check (S12-32): an applicant
-- message is by the applicant of the application its thread is joined to.
-- Reads as the caller, so a thread the caller cannot see is refused.
CREATE FUNCTION app.check_applicant_message()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  PERFORM FROM grants.application_message l
    JOIN grants.application a ON a.tenant_id = l.tenant_id AND a.id = l.application_id
   WHERE l.tenant_id = NEW.tenant_id AND l.thread_id = NEW.thread_id
     AND a.applicant_person_id = NEW.author_person_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'An applicant message must come from the application''s own applicant.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER check_applicant_message BEFORE INSERT ON app.message
  FOR EACH ROW WHEN (NEW.side = 'applicant')
  EXECUTE FUNCTION app.check_applicant_message();

-- A tenant's tags: configuration, so a label is internal and must not name a
-- person. Unique per tenant in any case.
CREATE TABLE app.tag (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL
    CONSTRAINT tag_label_length CHECK (char_length(label) BETWEEN 1 AND 40)
    CONSTRAINT tag_label_trimmed CHECK (label !~ '^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]|[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]$')
    CONSTRAINT tag_label_not_blank CHECK (label ~ '[^\t\n\v\f\r \u00a0\u00ad\u1680\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX tag_label_unique ON app.tag (tenant_id, lower(label));
SELECT app.enable_tenant_rls('app.tag');
SELECT app.deny_command('app.tag', 'DELETE');
CREATE TRIGGER set_created_at BEFORE INSERT ON app.tag
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();

-- The message notification outbox (S12-32 sends from it). A row is about a
-- message to a recipient, in a template version. Erasure clears the
-- recipient, so a queued row must have one: a row for an erased person cannot
-- be sent. error_code copies grants.decision_email's closed list.
CREATE TABLE grants.message_notification (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL,
  recipient_person_id uuid,
  template_version_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  error_code text CHECK (error_code IN (
    'invalid_message', 'connection_failed', 'tls_failed', 'timeout', 'auth_failed', 'rejected',
    'recipient_refused', 'failed', 'no_address')),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT message_notification_error CHECK ((status = 'failed') = (error_code IS NOT NULL)),
  CONSTRAINT message_notification_sent CHECK ((status = 'sent') = (sent_at IS NOT NULL)),
  CONSTRAINT message_notification_queued_recipient
    CHECK (status <> 'queued' OR recipient_person_id IS NOT NULL),
  FOREIGN KEY (tenant_id, message_id) REFERENCES app.message (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, recipient_person_id)
    REFERENCES party.person (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, template_version_id)
    REFERENCES grants.email_template_version (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX message_notification_recipient
  ON grants.message_notification (tenant_id, recipient_person_id);
SELECT app.enable_tenant_rls('grants.message_notification');
SELECT app.deny_command('grants.message_notification', 'DELETE');
CREATE TRIGGER set_created_at BEFORE INSERT ON grants.message_notification
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
-- Clearing the recipient, as erasure does, is the one write naming no party.
CREATE TRIGGER refuse_erased_party
  BEFORE INSERT OR UPDATE OF recipient_person_id ON grants.message_notification
  FOR EACH ROW WHEN (NEW.recipient_person_id IS NOT NULL)
  EXECUTE FUNCTION party.refuse_erased_party('recipient_person_id');

GRANT SELECT, INSERT (tenant_id, id, body, author_id) ON app.note TO app_api;
GRANT SELECT, INSERT (tenant_id, note_id, membership_id) ON app.note_mention TO app_api;
GRANT SELECT, INSERT (tenant_id, note_id, application_id) ON grants.application_note TO app_api;
GRANT SELECT, INSERT (tenant_id, id), UPDATE (applicant_read_at, staff_read_at)
   ON app.message_thread TO app_api;
GRANT SELECT, INSERT (tenant_id, id, thread_id, side, body, author_membership_id, author_person_id)
   ON app.message TO app_api;
GRANT SELECT, INSERT (tenant_id, application_id, thread_id)
   ON grants.application_message TO app_api;
GRANT SELECT, INSERT (tenant_id, id, label, created_by), UPDATE (label) ON app.tag TO app_api;
GRANT SELECT, INSERT (tenant_id, message_id, recipient_person_id, template_version_id)
   ON grants.message_notification TO app_api;

-- The notification job (S12-32), in its tenant's transaction: the outbox row,
-- its message and thread. The recipient's columns came with 0029's
-- party.person grant. It never writes a message or reads a note or tag.
GRANT SELECT ON app.message, app.message_thread, grants.application_message TO app_worker;
GRANT SELECT, UPDATE (status, error_code, sent_at) ON grants.message_notification TO app_worker;

-- The exclusive policy allows one waiting job per outbox row (see 0045).
SELECT pgboss.create_queue('grants.message_notification.dead', '{"policy": "standard"}');
SELECT pgboss.create_queue('grants.message_notification',
  '{"policy": "exclusive", "deadLetter": "grants.message_notification.dead"}');
INSERT INTO app.job_queue (name, kind)
  VALUES ('grants.message_notification.dead', 'tenant'), ('grants.message_notification', 'tenant');

-- The approved erasure of a subject's notes and messages (ADR 0027): it clears
-- the body of every note on, and every message on the thread of, an
-- application whose applicant is the party, and the party as notification
-- recipient, marking a still-queued notification failed so it is never sent.
-- It keeps ids, sides and times, deletes nothing, and refuses unless the party
-- is already erased in this transaction's tenant, so it can only follow
-- party.erase_party. A note or message body is replaced by 'erased', since
-- the column keeps its checks. A repeat call changes nothing further. It
-- writes no audit event: the erasure's own event covers it (as app.erase_file).
CREATE FUNCTION app.erase_subject_notes(party_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  erase_tenant CONSTANT uuid := app.current_tenant_id();
  notes integer;
  messages integer;
  notifications integer;
BEGIN
  IF erase_tenant IS NULL THEN
    RAISE EXCEPTION 'Erasure needs a tenant.' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  PERFORM FROM party.party p
   WHERE p.tenant_id = erase_tenant AND p.id = erase_subject_notes.party_id
     AND p.status = 'erased';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A party''s notes are erased only once the party is erased in this tenant.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  UPDATE app.note n
     SET body = 'erased'
    FROM grants.application_note l
    JOIN grants.application a ON a.tenant_id = l.tenant_id AND a.id = l.application_id
   WHERE n.tenant_id = erase_tenant AND l.tenant_id = n.tenant_id AND l.note_id = n.id
     AND a.applicant_person_id = erase_subject_notes.party_id AND n.body <> 'erased';
  GET DIAGNOSTICS notes = ROW_COUNT;

  UPDATE app.message m
     SET body = 'erased'
    FROM grants.application_message l
    JOIN grants.application a ON a.tenant_id = l.tenant_id AND a.id = l.application_id
   WHERE m.tenant_id = erase_tenant AND l.tenant_id = m.tenant_id AND l.thread_id = m.thread_id
     AND a.applicant_person_id = erase_subject_notes.party_id AND m.body <> 'erased';
  GET DIAGNOSTICS messages = ROW_COUNT;

  UPDATE grants.message_notification o
     SET recipient_person_id = NULL,
         status = CASE WHEN o.status = 'queued' THEN 'failed' ELSE o.status END,
         error_code = CASE WHEN o.status = 'queued' THEN 'no_address' ELSE o.error_code END
   WHERE o.tenant_id = erase_tenant AND o.recipient_person_id = erase_subject_notes.party_id;
  GET DIAGNOSTICS notifications = ROW_COUNT;

  RETURN pg_catalog.jsonb_build_object('app.note', notes, 'app.message', messages,
                                       'grants.message_notification', notifications);
END
$function$;

GRANT USAGE ON SCHEMA app, grants, party TO owner_app_erase_notes;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO owner_app_erase_notes;
GRANT SELECT (tenant_id, id, status) ON party.party TO owner_app_erase_notes;
GRANT SELECT (tenant_id, id, applicant_person_id) ON grants.application TO owner_app_erase_notes;
GRANT SELECT (tenant_id, note_id, application_id)
   ON grants.application_note TO owner_app_erase_notes;
GRANT SELECT (tenant_id, thread_id, application_id)
   ON grants.application_message TO owner_app_erase_notes;
GRANT SELECT (tenant_id, id, body), UPDATE (body) ON app.note TO owner_app_erase_notes;
GRANT SELECT (tenant_id, thread_id, body), UPDATE (body) ON app.message TO owner_app_erase_notes;
GRANT SELECT (tenant_id, recipient_person_id, status, error_code),
      UPDATE (recipient_person_id, status, error_code)
   ON grants.message_notification TO owner_app_erase_notes;

REVOKE ALL ON FUNCTION app.erase_subject_notes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.erase_subject_notes(uuid) TO app_worker;
GRANT CREATE ON SCHEMA app TO owner_app_erase_notes;
ALTER FUNCTION app.erase_subject_notes(uuid) OWNER TO owner_app_erase_notes;
REVOKE CREATE ON SCHEMA app FROM owner_app_erase_notes;
