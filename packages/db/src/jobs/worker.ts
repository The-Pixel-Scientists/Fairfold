// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The worker's pg-boss (ADR 0009, "Schema, queues and roles" and "Processes
// and scheduling"): connected as app_queue, it fetches, completes, fails
// and retries jobs, runs maintenance and keeps the cron schedules. It never
// changes the schema, and handlers never reach it: each runs through the
// wrapper on the worker's app_worker client.

import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { PgBoss, type Db } from 'pg-boss';
import type { z } from 'zod';

import { queuePoolConfig, type DatabaseSettings } from '../database.ts';
import { startHandlers, type JobHandler, type WorkerSetup } from './handler.ts';
import { isDefinedQueue, type Queue } from './queue.ts';

/** A platform job sent on a cron expression, read in Europe/London. */
export interface JobSchedule {
  readonly queue: Queue<z.ZodObject, 'platform'>;
  readonly cron: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export function defineSchedule<S extends z.ZodObject>(
  queue: Queue<S, 'platform'>,
  cron: string,
  data: z.input<S>,
): JobSchedule {
  return { queue, cron, data };
}

export interface WorkerOptions<DB> {
  /** app_queue's connection: the worker's database settings and its password. */
  readonly queue: Omit<DatabaseSettings, 'role'>;
  readonly setup: WorkerSetup<DB>;
  readonly handlers: readonly JobHandler<DB>[];
  /** Every schedule; any other in the database is removed. */
  readonly schedules: readonly JobSchedule[];
  readonly onError: (error: Error) => void;
}

declare const brand: unique symbol;
/** A started worker; only this package can reach its pg-boss instance. */
export interface WorkerRunner {
  readonly [brand]: true;
}
const runners = new WeakMap<WorkerRunner, { boss: PgBoss; pool: pg.Pool }>();

/** pg-boss's own cron queue, which migration 0036 creates and registers. */
const CREATE_CRON_QUEUE = /\bpgboss\.create_queue\('__pgboss__send-it',/;

/**
 * pg-boss's database adapter over app_queue's pool. pg-boss creates its cron
 * queue at start, which app_queue may not do, so that one statement is
 * answered with no rows; any other create_queue reaches the database and
 * is refused there.
 */
function queueAdapter(pool: pg.Pool): Db {
  return {
    executeSql: (text, values) =>
      CREATE_CRON_QUEUE.test(text) ? Promise.resolve({ rows: [] }) : pool.query(text, values),
  };
}

/** Why `schedules` cannot be registered: queue names only, never values. */
export function scheduleProblems(schedules: readonly JobSchedule[]): string[] {
  const seen = new Set<string>();
  return schedules.flatMap(({ queue, data }) => {
    if (!isDefinedQueue(queue)) return [`${queue.name} was not made by defineQueue()`];
    if ((queue.kind as string) !== 'platform') return [`${queue.name} is not a platform queue`];
    if (seen.has(queue.name)) return [`${queue.name} is scheduled twice`];
    seen.add(queue.name);
    return queue.data.safeParse(data).success ? [] : [`${queue.name} has an invalid payload`];
  });
}

/** Why `handlers` cannot be attached: queue names only. */
function handlerProblems<DB>(handlers: readonly JobHandler<DB>[]): string[] {
  const seen = new Set<string>();
  return handlers.flatMap(({ queue }) => {
    if (!isDefinedQueue(queue)) return [`${queue.name} was not made by defineQueue()`];
    if (seen.has(queue.name)) return [`${queue.name} has two handlers`];
    seen.add(queue.name);
    return [];
  });
}

/** Make the schedules in the database exactly `schedules`, each with a fresh request id. */
async function registerSchedules(boss: PgBoss, schedules: readonly JobSchedule[]): Promise<void> {
  const wanted = new Set(schedules.map(({ queue }) => queue.name));
  for (const { name, key } of await boss.getSchedules()) {
    if (!wanted.has(name) || key !== '') await boss.unschedule(name, key);
  }
  for (const { queue, cron, data } of schedules) {
    const payload = queue.payload.parse({
      ...queue.data.parse(data),
      requestId: randomUUID(),
      causingUserId: null,
    });
    await boss.schedule(queue.name, cron, payload, { tz: 'Europe/London' });
  }
}

/**
 * Start pg-boss as app_queue with supervise and schedule on, attach
 * `handlers` through the wrapper, and register `schedules`. Refuses, before
 * connecting, a handler or schedule that is not well formed.
 */
export async function startWorker<DB>(options: WorkerOptions<DB>): Promise<WorkerRunner> {
  const problems = [...handlerProblems(options.handlers), ...scheduleProblems(options.schedules)];
  if (problems.length > 0) throw new Error(`The worker cannot start: ${problems.join('; ')}.`);
  const pool = new pg.Pool(queuePoolConfig(options.queue));
  pool.on('error', options.onError);
  const boss = new PgBoss({
    db: queueAdapter(pool),
    migrate: false,
    createSchema: false,
    supervise: true,
    schedule: true,
  });
  boss.on('error', options.onError);
  try {
    await boss.start();
    await startHandlers(boss, options.setup, options.handlers);
    await registerSchedules(boss, options.schedules);
  } catch (error) {
    await boss.stop({ graceful: false, close: false });
    await pool.end();
    throw error;
  }
  const runner = {} as WorkerRunner;
  runners.set(runner, { boss, pool });
  return runner;
}

/** Stop fetching, let running handlers finish for up to `timeoutMillis`, then close the pool. */
export async function stopWorker(runner: WorkerRunner, timeoutMillis: number): Promise<void> {
  const started = runners.get(runner);
  if (started === undefined) return;
  runners.delete(runner);
  await started.boss.stop({ graceful: true, timeout: timeoutMillis, close: false });
  await started.pool.end();
}

/** The runner's pg-boss, for the dead-letter helpers in this folder only. */
export function bossOf(runner: WorkerRunner): PgBoss {
  const started = runners.get(runner);
  if (started === undefined) throw new Error('Start the worker with startWorker().');
  return started.boss;
}
