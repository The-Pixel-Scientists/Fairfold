// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The catalogue test's allowlists for the pgboss schema: ADR 0009's named
// exception to architecture rule 2, and every right an app role holds in
// pgboss or on the queue register app.job_queue (migration 0024).

import type { AppRole } from '../connect.ts';
import type { SchemaCatalogue } from './index.ts';

export const pgboss: SchemaCatalogue = {
  executableBy: [['pgboss.job_now()', ['app_api', 'app_worker', 'app_queue']]],
  rlsExcepted:
    "pg-boss's job schema, the one named exception to architecture rule 2 (ADR 0009): the worker fetches jobs for every tenant, so its tables carry no tenant RLS. The trigger app.check_job() checks each job's tenant instead, and the lint still checks the schema's classification, grants and functions.",
  // pg-boss's own tables, which no tenant owns. Each queue's table and each
  // queue_stats day is a partition of one of them.
  nonTenantTables: [
    'job',
    'queue',
    'schedule',
    'subscription',
    'version',
    'bam',
    'warning',
    'queue_stats',
    'job_dependency',
  ].map((table) => [`pgboss.${table}`, "A pg-boss table, under ADR 0009's exception."] as const),
  ownSchema: {
    role: 'app_queue',
    outside: [
      'USAGE on schema app',
      'EXECUTE on function app.current_tenant_id()',
      'SELECT on app.job_queue',
    ],
  },
};

/** The columns pg-boss's send writes, which app_api and app_worker may insert. */
export const SEND_COLUMNS: readonly string[] = [
  'id',
  'name',
  'data',
  'priority',
  'start_after',
  'created_on',
  'singleton_key',
  'singleton_on',
  'group_id',
  'group_tier',
  'expire_seconds',
  'deletion_seconds',
  'keep_until',
  'retry_limit',
  'retry_delay',
  'retry_backoff',
  'retry_delay_max',
  'policy',
  'dead_letter',
  'heartbeat_seconds',
  'blocked',
  'blocking',
  'pending_dependencies',
];

/** Rights every sender and app_queue hold: pg-boss's start-up check, queue settings and publish. */
const READS = [
  'USAGE on schema pgboss',
  'EXECUTE on function pgboss.job_now()',
  'SELECT on pgboss.version',
  'SELECT on pgboss.queue',
  'SELECT on pgboss.subscription',
  'SELECT on app.job_queue',
];

const crud = (table: string, privileges: readonly string[]) =>
  privileges.map((privilege) => `${privilege} on ${table}`);

/**
 * Each app role's rights in pgboss and on app.job_queue, as "<privilege> on
 * <object>". `table` holds the rights on each job table: pgboss.job and
 * every partition of it, written as "%".
 */
export const JOB_RIGHTS: Readonly<
  Record<AppRole, { readonly schema: readonly string[]; readonly table: readonly string[] }>
> = {
  app_api: {
    schema: READS,
    table: [
      ...SEND_COLUMNS.map((column) => `INSERT on column %.${column}`),
      'SELECT on column %.id',
    ],
  },
  app_worker: {
    schema: READS,
    table: [
      ...SEND_COLUMNS.map((column) => `INSERT on column %.${column}`),
      'SELECT on column %.id',
    ],
  },
  app_queue: {
    schema: [
      ...READS,
      ...crud('pgboss.version', ['UPDATE']),
      ...crud('pgboss.queue', ['UPDATE']),
      ...crud('pgboss.schedule', ['SELECT', 'INSERT', 'UPDATE', 'DELETE']),
      ...crud('pgboss.warning', ['SELECT', 'INSERT', 'DELETE']),
      ...crud('pgboss.job_dependency', ['SELECT', 'DELETE']),
    ],
    table: crud('%', ['SELECT', 'INSERT', 'UPDATE', 'DELETE']),
  },
  app_auth: { schema: [], table: [] },
};
