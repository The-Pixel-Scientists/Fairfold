-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0110, down: remove assure duplicate flags. Dropping the table
-- would lose staff's dismissals, so this refuses, before it changes
-- anything, while it holds a row, even one row-level security hides from
-- migrator: validating a check reads every row. Outside development the
-- rollback for this migration is a restore from backup (ADR 0003).

DO $refuse$
BEGIN
  ALTER TABLE assure.duplicate_flag ADD CONSTRAINT rollback_empty CHECK (false);
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Migration 0110 cannot be rolled back while assure.duplicate_flag holds rows: they would be lost with the table.'
    USING HINT = 'Restore the database backup taken before the rollback, as ADR 0003 sets out.';
END
$refuse$;

DROP TABLE assure.duplicate_flag;
DROP FUNCTION assure.check_duplicate_flag();
