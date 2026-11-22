-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0072, down: drop the current-consent view and party.suppression,
-- and narrow party.consent back to migration 0005's sources with a member
-- on every row.
--
-- Suppressions record people's objections, and an unsubscribe consent row
-- has no member, so this refuses, before it changes anything, while any
-- suppression or unsubscribe exists. Row-level security hides every
-- tenant's rows from migrator, but validating a check reads every row
-- whatever the policies. Outside development the rollback for this
-- migration is a restore from backup (ADR 0003).
DO $refuse$
BEGIN
  ALTER TABLE party.suppression ADD CONSTRAINT rollback_empty CHECK (false);
  ALTER TABLE party.consent
    DROP CONSTRAINT consent_recorded_by,
    DROP CONSTRAINT consent_source_check,
    ADD CONSTRAINT consent_source_check CHECK (source IN ('portal', 'staff')),
    ALTER COLUMN recorded_by SET NOT NULL;
EXCEPTION WHEN check_violation OR not_null_violation THEN
  RAISE EXCEPTION 'Migration 0072 cannot be rolled back while a suppression or unsubscribe is recorded: people''s objections would be lost.'
    USING HINT = 'Restore the database backup taken before the rollback, as ADR 0003 sets out.';
END
$refuse$;

DROP POLICY app_source ON party.consent;
-- Dropping them removes every right and policy on them.
DROP VIEW party.current_consent;
DROP TABLE party.suppression;
