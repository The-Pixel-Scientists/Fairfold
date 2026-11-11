// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The message notification queue and its job (ADR 0009, ADR 0033). Sending a
// funder message queues one job for its outbox row, in the request's
// transaction, holding the row's id and nothing else. The worker runs the
// grants module's sender for it, as the system acting for the member whose
// request queued it.

import { defineQueue, JobError, sendJob, type JobSender } from '@pixel-scientists/db/jobs';
import { idSchema } from '@pixel-scientists/domain';
import {
  sendMessageNotification,
  type MessageDependencies,
  type MessageNotificationDependencies,
} from '@pixel-scientists/grants/server';
import { z } from 'zod';

import type { ModuleJob } from './worker/registry.ts';

export const messageNotificationQueue = defineQueue(
  'grants.message_notification',
  'tenant',
  z.strictObject({ notificationId: idSchema }),
);

/**
 * The grants module's way to queue a notification: its job joins the request's transaction. The
 * queue keeps one waiting job per row (an exclusive policy), so a repeat adds none and answers false.
 */
export function queueMessageNotification(
  sender: JobSender,
): MessageDependencies['queueNotification'] {
  return async (tx, notificationId, by) => {
    const id = await sendJob(
      tx,
      messageNotificationQueue,
      { notificationId },
      { sender, requestId: by.requestId, causingUserId: by.membershipId },
      { singletonOn: ['notificationId'] },
    );
    return id !== null;
  };
}

/** The worker's handler: a mail server that cannot be reached fails the job, so it is tried again. */
export function messageNotificationJob(deps: MessageNotificationDependencies): ModuleJob {
  const send = sendMessageNotification(deps);
  return {
    queue: messageNotificationQueue,
    handler: async (trx, job) => {
      const payload = messageNotificationQueue.data.safeParse(job.data);
      if (!payload.success) throw new JobError('invalid_payload');
      const outcome = await send(trx, {
        notificationId: payload.data.notificationId,
        requestId: job.context.requestId,
      });
      if (outcome === 'missing') throw new JobError('not_found');
      if (outcome === 'retry') throw new JobError('internal');
    },
  };
}
