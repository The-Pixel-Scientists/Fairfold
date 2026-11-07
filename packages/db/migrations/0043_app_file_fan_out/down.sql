-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0043, down: remove the daily file fan-out queue with any jobs
-- on it. Stop the worker first and start one without the queue, which
-- removes its schedule; until then each daily occurrence is refused by the
-- job trigger. Tenant file jobs already sent stay on platform.file_scan.

DELETE FROM app.job_queue WHERE name IN ('platform.file_fan_out', 'platform.file_fan_out.dead');
SELECT pgboss.delete_queue('platform.file_fan_out');
SELECT pgboss.delete_queue('platform.file_fan_out.dead');
