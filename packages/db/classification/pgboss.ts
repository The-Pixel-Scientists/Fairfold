// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Field classification for pg-boss's job schema (ADR 0009). Every column is
// internal: a payload holds ids, enums, integers and timestamps only, and a
// job's output an error code and a request id only, so no column holds a
// person's data. Each queue's own table and each queue_stats day is a
// partition, covered by its parent's entry.
//
// A finished job (completed, failed or dead-lettered) is deleted 7 days
// after completed_on; warnings, statistics and finished schema commands 7
// days after their own time. Queue, schedule, subscription and version rows
// are configuration, kept while the platform runs.

import type { ClassificationRegistry, FieldClassification } from '../classification.ts';

const configuration: FieldClassification = {
  sensitivity: 'internal',
  retention: { kind: 'tenant_lifetime' },
};
const sevenDaysFrom = (from: string): FieldClassification => ({
  sensitivity: 'internal',
  retention: { kind: 'fixed', days: 7, from },
});

/** Every column of `columns` with the same classification. */
function all(
  columns: readonly string[],
  field: FieldClassification,
): Record<string, FieldClassification> {
  return Object.fromEntries(columns.map((column) => [column, field]));
}

export const pgboss: ClassificationRegistry = {
  'pgboss.version': all(
    ['version', 'cron_on', 'bam_on', 'flow_on', 'reindex_on', 'monitor_backoff_on'],
    configuration,
  ),
  'pgboss.queue': all(
    [
      'name',
      'policy',
      'retry_limit',
      'retry_delay',
      'retry_backoff',
      'retry_delay_max',
      'expire_seconds',
      'retention_seconds',
      'deletion_seconds',
      'dead_letter',
      'partition',
      'table_name',
      'deferred_count',
      'queued_count',
      'ready_count',
      'warning_queued',
      'active_count',
      'failed_count',
      'total_count',
      'created_delta',
      'completed_delta',
      'failed_delta',
      'delta_on',
      'delta_seconds',
      'ready_history',
      'heartbeat_seconds',
      'notify',
      'singletons_active',
      'monitor_claim_on',
      'monitor_on',
      'maintain_on',
      'created_on',
      'updated_on',
    ],
    configuration,
  ),
  // data and options are a schedule's payload and send options: ids only,
  // like a job's data (ADR 0009).
  'pgboss.schedule': all(
    [
      'name',
      'key',
      'kind',
      'cron',
      'timezone',
      'data',
      'options',
      'created_on',
      'updated_on',
      'last_job_id',
    ],
    configuration,
  ),
  'pgboss.subscription': all(['event', 'name', 'created_on', 'updated_on'], configuration),
  // Schema commands queued by an upgrade, which the migrate job drains.
  'pgboss.bam': all(
    [
      'id',
      'name',
      'version',
      'status',
      'queue',
      'table_name',
      'command',
      'error',
      'created_on',
      'started_on',
      'completed_on',
    ],
    sevenDaysFrom('completed_on'),
  ),
  // data holds ids only (ADR 0009); output and source_output an error code
  // and a request id only. The source_* columns are a dead-letter copy's
  // provenance.
  'pgboss.job': all(
    [
      'id',
      'name',
      'priority',
      'data',
      'state',
      'retry_limit',
      'retry_count',
      'retry_delay',
      'retry_backoff',
      'retry_delay_max',
      'expire_seconds',
      'deletion_seconds',
      'singleton_key',
      'singleton_on',
      'group_id',
      'group_tier',
      'start_after',
      'created_on',
      'started_on',
      'completed_on',
      'keep_until',
      'output',
      'dead_letter',
      'policy',
      'heartbeat_on',
      'heartbeat_seconds',
      'blocked',
      'blocking',
      'pending_dependencies',
      'source_name',
      'source_id',
      'source_created_on',
      'source_retry_count',
      'source_output',
      'source_root_id',
    ],
    sevenDaysFrom('completed_on'),
  ),
  'pgboss.warning': all(
    ['id', 'type', 'message', 'data', 'created_on'],
    sevenDaysFrom('created_on'),
  ),
  'pgboss.queue_stats': all(
    [
      'id',
      'name',
      'deferred_count',
      'queued_count',
      'ready_count',
      'active_count',
      'failed_count',
      'total_count',
      'created_delta',
      'completed_delta',
      'failed_delta',
      'delta_seconds',
      'delta_on',
      'captured_on',
    ],
    sevenDaysFrom('captured_on'),
  ),
  // Job flows, which nothing sends yet: a row has no time of its own, and
  // goes with its jobs.
  'pgboss.job_dependency': all(
    ['child_name', 'child_id', 'parent_name', 'parent_id'],
    configuration,
  ),
};
