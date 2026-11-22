-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0098, down: remove the relay's queues, then the cursors with
-- their trigger, function, policies and grants, and app_operator's read of
-- the outbox. Waiting jobs would be lost with their queues, so the rollback
-- stops while any are queued; stop the worker first. Cursors cannot come
-- back, so outside development the rollback for this migration is a restore
-- from backup; a consumer without a cursor would start again from the
-- oldest event kept. Nothing cascades.

DO $check$
BEGIN
  IF EXISTS (SELECT FROM pgboss.job
             WHERE name IN ('platform.outbox_relay', 'platform.outbox_relay.dead',
                            'platform.outbox_tenant', 'platform.outbox_tenant.dead',
                            'outbox.probe', 'outbox.probe.dead')
               AND state IN ('created', 'retry', 'active')) THEN
    RAISE EXCEPTION 'The outbox relay queues hold jobs. Let the worker finish them before this rollback.';
  END IF;
END
$check$;

DELETE FROM app.job_queue
 WHERE name IN ('platform.outbox_relay', 'platform.outbox_relay.dead',
                'platform.outbox_tenant', 'platform.outbox_tenant.dead',
                'outbox.probe', 'outbox.probe.dead');
SELECT pgboss.delete_queue('outbox.probe');
SELECT pgboss.delete_queue('outbox.probe.dead');
SELECT pgboss.delete_queue('platform.outbox_tenant');
SELECT pgboss.delete_queue('platform.outbox_tenant.dead');
SELECT pgboss.delete_queue('platform.outbox_relay');
SELECT pgboss.delete_queue('platform.outbox_relay.dead');

REVOKE SELECT (sequence, retain_until) ON app.event_outbox FROM app_operator;
DROP TABLE app.event_cursor;
DROP FUNCTION app.keep_event_cursor();
