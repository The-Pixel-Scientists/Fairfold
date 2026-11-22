-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0090, down: remove the breach log and its assessments.
-- Dropping them would lose their rows (switching privacy off, by contrast,
-- keeps them), so this refuses, before it changes anything, while any of
-- them holds a row. Row-level security hides every tenant's rows from
-- migrator, but validating a check reads every row whatever the policies.
-- Outside development the rollback is a restore from backup (ADR 0003).
-- Nothing cascades: while a later migration's objects still refer to these
-- tables, this fails and changes nothing.

DO $refuse$
DECLARE
  privacy_table regclass;
BEGIN
  FOREACH privacy_table IN ARRAY ARRAY['privacy.breach', 'privacy.breach_assessment']::regclass[] LOOP
    EXECUTE pg_catalog.format('ALTER TABLE %s ADD CONSTRAINT rollback_empty CHECK (false)',
                              privacy_table);
  END LOOP;
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Migration 0090 cannot be rolled back while breaches hold rows: they would be lost.'
    USING HINT = 'Restore the database backup taken before the rollback, as ADR 0003 sets out.';
END
$refuse$;

DROP TABLE privacy.breach_assessment;
DROP TABLE privacy.breach;
DROP FUNCTION privacy.stamp_breach_notices();
