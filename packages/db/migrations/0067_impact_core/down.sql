-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0067, down: remove the impact schema, in reverse order.
-- Dropping it would lose every impact row (switching impact off, by
-- contrast, keeps them), so this refuses, before it changes anything, while
-- any impact table holds a row. Row-level security hides every tenant's
-- rows from migrator, but validating a check reads every row whatever the
-- policies. Outside development the rollback for this migration is a
-- restore from backup (ADR 0003). Nothing cascades: while a later
-- migration's objects still refer to these tables, this fails and changes
-- nothing.

DO $refuse$
DECLARE
  impact_table regclass;
BEGIN
  FOR impact_table IN SELECT c.oid FROM pg_catalog.pg_class c
                       WHERE c.relnamespace = 'impact'::regnamespace AND c.relkind = 'r' LOOP
    EXECUTE pg_catalog.format('ALTER TABLE %s ADD CONSTRAINT rollback_empty CHECK (false)',
                              impact_table);
  END LOOP;
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Migration 0067 cannot be rolled back while impact holds rows: they would be lost with the schema.'
    USING HINT = 'Restore the database backup taken before the rollback, as ADR 0003 sets out.';
END
$refuse$;

DROP TABLE impact.learning_note;
DROP TABLE impact.result_evidence;
DROP FUNCTION impact.link_file();
DROP TRIGGER keep_unit ON impact.indicator;
DROP FUNCTION impact.keep_unit();
DROP TABLE impact.result;
DROP TABLE impact.target;
DROP FUNCTION impact.check_figures();
DROP TABLE impact.indicator;
DROP TABLE impact.outcome;
DROP FUNCTION impact.refuse_archived();
DROP TABLE impact.framework;
DROP FUNCTION impact.check_framework_version();
DROP FUNCTION impact.set_archived_at();
DROP SCHEMA impact;
