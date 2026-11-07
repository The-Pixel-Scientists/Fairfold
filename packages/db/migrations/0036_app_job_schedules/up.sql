-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0036, up: pg-boss's cron queue, for the worker's schedules
-- (ADR 0009, "Processes and scheduling"; S11-64).
--
-- With schedule on, pg-boss files each due occurrence as a job on its own
-- queue __pgboss__send-it, which it would otherwise create at start. No app
-- role may execute create_queue, so it is created here as migrator, and
-- registered as a platform queue so the trigger's rules 1 and 3 accept its
-- jobs from app_queue only, with no tenant. It has no dead-letter queue: a
-- lost occurrence is reported by pg-boss and the next one is sent as usual.
-- Its jobs' data is a schedule's queue name, key, slot and payload, which
-- the existing classification of pgboss.job covers.

SELECT pgboss.create_queue('__pgboss__send-it', '{"policy": "standard"}');
INSERT INTO app.job_queue (name, kind) VALUES ('__pgboss__send-it', 'platform');
