// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Dead letters, read in their tenant (ADR 0009, "Consequences"). pg-boss's
// redrive would re-create a job with no tenant set, which the trigger
// refuses, so a dead-lettered tenant job is read here inside a transaction
// with its tenant set, sent again by the caller with sendJob() in that same
// transaction, and completed once that commits. A job of another tenant
// reads as not found.

import { idSchema } from '@pixel-scientists/domain';
import type { Transaction } from 'kysely';
import type { z } from 'zod';

import { isDefinedQueue, type Queue } from './queue.ts';
import { currentTenant, JobSendError } from './send.ts';
import { bossOf, type WorkerRunner } from './worker.ts';

export interface DeadLetter<S extends z.ZodObject = z.ZodObject> {
  readonly id: string;
  /** The queue the job failed on, to send it to again. */
  readonly queue: Queue<S, 'tenant'>;
  readonly data: z.output<S>;
  readonly requestId: string;
  readonly causingUserId: string | null;
}

/** Each dead letter readDeadLetter() returned, with the queue it is on. */
const read = new WeakMap<DeadLetter, string>();

/**
 * The dead-lettered copy `id` of a job that failed on `source`, if it is
 * still waiting and belongs to the tenant set on `trx`; otherwise null.
 */
export async function readDeadLetter<DB, S extends z.ZodObject>(
  runner: WorkerRunner,
  trx: Transaction<DB>,
  source: Queue<S, 'tenant'>,
  id: string,
): Promise<DeadLetter<S> | null> {
  if (!isDefinedQueue(source) || (source.kind as string) !== 'tenant') {
    throw new Error(`${source.name} is not a tenant queue made by defineQueue().`);
  }
  const tenant = await currentTenant(trx);
  if (tenant === null) throw new JobSendError('no_tenant', `${source.name} dead letters`);
  if (!idSchema.safeParse(id).success) return null;
  const boss = bossOf(runner);
  const dead = (await boss.getQueue(source.name))?.deadLetter;
  if (!dead) return null;
  const [job] = await boss.findJobs<Record<string, unknown>>(dead, { id });
  if (
    job === undefined ||
    job.sourceName !== source.name ||
    !['created', 'retry', 'active'].includes(job.state) ||
    job.data['tenantId'] !== tenant
  ) {
    return null;
  }
  const parsed = source.payload.safeParse(job.data);
  if (!parsed.success) return null;
  const { requestId, causingUserId, ...data } = parsed.data as Record<string, unknown> & {
    readonly requestId: string;
    readonly causingUserId: string | null;
  };
  delete data['tenantId'];
  const letter: DeadLetter<S> = {
    id,
    queue: source,
    data: data as z.output<S>,
    requestId,
    causingUserId,
  };
  read.set(letter, dead);
  return letter;
}

/** Complete `letter` on its dead-letter queue, after its re-send has committed. */
export async function completeDeadLetter(runner: WorkerRunner, letter: DeadLetter): Promise<void> {
  const dead = read.get(letter);
  if (dead === undefined) throw new Error('Read the dead letter with readDeadLetter().');
  await bossOf(runner).complete(dead, letter.id, null, { includeQueued: true });
}
