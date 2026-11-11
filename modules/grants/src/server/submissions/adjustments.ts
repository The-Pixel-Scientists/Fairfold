// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reasonable adjustments, for staff (ADR 0004, ADR 0032). Everything is
// checked again here: the round, organisation and application are in the
// caller's tenant (row-level security) and fit together, a new closing time
// is read in the round's zone and is after the round's own and not yet past,
// and who granted or removed an adjustment is the session's member, never
// the request's. The database sets the times. The reason code is special
// category: it is read for staff and never put in an audit event, a problem
// or a log line.

import { organisationSummaries } from '@pixel-scientists/party/server';

import {
  adjustmentMessages,
  type Adjustment,
  type AdjustmentList,
  type GrantAdjustmentInput,
  type RevokeAdjustmentInput,
  type SubmissionAdjustments,
} from '../../contracts/index.ts';
import { namesOf } from '../assessment/names.ts';
import { closingTime, databaseNow } from '../applications/closing.ts';
import type { Tx } from '../programme/tables.ts';
import { instantAt, localAt } from '../programme/time.ts';
import type { SubmissionArgs, SubmissionDependencies } from './context.ts';
import { submissionsDb } from './tables.ts';

const column = (name: string) => `grants.adjustment.${name}`;

const adjustments = (tx: Tx) =>
  submissionsDb(tx)
    .selectFrom('grants.adjustment as a')
    .innerJoin('grants.round as r', 'r.id', 'a.round_id')
    .select([
      'a.id',
      'a.round_id',
      'a.organisation_id',
      'a.application_id',
      'a.kind',
      'a.closes_at',
      'a.reason_code',
      'a.granted_by',
      'a.granted_at',
      'a.revoked_by',
      'a.revoked_at',
      'a.revoke_reason_code',
      'r.timezone',
    ])
    .orderBy('a.granted_at', 'desc')
    .orderBy('a.id');

type Row = Awaited<ReturnType<ReturnType<typeof adjustments>['execute']>>[number];

/** The adjustments as the contract answers them, with organisations and members named. */
async function toAdjustments(tx: Tx, rows: readonly Row[]): Promise<Adjustment[]> {
  const organisations = new Map(
    (await organisationSummaries(tx, [...new Set(rows.map((row) => row.organisation_id))])).map(
      ({ id, name }) => [id, name],
    ),
  );
  const members = await namesOf(
    tx,
    rows.flatMap((row) =>
      row.revoked_by === null ? [row.granted_by] : [row.granted_by, row.revoked_by],
    ),
  );
  const member = (membershipId: string) => ({
    membershipId,
    name: members.get(membershipId) ?? null,
  });
  return rows.map((row) => ({
    id: row.id,
    roundId: row.round_id,
    organisation: { id: row.organisation_id, name: organisations.get(row.organisation_id) ?? '' },
    applicationId: row.application_id,
    kind: row.kind,
    closesAt: row.closes_at === null ? null : localAt(row.timezone, row.closes_at),
    timeZone: row.timezone,
    reasonCode: row.reason_code,
    grantedBy: member(row.granted_by),
    grantedAt: row.granted_at.toISOString(),
    revoked:
      row.revoked_by === null || row.revoked_at === null || row.revoke_reason_code === null
        ? null
        : {
            by: member(row.revoked_by),
            at: row.revoked_at.toISOString(),
            reasonCode: row.revoke_reason_code,
          },
  }));
}

/** One adjustment as the contract answers it, for the answer and the replay of a grant. */
export async function readAdjustment(tx: Tx, id: string): Promise<Adjustment | undefined> {
  const rows = await adjustments(tx).where('a.id', '=', id).execute();
  return (await toAdjustments(tx, rows))[0];
}

export function adjustmentHandlers(deps: SubmissionDependencies) {
  async function listRoundAdjustments({
    tx,
    input,
  }: SubmissionArgs<{ params: { roundId: string } }>): Promise<AdjustmentList> {
    const { roundId } = input.params;
    const round = await submissionsDb(tx)
      .selectFrom('grants.round')
      .select('id')
      .where('id', '=', roundId)
      .executeTakeFirst();
    if (round === undefined) throw deps.notFound();
    const rows = await adjustments(tx).where('a.round_id', '=', roundId).execute();
    return { adjustments: await toAdjustments(tx, rows) };
  }

  /** What applies to a submission: adjustments naming it, and the organisation's for the round that name none. */
  async function listSubmissionAdjustments({
    tx,
    input,
  }: SubmissionArgs<{ params: { submissionId: string } }>): Promise<SubmissionAdjustments> {
    const { submissionId } = input.params;
    const submission = await submissionsDb(tx)
      .selectFrom('grants.application')
      .select(['id', 'round_id', 'organisation_id'])
      .where('id', '=', submissionId)
      .where('status', '<>', 'draft')
      .executeTakeFirst();
    if (submission === undefined) throw deps.notFound();
    const rows = await adjustments(tx)
      .where('a.round_id', '=', submission.round_id)
      .where('a.organisation_id', '=', submission.organisation_id)
      .where((eb) =>
        eb.or([eb('a.application_id', 'is', null), eb('a.application_id', '=', submissionId)]),
      )
      .execute();
    const { closesAt } = await closingTime(tx, {
      roundId: submission.round_id,
      organisationId: submission.organisation_id,
      applicationId: submissionId,
    });
    const timeZone = await zoneOf(tx, submission.round_id);
    return {
      adjustments: await toAdjustments(tx, rows),
      closesAt: localAt(timeZone, closesAt),
      timeZone,
    };
  }

  async function zoneOf(tx: Tx, roundId: string): Promise<string> {
    const round = await submissionsDb(tx)
      .selectFrom('grants.round')
      .select('timezone')
      .where('id', '=', roundId)
      .executeTakeFirstOrThrow();
    return round.timezone;
  }

  async function grantAdjustment({
    tx,
    context,
    input,
  }: SubmissionArgs<{
    params: { roundId: string };
    body: GrantAdjustmentInput;
  }>): Promise<Adjustment> {
    const { roundId } = input.params;
    const { body } = input;
    const db = submissionsDb(tx);
    const round = await db
      .selectFrom('grants.round')
      .select(['closes_at', 'timezone'])
      .where('id', '=', roundId)
      .executeTakeFirst();
    const [organisation] = await organisationSummaries(tx, [body.organisationId]);
    if (round === undefined || organisation === undefined) throw deps.notFound();

    let closesAt: Date | null = null;
    let applicationId: string | null = null;
    if (body.kind === 'deadline_extension') {
      const problem = (field: string, message: string) =>
        deps.refuse(400, message, [{ field: `body.${field}`, message }]);
      if (body.applicationId !== undefined) {
        const own = await db
          .selectFrom('grants.application')
          .select('id')
          .where('id', '=', body.applicationId)
          .where('round_id', '=', roundId)
          .where('organisation_id', '=', body.organisationId)
          .executeTakeFirst();
        if (own === undefined) throw problem('applicationId', adjustmentMessages.otherOrganisation);
        applicationId = own.id;
      }
      closesAt = instantAt(round.timezone, body.closesAt);
      if (closesAt === null) throw problem('closesAt', adjustmentMessages.closesAt);
      if (closesAt <= round.closes_at)
        throw problem('closesAt', adjustmentMessages.closesAfterRound);
      if (closesAt <= (await databaseNow(tx)))
        throw problem('closesAt', adjustmentMessages.closesInFuture);
    }

    const { id } = await db
      .insertInto('grants.adjustment')
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        round_id: roundId,
        organisation_id: body.organisationId,
        application_id: applicationId,
        kind: body.kind,
        closes_at: closesAt,
        reason_code: body.reasonCode,
        granted_by: context.membership.id,
      }))
      .returning('id')
      .executeTakeFirstOrThrow();
    await context.audit.record({
      action: 'grants.adjustment.granted',
      entityId: id,
      changes: {
        [column('round_id')]: { before: null, after: roundId },
        [column('organisation_id')]: { before: null, after: body.organisationId },
        [column('application_id')]: { before: null, after: applicationId },
        [column('kind')]: { before: null, after: body.kind },
      },
    });
    return (await readAdjustment(tx, id)) ?? Promise.reject(deps.notFound());
  }

  async function revokeAdjustment({
    tx,
    context,
    input,
  }: SubmissionArgs<{
    params: { adjustmentId: string };
    body: RevokeAdjustmentInput;
  }>): Promise<Adjustment> {
    const { adjustmentId } = input.params;
    const db = submissionsDb(tx);
    const found = await db
      .selectFrom('grants.adjustment')
      .select(['round_id', 'organisation_id', 'kind', 'revoked_at'])
      .where('id', '=', adjustmentId)
      .forUpdate()
      .executeTakeFirst();
    if (found === undefined) throw deps.notFound();
    if (found.revoked_at !== null) throw deps.refuse(409, adjustmentMessages.alreadyRevoked);

    await db
      .updateTable('grants.adjustment')
      .set({ revoked_by: context.membership.id, revoke_reason_code: input.body.reasonCode })
      .where('id', '=', adjustmentId)
      .execute();
    await context.audit.record({
      action: 'grants.adjustment.revoked',
      entityId: adjustmentId,
      changes: {
        [column('round_id')]: { after: found.round_id },
        [column('organisation_id')]: { after: found.organisation_id },
        [column('kind')]: { after: found.kind },
        [column('revoked_by')]: { before: null, after: context.membership.id },
      },
    });
    return (await readAdjustment(tx, adjustmentId)) ?? Promise.reject(deps.notFound());
  }

  /** The grant a replayed request made, read as the grant answers it. */
  async function replayGrant({ tx, id }: { tx: Tx; id: string }): Promise<Adjustment> {
    return (await readAdjustment(tx, id)) ?? Promise.reject(deps.notFound());
  }

  return {
    listRoundAdjustments,
    listSubmissionAdjustments,
    grantAdjustment,
    revokeAdjustment,
    replayGrant,
  };
}
