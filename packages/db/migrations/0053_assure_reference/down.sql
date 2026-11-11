-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0053, down: remove the assure schema, its queues and
-- its reference tables, in reverse order.
-- Rows cannot come back, so outside development the rollback for this
-- migration is a restore from backup. Nothing cascades: while a later
-- migration's objects still refer to these tables, this fails and
-- changes nothing. Waiting jobs would be lost with
-- their queues, so it stops while any are queued.

DO $check$
BEGIN
  IF EXISTS (SELECT FROM pgboss.job
             WHERE name LIKE 'assure.%' AND state IN ('created', 'retry', 'active')) THEN
    RAISE EXCEPTION 'The assure queues hold jobs. Let the worker finish them before this rollback.';
  END IF;
END
$check$;

DELETE FROM app.job_queue WHERE name IN (
  'assure.registry_refresh', 'assure.registry_refresh.dead',
  'assure.screening', 'assure.screening.dead',
  'assure.sanctions_list_refresh', 'assure.sanctions_list_refresh.dead');
SELECT pgboss.delete_queue('assure.registry_refresh');
SELECT pgboss.delete_queue('assure.registry_refresh.dead');
SELECT pgboss.delete_queue('assure.screening');
SELECT pgboss.delete_queue('assure.screening.dead');
SELECT pgboss.delete_queue('assure.sanctions_list_refresh');
SELECT pgboss.delete_queue('assure.sanctions_list_refresh.dead');

DROP TABLE assure.sanctions_entry;
DROP TABLE assure.reference_list;
DROP FUNCTION assure.keep_erased();
DROP FUNCTION assure.stamp_now();
DROP SCHEMA assure;
