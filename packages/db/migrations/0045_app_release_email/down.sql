-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0045, down: take back the release email job's reads and return
-- the queues to the standard policy. Waiting release email jobs are lost
-- with the queue, so the rollback stops while any are queued; the rows they
-- were for stay pending, and resend queues them again.

DO $check$
BEGIN
  IF EXISTS (SELECT FROM pgboss.job
             WHERE name IN ('grants.release_email', 'grants.release_email.dead')
               AND state IN ('created', 'retry', 'active')) THEN
    RAISE EXCEPTION 'Queue grants.release_email holds jobs. Let the worker finish them before this rollback.';
  END IF;
END
$check$;

DELETE FROM app.job_queue WHERE name IN ('grants.release_email', 'grants.release_email.dead');
SELECT pgboss.delete_queue('grants.release_email');
SELECT pgboss.delete_queue('grants.release_email.dead');
SELECT pgboss.create_queue('grants.release_email.dead', '{"policy": "standard"}');
SELECT pgboss.create_queue('grants.release_email',
  '{"policy": "standard", "deadLetter": "grants.release_email.dead"}');
INSERT INTO app.job_queue (name, kind)
  VALUES ('grants.release_email.dead', 'tenant'), ('grants.release_email', 'tenant');

REVOKE SELECT (tenant_id, id, name) ON party.organisation FROM app_worker;
REVOKE SELECT (tenant_id, id, title) ON grants.programme FROM app_worker;
REVOKE SELECT (tenant_id, id, programme_id, title) ON grants.round FROM app_worker;
REVOKE SELECT (tenant_id, id, module, enabled) ON app.tenant_module FROM app_worker;
