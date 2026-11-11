-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0058, down: remove assure.erase_subject and every right its
-- owner was given. The owner role stays: the roles script, not a
-- migration, creates and removes roles.

DROP FUNCTION assure.erase_subject(uuid);
REVOKE SELECT (tenant_id, person_id), DELETE ON assure.visit_attendee
  FROM owner_assure_erase_subject;
REVOKE SELECT (tenant_id, visit_id, caption), UPDATE (caption) ON assure.visit_evidence
  FROM owner_assure_erase_subject;
REVOKE SELECT (tenant_id, id, organisation_id, findings, follow_ups),
       UPDATE (findings, follow_ups)
    ON assure.monitoring_visit FROM owner_assure_erase_subject;
REVOKE SELECT (tenant_id, application_id, answers), UPDATE (answers)
    ON assure.checklist_response FROM owner_assure_erase_subject;
REVOKE SELECT (tenant_id, organisation_id, address_line1),
       UPDATE (address_line1, address_line2, address_town, address_postcode, address_country_code)
    ON assure.lookup_snapshot FROM owner_assure_erase_subject;
REVOKE SELECT (tenant_id, subject_party_id, screened_name), UPDATE (screened_name)
    ON assure.screening_match FROM owner_assure_erase_subject;
REVOKE SELECT (tenant_id, person_id, name), UPDATE (name) ON assure.lookup_officer
  FROM owner_assure_erase_subject;
REVOKE SELECT (tenant_id, id, applicant_person_id) ON grants.application
  FROM owner_assure_erase_subject;
REVOKE SELECT (tenant_id, id, status) ON party.party FROM owner_assure_erase_subject;
REVOKE EXECUTE ON FUNCTION app.current_tenant_id() FROM owner_assure_erase_subject;
REVOKE USAGE ON SCHEMA app, assure, grants, party FROM owner_assure_erase_subject;
