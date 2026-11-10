-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0044, up: what the subject access export job (S11-85, ADR 0027)
-- reads as app_worker. It collects, in one tenant's transaction, every
-- classified column of the person's rows in the party and grants tables and
-- of the platform rows made through their memberships, and each pinned form
-- definition. Every grant is SELECT on the named columns only: row-level
-- security keeps the reads to the tenant, and the worker gains no write. An
-- invitation's token digest stays unreadable. Columns that 0029 and 0041
-- already grant are not repeated, so the down migration leaves them.

GRANT SELECT (tenant_id, id, kind, status, merged_into, erased_at,
              created_at, created_by, updated_at, updated_by)
   ON party.party TO app_worker;
GRANT SELECT (kind, family_name, phone, user_id, created_at, created_by, updated_at, updated_by)
   ON party.person TO app_worker;
GRANT SELECT (tenant_id, id, person_id, purpose, channel, state, privacy_notice_version, source,
              recorded_at, recorded_by)
   ON party.consent TO app_worker;
GRANT SELECT (tenant_id, id, party_id, party_kind, field_id, old_value, new_value,
              changed_by, changed_at)
   ON party.value_history TO app_worker;

GRANT SELECT (tenant_id, id, created_at, created_by, updated_at, updated_by, round_id,
              form_version_id, applicant_person_id, organisation_id, status, answers,
              answers_version, stage_id, submitted_at, submitted_late, withdrawn_at,
              organisation_snapshot_id)
   ON grants.application TO app_worker;
GRANT SELECT (tenant_id, id, definition) ON grants.form_version TO app_worker;
GRANT SELECT (tenant_id, id, application_id, form_version_id, outcome, stopping_field_id,
              checked_at, checked_by)
   ON grants.eligibility_result TO app_worker;
GRANT SELECT (tenant_id, id, round_id, application_id, from_stage_id, to_stage_id,
              moved_at, moved_by)
   ON grants.stage_transition TO app_worker;
GRANT SELECT (tenant_id, id, application_id, file_id, field_id, created_by, created_at)
   ON grants.application_file TO app_worker;
GRANT SELECT (tenant_id, id, created_at, created_by, updated_at, updated_by, round_id,
              application_id, reviewer_membership_id, stage_id, status, submitted_at)
   ON grants.assignment TO app_worker;
GRANT SELECT (tenant_id, id, created_at, created_by, updated_at, updated_by, assignment_id,
              stage_id, criterion_id, score, comment)
   ON grants.score TO app_worker;

GRANT SELECT (tenant_id, id, user_id, roles, status, created_at, created_by, updated_at,
              updated_by)
   ON app.membership TO app_worker;
GRANT SELECT (name, created_by, created_at, updated_by, updated_at) ON app.file TO app_worker;
GRANT SELECT (tenant_id, id, email, roles, expires_at, status, accepted_membership_id,
              created_at, created_by, updated_at, updated_by)
   ON app.invitation TO app_worker;
