// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Automatic assignment (ADR 0004). The server chooses from the round's pool
// and makes every assignment in the request's one transaction, each with its
// audit event. A submission the pool cannot fill is reported, not refused.

import type { AutomaticAssignInput, AutomaticAssignResult } from '../../contracts/index.ts';
import { balance } from './balance.ts';
import { createAssignments } from './assignments.ts';
import type { AssessmentArgs, AssessmentDependencies } from './context.ts';
import { activePool, lockSubmissions, stageRefusals } from './stage.ts';
import { assessmentDb, isDuplicate } from './tables.ts';

export function automaticHandlers(deps: AssessmentDependencies) {
  async function assignReviewersAutomatically({
    tx,
    context,
    input,
  }: AssessmentArgs<{
    params: { stageId: string };
    body: AutomaticAssignInput;
  }>): Promise<AutomaticAssignResult> {
    const { stageId } = input.params;
    const { submissionIds, reviewersPerSubmission } = input.body;
    const { roundId } = await lockSubmissions(tx, deps, stageId, submissionIds);
    const db = assessmentDb(tx);
    const pool = await activePool(tx, deps, roundId);

    const open = await db
      .selectFrom('grants.assignment')
      .select(['reviewer_membership_id', (eb) => eb.fn.countAll<string>().as('open')])
      .where('round_id', '=', roundId)
      .where('status', '=', 'assigned')
      .groupBy('reviewer_membership_id')
      .execute();
    const existing = await db
      .selectFrom('grants.assignment')
      .select(['application_id', 'reviewer_membership_id', 'stage_id', 'status'])
      .where('application_id', 'in', submissionIds)
      .execute();

    const { picks, unfilled } = balance(
      submissionIds.map((id) => {
        const theirs = existing.filter((row) => row.application_id === id);
        const here = theirs.filter((row) => row.stage_id === stageId);
        return {
          id,
          filled: here.filter((row) => row.status !== 'conflicted').length,
          excluded: new Set(
            theirs
              .filter((row) => row.stage_id === stageId || row.status === 'conflicted')
              .map((row) => row.reviewer_membership_id),
          ),
        };
      }),
      pool,
      new Map(open.map((row) => [row.reviewer_membership_id, Number(row.open)])),
      reviewersPerSubmission,
    );

    try {
      const assigned = await createAssignments(tx, context, roundId, stageId, picks);
      return { assigned, unfilled };
    } catch (error) {
      throw isDuplicate(error) ? deps.refuse(409, stageRefusals.changed) : error;
    }
  }

  return { assignReviewersAutomatically };
}
