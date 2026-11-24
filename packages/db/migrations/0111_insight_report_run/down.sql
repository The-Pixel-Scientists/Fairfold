-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0111, down: remove insight.report_run. Dropping it would lose
-- the run log that later runs are checked against (ADR 0032 rule 7), so
-- this refuses, before it changes anything, while it holds a row, even one
-- row-level security hides from migrator: validating a check reads every
-- row. Outside development the rollback for this migration is a restore
-- from backup (ADR 0003).

DO $refuse$
BEGIN
  ALTER TABLE insight.report_run ADD CONSTRAINT rollback_empty CHECK (false);
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Migration 0111 cannot be rolled back while insight.report_run holds rows: the run log would be lost.'
    USING HINT = 'Restore the database backup taken before the rollback, as ADR 0003 sets out.';
END
$refuse$;

DROP TABLE insight.report_run;
DROP FUNCTION insight.check_report_run();
ALTER TABLE insight.report_definition DROP CONSTRAINT report_definition_kind_key;
