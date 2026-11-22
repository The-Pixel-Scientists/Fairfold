-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0102, down: remove the signature queues and requests. Rows
-- cannot come back, so outside development the rollback for this migration
-- is a restore from backup. Waiting jobs are lost with their queues, so the
-- rollback stops while any are queued. Nothing cascades: while a later
-- migration's objects still refer to the table, this fails and changes
-- nothing.

DO $check$
BEGIN
  IF EXISTS (SELECT FROM pgboss.job
             WHERE name IN ('platform.signature_send', 'platform.signature_send.dead',
                            'platform.signature_refresh', 'platform.signature_refresh.dead')
               AND state IN ('created', 'retry', 'active')) THEN
    RAISE EXCEPTION 'A signature queue holds jobs. Let the worker finish them before this rollback.';
  END IF;
END
$check$;

DELETE FROM app.job_queue
 WHERE name IN ('platform.signature_send', 'platform.signature_send.dead',
                'platform.signature_refresh', 'platform.signature_refresh.dead');
SELECT pgboss.delete_queue('platform.signature_send');
SELECT pgboss.delete_queue('platform.signature_send.dead');
SELECT pgboss.delete_queue('platform.signature_refresh');
SELECT pgboss.delete_queue('platform.signature_refresh.dead');

DROP TABLE app.signature_request;
DROP FUNCTION app.keep_signature_request();
