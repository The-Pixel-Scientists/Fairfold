-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0089, down: remove the privacy schema, its requests, clock
-- events and tasks, and the deadline reminder's queues, in reverse order.
-- Dropping them would lose their rows (switching privacy off, by contrast,
-- keeps them), so this refuses, before it changes anything, while any of
-- them holds a row. Row-level security hides every tenant's rows from
-- migrator, but validating a check reads every row whatever the policies.
-- Outside development the rollback is a restore from backup (ADR 0003).
-- Nothing cascades: while a later migration's objects still refer to these
-- tables, this fails and changes nothing.
-- Waiting jobs would be lost with their queues, so it also stops while any
-- are queued.

DO $jobs$
BEGIN
  IF EXISTS (SELECT FROM pgboss.job
             WHERE name LIKE 'privacy.%' AND state IN ('created', 'retry', 'active')) THEN
    RAISE EXCEPTION 'The privacy queues hold jobs. Let the worker finish them before this rollback.';
  END IF;
END
$jobs$;

DO $refuse$
DECLARE
  privacy_table regclass;
BEGIN
  FOREACH privacy_table IN ARRAY ARRAY['privacy.rights_request', 'privacy.request_clock_event',
      'privacy.request_task']::regclass[] LOOP
    EXECUTE pg_catalog.format('ALTER TABLE %s ADD CONSTRAINT rollback_empty CHECK (false)',
                              privacy_table);
  END LOOP;
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Migration 0089 cannot be rolled back while rights requests hold rows: they would be lost.'
    USING HINT = 'Restore the database backup taken before the rollback, as ADR 0003 sets out.';
END
$refuse$;

DELETE FROM app.job_queue
 WHERE name IN ('privacy.deadline_reminder', 'privacy.deadline_reminder.dead');
SELECT pgboss.delete_queue('privacy.deadline_reminder');
SELECT pgboss.delete_queue('privacy.deadline_reminder.dead');

DROP TABLE privacy.request_task;
DROP FUNCTION privacy.stamp_completion();
DROP TABLE privacy.request_clock_event;
DROP FUNCTION privacy.check_clock_event();
DROP TABLE privacy.rights_request;
DROP FUNCTION privacy.refuse_erased_text();
DROP SCHEMA privacy;
