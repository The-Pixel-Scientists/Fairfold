// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A reviewer's scores against their stage's rubric. The contract bounds
// each score to 0 to 10; the criterion's own scale is checked here, and a
// submission needs a score for every criterion. Scores are written as a set,
// replacing those saved, only while the assignment is open: the database
// refuses a change to any other.

import type { FieldProblem } from '@pixel-scientists/domain/platform';

import type { Criterion, ScoresInput } from '../../contracts/index.ts';
import type { Tx } from '../programme/tables.ts';
import { assessmentDb } from './tables.ts';

export const scoringRefusals = {
  unknown: 'This is not a criterion for this review. Remove it and try again.',
  incomplete: 'Score every criterion before you submit.',
  closed: 'This review is submitted, so its scores can no longer change.',
} as const;

export const outOfScale = (criterion: Criterion) =>
  `Enter a score from ${criterion.scaleMin} to ${criterion.scaleMax}.`;

/** What is wrong with the scores against the criteria; a submission also needs every criterion scored. */
export function scoreProblems(
  criteria: readonly Criterion[],
  scores: ScoresInput['scores'],
  complete: boolean,
): FieldProblem[] {
  const byId = new Map(criteria.map((criterion) => [criterion.id, criterion]));
  const problems = scores.flatMap(({ criterionId, score }, index): FieldProblem[] => {
    const criterion = byId.get(criterionId);
    if (criterion === undefined) {
      return [{ field: `body.scores.${index}.criterionId`, message: scoringRefusals.unknown }];
    }
    return score < criterion.scaleMin || score > criterion.scaleMax
      ? [{ field: `body.scores.${index}.score`, message: outOfScale(criterion) }]
      : [];
  });
  if (complete && criteria.some((c) => !scores.some((s) => s.criterionId === c.id))) {
    problems.push({ field: 'body.scores', message: scoringRefusals.incomplete });
  }
  return problems;
}

/** Makes the assignment's saved scores exactly `scores`. */
export async function writeScores(
  tx: Tx,
  assignment: { readonly id: string; readonly stage_id: string },
  actor: string,
  scores: ScoresInput['scores'],
): Promise<void> {
  const db = assessmentDb(tx);
  const kept = scores.map((score) => score.criterionId);
  await db
    .deleteFrom('grants.score')
    .where('assignment_id', '=', assignment.id)
    .$if(kept.length > 0, (query) => query.where('criterion_id', 'not in', kept))
    .execute();
  if (scores.length === 0) return;
  await db
    .insertInto('grants.score')
    .values((eb) =>
      scores.map(({ criterionId, score, comment }) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        assignment_id: assignment.id,
        stage_id: assignment.stage_id,
        criterion_id: criterionId,
        score,
        comment,
        created_by: actor,
        updated_by: actor,
      })),
    )
    .onConflict((conflict) =>
      conflict.columns(['tenant_id', 'assignment_id', 'criterion_id']).doUpdateSet((eb) => ({
        score: eb.ref('excluded.score'),
        comment: eb.ref('excluded.comment'),
        updated_by: actor,
      })),
    )
    .execute();
}
