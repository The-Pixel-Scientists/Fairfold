-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0063, down: remove the crm schema, in reverse order. Dropping it
-- would lose every crm row (switching crm off, by contrast, keeps them),
-- including the append-only merge records, so this refuses, before it
-- changes anything, while any crm table holds a row. Row-level security
-- hides every tenant's rows from migrator, but validating a check reads
-- every row whatever the policies. Outside development the rollback for
-- this migration is a restore from backup (ADR 0003). Waiting parse jobs
-- are lost with their queue, so the rollback also stops while any are
-- queued. Nothing cascades: while a later migration's objects still refer
-- to these tables, this fails and changes nothing. The owner role stays:
-- the roles script, not a migration, creates and removes roles.

DO $refuse$
DECLARE
  crm_table regclass;
BEGIN
  FOR crm_table IN SELECT c.oid FROM pg_catalog.pg_class c
                    WHERE c.relnamespace = 'crm'::regnamespace AND c.relkind = 'r' LOOP
    EXECUTE pg_catalog.format('ALTER TABLE %s ADD CONSTRAINT rollback_empty CHECK (false)',
                              crm_table);
  END LOOP;
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Migration 0063 cannot be rolled back while crm holds rows: they would be lost with the schema.'
    USING HINT = 'Restore the database backup taken before the rollback, as ADR 0003 sets out.';
END
$refuse$;

DROP FUNCTION crm.erase_subject(uuid);
REVOKE SELECT (tenant_id, id, status) ON party.party FROM owner_crm_erase_subject;
REVOKE EXECUTE ON FUNCTION app.current_tenant_id() FROM owner_crm_erase_subject;
REVOKE USAGE ON SCHEMA app, party FROM owner_crm_erase_subject;
DROP TABLE crm.external_reference;

DO $check$
BEGIN
  IF EXISTS (SELECT FROM pgboss.job
             WHERE name IN ('crm.import_parse', 'crm.import_parse.dead')
               AND state IN ('created', 'retry', 'active')) THEN
    RAISE EXCEPTION 'Queue crm.import_parse holds jobs. Let the worker finish them before this rollback.';
  END IF;
END
$check$;
DELETE FROM app.job_queue WHERE name IN ('crm.import_parse', 'crm.import_parse.dead');
SELECT pgboss.delete_queue('crm.import_parse');
SELECT pgboss.delete_queue('crm.import_parse.dead');
DROP TABLE crm.import_row;
DROP FUNCTION crm.keep_import_row();
DROP TABLE crm.import_job;
DROP FUNCTION crm.link_import_file();
DROP FUNCTION crm.check_import_job();

DROP TABLE crm.merge_record;
DROP FUNCTION crm.set_merged_at();

DROP TABLE crm.interaction;
DROP FUNCTION crm.refuse_erased_value();

DROP TABLE crm.segment;
DROP FUNCTION crm.check_segment_version();

DROP TABLE crm.list_member;
DROP TABLE crm.list;
DROP FUNCTION crm.set_archived_at();
DROP SCHEMA crm;
