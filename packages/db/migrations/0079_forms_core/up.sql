-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0079, up: the forms schema (S12-44, ADR 0016, ADR 0036): a
-- tenant's standalone forms, their immutable published versions, the
-- responses pinned to them and the anonymous respondents' tokens, plus the
-- one write path for anonymous responses and the erasure of a subject's
-- answers.
--
-- Every table is a tenant table under app.enable_tenant_rls(), with column
-- grants to app_api. Ids and every time a row records come from the
-- database. Lists, codes and caps copy S11-52's contracts in
-- modules/forms/src/contracts; test/forms/contracts.test.ts reads them back.
-- Text is as line() and paragraphs() leave it, with migration 0063's
-- patterns. Nothing here writes app.config_version or decides about a
-- response: the server records configuration with the author from the
-- session, and staff mark spam (rules 6, 9 and 10).

CREATE SCHEMA forms AUTHORIZATION migrator;
REVOKE ALL ON SCHEMA forms FROM PUBLIC;
-- app_worker only calls forms.erase_subject, and holds no table right.
GRANT USAGE ON SCHEMA forms
   TO app_api, app_worker, owner_forms_submit_public_response, owner_forms_erase_subject;

-- archived_at takes the database's time and, once set, stays.
CREATE FUNCTION forms.set_archived_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    RAISE EXCEPTION 'An archived form stays archived.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
    NEW.archived_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END
$function$;

-- A form and its settings. One anyone can answer keeps its responses 12
-- months at most, as they have no known subject (ADR 0027).
CREATE TABLE forms.form (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200)
    CONSTRAINT form_title_text CHECK (title !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  description text CHECK (char_length(description) BETWEEN 1 AND 2000)
    CONSTRAINT form_description_text CHECK (description !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  respondents text NOT NULL CHECK (respondents IN ('signed_in', 'anonymous', 'both')),
  opens_at timestamptz,
  closes_at timestamptz,
  retention_months integer NOT NULL DEFAULT 12 CHECK (retention_months BETWEEN 1 AND 120),
  confirmation_message text NOT NULL DEFAULT '' CHECK (char_length(confirmation_message) <= 2000)
    CONSTRAINT form_confirmation_message_text CHECK (confirmation_message !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  UNIQUE (tenant_id, id),
  CONSTRAINT form_window CHECK (closes_at > opens_at),
  CONSTRAINT form_anonymous_retention CHECK (respondents = 'signed_in' OR retention_months <= 12),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('forms.form');
SELECT app.deny_command('forms.form', 'DELETE');
CREATE TRIGGER set_archived_at BEFORE UPDATE ON forms.form
  FOR EACH ROW EXECUTE FUNCTION forms.set_archived_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON forms.form
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT,
      INSERT (tenant_id, title, description, respondents, opens_at, closes_at, retention_months,
              confirmation_message, created_by, updated_by),
      UPDATE (title, description, respondents, opens_at, closes_at, retention_months,
              confirmation_message, archived_at, updated_by)
   ON forms.form TO app_api;

-- A form's numbered versions (rule 7), as migration 0010 keeps grants'.
-- A form has at most one draft, which app_api may save, publish or
-- discard. A published version never changes: the UPDATE and DELETE
-- policies match drafts only, so to every role a published row is not there
-- to change or remove. Publishing records its configuration version (rule
-- 10), and the database sets its time and copies the form's respondents
-- setting, which then never changes (ADR 0036). The size limit is twice the
-- contract's 256 KB of compact JSON, as definition::text adds spaces.
CREATE TABLE forms.form_version (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  respondents text CHECK (respondents IN ('signed_in', 'anonymous', 'both')),
  definition jsonb
    CONSTRAINT form_version_definition_object CHECK (jsonb_typeof(definition) = 'object')
    CONSTRAINT form_version_definition_size CHECK (octet_length(definition::text) <= 524288),
  published_at timestamptz,
  published_by uuid,
  config_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, form_id, id),
  CONSTRAINT form_version_once UNIQUE (tenant_id, form_id, version),
  CONSTRAINT form_version_published CHECK (
    (status = 'published') = (published_at IS NOT NULL)
    AND (status = 'published') = (published_by IS NOT NULL)
    AND (status = 'published') = (config_version_id IS NOT NULL)
    AND (status = 'published') = (respondents IS NOT NULL)
    AND (status = 'draft' OR definition IS NOT NULL)),
  FOREIGN KEY (tenant_id, form_id) REFERENCES forms.form (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, config_version_id)
    REFERENCES app.config_version (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, published_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX form_version_one_draft ON forms.form_version (tenant_id, form_id)
  WHERE status = 'draft';
SELECT app.enable_tenant_rls('forms.form_version');
ALTER POLICY tenant_update ON forms.form_version
  USING (tenant_id = app.current_tenant_id() AND status = 'draft');
ALTER POLICY tenant_delete ON forms.form_version
  USING (tenant_id = app.current_tenant_id() AND status = 'draft');

-- On publishing: the time, and the form's respondents setting, read under
-- the caller's row-level security. A version anyone can answer holds no
-- file question (ADR 0030) and none counted only in reports (ADR 0032).
CREATE FUNCTION forms.prepare_version()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.status = 'published' AND (TG_OP = 'INSERT' OR OLD.status = 'draft') THEN
    NEW.published_at := pg_catalog.now();
    SELECT f.respondents INTO NEW.respondents
      FROM forms.form f WHERE f.tenant_id = NEW.tenant_id AND f.id = NEW.form_id;
    IF NEW.respondents <> 'signed_in' AND pg_catalog.jsonb_path_exists(NEW.definition,
         '$.sections[*].fields[*] ? (@.type == "file" || @.audiences == "aggregate_only")') THEN
      RAISE EXCEPTION 'A version anyone can answer holds no file or aggregate-only question.'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.status = 'draft' THEN
    NEW.published_at := NULL;
    NEW.respondents := NULL;
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER prepare_version BEFORE INSERT OR UPDATE ON forms.form_version
  FOR EACH ROW EXECUTE FUNCTION forms.prepare_version();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON forms.form_version
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT, DELETE,
      INSERT (tenant_id, form_id, version, definition, created_by, updated_by),
      UPDATE (status, definition, published_by, config_version_id, updated_by)
   ON forms.form_version TO app_api;

-- The backstop to the server's cleaning (S11-79): no answer, nor any text
-- in a list or an address, is empty or only whitespace and invisible format
-- characters, which the server stores as null. Answers are checked against
-- their definition only by validateAnswers() on the server (rule 6).
CREATE FUNCTION forms.answers_are_clean(answers jsonb)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  SET search_path = pg_catalog, pg_temp
BEGIN ATOMIC
  SELECT jsonb_typeof(answers) = 'object'
     AND NOT EXISTS (
       SELECT FROM jsonb_each(CASE jsonb_typeof(answers) WHEN 'object' THEN answers ELSE '{}' END)
                AS a(key, value)
        CROSS JOIN LATERAL (
          SELECT a.value
          UNION ALL
          SELECT e.value
            FROM jsonb_array_elements(CASE jsonb_typeof(a.value) WHEN 'array' THEN a.value ELSE '[]' END)
                 AS e(value)
          UNION ALL
          SELECT o.value
            FROM jsonb_each(CASE jsonb_typeof(a.value) WHEN 'object' THEN a.value ELSE '{}' END)
                 AS o(key, value)
        ) AS s(value)
       WHERE jsonb_typeof(s.value) = 'string'
         AND (s.value #>> '{}') ~ '^[\u0009-\u000d \u00a0\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u2066-\u206f\u3000\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]*$');
END;
REVOKE ALL ON FUNCTION forms.answers_are_clean(jsonb) FROM PUBLIC;
-- Every role that writes answers evaluates the check.
GRANT EXECUTE ON FUNCTION forms.answers_are_clean(jsonb)
   TO app_api, owner_forms_submit_public_response, owner_forms_erase_subject;

-- A response, pinned to the published version it answered (rule 7), keyed
-- by stable field ids. A signed-in respondent's is their person's, written
-- by their membership, and is a draft until submitted; each person has one
-- draft per form, which may move to a later version before it is
-- submitted. An anonymous response is written submitted, only by
-- forms.submit_public_response, with ADR 0036's hashes: its idempotency key
-- and canonical request, and the proof it was sent with, or none. The
-- database sets the submission time and keeps the response until
-- retain_until, from the form's retention then. Once submitted, its answers
-- are only ever cleared, for erasure, and spam is a staff mark with a
-- reason, kept out of lists but never removed by code (rule 9).
CREATE TABLE forms.response (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL,
  form_version_id uuid NOT NULL,
  route text NOT NULL CHECK (route IN ('signed_in', 'anonymous')),
  respondent_person_id uuid,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  answers jsonb NOT NULL DEFAULT '{}'
    CONSTRAINT response_answers_size CHECK (octet_length(answers::text) <= 524288)
    CONSTRAINT response_answers_clean CHECK (forms.answers_are_clean(answers)),
  submitted_at timestamptz,
  retain_until timestamptz,
  spam_reason text
    CHECK (spam_reason IN ('automated', 'abusive', 'unrelated', 'duplicate', 'test')),
  spam_marked_by uuid,
  spam_marked_at timestamptz,
  idempotency_key_hash bytea CHECK (octet_length(idempotency_key_hash) = 32),
  request_hash bytea CHECK (octet_length(request_hash) = 32),
  proof_hash bytea CHECK (octet_length(proof_hash) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (tenant_id, id),
  CONSTRAINT response_key_once UNIQUE (tenant_id, form_id, idempotency_key_hash),
  CONSTRAINT response_proof_once UNIQUE (proof_hash),
  CONSTRAINT response_route CHECK (CASE route
    WHEN 'signed_in' THEN respondent_person_id IS NOT NULL AND created_by IS NOT NULL
                          AND idempotency_key_hash IS NULL AND request_hash IS NULL
                          AND proof_hash IS NULL
    ELSE respondent_person_id IS NULL AND created_by IS NULL AND status = 'submitted'
         AND idempotency_key_hash IS NOT NULL AND request_hash IS NOT NULL
  END),
  CONSTRAINT response_submitted CHECK (
    (status = 'submitted') = (submitted_at IS NOT NULL)
    AND (status = 'submitted') = (retain_until IS NOT NULL)),
  CONSTRAINT response_spam CHECK (
    (spam_reason IS NULL) = (spam_marked_by IS NULL)
    AND (spam_reason IS NULL) = (spam_marked_at IS NULL)
    AND (spam_reason IS NULL OR status = 'submitted')),
  FOREIGN KEY (tenant_id, form_id) REFERENCES forms.form (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, form_id, form_version_id)
    REFERENCES forms.form_version (tenant_id, form_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, respondent_person_id)
    REFERENCES party.person (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, spam_marked_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX response_one_draft ON forms.response (tenant_id, form_id, respondent_person_id)
  WHERE status = 'draft';
CREATE INDEX response_form ON forms.response (tenant_id, form_id, submitted_at);
CREATE INDEX response_respondent ON forms.response (tenant_id, respondent_person_id)
  WHERE respondent_person_id IS NOT NULL;
SELECT app.enable_tenant_rls('forms.response');
SELECT app.deny_command('forms.response', 'DELETE');
-- No app role writes an anonymous response but through the function.
CREATE POLICY signed_in_insert ON forms.response AS RESTRICTIVE FOR INSERT
  TO app_api, app_worker, app_queue, app_auth
  WITH CHECK (route = 'signed_in');

-- The changes a response allows, whoever makes them, and the times the
-- database sets. Its form, route, respondent, author and hashes never
-- change. A submitted response stays submitted, pinned and with its times,
-- and its answers only lose keys. The retention is read under the caller's
-- row-level security, and a form it cannot see leaves it null, which the
-- submitted check refuses.
CREATE FUNCTION forms.keep_response()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  months integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.form_id, NEW.route, NEW.respondent_person_id, NEW.created_by,
        NEW.idempotency_key_hash, NEW.request_hash, NEW.proof_hash)
       IS DISTINCT FROM
       (OLD.form_id, OLD.route, OLD.respondent_person_id, OLD.created_by,
        OLD.idempotency_key_hash, OLD.request_hash, OLD.proof_hash) THEN
      RAISE EXCEPTION 'A response keeps its form, route, respondent and keys.'
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    IF OLD.status = 'submitted' THEN
      IF NEW.status <> 'submitted' OR NEW.form_version_id <> OLD.form_version_id
         OR EXISTS (SELECT FROM pg_catalog.jsonb_each(NEW.answers) AS a(key, value)
                     WHERE (OLD.answers -> a.key) IS DISTINCT FROM a.value) THEN
        RAISE EXCEPTION 'A submitted response stays submitted and pinned, and its answers are only cleared.'
          USING ERRCODE = 'object_not_in_prerequisite_state';
      END IF;
      NEW.submitted_at := OLD.submitted_at;
      NEW.retain_until := OLD.retain_until;
    END IF;
    IF NEW.spam_reason IS DISTINCT FROM OLD.spam_reason THEN
      NEW.spam_marked_at := CASE WHEN NEW.spam_reason IS NOT NULL THEN pg_catalog.now() END;
    END IF;
  END IF;
  IF NEW.status = 'submitted' AND (TG_OP = 'INSERT' OR OLD.status = 'draft') THEN
    SELECT f.retention_months INTO months
      FROM forms.form f WHERE f.tenant_id = NEW.tenant_id AND f.id = NEW.form_id;
    NEW.submitted_at := pg_catalog.now();
    NEW.retain_until := pg_catalog.now() + pg_catalog.make_interval(months => months);
  ELSIF TG_OP = 'INSERT' THEN
    NEW.submitted_at := NULL;
    NEW.retain_until := NULL;
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER keep_response BEFORE INSERT OR UPDATE ON forms.response
  FOR EACH ROW EXECUTE FUNCTION forms.keep_response();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON forms.response
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER refuse_erased_party BEFORE INSERT OR UPDATE OF respondent_person_id ON forms.response
  FOR EACH ROW WHEN (NEW.route = 'signed_in')
  EXECUTE FUNCTION party.refuse_erased_party('respondent_person_id');

-- An erased respondent's answers are final (ADR 0027, "erased is final"):
-- none is added or changed, whoever asks, though any may be cleared, as
-- forms.erase_subject does. The hashes never change (keep_response, which
-- fires first) and only an anonymous response, which names no party, has
-- them.
CREATE FUNCTION forms.refuse_erased_answers()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NOT EXISTS (SELECT FROM pg_catalog.jsonb_each(NEW.answers) AS a(key, value)
                      WHERE (OLD.answers -> a.key) IS DISTINCT FROM a.value) THEN
    RETURN NEW;
  END IF;
  IF party.is_erased(NEW.tenant_id, NEW.respondent_person_id) THEN
    RAISE EXCEPTION 'An erased party''s data never changes.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER refuse_erased_answers
  BEFORE INSERT OR UPDATE OF answers, idempotency_key_hash, request_hash ON forms.response
  FOR EACH ROW WHEN (NEW.route = 'signed_in')
  EXECUTE FUNCTION forms.refuse_erased_answers();

-- A response pins a version of its form (the foreign key) that is
-- published for its route. It runs after the row-level security checks and
-- foreign keys, and reads under the caller's row-level security. A
-- published version never changes, so it needs no lock.
CREATE FUNCTION forms.check_response_version()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  PERFORM FROM forms.form_version v
   WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.form_version_id AND v.status = 'published'
     AND v.respondents IN ('both', CASE NEW.route WHEN 'anonymous' THEN 'anonymous' ELSE 'signed_in' END);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A response pins a version published for its route only.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NULL;
END
$function$;
CREATE TRIGGER check_response_version AFTER INSERT OR UPDATE OF form_version_id ON forms.response
  FOR EACH ROW EXECUTE FUNCTION forms.check_response_version();
GRANT SELECT,
      INSERT (tenant_id, form_id, form_version_id, route, respondent_person_id, status, answers,
              created_by, updated_by),
      UPDATE (form_version_id, status, answers, spam_reason, spam_marked_by, updated_by)
   ON forms.response TO app_api;

-- An anonymous respondent's reference (ADR 0036): only the keyed hash of the
-- token they hold, unique across the deployment, and nothing that links it
-- to a party. It belongs to one submitted anonymous response, ends when the
-- response does, and is revoked once, by staff, when the response is erased.
CREATE TABLE forms.respondent_token (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id uuid NOT NULL,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT respondent_token_one UNIQUE (tenant_id, response_id),
  CONSTRAINT respondent_token_revoked CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
  FOREIGN KEY (tenant_id, response_id) REFERENCES forms.response (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, revoked_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('forms.respondent_token');
SELECT app.deny_command('forms.respondent_token', 'INSERT');
SELECT app.deny_command('forms.respondent_token', 'DELETE');

-- The expiry is the response's retain_until, read under the caller's
-- row-level security, which also finds only a submitted anonymous response.
-- The revocation time is the database's, and stays.
CREATE FUNCTION forms.prepare_token()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  ends timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT r.retain_until INTO ends
      FROM forms.response r
     WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.response_id
       AND r.route = 'anonymous' AND r.status = 'submitted';
    IF ends IS NULL THEN
      RAISE EXCEPTION 'A respondent token belongs to a submitted anonymous response only.'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.expires_at := ends;
    NEW.revoked_at := NULL;
    NEW.revoked_by := NULL;
  ELSIF OLD.revoked_at IS NOT NULL THEN
    IF (NEW.revoked_at, NEW.revoked_by) IS DISTINCT FROM (OLD.revoked_at, OLD.revoked_by) THEN
      RAISE EXCEPTION 'A revoked token stays revoked.' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.revoked_at IS NOT NULL THEN
    NEW.revoked_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER prepare_token BEFORE INSERT OR UPDATE ON forms.respondent_token
  FOR EACH ROW EXECUTE FUNCTION forms.prepare_token();

-- A token's hash is about its response's respondent, so none is written for
-- an erased one (ADR 0027). Only a signed-in response names a party, and
-- prepare_token refuses a token for one; the respondent is read only then,
-- so the submit function's owner needs no right to it.
CREATE FUNCTION forms.refuse_erased_token()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  respondent uuid;
BEGIN
  PERFORM FROM forms.response r
   WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.response_id AND r.route = 'signed_in';
  IF FOUND THEN
    SELECT r.respondent_person_id INTO respondent
      FROM forms.response r WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.response_id;
    IF party.is_erased(NEW.tenant_id, respondent) THEN
      RAISE EXCEPTION 'An erased party''s data never changes.'
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER refuse_erased_token
  BEFORE INSERT OR UPDATE OF response_id, token_hash ON forms.respondent_token
  FOR EACH ROW EXECUTE FUNCTION forms.refuse_erased_token();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON forms.respondent_token
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT, UPDATE (revoked_at, revoked_by) ON forms.respondent_token TO app_api;

-- The one write path for anonymous responses (ADR 0036, ADR 0019): it
-- resolves the tenant from the slug inside itself and sets none. In this
-- order it finds an active tenant with forms switched on, then the form by
-- that tenant's id and the form id together, taking anonymous answers, not
-- archived, open now and with its latest published version published for
-- anonymous answers, or answers not_found; then the version answered, a
-- published version of that form for anonymous answers, or answers
-- form_changed. It never substitutes another version. A key already stored
-- for the form answers the first response's id when the request hash
-- matches, and key_reused when it does not. Otherwise it writes one
-- submitted response pinned to that version, its token and its audit event,
-- which holds no answer, token, key or proof. An identical request in
-- flight waits on the key's unique index, then replays; the API sets
-- lock_timeout to 5s first (ADR 0036). A proof or token already stored
-- answers proof_used or key_reused, and nothing is written. Only the
-- response id or a code ever leaves it.
CREATE FUNCTION forms.submit_public_response(
  slug text, form_id uuid, form_version_id uuid, answers jsonb, token_hash bytea,
  key_hash bytea, request_hash bytea, proof_hash bytea, request_id uuid,
  OUT response_id uuid, OUT code text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  submit_tenant uuid;
  earlier record;
  refused text;
BEGIN
  SELECT t.id INTO submit_tenant
    FROM app.tenant t WHERE t.slug = submit_public_response.slug AND t.status = 'active';
  PERFORM FROM app.tenant_module m
   WHERE m.tenant_id = submit_tenant AND m.module = 'forms' AND m.enabled;
  IF NOT FOUND THEN
    code := 'not_found';
    RETURN;
  END IF;
  PERFORM FROM forms.form f
   WHERE f.tenant_id = submit_tenant AND f.id = submit_public_response.form_id
     AND f.respondents IN ('anonymous', 'both') AND f.archived_at IS NULL
     AND (f.opens_at IS NULL OR f.opens_at <= pg_catalog.now())
     AND (f.closes_at IS NULL OR f.closes_at > pg_catalog.now())
     AND (SELECT v.respondents FROM forms.form_version v
           WHERE v.tenant_id = f.tenant_id AND v.form_id = f.id AND v.status = 'published'
           ORDER BY v.version DESC LIMIT 1) IN ('anonymous', 'both');
  IF NOT FOUND THEN
    code := 'not_found';
    RETURN;
  END IF;
  PERFORM FROM forms.form_version v
   WHERE v.tenant_id = submit_tenant AND v.form_id = submit_public_response.form_id
     AND v.id = submit_public_response.form_version_id AND v.status = 'published'
     AND v.respondents IN ('anonymous', 'both');
  IF NOT FOUND THEN
    code := 'form_changed';
    RETURN;
  END IF;

  -- A second pass reads the response whose key the first pass's insert met.
  FOR attempt IN 1..2 LOOP
    SELECT r.id, r.request_hash INTO earlier
      FROM forms.response r
     WHERE r.tenant_id = submit_tenant AND r.form_id = submit_public_response.form_id
       AND r.idempotency_key_hash = submit_public_response.key_hash;
    IF FOUND THEN
      IF earlier.request_hash = submit_public_response.request_hash THEN
        response_id := earlier.id;
      ELSE
        code := 'key_reused';
      END IF;
      RETURN;
    END IF;
    BEGIN
      INSERT INTO forms.response (tenant_id, form_id, form_version_id, route, status, answers,
                                  idempotency_key_hash, request_hash, proof_hash)
      VALUES (submit_tenant, submit_public_response.form_id,
              submit_public_response.form_version_id, 'anonymous', 'submitted',
              submit_public_response.answers, submit_public_response.key_hash,
              submit_public_response.request_hash, submit_public_response.proof_hash)
      RETURNING id INTO response_id;
      INSERT INTO forms.respondent_token (tenant_id, response_id, token_hash)
      VALUES (submit_tenant, submit_public_response.response_id,
              submit_public_response.token_hash);
      INSERT INTO app.audit_event (tenant_id, request_id, actor_kind, action, entity_type,
                                   entity_id, changes)
      VALUES (submit_tenant, submit_public_response.request_id, 'system',
              'forms.response.submitted', 'forms.response', submit_public_response.response_id,
              pg_catalog.jsonb_build_object(
                'forms.response.form_id',
                pg_catalog.jsonb_build_object('after', submit_public_response.form_id),
                'forms.response.form_version_id',
                pg_catalog.jsonb_build_object('after', submit_public_response.form_version_id)));
      RETURN;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS refused = CONSTRAINT_NAME;
      response_id := NULL;
      IF refused <> 'response_key_once' THEN
        code := CASE refused WHEN 'response_proof_once' THEN 'proof_used' ELSE 'key_reused' END;
        RETURN;
      END IF;
    END;
  END LOOP;
  RAISE EXCEPTION 'An idempotency key met a response this transaction cannot see.'
    USING ERRCODE = 'serialization_failure';
END
$function$;

-- Its owner's rights: only the columns it, and the triggers it fires, read
-- or write, with a policy naming it on each table, since it runs with no
-- tenant set. The audit trigger reads the audit retention setting.
GRANT USAGE ON SCHEMA app TO owner_forms_submit_public_response;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO owner_forms_submit_public_response;
GRANT SELECT (id, slug, status) ON app.tenant TO owner_forms_submit_public_response;
GRANT SELECT (tenant_id, module, enabled) ON app.tenant_module
   TO owner_forms_submit_public_response;
GRANT SELECT (tenant_id, id, respondents, opens_at, closes_at, retention_months, archived_at)
   ON forms.form TO owner_forms_submit_public_response;
GRANT SELECT (tenant_id, id, form_id, version, status, respondents)
   ON forms.form_version TO owner_forms_submit_public_response;
GRANT SELECT (tenant_id, id, form_id, route, status, retain_until, idempotency_key_hash,
              request_hash),
      INSERT (tenant_id, form_id, form_version_id, route, status, answers,
              idempotency_key_hash, request_hash, proof_hash)
   ON forms.response TO owner_forms_submit_public_response;
GRANT INSERT (tenant_id, response_id, token_hash)
   ON forms.respondent_token TO owner_forms_submit_public_response;
GRANT SELECT (tenant_id, policy, days) ON app.retention_policy
   TO owner_forms_submit_public_response;
GRANT INSERT (tenant_id, request_id, actor_kind, action, entity_type, entity_id, changes)
   ON app.audit_event TO owner_forms_submit_public_response;

CREATE POLICY submit_public_response_select ON app.tenant FOR SELECT
  TO owner_forms_submit_public_response USING (status = 'active');
CREATE POLICY submit_public_response_select ON app.tenant_module FOR SELECT
  TO owner_forms_submit_public_response USING (module = 'forms');
CREATE POLICY submit_public_response_select ON forms.form FOR SELECT
  TO owner_forms_submit_public_response USING (respondents <> 'signed_in');
CREATE POLICY submit_public_response_select ON forms.form_version FOR SELECT
  TO owner_forms_submit_public_response USING (status = 'published');
CREATE POLICY submit_public_response_select ON forms.response FOR SELECT
  TO owner_forms_submit_public_response USING (route = 'anonymous');
CREATE POLICY submit_public_response_insert ON forms.response FOR INSERT
  TO owner_forms_submit_public_response
  WITH CHECK (route = 'anonymous' AND status = 'submitted');
CREATE POLICY submit_public_response_insert ON forms.respondent_token FOR INSERT
  TO owner_forms_submit_public_response WITH CHECK (revoked_at IS NULL);
CREATE POLICY submit_public_response_select ON app.retention_policy FOR SELECT
  TO owner_forms_submit_public_response USING (policy = 'audit');
CREATE POLICY submit_public_response_insert ON app.audit_event FOR INSERT
  TO owner_forms_submit_public_response
  WITH CHECK (action = 'forms.response.submitted' AND actor_kind = 'system'
              AND entity_type = 'forms.response');

REVOKE ALL ON FUNCTION
  forms.submit_public_response(text, uuid, uuid, jsonb, bytea, bytea, bytea, bytea, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  forms.submit_public_response(text, uuid, uuid, jsonb, bytea, bytea, bytea, bytea, uuid)
  TO app_api;
GRANT CREATE ON SCHEMA forms TO owner_forms_submit_public_response;
ALTER FUNCTION
  forms.submit_public_response(text, uuid, uuid, jsonb, bytea, bytea, bytea, bytea, uuid)
  OWNER TO owner_forms_submit_public_response;
REVOKE CREATE ON SCHEMA forms FROM owner_forms_submit_public_response;

-- The approved erasure of a subject's forms data (ADR 0027), run by the
-- erasure job after party.erase_party, in the tenant set in the
-- transaction. It refuses unless the party is already erased there. Of the
-- person's responses it keeps only the answers the pinned version (rule 7)
-- classifies public or internal, and ids, statuses and times; a question
-- with no class is personal or special category, as classificationOf()
-- reads it. It deletes nothing. Anonymous responses hold no party and are
-- untouched, and so are their tokens, the only tokens there are. A repeat
-- call changes nothing further. It writes no audit event: the erasure's own
-- event covers it.
CREATE FUNCTION forms.erase_subject(party_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  erase_tenant CONSTANT uuid := app.current_tenant_id();
  responses integer;
BEGIN
  IF erase_tenant IS NULL THEN
    RAISE EXCEPTION 'Erasure needs a tenant.' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  PERFORM FROM party.party p
   WHERE p.tenant_id = erase_tenant AND p.id = erase_subject.party_id AND p.status = 'erased';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A party''s forms data is erased only once the party is erased in this tenant.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  UPDATE forms.response r SET answers = k.answers
    FROM (SELECT s.id,
                 COALESCE((SELECT pg_catalog.jsonb_object_agg(a.key, a.value)
                             FROM pg_catalog.jsonb_each(s.answers) AS a(key, value)
                            WHERE a.key IN (
                              SELECT q.field ->> 'id'
                                FROM pg_catalog.jsonb_path_query(v.definition,
                                       '$.sections[*].fields[*] ? (@.classification == "public" || @.classification == "internal")')
                                     AS q(field))),
                          '{}') AS answers
            FROM forms.response s
            JOIN forms.form_version v ON v.tenant_id = s.tenant_id AND v.id = s.form_version_id
           WHERE s.tenant_id = erase_tenant AND s.respondent_person_id = erase_subject.party_id)
         AS k
   WHERE r.tenant_id = erase_tenant AND r.id = k.id AND r.answers <> k.answers;
  GET DIAGNOSTICS responses = ROW_COUNT;
  RETURN pg_catalog.jsonb_build_object('forms.response', responses);
END
$function$;

GRANT USAGE ON SCHEMA app, party TO owner_forms_erase_subject;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO owner_forms_erase_subject;
GRANT SELECT (tenant_id, id, status) ON party.party TO owner_forms_erase_subject;
GRANT SELECT (tenant_id, id, definition) ON forms.form_version TO owner_forms_erase_subject;
GRANT SELECT (tenant_id, id, form_version_id, respondent_person_id, answers), UPDATE (answers)
   ON forms.response TO owner_forms_erase_subject;

REVOKE ALL ON FUNCTION forms.erase_subject(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION forms.erase_subject(uuid) TO app_worker;
GRANT CREATE ON SCHEMA forms TO owner_forms_erase_subject;
ALTER FUNCTION forms.erase_subject(uuid) OWNER TO owner_forms_erase_subject;
REVOKE CREATE ON SCHEMA forms FROM owner_forms_erase_subject;
