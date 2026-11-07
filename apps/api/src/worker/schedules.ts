// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Every cron schedule, in one list (queue, cron in Europe/London, payload).
// The worker registers exactly these at start and removes any other. Only
// platform queues can be scheduled and no payload names a tenant. The first
// entries arrive with the jobs they run (retention, S11-107).

import type { JobSchedule } from '@pixel-scientists/db/jobs';

export const schedules: readonly JobSchedule[] = [];
