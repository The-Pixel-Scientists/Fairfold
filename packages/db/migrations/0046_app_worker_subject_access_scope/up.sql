-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0046, up: narrow what the subject access export reads as
-- app_worker (S11-85a, rule 8). Scores and reviewer ids stay out of an export
-- until a check before release exists, so the worker gives up the reads 0044
-- granted for them, including grants.assignment.updated_by, which holds the
-- reviewer's id once they submit or declare a conflict. No other worker job
-- reads these columns. The export gains a person's relationships, read in
-- both directions.
--
-- This closes the table reads only. app_worker keeps SELECT on
-- app.audit_event, whose changes can hold a reviewer's id or an unreleased
-- outcome, so the export has to drop those keys itself (S11-85b). The export
-- reads these columns until S11-85b lands, so S11-85b must ship first or with
-- this migration.

REVOKE SELECT (tenant_id, id, created_at, created_by, updated_at, updated_by, assignment_id,
              stage_id, criterion_id, score, comment)
   ON grants.score FROM app_worker;
REVOKE SELECT (reviewer_membership_id, updated_by) ON grants.assignment FROM app_worker;

GRANT SELECT (tenant_id, id, created_at, created_by, updated_at, updated_by, type, subject_id,
              subject_kind, object_id, object_kind, starts_on, ends_on)
   ON party.relationship TO app_worker;
