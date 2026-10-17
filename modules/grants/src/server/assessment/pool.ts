// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A round's reviewer pool (ADR 0004). Only active members who hold
// `grants.reviews.score` can be added, each once. A reviewer with any
// assignment in the round stays in the pool: the database refuses the
// removal. Each added or removed reviewer records an audit event.

import type { FieldProblem } from '@pixel-scientists/domain/platform';

import type { PoolAddInput, ReviewerCandidates, ReviewerPool } from '../../contracts/index.ts';
import type { AssessmentArgs, AssessmentDependencies } from './context.ts';
import { reviewerRefs } from './names.ts';
import { assessmentDb, isDuplicate } from './tables.ts';
import { isInUse } from '../programme/tables.ts';
import type { Tx } from '../programme/tables.ts';

export const poolRefusals = {
  none: 'No reviewers were added. Remove the people listed and try again.',
  cannotReview: 'This person cannot review. Give them the reviewer role first, or remove them.',
  inPool: 'This person is already in the pool. Remove them and try again.',
  assigned:
    'This reviewer has assignments in this round, so they cannot be removed. Remove their assignments first.',
} as const;

type RoundParams = { readonly params: { readonly roundId: string } };

/** The members in a round's pool, by name. */
export async function readPool(tx: Tx, roundId: string): Promise<ReviewerPool> {
  const db = assessmentDb(tx);
  const members = await db
    .selectFrom('grants.reviewer')
    .select('membership_id')
    .where('round_id', '=', roundId)
    .execute();
  const counts = await db
    .selectFrom('grants.assignment')
    .select(['reviewer_membership_id', (eb) => eb.fn.countAll<string>().as('assignments')])
    .select((eb) => eb.fn.countAll<string>().filterWhere('status', '=', 'assigned').as('open'))
    .where('round_id', '=', roundId)
    .groupBy('reviewer_membership_id')
    .execute();
  const byMember = new Map(counts.map((row) => [row.reviewer_membership_id, row]));
  const refs = await reviewerRefs(
    tx,
    members.map((member) => member.membership_id),
  );
  return {
    reviewers: refs.map((ref) => ({
      ...ref,
      openAssignments: Number(byMember.get(ref.membershipId)?.open ?? 0),
      assignments: Number(byMember.get(ref.membershipId)?.assignments ?? 0),
    })),
  };
}

export function poolHandlers(deps: AssessmentDependencies) {
  async function requireRound(tx: Tx, roundId: string): Promise<void> {
    const round = await assessmentDb(tx)
      .selectFrom('grants.round')
      .select('id')
      .where('id', '=', roundId)
      .executeTakeFirst();
    if (round === undefined) throw deps.notFound();
  }

  async function getReviewerPool({ tx, input }: AssessmentArgs<RoundParams>) {
    await requireRound(tx, input.params.roundId);
    return readPool(tx, input.params.roundId);
  }

  async function listReviewerCandidates({
    tx,
    input,
  }: AssessmentArgs<RoundParams>): Promise<ReviewerCandidates> {
    const { roundId } = input.params;
    await requireRound(tx, roundId);
    const inPool = await assessmentDb(tx)
      .selectFrom('grants.reviewer')
      .select('membership_id')
      .where('round_id', '=', roundId)
      .execute();
    const taken = new Set(inPool.map((row) => row.membership_id));
    const reviewers = await deps.membersWith(tx, 'grants.reviews.score');
    return {
      members: await reviewerRefs(
        tx,
        reviewers.filter((id) => !taken.has(id)),
      ),
    };
  }

  async function addReviewers({
    tx,
    context,
    input,
  }: AssessmentArgs<RoundParams & { body: PoolAddInput }>): Promise<ReviewerPool> {
    const { roundId } = input.params;
    const { membershipIds } = input.body;
    await requireRound(tx, roundId);
    const db = assessmentDb(tx);
    const canReview = new Set(await deps.membersWith(tx, 'grants.reviews.score'));
    const inPool = new Set(
      (
        await db
          .selectFrom('grants.reviewer')
          .select('membership_id')
          .where('round_id', '=', roundId)
          .execute()
      ).map((row) => row.membership_id),
    );
    const problems = membershipIds.flatMap((id, index): FieldProblem[] => {
      const message = !canReview.has(id)
        ? poolRefusals.cannotReview
        : inPool.has(id)
          ? poolRefusals.inPool
          : undefined;
      return message === undefined ? [] : [{ field: `body.membershipIds.${index}`, message }];
    });
    if (problems.length > 0) throw deps.refuse(409, poolRefusals.none, problems);

    try {
      const added = await db
        .insertInto('grants.reviewer')
        .values((eb) =>
          membershipIds.map((membershipId) => ({
            tenant_id: eb.fn<string>('app.current_tenant_id', []),
            round_id: roundId,
            membership_id: membershipId,
            added_by: context.membership.id,
          })),
        )
        .returning(['id', 'membership_id'])
        .execute();
      for (const reviewer of added) {
        await context.audit.record({
          action: 'grants.reviewer.added',
          entityId: reviewer.id,
          changes: {
            'grants.reviewer.membership_id': { before: null, after: reviewer.membership_id },
          },
        });
      }
    } catch (error) {
      throw isDuplicate(error) ? deps.refuse(409, poolRefusals.none) : error;
    }
    return readPool(tx, roundId);
  }

  async function removeReviewer({
    tx,
    context,
    input,
  }: AssessmentArgs<{
    params: { roundId: string; membershipId: string };
  }>): Promise<undefined> {
    const { roundId, membershipId } = input.params;
    const db = assessmentDb(tx);
    try {
      const removed = await db
        .deleteFrom('grants.reviewer')
        .where('round_id', '=', roundId)
        .where('membership_id', '=', membershipId)
        .returning('id')
        .executeTakeFirst();
      if (removed === undefined) throw deps.notFound();
      await context.audit.record({
        action: 'grants.reviewer.removed',
        entityId: removed.id,
        changes: { 'grants.reviewer.membership_id': { before: membershipId, after: null } },
      });
    } catch (error) {
      throw isInUse(error) ? deps.refuse(409, poolRefusals.assigned) : error;
    }
    return undefined;
  }

  return { getReviewerPool, listReviewerCandidates, addReviewers, removeReviewer };
}
