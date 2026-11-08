// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The release email queue and its job (ADR 0009, ADR 0020). Releasing or
// resending decisions queues one job per outbox row, in the request's
// transaction, holding the row's id and nothing else. The worker runs the
// grants module's sender for it, as the system acting for the member whose
// request queued it.

import { defineQueue, JobError, sendJob, type JobSender } from '@pixel-scientists/db/jobs';
import { idSchema } from '@pixel-scientists/domain';
import {
  sendReleaseEmail,
  type DecisionDependencies,
  type ReleaseEmailDependencies,
} from '@pixel-scientists/grants/server';
import { z } from 'zod';

import { recordAudit } from './audit/writer.ts';
import { jobActor } from './worker/job-actor.ts';
import type { ModuleJob } from './worker/registry.ts';

export const releaseEmailQueue = defineQueue(
  'grants.release_email',
  'tenant',
  z.strictObject({ decisionEmailId: idSchema }),
);

/**
 * The grants module's way to queue an email: its job joins the request's transaction. The queue
 * keeps one waiting job per row (an exclusive policy), so a repeat adds none and answers false.
 */
export function queueReleaseEmail(sender: JobSender): DecisionDependencies['queueEmail'] {
  return async (tx, decisionEmailId, by) => {
    const id = await sendJob(
      tx,
      releaseEmailQueue,
      { decisionEmailId },
      { sender, requestId: by.requestId, causingUserId: by.membershipId },
      { singletonOn: ['decisionEmailId'] },
    );
    return id !== null;
  };
}

/** The worker's handler: a mail server that cannot be reached fails the job, so it is tried again. */
export function releaseEmailJob(deps: ReleaseEmailDependencies): ModuleJob {
  const send = sendReleaseEmail(deps);
  return {
    queue: releaseEmailQueue,
    handler: async (trx, job) => {
      const payload = releaseEmailQueue.data.safeParse(job.data);
      if (!payload.success) throw new JobError('invalid_payload');
      const outcome = await send(trx, {
        decisionEmailId: payload.data.decisionEmailId,
        requestId: job.context.requestId,
        audit: (event) => recordAudit(trx, jobActor(job), event),
      });
      if (outcome === 'missing') throw new JobError('not_found');
      if (outcome === 'retry') throw new JobError('internal');
    },
  };
}
