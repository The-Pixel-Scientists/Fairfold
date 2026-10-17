// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The staff submission routes (ADR 0004), matched with their contracts in
// apps/api/src/modules.ts. Everything is checked again here: drafts are
// never read or moved, and a stage move names every submission that stops
// it and then moves none. Each read of one submission is audited, and each
// moved submission records its stage change and an audit event.

import type {
  StageMoveInput,
  StageMoveResult,
  Submission,
  SubmissionPage,
  SubmissionQuery,
} from '../../contracts/index.ts';
import type { SubmissionArgs, SubmissionDependencies } from './context.ts';
import { readSubmission, readSubmissions } from './read.ts';
import { submissionsDb } from './tables.ts';

const refusals = {
  page: 'This page is no longer available. Go back to the first page of submissions.',
  none: 'No submissions were moved. Remove the ones listed and try again.',
  missing: 'This is not a submission. Remove it and try again.',
  withdrawn: 'This submission was withdrawn, so it cannot move. Remove it and try again.',
  otherRound: 'This submission is in another round. Move the submissions of one round at a time.',
} as const;

export function submissionHandlers(deps: SubmissionDependencies) {
  async function listSubmissions({
    tx,
    input,
  }: SubmissionArgs<{ query: SubmissionQuery }>): Promise<SubmissionPage> {
    return (
      (await readSubmissions(tx, input.query)) ?? Promise.reject(deps.refuse(400, refusals.page))
    );
  }

  async function getSubmission({
    tx,
    context,
    input,
  }: SubmissionArgs<{ params: { submissionId: string } }>): Promise<Submission> {
    const { submissionId } = input.params;
    const submission = await readSubmission(tx, submissionId);
    if (submission === undefined) throw deps.notFound();
    await context.audit.read({ action: 'grants.application.viewed', entityId: submissionId });
    return submission;
  }

  async function moveSubmissionsToStage({
    tx,
    context,
    input,
  }: SubmissionArgs<{
    params: { stageId: string };
    body: StageMoveInput;
  }>): Promise<StageMoveResult> {
    const { stageId } = input.params;
    const { submissionIds } = input.body;
    const db = submissionsDb(tx);
    const stage = await db
      .selectFrom('grants.stage')
      .select(['id', 'round_id'])
      .where('id', '=', stageId)
      .executeTakeFirst();
    if (stage === undefined) throw deps.notFound();

    // Locked in id order, so a withdrawal or a second move waits its turn.
    const rows = await db
      .selectFrom('grants.application')
      .select(['id', 'status', 'round_id', 'stage_id'])
      .where('id', 'in', submissionIds)
      .orderBy('id')
      .forUpdate()
      .execute();
    const byId = new Map(rows.map((row) => [row.id, row]));
    // A draft, and an id of nobody's or of another tenant, read as no submission at all.
    const problems = submissionIds.flatMap((id, index) => {
      const row = byId.get(id);
      const message =
        row === undefined || row.status === 'draft'
          ? refusals.missing
          : row.status === 'withdrawn'
            ? refusals.withdrawn
            : row.round_id === stage.round_id
              ? undefined
              : refusals.otherRound;
      return message === undefined ? [] : [{ field: `body.submissionIds.${index}`, message }];
    });
    if (problems.length > 0) throw deps.refuse(409, refusals.none, problems);

    const moving = rows.filter((row) => row.stage_id !== stageId);
    if (moving.length === 0) return { moved: 0 };

    const actor = context.membership.id;
    await db
      .updateTable('grants.application')
      .set({ stage_id: stageId, updated_by: actor })
      .where(
        'id',
        'in',
        moving.map((row) => row.id),
      )
      .execute();
    await db
      .insertInto('grants.stage_transition')
      .values((eb) =>
        moving.map((row) => ({
          tenant_id: eb.fn<string>('app.current_tenant_id', []),
          round_id: stage.round_id,
          application_id: row.id,
          from_stage_id: row.stage_id,
          to_stage_id: stageId,
          moved_by: actor,
        })),
      )
      .execute();
    for (const row of moving) {
      await context.audit.record({
        action: 'grants.application.stage_changed',
        entityId: row.id,
        changes: { 'grants.application.stage_id': { before: row.stage_id, after: stageId } },
      });
    }
    return { moved: moving.length };
  }

  return { listSubmissions, getSubmission, moveSubmissionsToStage };
}
