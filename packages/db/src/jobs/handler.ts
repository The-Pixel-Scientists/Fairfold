// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The handler wrapper (ADR 0009, "Tenant checks" and "Payloads, results and
// classification"). Each job's payload is parsed with its queue's strict
// schema before the handler sees it. A tenant job runs in a transaction on
// the worker's app_worker client with the job's tenant set by withTenant();
// a platform job runs with no tenant. Every error is caught and logged, and
// the job fails with `{ code, requestId }` only, so no message, stack or
// value reaches pgboss.job.output.
//
// Delivery is at least once: a job whose handler committed can run again if
// the worker stops before pg-boss records the result, so handlers are
// idempotent and re-check their preconditions in the database.

import { idSchema } from '@pixel-scientists/domain';
import { EventParseError, parseEvent, type EventEnvelope } from '@pixel-scientists/domain/events';
import type { ModuleId } from '@pixel-scientists/domain/platform';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { JobResult, PgBoss } from 'pg-boss';
import type { z } from 'zod';

import { trustedTenantId, withTenant } from '../tenant-context.ts';
import { eventJobQueue, type Queue, type QueueKind } from './queue.ts';
import { currentTenant, type JobContext, type JobSender } from './send.ts';

export const JOB_ERROR_CODES = [
  'invalid_payload',
  'precondition_failed',
  'not_found',
  'internal',
] as const;
export type JobErrorCode = (typeof JOB_ERROR_CODES)[number];

/** Thrown by a handler to fail its job with `code`; any other error becomes `internal`. */
export class JobError extends Error {
  override name = 'JobError';
  readonly code: JobErrorCode;

  constructor(code: JobErrorCode, options?: ErrorOptions) {
    super(`The job failed: ${code}.`, options);
    this.code = code;
  }
}

/** The process's redacting logger, such as the API's pino logger. */
export interface JobLogger {
  error(fields: Record<string, unknown>, message: string): void;
}

export interface RunningJob<D> {
  readonly id: string;
  readonly data: D;
  /** The job's request id and causing user, for follow-on sends and audit events. */
  readonly context: JobContext;
}

/** A tenant job gets its transaction; a platform job gets the worker's client. */
type Handle<DB, K extends QueueKind, D> = (
  db: K extends 'tenant' ? Transaction<DB> : Kysely<DB>,
  job: RunningJob<D>,
) => Promise<void>;

export interface JobHandler<DB> {
  readonly queue: Queue;
  readonly handle: Handle<DB, QueueKind, unknown>;
}

export interface WorkerSetup<DB> {
  /** The worker's client from createDatabase(), connected as app_worker. */
  readonly db: Kysely<DB>;
  readonly sender: JobSender;
  readonly logger: JobLogger;
}

export function defineHandler<DB, S extends z.ZodObject, K extends QueueKind>(
  queue: Queue<S, K>,
  handle: Handle<DB, K, z.output<S>>,
): JobHandler<DB> {
  return { queue, handle: handle as Handle<DB, QueueKind, unknown> };
}

/** A subscribing module's handler, given each event parsed with parseEvent(). */
export function defineEventHandler<DB>(
  module: ModuleId,
  handle: (trx: Transaction<DB>, job: RunningJob<EventEnvelope>) => Promise<void>,
): JobHandler<DB> {
  return defineHandler<DB, z.ZodObject, 'tenant'>(eventJobQueue(module), async (trx, job) => {
    const envelope = parseEvent(job.data['event']);
    if (envelope.tenantId !== (await currentTenant(trx))) throw new JobError('invalid_payload');
    await handle(trx, { ...job, data: envelope });
  });
}

interface Reserved {
  readonly tenantId?: string;
  readonly requestId: string;
  readonly causingUserId: string | null;
}

/** Run one job and say how pg-boss should settle it. Never throws. */
export async function runJob<DB>(
  setup: WorkerSetup<DB>,
  handler: JobHandler<DB>,
  job: { readonly id: string; readonly data: unknown },
): Promise<JobResult> {
  const { queue } = handler;
  let requestId: string | null = null;
  let paths: string[] | undefined;
  try {
    const parsed = queue.payload.safeParse(job.data);
    if (!parsed.success) {
      // A valid request id is still worth keeping, to trace the job.
      const { data } = idSchema.safeParse((job.data as { requestId?: unknown } | null)?.requestId);
      requestId = data ?? null;
      paths = parsed.error.issues.map(({ path }) => path.join('.'));
      throw new JobError('invalid_payload');
    }
    const {
      tenantId,
      requestId: request,
      causingUserId,
      ...data
    } = parsed.data as Reserved & Record<string, unknown>;
    requestId = request;
    const running = {
      id: job.id,
      data,
      context: { sender: setup.sender, requestId, causingUserId },
    };
    if (queue.kind === 'platform') {
      await handler.handle(setup.db, running);
    } else {
      const tenant = trustedTenantId(tenantId ?? '');
      await withTenant(setup.db, tenant, (trx) => handler.handle(trx, running));
    }
    return { id: job.id, status: 'completed' };
  } catch (error) {
    const code = codeOf(error);
    if (error instanceof EventParseError) paths = [...error.paths];
    try {
      setup.logger.error(
        { err: error, queue: queue.name, jobId: job.id, requestId, code, paths },
        'A job failed.',
      );
    } catch {
      // A failing logger must not change how the job is settled.
    }
    return { id: job.id, status: 'failed', output: { code, requestId } };
  }
}

function codeOf(error: unknown): JobErrorCode {
  if (error instanceof JobError) return error.code;
  return error instanceof EventParseError ? 'invalid_payload' : 'internal';
}

/**
 * Register `handlers` with the worker's pg-boss instance, one job at a time
 * each. Refuses unless `setup.db` connects as app_worker.
 */
export async function startHandlers<DB>(
  boss: Pick<PgBoss, 'work'>,
  setup: WorkerSetup<DB>,
  handlers: readonly JobHandler<DB>[],
): Promise<void> {
  const { rows } = await sql<{ role: string }>`SELECT current_user AS role`.execute(setup.db);
  if (rows[0]?.role !== 'app_worker') throw new Error('Job handlers run only as app_worker.');
  for (const handler of handlers) {
    await boss.work(handler.queue.name, { batchSize: 1, perJobResults: true }, async (jobs) => {
      const results: JobResult[] = [];
      for (const job of jobs) results.push(await runJob(setup, handler, job));
      return results;
    });
  }
}

/**
 * Run `work` once per active tenant, from app.tenant_ids(), each in its own
 * transaction with that tenant set, so a platform job can send one tenant
 * job per tenant. Stops at the first failure, which fails the platform job.
 */
export async function forEachTenant<DB>(
  db: Kysely<DB>,
  work: (trx: Transaction<DB>) => Promise<void>,
): Promise<void> {
  const { rows } = await sql<{ id: string }>`SELECT app.tenant_ids() AS id`.execute(db);
  for (const { id } of rows) await withTenant(db, trustedTenantId(id), work);
}
