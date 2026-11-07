// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Test-only queues and helpers for the job schema (migration 0024). A queue
// is created and registered as a migration would: by migrator, through
// pgboss.create_queue(), with its kind in app.job_queue.

import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { PgBoss } from 'pg-boss';

import type { LoginRole } from '../../scripts/roles.ts';
import { connectionSettings, withClient } from '../connect.ts';
import { insertStatement, outcome, type Row } from '../tenants.ts';

/** The SQLSTATE app.check_job() raises on every refusal. */
export const REFUSED = 'JB001';

export type QueueKind = 'tenant' | 'platform';

export interface TestQueues {
  /** A tenant queue whose failed jobs go to `dead`, after one retry. */
  readonly source: string;
  /** The tenant dead-letter queue of `source`. */
  readonly dead: string;
  readonly platform: string;
}

/** Create `name` as migrator on `client` and register it with `kind`. */
export async function createQueue(
  client: pg.ClientBase,
  name: string,
  kind: QueueKind,
  options: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  await client.query('SELECT pgboss.create_queue($1, $2::jsonb)', [
    name,
    JSON.stringify({ policy: 'standard', ...options }),
  ]);
  await client.query('INSERT INTO app.job_queue (name, kind) VALUES ($1, $2)', [name, kind]);
}

/** Commit a fresh set of test queues, with names no other run uses. */
export function createTestQueues(): Promise<TestQueues> {
  const prefix = `test_jobs_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const queues = {
    source: `${prefix}_source`,
    dead: `${prefix}_dead`,
    platform: `${prefix}_platform`,
  };
  return withClient('migrator', async (client) => {
    await client.query('BEGIN');
    await createQueue(client, queues.dead, 'tenant');
    await createQueue(client, queues.source, 'tenant', {
      deadLetter: queues.dead,
      retryLimit: 1,
    });
    await createQueue(client, queues.platform, 'platform');
    await client.query('COMMIT');
    return queues;
  });
}

/** Remove the test queues and their jobs, as a migration's down step would. */
export function dropTestQueues(queues: TestQueues): Promise<void> {
  return withClient('migrator', async (client) => {
    await client.query('BEGIN');
    for (const name of [queues.source, queues.platform, queues.dead]) {
      await client.query('DELETE FROM app.job_queue WHERE name = $1', [name]);
      await client.query('SELECT pgboss.delete_queue($1)', [name]);
    }
    await client.query('COMMIT');
  });
}

/** Insert `values` into pgboss.job in a savepoint that is undone, and return ok or the SQLSTATE. */
export function tryInsertJob(client: pg.ClientBase, values: Row): Promise<string> {
  const { text, values: parameters } = insertStatement(client, 'pgboss.job', values);
  return outcome(client, text, parameters);
}

/** Set `tenant` for the rest of the transaction on `client`. */
export async function setTenant(client: pg.ClientBase, tenant: string): Promise<void> {
  await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant]);
}

/** Run `work` as `role` in a transaction with no tenant set, and roll it back. */
export function asRoleRolledBack<T>(
  role: LoginRole,
  work: (client: pg.Client) => Promise<T>,
): Promise<T> {
  return withClient(role, async (client) => {
    await client.query('BEGIN');
    try {
      return await work(client);
    } finally {
      await client.query('ROLLBACK');
    }
  });
}

/** pg-boss connected as `role`, as the API and worker run it: it never changes the schema. */
export function bossAs(role: LoginRole, options: Record<string, unknown> = {}): PgBoss {
  return new PgBoss({
    ...connectionSettings(role),
    max: 2,
    migrate: false,
    createSchema: false,
    supervise: false,
    schedule: false,
    ...options,
  });
}

/** A pg-boss database adapter that runs every statement on `client`. */
export function onClient(client: pg.ClientBase) {
  return {
    executeSql: (text: string, values?: unknown[]) => client.query(text, values),
  };
}
