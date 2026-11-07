// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The one way to send a job (ADR 0009, "Tenant checks"). sendJob() takes the
// caller's transaction and no tenant: it reads the tenant from that
// transaction, adds it and the caller's server-side context to the payload,
// and inserts through pg-boss on the transaction's own connection, so the
// job commits or rolls back with the caller's state change. The tenant
// trigger from migration 0024 stays the backstop.

import { CompiledQuery, sql, type Kysely, type Transaction } from 'kysely';
import { PgBoss, type Db, type SendOptions } from 'pg-boss';
import type { z } from 'zod';

import { isDefinedQueue, type Queue } from './queue.ts';

/** Why sendJob() refused, before anything reached the database. */
export type SendRefusal = 'no_tenant' | 'tenant_set' | 'invalid_payload' | 'invalid_options';

export class JobSendError extends Error {
  override name = 'JobSendError';
  readonly code: SendRefusal;

  /** `detail` names a queue and paths only, never a value. */
  constructor(code: SendRefusal, detail: string) {
    super(`The job was not sent (${code}): ${detail}.`);
    this.code = code;
  }
}

declare const brand: unique symbol;
/** A process's pg-boss instance for sending; only this file can reach it. */
export interface JobSender {
  readonly [brand]: true;
}
const bosses = new WeakMap<JobSender, PgBoss>();

/** The server-side context of a send: the API request's, or the running job's. */
export interface JobContext {
  readonly sender: JobSender;
  readonly requestId: string;
  /** For the audit trail only, never for a permission decision. */
  readonly causingUserId: string | null;
}

export interface SendJobOptions<D> {
  /** Payload fields the singleton key is built from; the tenant always comes first. */
  readonly singletonOn?: readonly (keyof D & string)[];
  readonly startAfter?: Date;
  readonly retryLimit?: number;
}

/** pg-boss's database adapter over a Kysely client or transaction. */
function adapter<DB>(db: Kysely<DB>): Db {
  return {
    executeSql: async (text, values = []) => ({
      rows: (await db.executeQuery(CompiledQuery.raw(text, values))).rows,
    }),
  };
}

/**
 * Start the sender over `db`, the API's or worker's client, which pg-boss
 * uses only to check the schema version and read queue settings. It never
 * migrates, supervises or schedules.
 */
export async function startJobSender<DB>(
  db: Kysely<DB>,
  onError: (error: Error) => void,
): Promise<JobSender> {
  const boss = new PgBoss({
    db: adapter(db),
    migrate: false,
    createSchema: false,
    supervise: false,
    schedule: false,
  });
  boss.on('error', onError);
  await boss.start();
  const sender = {} as JobSender;
  bosses.set(sender, boss);
  return sender;
}

export async function stopJobSender(sender: JobSender): Promise<void> {
  await bosses.get(sender)?.stop({ graceful: false, close: false });
}

/** The tenant set on `trx`, read fresh each time. */
export async function currentTenant<DB>(trx: Transaction<DB>): Promise<string | null> {
  const { rows } = await sql<{ tenant: string | null }>`
    SELECT app.current_tenant_id() AS tenant
  `.execute(trx);
  return rows[0]?.tenant ?? null;
}

function issuePaths(error: z.ZodError): string {
  return [...new Set(error.issues.map(({ path }) => path.join('.') || 'the payload'))].join(', ');
}

function sendOptions<D>(
  queue: Queue,
  scope: string,
  data: D,
  options: SendJobOptions<D>,
): SendOptions {
  const refuse = (detail: string) => new JobSendError('invalid_options', `${queue.name} ${detail}`);
  const result: SendOptions = {};
  if (options.singletonOn !== undefined) {
    const fields = options.singletonOn;
    const shape = queue.data.shape;
    if (fields.length === 0 || fields.some((field) => !Object.hasOwn(shape, field))) {
      throw refuse('singleton key must name payload fields');
    }
    result.singletonKey = `${scope}:${JSON.stringify(fields.map((field) => data[field] ?? null))}`;
  }
  if (options.startAfter !== undefined) {
    if (Number.isNaN(options.startAfter.getTime())) throw refuse('start time is not a date');
    result.startAfter = options.startAfter;
  }
  if (options.retryLimit !== undefined) {
    if (!Number.isInteger(options.retryLimit) || options.retryLimit < 0) {
      throw refuse('retry limit must be a whole number from 0');
    }
    result.retryLimit = options.retryLimit;
  }
  return result;
}

/**
 * Send a job on `queue` in the caller's transaction, and return its id, or
 * null when a job with the same singleton key suppressed it. `queue` must be
 * the instance defineQueue() or eventJobQueue() returned. A tenant queue
 * needs a tenant set on `trx`; a platform queue needs none.
 */
export async function sendJob<DB, S extends z.ZodObject>(
  trx: Transaction<DB>,
  queue: Queue<S>,
  data: z.input<S>,
  context: JobContext,
  options: SendJobOptions<z.output<S>> = {},
): Promise<string | null> {
  // A look-alike queue could carry any schema, so only the defined instance is trusted.
  if (!isDefinedQueue(queue)) {
    throw new JobSendError('invalid_options', 'the queue was not made by defineQueue()');
  }
  const tenant = await currentTenant(trx);
  if (queue.kind === 'tenant' && tenant === null) {
    throw new JobSendError('no_tenant', `${queue.name} is a tenant queue and no tenant is set`);
  }
  if (queue.kind === 'platform' && tenant !== null) {
    throw new JobSendError('tenant_set', `${queue.name} is a platform queue and a tenant is set`);
  }
  // Parsed alone first, so a reserved key in `data` is refused, not overwritten.
  const parsed = queue.data.safeParse(data);
  if (!parsed.success) {
    throw new JobSendError('invalid_payload', `${queue.name} at ${issuePaths(parsed.error)}`);
  }
  const { requestId, causingUserId } = context;
  const reserved = tenant === null ? {} : { tenantId: tenant };
  const payload = queue.payload.safeParse({
    ...parsed.data,
    ...reserved,
    requestId,
    causingUserId,
  });
  if (!payload.success) {
    throw new JobSendError('invalid_payload', `${queue.name} at ${issuePaths(payload.error)}`);
  }
  const boss = bosses.get(context.sender);
  if (boss === undefined) throw new Error('Start the job sender with startJobSender().');
  const settings = sendOptions(queue, tenant ?? 'platform', parsed.data, options);
  return boss.send(queue.name, payload.data, { ...settings, db: adapter(trx) });
}
