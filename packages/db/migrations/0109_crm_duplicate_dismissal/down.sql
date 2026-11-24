-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0109, down: remove crm duplicate dismissals. Dropping the table
-- would lose staff's dismissals, so this refuses, before it changes
-- anything, while it holds a row, even one row-level security hides from
-- migrator: validating a check reads every row. Outside development the
-- rollback for this migration is a restore from backup (ADR 0003).

DO $refuse$
BEGIN
  ALTER TABLE crm.duplicate_dismissal ADD CONSTRAINT rollback_empty CHECK (false);
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Migration 0109 cannot be rolled back while crm.duplicate_dismissal holds rows: they would be lost with the table.'
    USING HINT = 'Restore the database backup taken before the rollback, as ADR 0003 sets out.';
END
$refuse$;

DROP TABLE crm.duplicate_dismissal;
