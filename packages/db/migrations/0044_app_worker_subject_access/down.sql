-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0044, down: take back the subject access export's reads. The
-- columns that 0029 and 0041 grant app_worker stay.

REVOKE SELECT (tenant_id, id, kind, status, merged_into, erased_at,
              created_at, created_by, updated_at, updated_by)
   ON party.party FROM app_worker;
REVOKE SELECT (kind, family_name, phone, user_id, created_at, created_by, updated_at, updated_by)
   ON party.person FROM app_worker;
REVOKE SELECT (tenant_id, id, person_id, purpose, channel, state, privacy_notice_version, source,
              recorded_at, recorded_by)
   ON party.consent FROM app_worker;
REVOKE SELECT (tenant_id, id, party_id, party_kind, field_id, old_value, new_value,
              changed_by, changed_at)
   ON party.value_history FROM app_worker;

REVOKE SELECT (tenant_id, id, created_at, created_by, updated_at, updated_by, round_id,
              form_version_id, applicant_person_id, organisation_id, status, answers,
              answers_version, stage_id, submitted_at, submitted_late, withdrawn_at,
              organisation_snapshot_id)
   ON grants.application FROM app_worker;
REVOKE SELECT (tenant_id, id, definition) ON grants.form_version FROM app_worker;
REVOKE SELECT (tenant_id, id, application_id, form_version_id, outcome, stopping_field_id,
              checked_at, checked_by)
   ON grants.eligibility_result FROM app_worker;
REVOKE SELECT (tenant_id, id, round_id, application_id, from_stage_id, to_stage_id,
              moved_at, moved_by)
   ON grants.stage_transition FROM app_worker;
REVOKE SELECT (tenant_id, id, application_id, file_id, field_id, created_by, created_at)
   ON grants.application_file FROM app_worker;
REVOKE SELECT (tenant_id, id, created_at, created_by, updated_at, updated_by, round_id,
              application_id, reviewer_membership_id, stage_id, status, submitted_at)
   ON grants.assignment FROM app_worker;
REVOKE SELECT (tenant_id, id, created_at, created_by, updated_at, updated_by, assignment_id,
              stage_id, criterion_id, score, comment)
   ON grants.score FROM app_worker;

REVOKE SELECT (tenant_id, id, user_id, roles, status, created_at, created_by, updated_at,
              updated_by)
   ON app.membership FROM app_worker;
REVOKE SELECT (name, created_by, created_at, updated_by, updated_at) ON app.file FROM app_worker;
REVOKE SELECT (tenant_id, id, email, roles, expires_at, status, accepted_membership_id,
              created_at, created_by, updated_at, updated_by)
   ON app.invitation FROM app_worker;
