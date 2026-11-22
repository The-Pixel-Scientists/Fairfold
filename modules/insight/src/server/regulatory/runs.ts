// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The publication run handlers. The platform has already checked the session,
// the permission and that insight is on. A run is prepared by the job these
// handlers send and marked submitted only by a named member: nothing here, or
// anywhere in this folder, submits anything to a regulator. The events hold
// ids, the kind, the period, the state and the failure code, never an amount,
// a name or the output's content.

import type { AuditChanges } from '@pixel-scientists/db';

import {
  insightRefusals,
  type PublicationKind,
  type PublicationRun,
  type PublicationRunInput,
  type PublicationRunList,
  type PublicationState,
} from '../../contracts/index.ts';
import { insightDb, iso, type Args, type InsightDependencies, type Tx } from '../context.ts';
import { publicationRefusals } from './messages.ts';

const MAX_LISTED = 100;

/** The columns of a run, with its dates as the text the contract holds. */
export function selectRuns(tx: Tx) {
  return insightDb(tx)
    .selectFrom('insight.publication_run')
    .select((eb) => [
      'id',
      'kind',
      eb.cast<string>('period_start', 'text').as('period_start'),
      eb.cast<string>('period_end', 'text').as('period_end'),
      'state',
      'output_file_id',
      'error_code',
      'prepared_by',
      'created_at',
      'submitted_by',
      'submitted_at',
    ]);
}

type Row = Awaited<ReturnType<ReturnType<typeof selectRuns>['executeTakeFirstOrThrow']>>;

const toRun = (row: Row): PublicationRun => ({
  id: row.id,
  kind: row.kind as PublicationKind,
  periodStart: row.period_start,
  periodEnd: row.period_end,
  state: row.state as PublicationState,
  outputFileId: row.output_file_id,
  errorCode: row.error_code,
  preparedByMembershipId: row.prepared_by,
  createdAt: iso(row.created_at),
  submittedByMembershipId: row.submitted_by,
  submittedAt: row.submitted_at === null ? null : iso(row.submitted_at),
});

/** What a run's audit event records: the run's own fields, never its output. */
export const runChanges = (
  run: Pick<PublicationRun, 'kind' | 'periodStart' | 'periodEnd' | 'state'>,
  more: AuditChanges = {},
): AuditChanges => ({
  'insight.publication_run.kind': { after: run.kind },
  'insight.publication_run.period_start': { after: run.periodStart },
  'insight.publication_run.period_end': { after: run.periodEnd },
  'insight.publication_run.state': { after: run.state },
  ...more,
});

/** Whether the tenant has the module on, read where the job and the route both run. */
export async function moduleIsOn(tx: Tx, module: 'grants' | 'insight'): Promise<boolean> {
  const row = await insightDb(tx)
    .$extendTables<{ 'app.tenant_module': { module: string; enabled: boolean } }>()
    .selectFrom('app.tenant_module')
    .select('enabled')
    .where('module', '=', module)
    .executeTakeFirst();
  return row?.enabled === true;
}

/** The session member and request a job is sent for, so its audit event names the originating member. */
export interface Requester {
  readonly membershipId: string;
  readonly requestId: string;
}

export interface RunDependencies extends Pick<InsightDependencies, 'notFound' | 'refuse'> {
  /** Sends the preparation job for a run, in the request's transaction. The payload is the run's id. */
  readonly sendPrepareJob: (tx: Tx, runId: string, requester: Requester) => Promise<void>;
}

export function runHandlers(deps: RunDependencies) {
  async function readRun(tx: Tx, runId: string, lock = false): Promise<PublicationRun> {
    const query = selectRuns(tx).where('id', '=', runId);
    const row = await (lock ? query.forUpdate() : query).executeTakeFirst();
    if (row === undefined) throw deps.notFound();
    return toRun(row);
  }

  async function listPublicationRuns({ tx }: Args<unknown>): Promise<PublicationRunList> {
    const rows = await selectRuns(tx)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(MAX_LISTED)
      .execute();
    return { runs: rows.map(toRun) };
  }

  async function getPublicationRun({
    tx,
    input,
  }: Args<{ params: { runId: string } }>): Promise<PublicationRun> {
    return readRun(tx, input.params.runId);
  }

  async function preparePublicationRun({
    tx,
    context,
    input,
  }: Args<{ body: PublicationRunInput }>): Promise<PublicationRun> {
    // Every output reads grants, so a tenant without it is told so and nothing is read.
    if (!(await moduleIsOn(tx, 'grants'))) {
      throw deps.refuse(409, publicationRefusals.needsGrants);
    }
    const { kind, periodStart, periodEnd } = input.body;
    const { id } = await insightDb(tx)
      .insertInto('insight.publication_run')
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        kind,
        period_start: periodStart,
        period_end: periodEnd,
        prepared_by: context.membership.id,
      }))
      .returning('id')
      .executeTakeFirstOrThrow();
    await context.audit.record({
      action: 'insight.publication_run.prepared',
      entityId: id,
      changes: runChanges({ kind, periodStart, periodEnd, state: 'preparing' }),
    });
    await deps.sendPrepareJob(tx, id, {
      membershipId: context.membership.id,
      requestId: context.requestId,
    });
    return readRun(tx, id);
  }

  async function markPublicationRunSubmitted({
    tx,
    context,
    input,
  }: Args<{ params: { runId: string } }>): Promise<PublicationRun> {
    const { runId } = input.params;
    const run = await readRun(tx, runId, true);
    if (run.state !== 'prepared') throw deps.refuse(409, insightRefusals.notPrepared);
    // The member comes from the session, and the database sets the time.
    await insightDb(tx)
      .updateTable('insight.publication_run')
      .set({ state: 'submitted', submitted_by: context.membership.id })
      .where('id', '=', runId)
      .execute();
    await context.audit.record({
      action: 'insight.publication_run.submitted',
      entityId: runId,
      changes: runChanges({ ...run, state: 'submitted' }),
    });
    return readRun(tx, runId);
  }

  return {
    listPublicationRuns,
    getPublicationRun,
    preparePublicationRun,
    markPublicationRunSubmitted,
  };
}
