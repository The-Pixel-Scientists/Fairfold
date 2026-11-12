-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0057, up: monitoring visits with their attendees and evidence
-- (S12-14). app_api writes them for the console (S12-35); app_worker only
-- reads them, for subject access (ADR 0027). Evidence links its file with
-- assure.link_file(), from migration 0056.

-- A monitoring visit to an organisation, for a funded application or none.
-- Findings and follow-ups are free text about the organisation and may name
-- people. A visit stays with its organisation and application.
CREATE TABLE assure.monitoring_visit (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  application_id uuid,
  visited_on date NOT NULL,
  visit_type text NOT NULL CHECK (visit_type IN ('in_person', 'video_call', 'phone_call')),
  findings text NOT NULL DEFAULT ''
    CHECK (char_length(findings) <= 10000 AND findings !~ '[\x01-\x09\x0b-\x1f\x7f]'),
  follow_ups jsonb NOT NULL DEFAULT '[]' CHECK (
    jsonb_typeof(follow_ups) = 'array' AND jsonb_array_length(follow_ups) <= 50
    AND octet_length(follow_ups::text) <= 40000
    AND NOT jsonb_path_exists(follow_ups, '$[*] ? (@.type() != "object"
      || !exists(@.action ? (@.type() == "string"))
      || !exists(@.done ? (@.type() == "boolean")))')),
  recorded_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, organisation_id)
    REFERENCES party.organisation (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, application_id)
    REFERENCES grants.application (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, recorded_by)
    REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX monitoring_visit_organisation
  ON assure.monitoring_visit (tenant_id, organisation_id, visited_on DESC);
CREATE INDEX monitoring_visit_application ON assure.monitoring_visit (tenant_id, application_id);
SELECT app.enable_tenant_rls('assure.monitoring_visit');
SELECT app.deny_command('assure.monitoring_visit', 'DELETE');
CREATE TRIGGER stamp_now BEFORE INSERT ON assure.monitoring_visit
  FOR EACH ROW EXECUTE FUNCTION assure.stamp_now('created_at', 'updated_at');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON assure.monitoring_visit
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER refuse_erased_party BEFORE INSERT OR UPDATE OF organisation_id
  ON assure.monitoring_visit
  FOR EACH ROW EXECUTE FUNCTION party.refuse_erased_party('organisation_id');
CREATE TRIGGER keep_erased BEFORE UPDATE OF findings, follow_ups ON assure.monitoring_visit
  FOR EACH ROW EXECUTE FUNCTION assure.keep_erased('organisation_id',
    '{"findings": "erased", "follow_ups": []}');

CREATE TABLE assure.visit_attendee (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL,
  person_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, visit_id, person_id),
  FOREIGN KEY (tenant_id, visit_id)
    REFERENCES assure.monitoring_visit (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, person_id) REFERENCES party.person (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX visit_attendee_person ON assure.visit_attendee (tenant_id, person_id);
SELECT app.enable_tenant_rls('assure.visit_attendee');
SELECT app.deny_command('assure.visit_attendee', 'UPDATE');
CREATE TRIGGER stamp_now BEFORE INSERT ON assure.visit_attendee
  FOR EACH ROW EXECUTE FUNCTION assure.stamp_now('created_at');
CREATE TRIGGER refuse_erased_party BEFORE INSERT OR UPDATE OF person_id
  ON assure.visit_attendee
  FOR EACH ROW EXECUTE FUNCTION party.refuse_erased_party('person_id');

-- A caption changes in place, so a kept file is never released and linked
-- again.
CREATE TABLE assure.visit_evidence (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL,
  file_id uuid NOT NULL,
  caption text NOT NULL CHECK (char_length(caption) BETWEEN 1 AND 200
    AND caption !~ '[[:cntrl:]]' AND caption = btrim(caption)),
  added_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, file_id),
  FOREIGN KEY (tenant_id, visit_id)
    REFERENCES assure.monitoring_visit (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, file_id) REFERENCES app.file (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, added_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX visit_evidence_visit ON assure.visit_evidence (tenant_id, visit_id);
SELECT app.enable_tenant_rls('assure.visit_evidence');
CREATE TRIGGER stamp_now BEFORE INSERT ON assure.visit_evidence
  FOR EACH ROW EXECUTE FUNCTION assure.stamp_now('created_at');
CREATE TRIGGER link_file AFTER INSERT OR DELETE ON assure.visit_evidence
  FOR EACH ROW EXECUTE FUNCTION assure.link_file();

-- No evidence is added to a visit to an erased organisation, and its
-- evidence changes only as assure.erase_subject changes it: the caption to
-- 'erased'. Reads the visit as the caller.
CREATE FUNCTION assure.keep_erased_evidence()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  organisation uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.caption = 'erased'
     AND (NEW.visit_id, NEW.file_id) = (OLD.visit_id, OLD.file_id) THEN
    RETURN NEW;
  END IF;
  SELECT v.organisation_id INTO organisation
    FROM assure.monitoring_visit v
   WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.visit_id;
  IF party.is_erased(NEW.tenant_id, organisation) THEN
    RAISE EXCEPTION 'An erased party''s data never changes.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER keep_erased BEFORE INSERT OR UPDATE ON assure.visit_evidence
  FOR EACH ROW EXECUTE FUNCTION assure.keep_erased_evidence();

GRANT SELECT,
      INSERT (tenant_id, organisation_id, application_id, visited_on, visit_type, findings,
              follow_ups, recorded_by, updated_by),
      UPDATE (visited_on, visit_type, findings, follow_ups, updated_by)
   ON assure.monitoring_visit TO app_api;
GRANT SELECT, DELETE, INSERT (tenant_id, visit_id, person_id) ON assure.visit_attendee TO app_api;
GRANT SELECT, DELETE, INSERT (tenant_id, visit_id, file_id, caption, added_by),
      UPDATE (caption)
   ON assure.visit_evidence TO app_api;
GRANT SELECT ON assure.monitoring_visit, assure.visit_attendee, assure.visit_evidence
  TO app_worker;
