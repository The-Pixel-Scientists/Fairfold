// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What assigning reviewers, by hand or automatically, checks first: the
// stage is a review stage, every submission is submitted and in it, and the
// pool's members can still review. Submissions are locked in id order, so
// a withdrawal, a stage move or a conflict declared on one waits its turn.

import type { FieldProblem } from '@pixel-scientists/domain/platform';

import type { Tx } from '../programme/tables.ts';
import type { AssessmentDependencies } from './context.ts';
import { assessmentDb } from './tables.ts';

export const stageRefusals = {
  none: 'No reviewers were assigned. Remove the ones listed and try again.',
  changed: 'These assignments changed while you worked. Reload the page and try again.',
  noRubric:
    'This stage has no rubric, so reviewers cannot score it. Add criteria to its rubric first.',
  missing: 'This is not a submission. Remove it and try again.',
  withdrawn: 'This submission was withdrawn. Remove it and try again.',
  elsewhere: 'This submission is not in this stage. Move it here first, or remove it.',
} as const;

/** The stage's round, once the stage has a rubric and every submission is submitted and in it; the submissions are locked. */
export async function lockSubmissions(
  tx: Tx,
  deps: AssessmentDependencies,
  stageId: string,
  submissionIds: readonly string[],
): Promise<{ readonly roundId: string }> {
  const db = assessmentDb(tx);
  const stage = await db
    .selectFrom('grants.stage')
    .select(['id', 'round_id'])
    .where('id', '=', stageId)
    .executeTakeFirst();
  if (stage === undefined) throw deps.notFound();
  const criterion = await db
    .selectFrom('grants.rubric_criterion')
    .select('id')
    .where('stage_id', '=', stageId)
    .limit(1)
    .executeTakeFirst();
  if (criterion === undefined) throw deps.refuse(409, stageRefusals.noRubric);

  const rows = await db
    .selectFrom('grants.application')
    .select(['id', 'status', 'stage_id'])
    .where('id', 'in', submissionIds)
    .orderBy('id')
    .forUpdate()
    .execute();
  const byId = new Map(rows.map((row) => [row.id, row]));
  // A draft, and an id of nobody's or of another tenant, read as no submission at all.
  const problems = submissionIds.flatMap((id, index): FieldProblem[] => {
    const row = byId.get(id);
    const message =
      row === undefined || row.status === 'draft'
        ? stageRefusals.missing
        : row.status === 'withdrawn'
          ? stageRefusals.withdrawn
          : row.stage_id === stageId
            ? undefined
            : stageRefusals.elsewhere;
    return message === undefined ? [] : [{ field: `body.submissionIds.${index}`, message }];
  });
  if (problems.length > 0) throw deps.refuse(409, stageRefusals.none, problems);
  return { roundId: stage.round_id };
}

/** The round's pool members who can still review, by id. */
export async function activePool(
  tx: Tx,
  deps: AssessmentDependencies,
  roundId: string,
): Promise<string[]> {
  const inPool = await assessmentDb(tx)
    .selectFrom('grants.reviewer')
    .select('membership_id')
    .where('round_id', '=', roundId)
    .execute();
  const canReview = new Set(await deps.membersWith(tx, 'grants.reviews.score'));
  return inPool
    .map((row) => row.membership_id)
    .filter((id) => canReview.has(id))
    .sort();
}
