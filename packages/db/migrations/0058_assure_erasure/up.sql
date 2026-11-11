-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0058, up: assure.erase_subject, the approved erasure of a
-- subject's assure data (S12-14, ADR 0027), owned by its own owner role
-- (ADR 0023) and callable by app_worker alone.

-- The approved erasure of a subject's assure data (ADR 0027), run by the
-- erasure job after party.erase_party, in the tenant set in the transaction.
-- It refuses unless the party is already erased there. It replaces names
-- and free text with 'erased' (or clears them where the column allows),
-- and keeps ids, codes, similarities, outcomes and decisions:
-- - officer rows linked to the person: the name;
-- - matches whose subject is the party: the screened name;
-- - snapshots of the organisation: its registered address;
-- - answers to the person's applications' checklists: each short text;
-- - visits to the organisation: findings and follow-ups, and every caption;
-- - the person's attendee rows, which hold nothing but the link, are
--   removed; no row anything refers to is.
-- Unlinked officer rows are never matched by name, so a namesake is never
-- touched (ADR 0031). A repeat call changes nothing further. It writes no
-- audit event: the erasure's own event covers it, as app.erase_subject_notes.
CREATE FUNCTION assure.erase_subject(party_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  erase_tenant CONSTANT uuid := app.current_tenant_id();
  officers integer;
  matches integer;
  snapshots integer;
  responses integer;
  visits integer;
  evidence integer;
  attendees integer;
BEGIN
  IF erase_tenant IS NULL THEN
    RAISE EXCEPTION 'Erasure needs a tenant.' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  PERFORM FROM party.party p
   WHERE p.tenant_id = erase_tenant AND p.id = erase_subject.party_id AND p.status = 'erased';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A party''s assure data is erased only once the party is erased in this tenant.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  UPDATE assure.lookup_officer o SET name = 'erased'
   WHERE o.tenant_id = erase_tenant AND o.person_id = erase_subject.party_id
     AND o.name <> 'erased';
  GET DIAGNOSTICS officers = ROW_COUNT;

  UPDATE assure.screening_match m SET screened_name = 'erased'
   WHERE m.tenant_id = erase_tenant AND m.subject_party_id = erase_subject.party_id
     AND m.screened_name <> 'erased';
  GET DIAGNOSTICS matches = ROW_COUNT;

  UPDATE assure.lookup_snapshot s
     SET address_line1 = NULL, address_line2 = NULL, address_town = NULL,
         address_postcode = NULL, address_country_code = NULL
   WHERE s.tenant_id = erase_tenant AND s.organisation_id = erase_subject.party_id
     AND s.address_line1 IS NOT NULL;
  GET DIAGNOSTICS snapshots = ROW_COUNT;

  UPDATE assure.checklist_response r
     SET answers = (SELECT pg_catalog.jsonb_object_agg(e.key, CASE
                      WHEN e.value ->> 'kind' = 'short_text'
                        THEN pg_catalog.jsonb_build_object('kind', 'short_text', 'value', 'erased')
                      ELSE e.value END)
                      FROM pg_catalog.jsonb_each(r.answers) AS e)
    FROM grants.application a
   WHERE r.tenant_id = erase_tenant AND a.tenant_id = r.tenant_id AND a.id = r.application_id
     AND a.applicant_person_id = erase_subject.party_id
     AND pg_catalog.jsonb_path_exists(r.answers,
           '$.* ? (@.kind == "short_text" && @.value != "erased")');
  GET DIAGNOSTICS responses = ROW_COUNT;

  UPDATE assure.monitoring_visit v SET findings = 'erased', follow_ups = '[]'
   WHERE v.tenant_id = erase_tenant AND v.organisation_id = erase_subject.party_id
     AND (v.findings <> 'erased' OR v.follow_ups <> '[]');
  GET DIAGNOSTICS visits = ROW_COUNT;

  UPDATE assure.visit_evidence e SET caption = 'erased'
    FROM assure.monitoring_visit v
   WHERE e.tenant_id = erase_tenant AND v.tenant_id = e.tenant_id AND v.id = e.visit_id
     AND v.organisation_id = erase_subject.party_id AND e.caption <> 'erased';
  GET DIAGNOSTICS evidence = ROW_COUNT;

  DELETE FROM assure.visit_attendee t
   WHERE t.tenant_id = erase_tenant AND t.person_id = erase_subject.party_id;
  GET DIAGNOSTICS attendees = ROW_COUNT;

  RETURN pg_catalog.jsonb_build_object(
    'assure.lookup_officer', officers, 'assure.screening_match', matches,
    'assure.lookup_snapshot', snapshots, 'assure.checklist_response', responses,
    'assure.monitoring_visit', visits, 'assure.visit_evidence', evidence,
    'assure.visit_attendee', attendees);
END
$function$;

GRANT USAGE ON SCHEMA app, assure, grants, party TO owner_assure_erase_subject;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO owner_assure_erase_subject;
GRANT SELECT (tenant_id, id, status) ON party.party TO owner_assure_erase_subject;
GRANT SELECT (tenant_id, id, applicant_person_id) ON grants.application
  TO owner_assure_erase_subject;
GRANT SELECT (tenant_id, person_id, name), UPDATE (name) ON assure.lookup_officer
  TO owner_assure_erase_subject;
GRANT SELECT (tenant_id, subject_party_id, screened_name), UPDATE (screened_name)
   ON assure.screening_match TO owner_assure_erase_subject;
GRANT SELECT (tenant_id, organisation_id, address_line1),
      UPDATE (address_line1, address_line2, address_town, address_postcode, address_country_code)
   ON assure.lookup_snapshot TO owner_assure_erase_subject;
GRANT SELECT (tenant_id, application_id, answers), UPDATE (answers)
   ON assure.checklist_response TO owner_assure_erase_subject;
GRANT SELECT (tenant_id, id, organisation_id, findings, follow_ups),
      UPDATE (findings, follow_ups)
   ON assure.monitoring_visit TO owner_assure_erase_subject;
GRANT SELECT (tenant_id, visit_id, caption), UPDATE (caption)
   ON assure.visit_evidence TO owner_assure_erase_subject;
GRANT SELECT (tenant_id, person_id), DELETE ON assure.visit_attendee TO owner_assure_erase_subject;

REVOKE ALL ON FUNCTION assure.erase_subject(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assure.erase_subject(uuid) TO app_worker;
GRANT CREATE ON SCHEMA assure TO owner_assure_erase_subject;
ALTER FUNCTION assure.erase_subject(uuid) OWNER TO owner_assure_erase_subject;
REVOKE CREATE ON SCHEMA assure FROM owner_assure_erase_subject;
