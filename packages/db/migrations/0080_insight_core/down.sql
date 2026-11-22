-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0080, down: remove the insight schema, in reverse order.
-- Dropping it would lose every insight row (switching insight off, by
-- contrast, keeps them), so this refuses, before it changes anything, while
-- any insight table holds a row. Row-level security hides every tenant's
-- rows from migrator, but validating a check reads every row whatever the
-- policies. Outside development the rollback for this migration is a
-- restore from backup (ADR 0003). Nothing cascades: while a later
-- migration's objects still refer to these tables, this fails and changes
-- nothing.

DO $refuse$
DECLARE
  insight_table regclass;
BEGIN
  FOR insight_table IN SELECT c.oid FROM pg_catalog.pg_class c
                        WHERE c.relnamespace = 'insight'::regnamespace AND c.relkind = 'r' LOOP
    EXECUTE pg_catalog.format('ALTER TABLE %s ADD CONSTRAINT rollback_empty CHECK (false)',
                              insight_table);
  END LOOP;
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Migration 0080 cannot be rolled back while insight holds rows: they would be lost with the schema.'
    USING HINT = 'Restore the database backup taken before the rollback, as ADR 0003 sets out.';
END
$refuse$;

DROP TABLE insight.publication_run;
DROP FUNCTION insight.check_run_state();
DROP TABLE insight.disclosure_rule;
DROP FUNCTION insight.check_rule_version();
DROP TABLE insight.report_definition;
DROP FUNCTION insight.check_definition_version();
DROP SCHEMA insight;
