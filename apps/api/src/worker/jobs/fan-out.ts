// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The platform fan-out job (ADR 0009, "Processes and scheduling"): work for
// every tenant is one scheduled platform job that sends one job per active
// tenant, each from inside that tenant's own transaction. The target is an
// enum of tenant queues, never a free string, and its payload is a slot
// only: a tenant queue it sends to takes `{ slot: id }`. The slot is this
// job's id, which a retry keeps. The per-tenant singleton key on that slot
// suppresses a repeat send only for a queue whose pg-boss policy indexes the
// key (short, singleton, stately, exclusive or key_strict_fifo). The standard
// policy does not, so a target queue's handler must be safe to run twice for
// one slot; a retry may send a tenant a second job.

import {
  defineHandler,
  defineQueue,
  definedQueues,
  forEachTenant,
  JobError,
  JobSendError,
  sendJob,
  type JobHandler,
  type JobLogger,
  type RunningJob,
} from '@pixel-scientists/db/jobs';
import { z } from 'zod';

/** Declare the fan-out queue `name`, which can send to `targets` only. */
export function defineFanOut<const T extends readonly [string, ...string[]]>(
  name: string,
  targets: T,
) {
  return defineQueue(name, 'platform', z.strictObject({ target: z.enum(targets) }));
}
export type FanOutQueue = ReturnType<typeof defineFanOut>;

type Platform = Parameters<typeof forEachTenant<unknown>>[0];

/** Sends the job's target queue one job per active tenant; one tenant's failure fails the job after the rest are sent. */
export async function sendToEachTenant(
  db: Platform,
  job: RunningJob<{ readonly target: string }>,
  logger: JobLogger,
): Promise<void> {
  const target = definedQueues().find(({ name }) => name === job.data.target);
  const send = { slot: job.id };
  if (target?.kind !== 'tenant' || !target.data.safeParse(send).success) {
    throw new JobError('precondition_failed');
  }
  let failed = 0;
  await forEachTenant(db, async (trx) => {
    try {
      await sendJob(trx, target, send, job.context, { singletonOn: ['slot'] });
    } catch (error) {
      // The others still run; the job then fails and its retry sends to every tenant again.
      failed++;
      const code = error instanceof JobSendError ? error.code : 'internal';
      logger.error({ queue: target.name, jobId: job.id, code }, 'A tenant job was not sent.');
    }
  });
  if (failed > 0) throw new JobError('internal');
}

export function fanOutHandler(queue: FanOutQueue, logger: JobLogger): JobHandler<unknown> {
  return defineHandler<unknown, FanOutQueue['data'], 'platform'>(queue, (db, job) =>
    sendToEachTenant(db, job, logger),
  );
}
