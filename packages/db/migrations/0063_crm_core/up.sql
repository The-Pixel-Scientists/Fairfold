-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0063, up: the crm schema (S12-25, ADR 0016, ADR 0017, ADR 0025):
-- lists and their members, versioned segments, timeline interactions,
-- append-only merge records, CSV import jobs and rows, and external
-- references, keyed to parties by composite foreign key only. No crm table
-- copies a party's name, email, address or identifier, and nothing here
-- changes a party table. Lists, codes and caps copy S11-51's contracts in
-- modules/crm/src/contracts; test/crm/contracts.test.ts reads them back.
--
-- Every table is a tenant table under app.enable_tenant_rls(), with column
-- grants. Ids and every time a row records (created_at, updated_at,
-- archived_at, merged_at, confirmed_at, completed_at) come from the
-- database. Text is as line() and paragraphs() leave it, with the same
-- patterns as migration 0009. The migration writes no audit event or
-- config version, and no trigger does: the server writes both with the
-- actor from the session (rules 4, 6 and 10).

CREATE SCHEMA crm AUTHORIZATION migrator;
REVOKE ALL ON SCHEMA crm FROM PUBLIC;
GRANT USAGE ON SCHEMA crm TO app_api, app_worker;

-- archived_at takes the database's time and, once set, stays.
CREATE FUNCTION crm.set_archived_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    RAISE EXCEPTION 'An archived row stays archived.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
    NEW.archived_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END
$function$;

-- Names and descriptions are staff's words about a set of records, like a
-- tag's label: configuration that must not name a person.
CREATE TABLE crm.list (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200)
    CONSTRAINT list_name_text CHECK (name !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  description text CHECK (char_length(description) BETWEEN 1 AND 2000)
    CONSTRAINT list_description_text CHECK (description !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX list_name_unique ON crm.list (tenant_id, lower(name))
  WHERE archived_at IS NULL;
SELECT app.enable_tenant_rls('crm.list');
SELECT app.deny_command('crm.list', 'DELETE');
CREATE TRIGGER set_created_at BEFORE INSERT ON crm.list
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON crm.list
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_archived_at BEFORE UPDATE OF archived_at ON crm.list
  FOR EACH ROW EXECUTE FUNCTION crm.set_archived_at();
GRANT SELECT, INSERT (tenant_id, name, description, created_by, updated_by),
      UPDATE (name, description, archived_at, updated_by)
   ON crm.list TO app_api;

-- Party ids only: no consent, channel or contact value (ADR 0033). A member
-- is removed by DELETE, as S11-51's removeMembers route does; the audit
-- event crm.list_member.removed keeps the history.
CREATE TABLE crm.list_member (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL,
  party_id uuid NOT NULL,
  added_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, list_id, party_id),
  FOREIGN KEY (tenant_id, list_id) REFERENCES crm.list (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, party_id) REFERENCES party.party (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, added_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX list_member_party ON crm.list_member (tenant_id, party_id);
SELECT app.enable_tenant_rls('crm.list_member');
CREATE TRIGGER set_created_at BEFORE INSERT ON crm.list_member
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON crm.list_member
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER refuse_erased_party BEFORE INSERT OR UPDATE OF party_id ON crm.list_member
  FOR EACH ROW EXECUTE FUNCTION party.refuse_erased_party('party_id');
-- UPDATE (party_id), here and on crm.interaction and crm.external_reference,
-- is for crm's RepointParty (S12-33) alone. Their unique keys refuse a
-- re-point that would duplicate a list member, an event-fed interaction or an
-- external reference: S12-33 removes the loser's duplicate in the same
-- transaction, before it re-points.
GRANT SELECT, INSERT (tenant_id, list_id, party_id, added_by), UPDATE (party_id), DELETE
   ON crm.list_member TO app_api;

-- A definition is S11-51's filters: filter id to field, operator and value,
-- from the closed list of fields, none personal, special category or hidden.
CREATE TABLE crm.segment (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200)
    CONSTRAINT segment_name_text CHECK (name !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  description text CHECK (char_length(description) BETWEEN 1 AND 2000)
    CONSTRAINT segment_description_text CHECK (description !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  definition jsonb NOT NULL
    CONSTRAINT segment_definition_size CHECK (octet_length(definition::text) <= 8192)
    CONSTRAINT segment_definition_filters CHECK (
      jsonb_typeof(definition) = 'object'
      AND jsonb_array_length(jsonb_path_query_array(definition, '$.keyvalue()')) BETWEEN 1 AND 10
      AND NOT jsonb_path_exists(definition, 'strict $.keyvalue() ? (!(@.key like_regex "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$") || @.value.type() != "object")')
      AND NOT jsonb_path_exists(definition, 'strict $.* ? (@.type() == "object").keyvalue() ? (!(@.key like_regex "^(field|operator|value)$"))')
      AND NOT jsonb_path_exists(definition, 'lax $.* ? (@.field.type() != "string" || @.operator.type() != "string" || @.value.type() != "string" || !(@.field like_regex "^(kind|status|legal_form|identifier_scheme|list|contact_for|interaction_kind|last_interaction|created)$") || !(@.operator like_regex "^(eq|ne|has|lacks|has_verified|before|after)$"))')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX segment_name_unique ON crm.segment (tenant_id, lower(name))
  WHERE archived_at IS NULL;
SELECT app.enable_tenant_rls('crm.segment');
SELECT app.deny_command('crm.segment', 'DELETE');
CREATE TRIGGER set_created_at BEFORE INSERT ON crm.segment
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON crm.segment
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_archived_at BEFORE UPDATE OF archived_at ON crm.segment
  FOR EACH ROW EXECUTE FUNCTION crm.set_archived_at();

-- Rule 10: a change to the name, description or definition raises the
-- version by exactly one, and nothing else changes it. The server writes the
-- matching app.config_version row (entity type crm.segment, entity id the
-- segment's id, the same version, the diff from segmentDiff) in the same
-- transaction. Archiving keeps the version.
CREATE FUNCTION crm.check_segment_version()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF (NEW.name, NEW.description, NEW.definition) IS DISTINCT FROM
     (OLD.name, OLD.description, OLD.definition) THEN
    IF NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'A segment change raises its version by one.'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.version <> OLD.version THEN
    RAISE EXCEPTION 'A segment''s version changes only with its name, description or definition.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER check_segment_version BEFORE UPDATE ON crm.segment
  FOR EACH ROW EXECUTE FUNCTION crm.check_segment_version();
GRANT SELECT, INSERT (tenant_id, name, description, definition, created_by, updated_by),
      UPDATE (name, description, definition, version, archived_at, updated_by)
   ON crm.segment TO app_api;

-- A personal value about an erased party is never written (ADR 0027,
-- "erased is final"), except by crm.erase_subject, which clears it.
CREATE FUNCTION crm.refuse_erased_value()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF current_user = 'owner_crm_erase_subject' THEN
    RETURN NEW;
  END IF;
  IF party.is_erased(app.current_tenant_id(), NEW.party_id) THEN
    RAISE EXCEPTION 'An erased party''s data never changes.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END
$function$;

-- A timeline item. Staff record a note, call, meeting or email (source
-- module crm, with a summary and the recording member). Another module's
-- event adds one with a source reference instead: the module's entity type
-- and id. The reference is not a foreign key, since the entity lives in
-- another module's schema (ADR 0016), and holds no copy of its values: the
-- screen reads it through the owning module's contract (S11-51), so erasure
-- there needs nothing here. This exception to "no polymorphic owner"
-- (ADR 0030) needs sign-off in review before S12-51 builds on it.
-- A replayed event inserts nothing: the worker inserts with ON CONFLICT DO
-- NOTHING against interaction_event.
CREATE TABLE crm.interaction (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN (
    'note', 'call', 'meeting', 'email', 'application_submitted', 'decision_released')),
  occurred_at timestamptz NOT NULL,
  source_module text NOT NULL CHECK (source_module IN (
    'platform', 'party', 'grants', 'crm', 'assure', 'forms', 'privacy', 'insight')),
  source_entity_type text CHECK (source_entity_type IN ('grants.application', 'grants.decision')),
  source_entity_id uuid,
  summary text CHECK (char_length(summary) BETWEEN 1 AND 2000)
    CONSTRAINT interaction_summary_text CHECK (summary !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT interaction_event
    UNIQUE (tenant_id, party_id, source_module, source_entity_type, source_entity_id, kind),
  CONSTRAINT interaction_source CHECK (CASE WHEN source_module = 'crm'
    THEN kind IN ('note', 'call', 'meeting', 'email')
      AND source_entity_type IS NULL AND source_entity_id IS NULL
      AND summary IS NOT NULL AND recorded_by IS NOT NULL
    ELSE kind IN ('application_submitted', 'decision_released')
      AND split_part(source_entity_type, '.', 1) = source_module AND source_entity_id IS NOT NULL
      AND summary IS NULL AND recorded_by IS NULL
    END),
  FOREIGN KEY (tenant_id, party_id) REFERENCES party.party (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, recorded_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX interaction_timeline ON crm.interaction (tenant_id, party_id, occurred_at);
SELECT app.enable_tenant_rls('crm.interaction');
SELECT app.deny_command('crm.interaction', 'DELETE');
CREATE TRIGGER set_created_at BEFORE INSERT ON crm.interaction
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON crm.interaction
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER refuse_erased_party BEFORE INSERT OR UPDATE OF party_id ON crm.interaction
  FOR EACH ROW EXECUTE FUNCTION party.refuse_erased_party('party_id');
CREATE TRIGGER refuse_erased_value BEFORE INSERT OR UPDATE OF summary ON crm.interaction
  FOR EACH ROW EXECUTE FUNCTION crm.refuse_erased_value();
GRANT SELECT, INSERT (tenant_id, party_id, kind, occurred_at, source_module, summary, recorded_by),
      UPDATE (party_id)
   ON crm.interaction TO app_api;
-- S12-51's timeline handler, for event-fed rows only.
GRANT INSERT (tenant_id, party_id, kind, occurred_at, source_module, source_entity_type,
              source_entity_id)
   ON crm.interaction TO app_worker;

-- Every merge (ADR 0025), append-only for every app role, and written only
-- by the confirming member's request (rule 9): no default, trigger, job or
-- function writes one. Loser and survivor are parties of the record's kind,
-- and keep pointing at the loser. Counts are S11-51's: rows changed by table
-- for each module, with no ids or values. The preview hash is the SHA-256,
-- in hex, of the confirmed preview's previewBasisText. ADR 0025 is still
-- proposed, so the only action is merge: an unmerge needs the rows a merge
-- changed (crm.merge_record_row) and the loser's earlier status, which a
-- later migration adds with the reversal once the ADR is accepted.
CREATE TABLE crm.merge_record (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('organisation', 'person')),
  action text NOT NULL CHECK (action IN ('merge')),
  loser_id uuid NOT NULL,
  survivor_id uuid NOT NULL,
  repointed_counts jsonb NOT NULL
    CONSTRAINT merge_record_counts_size CHECK (octet_length(repointed_counts::text) <= 8192)
    CONSTRAINT merge_record_counts CHECK (
      jsonb_typeof(repointed_counts) = 'object'
      AND NOT jsonb_path_exists(repointed_counts, 'strict $.keyvalue() ? (!(@.key like_regex "^(platform|party|grants|crm|assure|forms|privacy|insight)$") || @.value.type() != "object")')
      AND NOT jsonb_path_exists(repointed_counts, 'strict $.* ? (@.type() == "object").keyvalue() ? (!(@.key like_regex "^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$") || @.value.type() != "number" || @.value < 0 || @.value != @.value.floor())')),
  preview_hash text NOT NULL CHECK (preview_hash ~ '^[0-9a-f]{64}$'),
  merged_by uuid NOT NULL,
  merged_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT merge_record_two_parties CHECK (loser_id <> survivor_id),
  FOREIGN KEY (tenant_id, loser_id, kind)
    REFERENCES party.party (tenant_id, id, kind) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, survivor_id, kind)
    REFERENCES party.party (tenant_id, id, kind) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, merged_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX merge_record_loser ON crm.merge_record (tenant_id, loser_id);
CREATE INDEX merge_record_survivor ON crm.merge_record (tenant_id, survivor_id);
SELECT app.enable_tenant_rls('crm.merge_record');
SELECT app.deny_command('crm.merge_record', 'UPDATE');
SELECT app.deny_command('crm.merge_record', 'DELETE');

CREATE FUNCTION crm.set_merged_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  NEW.merged_at := pg_catalog.now();
  RETURN NEW;
END
$function$;
CREATE TRIGGER set_merged_at BEFORE INSERT ON crm.merge_record
  FOR EACH ROW EXECUTE FUNCTION crm.set_merged_at();
CREATE TRIGGER refuse_erased_party BEFORE INSERT ON crm.merge_record
  FOR EACH ROW EXECUTE FUNCTION party.refuse_erased_party('loser_id', 'survivor_id');
GRANT SELECT, INSERT (tenant_id, kind, action, loser_id, survivor_id, repointed_counts,
                      preview_hash, merged_by)
   ON crm.merge_record TO app_api;

-- A CSV import (S11-51): the uploaded file, the kind of record, whether the
-- first row is a header, and column position to field id; no header text or
-- cell values. The worker checks the file (queued, checking, then ready or
-- failed with a file failure code, never exception text); staff confirm a
-- ready job, which the API imports (importing, then completed). The job's
-- file never changes, its other inputs never change once it leaves queued,
-- and a finished job never changes.
CREATE TABLE crm.import_job (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid NOT NULL,
  target_kind text NOT NULL CHECK (target_kind IN ('organisation', 'person')),
  header_row boolean NOT NULL,
  column_mapping jsonb NOT NULL
    CONSTRAINT import_job_mapping CHECK (
      jsonb_typeof(column_mapping) = 'object'
      AND jsonb_array_length(jsonb_path_query_array(column_mapping, '$.keyvalue()')) BETWEEN 1 AND 50
      AND NOT jsonb_path_exists(column_mapping, 'strict $.keyvalue() ? (!(@.key like_regex "^([1-9]|[1-4][0-9]|50)$") || @.value.type() != "string" || !(@.value like_regex "^(name|legal_form|address_line1|town|postcode|address_line2|country_code|website|identifier_scheme|identifier|given_name|family_name|email|phone)$"))')),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN (
    'queued', 'checking', 'ready', 'failed', 'importing', 'completed')),
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count BETWEEN 0 AND 5000),
  valid_count integer NOT NULL DEFAULT 0 CHECK (valid_count BETWEEN 0 AND row_count),
  created_count integer NOT NULL DEFAULT 0 CHECK (created_count BETWEEN 0 AND row_count),
  error_code text CHECK (error_code IN (
    'file_unreadable', 'not_csv', 'too_large', 'too_many_rows', 'too_many_columns', 'no_rows')),
  requested_by uuid NOT NULL,
  confirmed_by uuid,
  confirmed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT import_job_failure CHECK ((state = 'failed') = (error_code IS NOT NULL)),
  CONSTRAINT import_job_confirmed CHECK (
    (state IN ('importing', 'completed')) = (confirmed_by IS NOT NULL)
    AND (confirmed_by IS NULL) = (confirmed_at IS NULL)),
  CONSTRAINT import_job_completed CHECK (
    (state IN ('failed', 'completed')) = (completed_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, file_id) REFERENCES app.file (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, requested_by)
    REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, confirmed_by)
    REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('crm.import_job');
SELECT app.deny_command('crm.import_job', 'DELETE');
CREATE TRIGGER set_created_at BEFORE INSERT ON crm.import_job
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON crm.import_job
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE FUNCTION crm.check_import_job()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF OLD.state IN ('failed', 'completed') THEN
    RAISE EXCEPTION 'A finished import never changes.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.file_id IS DISTINCT FROM OLD.file_id THEN
    RAISE EXCEPTION 'An import keeps the file it linked.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state <> 'queued' AND (NEW.target_kind, NEW.header_row, NEW.column_mapping)
     IS DISTINCT FROM (OLD.target_kind, OLD.header_row, OLD.column_mapping) THEN
    RAISE EXCEPTION 'An import''s file and mapping are fixed once it is checked.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.state <> OLD.state AND (OLD.state, NEW.state) NOT IN (
       ('queued', 'checking'), ('queued', 'failed'), ('checking', 'ready'),
       ('checking', 'failed'), ('ready', 'importing'), ('importing', 'completed')) THEN
    RAISE EXCEPTION 'An import moves only forward through its states.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.confirmed_by IS NOT NULL AND NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by THEN
    RAISE EXCEPTION 'An import is confirmed once.' USING ERRCODE = 'check_violation';
  END IF;
  NEW.confirmed_at := CASE WHEN OLD.confirmed_by IS NULL AND NEW.confirmed_by IS NOT NULL
                           THEN pg_catalog.now() ELSE OLD.confirmed_at END;
  NEW.completed_at := CASE WHEN NEW.state IN ('failed', 'completed') THEN pg_catalog.now() END;
  RETURN NEW;
END
$function$;
CREATE TRIGGER check_import_job BEFORE UPDATE ON crm.import_job
  FOR EACH ROW EXECUTE FUNCTION crm.check_import_job();

-- A new job links its file (ADR 0030, "One file, one link"): app.link_file()
-- refuses a file that has not passed its virus scan, is erased, or was ever
-- linked, so a job never takes an unscanned file or another link's file.
CREATE FUNCTION crm.link_import_file()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  PERFORM app.link_file(NEW.file_id);
  RETURN NULL;
END
$function$;
CREATE TRIGGER link_import_file AFTER INSERT ON crm.import_job
  FOR EACH ROW EXECUTE FUNCTION crm.link_import_file();
-- app_api starts and confirms an import; S12-51's parse job checks the file.
GRANT SELECT, INSERT (tenant_id, file_id, target_kind, header_row, column_mapping, requested_by),
      UPDATE (state, created_count, confirmed_by)
   ON crm.import_job TO app_api;
GRANT SELECT, UPDATE (state, row_count, valid_count, error_code) ON crm.import_job TO app_worker;

-- One row of the file: cells are field id to the value as read, personal and
-- short-lived; errors are field id and code pairs, never a value. A created
-- party is set once, on confirm. Import rows never write to party: the API
-- creates parties through party's contract.
CREATE TABLE crm.import_row (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  row_number integer NOT NULL CHECK (row_number BETWEEN 1 AND 5001),
  cells jsonb NOT NULL
    CONSTRAINT import_row_cells_size CHECK (octet_length(cells::text) <= 32768)
    CONSTRAINT import_row_cells CHECK (
      jsonb_typeof(cells) = 'object'
      AND NOT jsonb_path_exists(cells, 'strict $.keyvalue() ? (@.value.type() != "string" || !(@.key like_regex "^(name|legal_form|address_line1|town|postcode|address_line2|country_code|website|identifier_scheme|identifier|given_name|family_name|email|phone)$"))')),
  errors jsonb NOT NULL DEFAULT '[]'
    CONSTRAINT import_row_errors CHECK (
      jsonb_typeof(errors) = 'array' AND jsonb_array_length(errors) <= 14
      AND NOT jsonb_path_exists(errors, 'strict $[*] ? (@.type() != "object")')
      AND NOT jsonb_path_exists(errors, 'strict $[*] ? (@.type() == "object").keyvalue() ? (!(@.key like_regex "^(field|code)$"))')
      AND NOT jsonb_path_exists(errors, 'lax $[*] ? (@.field.type() != "string" || @.code.type() != "string" || !(@.field like_regex "^(name|legal_form|address_line1|town|postcode|address_line2|country_code|website|identifier_scheme|identifier|given_name|family_name|email|phone)$") || !(@.code like_regex "^(required|too_long|not_valid|not_in_list|hidden_characters|formula|repeated_in_file)$"))')),
  duplicate_party_id uuid,
  created_party_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, job_id, row_number),
  FOREIGN KEY (tenant_id, job_id) REFERENCES crm.import_job (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, duplicate_party_id)
    REFERENCES party.party (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_party_id)
    REFERENCES party.party (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX import_row_created_party ON crm.import_row (tenant_id, created_party_id)
  WHERE created_party_id IS NOT NULL;
CREATE INDEX import_row_duplicate_party ON crm.import_row (tenant_id, duplicate_party_id)
  WHERE duplicate_party_id IS NOT NULL;
SELECT app.enable_tenant_rls('crm.import_row');
SELECT app.deny_command('crm.import_row', 'DELETE');
CREATE TRIGGER set_created_at BEFORE INSERT ON crm.import_row
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON crm.import_row
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER refuse_erased_party
  BEFORE INSERT OR UPDATE OF duplicate_party_id, created_party_id ON crm.import_row
  FOR EACH ROW EXECUTE FUNCTION party.refuse_erased_party('duplicate_party_id', 'created_party_id');

CREATE FUNCTION crm.keep_import_row()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF OLD.created_party_id IS NOT NULL
     AND NEW.created_party_id IS DISTINCT FROM OLD.created_party_id THEN
    RAISE EXCEPTION 'An import row''s created record is set once.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER keep_import_row BEFORE UPDATE OF created_party_id ON crm.import_row
  FOR EACH ROW EXECUTE FUNCTION crm.keep_import_row();
GRANT SELECT, UPDATE (created_party_id) ON crm.import_row TO app_api;
GRANT SELECT, INSERT (tenant_id, job_id, row_number, cells, errors, duplicate_party_id)
   ON crm.import_row TO app_worker;

-- The parse job, one waiting job per import (keyed on its id).
SELECT pgboss.create_queue('crm.import_parse.dead', '{"policy": "standard"}');
SELECT pgboss.create_queue('crm.import_parse',
  '{"policy": "exclusive", "deadLetter": "crm.import_parse.dead"}');
INSERT INTO app.job_queue (name, kind)
  VALUES ('crm.import_parse.dead', 'tenant'), ('crm.import_parse', 'tenant');

-- The id a party has in another system (ADR 0008), a pointer only: no
-- credential, token or sync state. Removing one is a DELETE, as S11-51's
-- removeExternalReference route does.
CREATE TABLE crm.external_reference (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL,
  system text NOT NULL CHECK (system IN ('twenty', 'salesforce', 'other')),
  external_id text NOT NULL CHECK (external_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  url text CHECK (char_length(url) <= 500 AND url ~ '^https://[^/?#@[:space:][:cntrl:]]+\.[^/?#@[:space:][:cntrl:]]+([/?#][^[:space:][:cntrl:]]*)?$'),
  added_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, system, external_id),
  FOREIGN KEY (tenant_id, party_id) REFERENCES party.party (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, added_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX external_reference_party ON crm.external_reference (tenant_id, party_id);
SELECT app.enable_tenant_rls('crm.external_reference');
CREATE TRIGGER set_created_at BEFORE INSERT ON crm.external_reference
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON crm.external_reference
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER refuse_erased_party BEFORE INSERT OR UPDATE OF party_id ON crm.external_reference
  FOR EACH ROW EXECUTE FUNCTION party.refuse_erased_party('party_id');
CREATE TRIGGER refuse_erased_value BEFORE INSERT OR UPDATE OF external_id, url
  ON crm.external_reference
  FOR EACH ROW EXECUTE FUNCTION crm.refuse_erased_value();
GRANT SELECT, INSERT (tenant_id, party_id, system, external_id, url, added_by),
      UPDATE (party_id), DELETE
   ON crm.external_reference TO app_api;

-- The approved erasure of a subject's crm data (ADR 0027): it replaces the
-- party's interaction summaries with 'erased', empties the cells of import
-- rows that created or matched the party, and replaces the party's external
-- ids with 'erased:<row id>' (kept unique) and clears their URLs. It keeps
-- ids, codes and times, deletes nothing, and refuses unless the party is
-- already erased in this transaction's tenant, so it follows
-- party.erase_party. List members and merge records hold no personal value.
-- A repeat call changes nothing further. It writes no audit event: the
-- erasure's own event covers it.
CREATE FUNCTION crm.erase_subject(party_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  erase_tenant CONSTANT uuid := app.current_tenant_id();
  interactions integer;
  import_rows integer;
  references_cleared integer;
BEGIN
  IF erase_tenant IS NULL THEN
    RAISE EXCEPTION 'Erasure needs a tenant.' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  PERFORM FROM party.party p
   WHERE p.tenant_id = erase_tenant AND p.id = erase_subject.party_id AND p.status = 'erased';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A party''s crm data is erased only once the party is erased in this tenant.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  UPDATE crm.interaction i SET summary = 'erased'
   WHERE i.tenant_id = erase_tenant AND i.party_id = erase_subject.party_id
     AND i.summary <> 'erased';
  GET DIAGNOSTICS interactions = ROW_COUNT;

  UPDATE crm.import_row r SET cells = '{}'
   WHERE r.tenant_id = erase_tenant AND r.cells <> '{}'
     AND (r.created_party_id = erase_subject.party_id
          OR r.duplicate_party_id = erase_subject.party_id);
  GET DIAGNOSTICS import_rows = ROW_COUNT;

  UPDATE crm.external_reference e SET external_id = 'erased:' || e.id::text, url = NULL
   WHERE e.tenant_id = erase_tenant AND e.party_id = erase_subject.party_id
     AND (e.external_id <> 'erased:' || e.id::text OR e.url IS NOT NULL);
  GET DIAGNOSTICS references_cleared = ROW_COUNT;

  RETURN pg_catalog.jsonb_build_object('crm.interaction', interactions,
                                       'crm.import_row', import_rows,
                                       'crm.external_reference', references_cleared);
END
$function$;

GRANT USAGE ON SCHEMA app, party, crm TO owner_crm_erase_subject;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO owner_crm_erase_subject;
GRANT SELECT (tenant_id, id, status) ON party.party TO owner_crm_erase_subject;
GRANT SELECT (tenant_id, party_id, summary), UPDATE (summary)
   ON crm.interaction TO owner_crm_erase_subject;
GRANT SELECT (tenant_id, created_party_id, duplicate_party_id, cells), UPDATE (cells)
   ON crm.import_row TO owner_crm_erase_subject;
GRANT SELECT (tenant_id, id, party_id, external_id, url), UPDATE (external_id, url)
   ON crm.external_reference TO owner_crm_erase_subject;

REVOKE ALL ON FUNCTION crm.erase_subject(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm.erase_subject(uuid) TO app_worker;
GRANT CREATE ON SCHEMA crm TO owner_crm_erase_subject;
ALTER FUNCTION crm.erase_subject(uuid) OWNER TO owner_crm_erase_subject;
REVOKE CREATE ON SCHEMA crm FROM owner_crm_erase_subject;
