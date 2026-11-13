-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0068, up: a reminder sends only a reminder template (B10-01,
-- rule 8). A template version's outcome becomes the email it is for: a
-- decision outcome, as before, or a reminder kind (values copy
-- modules/grants/src/contracts/reminders). Each reminder key also names the
-- kind its template must have, so the database refuses a reminder that
-- points at an accepted, waitlisted or declined template, and the worker
-- can never send decision wording before release.
--
-- No reminder template could exist before this, so a reminder row that
-- points at a decision template fails the new keys and this migration
-- changes nothing. Only a development database holds such rows; reset it.
-- Foreign key checks read every row whatever the policies.

ALTER TABLE grants.email_template_version
  DROP CONSTRAINT email_template_version_outcome_check,
  ADD CONSTRAINT email_template_version_outcome_check CHECK (outcome IN (
    'accepted', 'waitlisted', 'declined', 'draft_closing', 'review_overdue')),
  ADD CONSTRAINT email_template_version_outcome_key UNIQUE (tenant_id, id, outcome);

-- The kind each of a setting's templates must have, which no role writes.
ALTER TABLE grants.reminder_setting
  ADD COLUMN draft_template_kind text NOT NULL GENERATED ALWAYS AS ('draft_closing') STORED,
  ADD COLUMN review_template_kind text NOT NULL GENERATED ALWAYS AS ('review_overdue') STORED;

ALTER TABLE grants.reminder_setting
  DROP CONSTRAINT reminder_setting_tenant_id_draft_template_version_id_fkey,
  DROP CONSTRAINT reminder_setting_tenant_id_review_template_version_id_fkey,
  ADD CONSTRAINT reminder_setting_draft_template
    FOREIGN KEY (tenant_id, draft_template_version_id, draft_template_kind)
    REFERENCES grants.email_template_version (tenant_id, id, outcome) ON DELETE RESTRICT,
  ADD CONSTRAINT reminder_setting_review_template
    FOREIGN KEY (tenant_id, review_template_version_id, review_template_kind)
    REFERENCES grants.email_template_version (tenant_id, id, outcome) ON DELETE RESTRICT;

-- An outbox row's template is one for the row's own kind.
ALTER TABLE grants.reminder_email
  DROP CONSTRAINT reminder_email_tenant_id_template_version_id_fkey,
  ADD CONSTRAINT reminder_email_template
    FOREIGN KEY (tenant_id, template_version_id, kind)
    REFERENCES grants.email_template_version (tenant_id, id, outcome) ON DELETE RESTRICT;
