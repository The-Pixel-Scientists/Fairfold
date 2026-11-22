// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The board pack queue and its job (ADR 0009, "Jobs that act for a user").
// Asking for a pack writes a job request and queues one job holding the
// request's id and nothing else, in the request's transaction. The worker
// runs the grants module's pack maker for it, as the system acting for the
// member whose request caused it.

import { defineQueue, JobError, sendJob, type JobSender } from '@pixel-scientists/db/jobs';
import { idSchema } from '@pixel-scientists/domain';
import {
  makeBoardPack,
  type BoardPackDependencies,
  type BoardPackJobDependencies,
} from '@pixel-scientists/grants/server';
import { z } from 'zod';

import { createJobRequest } from './audit/job-request.ts';
import { recordAudit } from './audit/writer.ts';
import {
  latestOrDefaultTemplateVersion,
  templateVersionById,
} from './platform/documents/templates.ts';
import { jobActor } from './worker/job-actor.ts';
import type { ModuleJob } from './worker/registry.ts';

/** Migration 0029's tenant queue; its payload is the request's id and nothing else. */
export const boardPackQueue = defineQueue(
  'platform.board_pack',
  'tenant',
  z.strictObject({ jobRequest: idSchema }),
);

/** The template versions the pack uses: the server's choice, never the request's. */
export const boardPackTemplates: BoardPackDependencies['boardPackTemplates'] = {
  latestOrDefault: (tx, author) => latestOrDefaultTemplateVersion(tx, author, 'board_pack'),
  byId: templateVersionById,
};

/**
 * The grants module's way to ask for a pack: the request, its audit event and its job share the
 * request's transaction, so all three commit or none does.
 */
export function queueBoardPack(sender: JobSender): BoardPackDependencies['queueBoardPack'] {
  return async (tx, by, { filters, fieldIds, answerClasses }) => {
    const requestId = await createJobRequest(
      tx,
      { kind: 'user', ...by },
      {
        kind: 'board_pack',
        permission: 'grants.data.export',
        filters,
        fieldIds,
        answerClasses,
      },
      'grants.board_pack.requested',
    );
    await sendJob(
      tx,
      boardPackQueue,
      { jobRequest: requestId },
      { sender, requestId: by.requestId, causingUserId: by.membershipId },
      { singletonOn: ['jobRequest'] },
    );
    return requestId;
  };
}

/** The worker's handler. A request that cannot be made ends `failed` with a code, so only a missing one fails the job. */
export function boardPackJob(
  deps: Pick<BoardPackJobDependencies, 'render' | 'store' | 'tenantTimeZone'>,
): ModuleJob {
  const make = makeBoardPack({ boardPackTemplates, ...deps });
  return {
    queue: boardPackQueue,
    handler: async (trx, job) => {
      const payload = boardPackQueue.data.safeParse(job.data);
      if (!payload.success) throw new JobError('invalid_payload');
      const outcome = await make(trx, {
        jobRequestId: payload.data.jobRequest,
        audit: (event) => recordAudit(trx, jobActor(job), event),
      });
      if (outcome === 'missing') throw new JobError('not_found');
    },
  };
}
