// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The audit actor of a running job (ADR 0009): the system, the job's id and
// the membership whose request caused it, for the trail only. It is built
// from the wrapper's job context, never from payload data a handler chose,
// and is never used for a permission decision.

import type { RunningJob } from '@pixel-scientists/db/jobs';

import type { JobActor } from '../audit/writer.ts';

export function jobActor(job: Pick<RunningJob<unknown>, 'id' | 'context'>): JobActor {
  return { kind: 'job', jobId: job.id, originMembershipId: job.context.causingUserId };
}
