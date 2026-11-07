-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0043, up: the daily file fan-out queue (ADR 0030, "Retention";
-- S11-74).
--
-- The worker keeps one schedule per queue, and platform.fan_out is already
-- hourly, so the daily file sweep and withheld recheck get their own
-- platform fan-out queue, which sends each tenant one platform.file_scan
-- job. Like migration 0029's queues it has a dead-letter queue of the same
-- kind, and as a platform queue its jobs carry no tenant. Its jobs' data is
-- a target queue name and the platform's reserved ids, which the existing
-- classification of pgboss.job covers.

SELECT pgboss.create_queue('platform.file_fan_out.dead', '{"policy": "standard"}');
SELECT pgboss.create_queue('platform.file_fan_out',
  '{"policy": "standard", "deadLetter": "platform.file_fan_out.dead"}');
INSERT INTO app.job_queue (name, kind)
  VALUES ('platform.file_fan_out.dead', 'platform'), ('platform.file_fan_out', 'platform');
