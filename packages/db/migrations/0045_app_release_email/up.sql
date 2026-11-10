-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0045, up: what the release email job needs to run as app_worker,
-- and one waiting job per outbox row (ADR 0009, ADR 0020, ADR 0024; S11-92).
--
-- The job reads, in its own tenant's transaction: whether grants is on, and
-- for the email's decision the application's round and organisation, the
-- round and programme titles and the organisation's name. 0029 gave it the
-- decision, template, audit and outbox rows and four party.person columns,
-- and 0044 the application's columns. Only the columns the job reads (and tenant_id and id) are granted, and
-- only SELECT.
--
-- app.tenant_module: 0040 took the switch rights from app_worker and gave
-- them to app_operator, so that a job could never change a module switch.
-- That stands: app_worker still cannot insert or update a switch. ADR 0024
-- says a handler skips a module that is switched off, so the job may read
-- the columns that say which module is on, with the tenant and row id every
-- tenant policy and the cross-tenant tests read. It reads no author column.
--
-- grants.release_email was created with the standard policy, which keeps no
-- singleton key, so a resend queued a second job for a row whose job was
-- still waiting. The exclusive policy allows one created, retrying or active
-- job per key, and sendJob() answers null for the repeat. pg-boss refuses to
-- change a queue's policy once it exists, so the queue and its dead-letter
-- queue are recreated. Nothing queued to them before S11-92, and the
-- migration stops if either holds a job or is partitioned.

DO $check$
BEGIN
  IF EXISTS (SELECT FROM pgboss.queue
             WHERE name IN ('grants.release_email', 'grants.release_email.dead')
               AND partition) THEN
    RAISE EXCEPTION 'Queue grants.release_email is partitioned, and this migration recreates it unpartitioned.';
  END IF;
  IF EXISTS (SELECT FROM pgboss.job
             WHERE name IN ('grants.release_email', 'grants.release_email.dead')) THEN
    RAISE EXCEPTION 'Queue grants.release_email holds jobs. Let the worker finish them before this migration.';
  END IF;
END
$check$;

GRANT SELECT (tenant_id, id, module, enabled) ON app.tenant_module TO app_worker;
GRANT SELECT (tenant_id, id, programme_id, title) ON grants.round TO app_worker;
GRANT SELECT (tenant_id, id, title) ON grants.programme TO app_worker;
GRANT SELECT (tenant_id, id, name) ON party.organisation TO app_worker;

DELETE FROM app.job_queue WHERE name IN ('grants.release_email', 'grants.release_email.dead');
SELECT pgboss.delete_queue('grants.release_email');
SELECT pgboss.delete_queue('grants.release_email.dead');
SELECT pgboss.create_queue('grants.release_email.dead', '{"policy": "standard"}');
SELECT pgboss.create_queue('grants.release_email',
  '{"policy": "exclusive", "deadLetter": "grants.release_email.dead"}');
INSERT INTO app.job_queue (name, kind)
  VALUES ('grants.release_email.dead', 'tenant'), ('grants.release_email', 'tenant');
