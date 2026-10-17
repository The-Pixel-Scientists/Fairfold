// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Assigning reviewers to submissions (ADR 0004). An assignment pairs a
// pool reviewer with a submission at a review stage. A request that names
// anyone outside the pool, anyone already assigned at the stage, or anyone
// who declared a conflict on the submission at any stage, makes no
// assignment at all. Each assignment made or removed records an audit event.

import type { FieldProblem } from '@pixel-scientists/domain/platform';

import type { Assigned, AssignInput, AssignmentList } from '../../contracts/index.ts';
import { isInUse, type Tx } from '../programme/tables.ts';
import type { AssessmentArgs, AssessmentContext, AssessmentDependencies } from './context.ts';
import { namesOf } from './names.ts';
import { activePool, lockSubmissions, stageRefusals } from './stage.ts';
import { assessmentDb, isDuplicate } from './tables.ts';

export const assignmentRefusals = {
  notInPool: 'This person is not in the pool, or can no longer review. Add them to the pool first.',
  conflicted: 'This reviewer declared a conflict on one of these submissions. Remove them.',
  assigned: 'This reviewer is already assigned to one of these submissions. Remove them.',
  conflictRecord:
    'This assignment records a conflict the reviewer declared, so it cannot be removed.',
  scored:
    'This reviewer has started or submitted their scores, so the assignment cannot be removed.',
} as const;

const column = (name: string) => `grants.assignment.${name}`;

/** Makes one assignment for each pair, records each, and says how many. */
export async function createAssignments(
  tx: Tx,
  context: AssessmentContext,
  roundId: string,
  stageId: string,
  pairs: readonly { readonly submissionId: string; readonly membershipId: string }[],
): Promise<number> {
  if (pairs.length === 0) return 0;
  const actor = context.membership.id;
  const made = await assessmentDb(tx)
    .insertInto('grants.assignment')
    .values((eb) =>
      pairs.map(({ submissionId, membershipId }) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        round_id: roundId,
        application_id: submissionId,
        reviewer_membership_id: membershipId,
        stage_id: stageId,
        created_by: actor,
        updated_by: actor,
      })),
    )
    .returning(['id', 'application_id', 'reviewer_membership_id'])
    .execute();
  for (const assignment of made) {
    await context.audit.record({
      action: 'grants.assignment.created',
      entityId: assignment.id,
      changes: {
        [column('application_id')]: { before: null, after: assignment.application_id },
        [column('reviewer_membership_id')]: {
          before: null,
          after: assignment.reviewer_membership_id,
        },
        [column('stage_id')]: { before: null, after: stageId },
      },
    });
  }
  return made.length;
}

export function assignmentHandlers(deps: AssessmentDependencies) {
  async function listAssignments({
    tx,
    input,
  }: AssessmentArgs<{ params: { submissionId: string } }>): Promise<AssignmentList> {
    const { submissionId } = input.params;
    const db = assessmentDb(tx);
    const submission = await db
      .selectFrom('grants.application')
      .select('id')
      .where('id', '=', submissionId)
      .where('status', '<>', 'draft')
      .executeTakeFirst();
    if (submission === undefined) throw deps.notFound();

    const rows = await db
      .selectFrom('grants.assignment as a')
      .innerJoin('grants.stage as s', 's.id', 'a.stage_id')
      .select([
        'a.id',
        'a.reviewer_membership_id',
        'a.status',
        'a.created_at',
        'a.submitted_at',
        's.id as stage_id',
        's.name as stage_name',
      ])
      .select((eb) =>
        eb
          .exists(
            eb
              .selectFrom('grants.score as c')
              .select('c.id')
              .whereRef('c.assignment_id', '=', 'a.id'),
          )
          .as('scored'),
      )
      .where('a.application_id', '=', submissionId)
      .orderBy('a.created_at')
      .orderBy('a.id')
      .execute();
    const names = await namesOf(
      tx,
      rows.map((row) => row.reviewer_membership_id),
    );
    return {
      assignments: rows.map((row) => ({
        id: row.id,
        submissionId,
        stage: { id: row.stage_id, name: row.stage_name },
        reviewer: {
          membershipId: row.reviewer_membership_id,
          name: names.get(row.reviewer_membership_id) ?? null,
        },
        status: row.status,
        scored: Boolean(row.scored),
        assignedAt: row.created_at.toISOString(),
        submittedAt: row.submitted_at?.toISOString() ?? null,
      })),
    };
  }

  async function assignReviewers({
    tx,
    context,
    input,
  }: AssessmentArgs<{ params: { stageId: string }; body: AssignInput }>): Promise<Assigned> {
    const { stageId } = input.params;
    const { submissionIds, membershipIds } = input.body;
    const { roundId } = await lockSubmissions(tx, deps, stageId, submissionIds);
    const pool = new Set(await activePool(tx, deps, roundId));
    const existing = await assessmentDb(tx)
      .selectFrom('grants.assignment')
      .select(['reviewer_membership_id', 'stage_id', 'status'])
      .where('application_id', 'in', submissionIds)
      .where('reviewer_membership_id', 'in', membershipIds)
      .execute();
    const problems = membershipIds.flatMap((id, index): FieldProblem[] => {
      const theirs = existing.filter((row) => row.reviewer_membership_id === id);
      const message = !pool.has(id)
        ? assignmentRefusals.notInPool
        : theirs.some((row) => row.status === 'conflicted')
          ? assignmentRefusals.conflicted
          : theirs.some((row) => row.stage_id === stageId)
            ? assignmentRefusals.assigned
            : undefined;
      return message === undefined ? [] : [{ field: `body.membershipIds.${index}`, message }];
    });
    if (problems.length > 0) throw deps.refuse(409, stageRefusals.none, problems);

    try {
      const assigned = await createAssignments(
        tx,
        context,
        roundId,
        stageId,
        submissionIds.flatMap((submissionId) =>
          membershipIds.map((membershipId) => ({ submissionId, membershipId })),
        ),
      );
      return { assigned };
    } catch (error) {
      throw isDuplicate(error) ? deps.refuse(409, stageRefusals.changed) : error;
    }
  }

  async function removeAssignment({
    tx,
    context,
    input,
  }: AssessmentArgs<{ params: { assignmentId: string } }>): Promise<undefined> {
    const { assignmentId } = input.params;
    const db = assessmentDb(tx);
    const row = await db
      .selectFrom('grants.assignment')
      .select(['id', 'application_id', 'reviewer_membership_id', 'stage_id', 'status'])
      .where('id', '=', assignmentId)
      .forUpdate()
      .executeTakeFirst();
    if (row === undefined) throw deps.notFound();
    if (row.status === 'conflicted') throw deps.refuse(409, assignmentRefusals.conflictRecord);
    const score = await db
      .selectFrom('grants.score')
      .select('id')
      .where('assignment_id', '=', assignmentId)
      .limit(1)
      .executeTakeFirst();
    if (row.status === 'submitted' || score !== undefined) {
      throw deps.refuse(409, assignmentRefusals.scored);
    }

    try {
      await db.deleteFrom('grants.assignment').where('id', '=', assignmentId).execute();
    } catch (error) {
      throw isInUse(error) ? deps.refuse(409, assignmentRefusals.scored) : error;
    }
    await context.audit.record({
      action: 'grants.assignment.removed',
      entityId: assignmentId,
      changes: {
        [column('application_id')]: { before: row.application_id, after: null },
        [column('reviewer_membership_id')]: { before: row.reviewer_membership_id, after: null },
        [column('stage_id')]: { before: row.stage_id, after: null },
      },
    });
    return undefined;
  }

  return { listAssignments, assignReviewers, removeAssignment };
}
