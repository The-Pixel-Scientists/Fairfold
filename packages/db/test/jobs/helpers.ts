// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Helpers for the tests of the send helper, handler wrapper and publish():
// clients as app_api and app_worker, a sender over each, and a queue whose
// singleton keys suppress a second job, beside fixtures.ts's test queues.

import type { Kysely } from 'kysely';

import { createDatabase } from '../../src/database.ts';
import { startJobSender, stopJobSender, type JobSender } from '../../src/jobs/send.ts';
import { databaseSettings, withClient } from '../connect.ts';
import { createQueue, createTestQueues, dropTestQueues, type TestQueues } from './fixtures.ts';

export interface JobsTest {
  readonly queues: TestQueues;
  /** A tenant queue with pg-boss's `short` policy: one queued job per singleton key. */
  readonly short: string;
  readonly api: Kysely<unknown>;
  readonly worker: Kysely<unknown>;
  readonly apiSender: JobSender;
  readonly workerSender: JobSender;
  /** Errors pg-boss reported outside any call. */
  readonly errors: Error[];
}

export async function startJobsTest(): Promise<JobsTest> {
  const queues = await createTestQueues();
  const short = `${queues.platform}_short`;
  await withClient('migrator', async (client) => {
    await client.query('BEGIN');
    await createQueue(client, short, 'tenant', { policy: 'short' });
    await client.query('COMMIT');
  });
  const api = createDatabase<unknown>(databaseSettings('app_api', 4));
  const worker = createDatabase<unknown>(databaseSettings('app_worker', 4));
  const errors: Error[] = [];
  const onError = (error: Error) => errors.push(error);
  const [apiSender, workerSender] = [
    await startJobSender(api, onError),
    await startJobSender(worker, onError),
  ];
  return { queues, short, api, worker, apiSender, workerSender, errors };
}

export async function stopJobsTest(test: JobsTest): Promise<void> {
  await stopJobSender(test.apiSender);
  await stopJobSender(test.workerSender);
  await test.api.destroy();
  await test.worker.destroy();
  await withClient('migrator', async (client) => {
    await client.query('BEGIN');
    await client.query('DELETE FROM app.job_queue WHERE name = $1', [test.short]);
    await client.query('SELECT pgboss.delete_queue($1)', [test.short]);
    await client.query('COMMIT');
  });
  await dropTestQueues(test.queues);
}

export interface JobRow {
  readonly name: string;
  readonly state: string;
  readonly data: Record<string, unknown>;
  readonly output: unknown;
  readonly singleton_key: string | null;
  readonly dead_letter: string | null;
}

/** The jobs matching `where`, read as migrator. */
export function jobRows(where: string, values: readonly unknown[]): Promise<JobRow[]> {
  return withClient('migrator', async (client) => {
    const { rows } = await client.query<JobRow>(
      `SELECT name, state, data, output, singleton_key, dead_letter FROM pgboss.job WHERE ${where}`,
      [...values],
    );
    return rows;
  });
}
