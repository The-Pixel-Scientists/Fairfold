// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Every cron schedule, in one list (queue, cron in Europe/London, payload).
// The worker registers exactly these at start and removes any other. Only
// platform queues can be scheduled, one schedule each, and no payload names
// a tenant. The nightly retention job runs at 03:30, clear of the hour a clock
// change repeats or skips.

import { defineSchedule, type JobSchedule } from '@pixel-scientists/db/jobs';

import { fanOutQueue, fileFanOutQueue } from './jobs/index.ts';
import { auditPurgeQueue, retentionSweepQueue } from './jobs/retention.ts';

export const schedules: readonly JobSchedule[] = [
  defineSchedule(fanOutQueue, '0 * * * *', { target: 'platform.idempotency_purge' }),
  defineSchedule(fileFanOutQueue, '0 2 * * *', { target: 'platform.file_scan' }),
  defineSchedule(auditPurgeQueue, '30 3 * * *', { target: retentionSweepQueue.name }),
];
