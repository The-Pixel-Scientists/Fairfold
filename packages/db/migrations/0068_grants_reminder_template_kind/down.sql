-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0068, down: the reminder keys name a template by tenant and id
-- alone again, and a template's outcome is a decision outcome again. No row
-- is lost: reminder templates stay, and while any exists the outcome check
-- holds for new rows only (NOT VALID). Validating a check reads every row
-- whatever the policies. Nothing cascades.

ALTER TABLE grants.reminder_email
  DROP CONSTRAINT reminder_email_template,
  ADD FOREIGN KEY (tenant_id, template_version_id)
    REFERENCES grants.email_template_version (tenant_id, id) ON DELETE RESTRICT;

ALTER TABLE grants.reminder_setting
  DROP CONSTRAINT reminder_setting_review_template,
  DROP CONSTRAINT reminder_setting_draft_template,
  ADD FOREIGN KEY (tenant_id, draft_template_version_id)
    REFERENCES grants.email_template_version (tenant_id, id) ON DELETE RESTRICT,
  ADD FOREIGN KEY (tenant_id, review_template_version_id)
    REFERENCES grants.email_template_version (tenant_id, id) ON DELETE RESTRICT;

ALTER TABLE grants.reminder_setting
  DROP COLUMN review_template_kind,
  DROP COLUMN draft_template_kind;

ALTER TABLE grants.email_template_version
  DROP CONSTRAINT email_template_version_outcome_key,
  DROP CONSTRAINT email_template_version_outcome_check,
  ADD CONSTRAINT email_template_version_outcome_check
    CHECK (outcome IN ('accepted', 'waitlisted', 'declined')) NOT VALID;

DO $validate$
BEGIN
  ALTER TABLE grants.email_template_version VALIDATE CONSTRAINT email_template_version_outcome_check;
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'Reminder templates remain, so the outcome check holds for new rows only.';
END
$validate$;
