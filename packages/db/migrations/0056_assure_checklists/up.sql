-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0056, up: due diligence checklists, their versions, and an
-- application's answers with their file answers (S12-14). app_api writes
-- them for the console (S12-35); app_worker only reads them, for subject
-- access (ADR 0027).

-- Due diligence checklists: versioned configuration (rule 10). The name is
-- the newest version's, for listing and uniqueness. current_version moves
-- only to the next existing version; the server writes the matching
-- app.config_version row (entity type assure.checklist, entity id the
-- checklist's id) in the same transaction.
CREATE TABLE assure.checklist (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id uuid,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120 AND name !~ '[[:cntrl:]]'
    AND name = btrim(name)),
  current_version integer CHECK (current_version > 0),
  archived_at timestamptz,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, programme_id)
    REFERENCES grants.programme (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX checklist_name_unique ON assure.checklist (tenant_id, lower(name))
  WHERE archived_at IS NULL;
SELECT app.enable_tenant_rls('assure.checklist');
SELECT app.deny_command('assure.checklist', 'DELETE');
CREATE TRIGGER stamp_now BEFORE INSERT ON assure.checklist
  FOR EACH ROW EXECUTE FUNCTION assure.stamp_now('created_at', 'updated_at');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON assure.checklist
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- Immutable once written. Each item keeps its id in every version; answers
-- are keyed by it.
CREATE TABLE assure.checklist_version (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120 AND name !~ '[[:cntrl:]]'
    AND name = btrim(name)),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  items jsonb NOT NULL CHECK (
    jsonb_typeof(items) = 'array' AND jsonb_array_length(items) BETWEEN 1 AND 100
    AND octet_length(items::text) <= 200000
    AND NOT jsonb_path_exists(items, '$[*] ? (@.type() != "object"
      || !exists(@.id ? (@.type() == "string" && @ like_regex "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"))
      || !exists(@.label ? (@.type() == "string"))
      || !exists(@.help ? (@.type() == "string"))
      || !exists(@.required ? (@.type() == "boolean"))
      || !exists(@.kind ? (@ == "yes_no" || @ == "date" || @ == "short_text" || @ == "file")))')),
  published_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, id, checklist_id),
  UNIQUE (tenant_id, checklist_id, version),
  FOREIGN KEY (tenant_id, checklist_id)
    REFERENCES assure.checklist (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, published_by)
    REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('assure.checklist_version');
SELECT app.deny_command('assure.checklist_version', 'UPDATE');
SELECT app.deny_command('assure.checklist_version', 'DELETE');
CREATE TRIGGER stamp_now BEFORE INSERT ON assure.checklist_version
  FOR EACH ROW EXECUTE FUNCTION assure.stamp_now('created_at');

CREATE FUNCTION assure.check_checklist_version()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.current_version IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.current_version IS DISTINCT FROM OLD.current_version
         AND (NEW.current_version IS DISTINCT FROM COALESCE(OLD.current_version, 0) + 1
              OR NOT EXISTS (SELECT FROM assure.checklist_version v
                              WHERE v.tenant_id = NEW.tenant_id AND v.checklist_id = NEW.id
                                AND v.version = NEW.current_version))) THEN
    RAISE EXCEPTION 'A checklist moves only to its next published version.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER check_checklist_version BEFORE INSERT OR UPDATE ON assure.checklist
  FOR EACH ROW EXECUTE FUNCTION assure.check_checklist_version();

-- An application's answers to one checklist, pinned to the version they
-- answer (rule 7): one per application and checklist. File answers are rows
-- of assure.checklist_response_file, never ids in answers.
CREATE TABLE assure.checklist_response (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL,
  checklist_id uuid NOT NULL,
  checklist_version_id uuid NOT NULL,
  answers jsonb NOT NULL DEFAULT '{}' CHECK (
    jsonb_typeof(answers) = 'object' AND octet_length(answers::text) <= 100000
    AND jsonb_array_length(jsonb_path_query_array(answers, '$.keyvalue()')) <= 100
    AND NOT jsonb_path_exists(answers, '$.* ? (@.type() != "object"
      || !exists(@.kind ? (@ == "yes_no" || @ == "date" || @ == "short_text")))')),
  saved_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, application_id, checklist_id),
  FOREIGN KEY (tenant_id, application_id)
    REFERENCES grants.application (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, checklist_version_id, checklist_id)
    REFERENCES assure.checklist_version (tenant_id, id, checklist_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, saved_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('assure.checklist_response');
SELECT app.deny_command('assure.checklist_response', 'DELETE');
CREATE TRIGGER stamp_now BEFORE INSERT ON assure.checklist_response
  FOR EACH ROW EXECUTE FUNCTION assure.stamp_now('created_at', 'updated_at');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON assure.checklist_response
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER refuse_erased_applicant BEFORE INSERT ON assure.checklist_response
  FOR EACH ROW EXECUTE FUNCTION grants.refuse_erased_applicant_link();

-- An erased applicant's answers change only as assure.erase_subject changes
-- them: each short text to 'erased', every other answer kept. A file answer
-- is never added to their response, nor changed. Both read as the caller.
CREATE FUNCTION assure.keep_erased_answers()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  applicant uuid;
BEGIN
  IF TG_TABLE_NAME = 'checklist_response' THEN
    IF NEW.answers = COALESCE(
         (SELECT pg_catalog.jsonb_object_agg(e.key, CASE
                   WHEN e.value ->> 'kind' = 'short_text'
                     THEN pg_catalog.jsonb_build_object('kind', 'short_text', 'value', 'erased')
                   ELSE e.value END)
            FROM pg_catalog.jsonb_each(OLD.answers) AS e), '{}') THEN
      RETURN NEW;
    END IF;
    SELECT a.applicant_person_id INTO applicant
      FROM grants.application a
     WHERE a.tenant_id = NEW.tenant_id AND a.id = NEW.application_id;
  ELSE
    SELECT a.applicant_person_id INTO applicant
      FROM assure.checklist_response r
      JOIN grants.application a ON a.tenant_id = r.tenant_id AND a.id = r.application_id
     WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.response_id;
  END IF;
  IF party.is_erased(NEW.tenant_id, applicant) THEN
    RAISE EXCEPTION 'An erased party''s data never changes.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER keep_erased BEFORE UPDATE OF answers ON assure.checklist_response
  FOR EACH ROW EXECUTE FUNCTION assure.keep_erased_answers();

-- A join's triggers link a clean file when its row is added and release it
-- when the row goes (ADR 0030, "One file, one link").
CREATE FUNCTION assure.link_file()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM app.link_file(NEW.file_id);
  ELSE
    PERFORM app.release_file(OLD.file_id);
  END IF;
  RETURN NULL;
END
$function$;

CREATE TABLE assure.checklist_response_file (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id uuid NOT NULL,
  item_id uuid NOT NULL,
  file_id uuid NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, file_id),
  FOREIGN KEY (tenant_id, response_id)
    REFERENCES assure.checklist_response (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, file_id) REFERENCES app.file (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX checklist_response_file_response
  ON assure.checklist_response_file (tenant_id, response_id, item_id);
SELECT app.enable_tenant_rls('assure.checklist_response_file');
SELECT app.deny_command('assure.checklist_response_file', 'UPDATE');
CREATE TRIGGER stamp_now BEFORE INSERT ON assure.checklist_response_file
  FOR EACH ROW EXECUTE FUNCTION assure.stamp_now('created_at');
CREATE TRIGGER link_file AFTER INSERT OR DELETE ON assure.checklist_response_file
  FOR EACH ROW EXECUTE FUNCTION assure.link_file();
CREATE TRIGGER keep_erased BEFORE INSERT OR UPDATE ON assure.checklist_response_file
  FOR EACH ROW EXECUTE FUNCTION assure.keep_erased_answers();

GRANT SELECT, INSERT (tenant_id, programme_id, name, created_by, updated_by),
      UPDATE (name, current_version, archived_at, updated_by)
   ON assure.checklist TO app_api;
GRANT SELECT,
      INSERT (tenant_id, checklist_id, version, name, description, items, published_by)
   ON assure.checklist_version TO app_api;
GRANT SELECT,
      INSERT (tenant_id, application_id, checklist_id, checklist_version_id, answers, saved_by),
      UPDATE (answers, saved_by)
   ON assure.checklist_response TO app_api;
GRANT SELECT, DELETE, INSERT (tenant_id, response_id, item_id, file_id, created_by)
   ON assure.checklist_response_file TO app_api;
GRANT SELECT ON assure.checklist, assure.checklist_version, assure.checklist_response,
  assure.checklist_response_file TO app_worker;
