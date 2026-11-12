-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0061, down: remove the reminder queues and the app roles' reads,
-- then the outbox with its triggers and functions. Rows cannot come back, so
-- outside development the rollback for this migration is a restore from
-- backup. Waiting jobs are lost with their queues, so the rollback stops while
-- any are queued; stop the worker first, so the fan-out sends no more.
-- Nothing cascades.

DO $check$
BEGIN
  IF EXISTS (SELECT FROM pgboss.job
             WHERE name IN ('grants.reminder_scan', 'grants.reminder_scan.dead',
                            'grants.reminder_send', 'grants.reminder_send.dead')
               AND state IN ('created', 'retry', 'active')) THEN
    RAISE EXCEPTION 'The reminder queues hold jobs. Let the worker finish them before this rollback.';
  END IF;
END
$check$;

DELETE FROM app.job_queue
 WHERE name IN ('grants.reminder_scan', 'grants.reminder_scan.dead',
                'grants.reminder_send', 'grants.reminder_send.dead');
SELECT pgboss.delete_queue('grants.reminder_send');
SELECT pgboss.delete_queue('grants.reminder_send.dead');
SELECT pgboss.delete_queue('grants.reminder_scan');
SELECT pgboss.delete_queue('grants.reminder_scan.dead');

REVOKE SELECT ON grants.reminder_email FROM app_api;
REVOKE SELECT (reviewer_membership_id) ON grants.assignment FROM app_worker;
REVOKE SELECT (tenant_id, id, round_id, organisation_id, application_id, kind, closes_at,
               revoked_at)
    ON grants.adjustment FROM app_worker;
REVOKE SELECT (closes_at) ON grants.round FROM app_worker;

DROP TABLE grants.reminder_email;
DROP FUNCTION grants.record_reminder_attempt();
DROP FUNCTION grants.keep_reminder_email();
