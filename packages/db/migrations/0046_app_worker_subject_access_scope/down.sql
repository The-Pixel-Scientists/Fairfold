-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0046, down: give back the reads 0044 granted app_worker and take
-- away its reads of a person's relationships.

REVOKE SELECT (tenant_id, id, created_at, created_by, updated_at, updated_by, type, subject_id,
              subject_kind, object_id, object_kind, starts_on, ends_on)
   ON party.relationship FROM app_worker;

GRANT SELECT (reviewer_membership_id, updated_by) ON grants.assignment TO app_worker;
GRANT SELECT (tenant_id, id, created_at, created_by, updated_at, updated_by, assignment_id,
              stage_id, criterion_id, score, comment)
   ON grants.score TO app_worker;
