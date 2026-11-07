-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0036, down: remove pg-boss's cron queue and any occurrences
-- waiting on it. Stop the worker first; started with schedule on, it
-- refuses to run without the queue. The schedules themselves stay in
-- pgboss.schedule and send again once the queue is back.

DELETE FROM app.job_queue WHERE name = '__pgboss__send-it';
SELECT pgboss.delete_queue('__pgboss__send-it');
