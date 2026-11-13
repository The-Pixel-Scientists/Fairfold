// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The reminder queues and their jobs (ADR 0009, ADR 0020). The hourly
// platform fan-out sends each tenant one scan, holding a slot id and nothing
// else. The scan writes an outbox row for each reminder due and sends the
// send job for it in the same transaction, holding the row's id and nothing
// else. Both run as app_worker in the payload's tenant. A reminder only
// reminds (rule 9): no job here changes an application or an assignment.

import { defineQueue, JobError, sendJob } from '@pixel-scientists/db/jobs';
import { idSchema } from '@pixel-scientists/domain';
import {
  databaseNow,
  scanReminders,
  sendReminder,
  type ReminderSendDependencies,
} from '@pixel-scientists/grants/server';
import { z } from 'zod';

import type { ModuleJob } from './worker/registry.ts';

export const reminderScanQueue = defineQueue(
  'grants.reminder_scan',
  'tenant',
  z.strictObject({ slot: idSchema }),
);

export const reminderSendQueue = defineQueue(
  'grants.reminder_send',
  'tenant',
  z.strictObject({ reminderEmailId: idSchema }),
);

/** The worker's scan: a repeat for one slot, or a job delivered twice, writes and sends nothing new. */
export function reminderScanJob(): ModuleJob {
  return {
    queue: reminderScanQueue,
    handler: async (trx, job) => {
      if (!reminderScanQueue.data.safeParse(job.data).success) {
        throw new JobError('invalid_payload');
      }
      await scanReminders(trx, await databaseNow(trx), async (tx, reminderEmailId) => {
        await sendJob(tx, reminderSendQueue, { reminderEmailId }, job.context, {
          singletonOn: ['reminderEmailId'],
        });
      });
    },
  };
}

/** The worker's send: a mail server that cannot be reached fails the job, so it is tried again. */
export function reminderSendJob(deps: ReminderSendDependencies): ModuleJob {
  const send = sendReminder(deps);
  return {
    queue: reminderSendQueue,
    handler: async (trx, job) => {
      const payload = reminderSendQueue.data.safeParse(job.data);
      if (!payload.success) throw new JobError('invalid_payload');
      const outcome = await send(trx, {
        reminderEmailId: payload.data.reminderEmailId,
        requestId: job.context.requestId,
        now: await databaseNow(trx),
      });
      if (outcome === 'missing') throw new JobError('not_found');
      if (outcome === 'retry') throw new JobError('internal');
    },
  };
}
