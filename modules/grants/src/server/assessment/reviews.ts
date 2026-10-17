// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The reviewer's routes (ADR 0004). Every one reaches an assignment of the
// caller's own that is not conflicted, on a submission still submitted, and
// anything else is a 404 as if it did not exist; the scope rule checks that
// and each handler checks it again in its own query. Answers are the
// reviewer's own, built here from the blind projection: no organisation,
// person, other reviewer, other score or decision is read for them.

import { projectedAnswers } from '@pixel-scientists/domain/api';
import type { Answers } from '@pixel-scientists/domain/forms';

import type {
  Review,
  ReviewList,
  ReviewScores,
  ReviewStatus,
  ReviewSummary,
  ScoresInput,
} from '../../contracts/index.ts';
import { definitionOf } from '../forms/read.ts';
import { readCriteria } from '../programme/read.ts';
import type { Tx } from '../programme/tables.ts';
import { blindDefinition } from './blind.ts';
import type { AssessmentArgs, AssessmentDependencies } from './context.ts';
import { scoreProblems, scoringRefusals, writeScores } from './scoring.ts';
import { assessmentDb } from './tables.ts';

export const reviewRefusals = {
  submitted: 'You have submitted this review, so you cannot declare a conflict now.',
  noQuestions: 'This application has no questions for reviewers to read, so it cannot be reviewed.',
  scores: 'Check the scores and try again.',
} as const;

const column = (name: string) => `grants.assignment.${name}`;

type ReviewParams = { readonly params: { readonly assignmentId: string } };

/** The caller's reviewable assignments with their programme, round and stage. */
function reviewRows(tx: Tx, membershipId: string) {
  return assessmentDb(tx)
    .selectFrom('grants.assignment as a')
    .innerJoin('grants.application as ap', 'ap.id', 'a.application_id')
    .innerJoin('grants.round as r', 'r.id', 'a.round_id')
    .innerJoin('grants.programme as p', 'p.id', 'r.programme_id')
    .innerJoin('grants.stage as s', 's.id', 'a.stage_id')
    .select([
      'a.id',
      'a.application_id',
      'a.stage_id',
      'a.status',
      'a.created_at',
      'a.submitted_at',
      'p.id as programme_id',
      'p.title as programme_title',
      'r.id as round_id',
      'r.title as round_title',
      's.name as stage_name',
    ])
    .where('a.reviewer_membership_id', '=', membershipId)
    .where('a.status', '<>', 'conflicted')
    .where('ap.status', '=', 'submitted');
}

type ReviewRow = Awaited<ReturnType<ReturnType<typeof reviewRows>['execute']>>[number];

async function summaries(tx: Tx, rows: readonly ReviewRow[]): Promise<ReviewSummary[]> {
  if (rows.length === 0) return [];
  const db = assessmentDb(tx);
  const scored = await db
    .selectFrom('grants.score')
    .select(['assignment_id', (eb) => eb.fn.countAll<string>().as('scored')])
    .where(
      'assignment_id',
      'in',
      rows.map((row) => row.id),
    )
    .groupBy('assignment_id')
    .execute();
  const criteria = await readCriteria(tx, [...new Set(rows.map((row) => row.stage_id))]);
  const scoredBy = new Map(scored.map((row) => [row.assignment_id, Number(row.scored)]));
  return rows.map((row) => ({
    id: row.id,
    applicationId: row.application_id,
    programme: { id: row.programme_id, title: row.programme_title },
    round: { id: row.round_id, title: row.round_title },
    stage: { id: row.stage_id, name: row.stage_name },
    // The query leaves out conflicted assignments.
    status: row.status as ReviewStatus,
    progress: { scored: scoredBy.get(row.id) ?? 0, total: criteria.get(row.stage_id)?.length ?? 0 },
    assignedAt: row.created_at.toISOString(),
    submittedAt: row.submitted_at?.toISOString() ?? null,
  }));
}

export function reviewHandlers(deps: AssessmentDependencies) {
  /** The caller's review, locked for the rest of the request when asked, or a 404. */
  async function findReview(tx: Tx, assignmentId: string, membershipId: string, lock = false) {
    const query = reviewRows(tx, membershipId).where('a.id', '=', assignmentId);
    const row = await (lock ? query.forUpdate('a') : query).executeTakeFirst();
    if (row === undefined) throw deps.notFound();
    return row;
  }

  async function summaryOf(tx: Tx, row: ReviewRow): Promise<ReviewSummary> {
    const [summary] = await summaries(tx, [row]);
    if (summary === undefined) throw deps.notFound();
    return summary;
  }

  async function listReviews({ tx, context }: AssessmentArgs<unknown>): Promise<ReviewList> {
    const rows = await reviewRows(tx, context.membership.id)
      .orderBy('a.created_at')
      .orderBy('a.id')
      .execute();
    return { reviews: await summaries(tx, rows) };
  }

  async function getReview({ tx, context, input }: AssessmentArgs<ReviewParams>): Promise<Review> {
    const row = await findReview(tx, input.params.assignmentId, context.membership.id);
    const application = await assessmentDb(tx)
      .selectFrom('grants.application as ap')
      .innerJoin('grants.form_version as f', 'f.id', 'ap.form_version_id')
      .select(['ap.answers', 'f.definition'])
      .where('ap.id', '=', row.application_id)
      .executeTakeFirst();
    const definition = definitionOf(application?.definition ?? null);
    if (application === undefined || definition === null) throw deps.notFound();
    const form = blindDefinition(definition);
    if (form === null) throw deps.refuse(409, reviewRefusals.noQuestions);

    const criteria = (await readCriteria(tx, [row.stage_id])).get(row.stage_id) ?? [];
    const saved = await assessmentDb(tx)
      .selectFrom('grants.score')
      .select(['criterion_id', 'score', 'comment'])
      .where('assignment_id', '=', row.id)
      .execute();
    await context.audit.read({
      action: 'grants.application.viewed',
      entityId: row.application_id,
    });
    return {
      ...(await summaryOf(tx, row)),
      form: { definition: form },
      answers: projectedAnswers(definition, application.answers as Answers, 'blind_reviewer'),
      criteria,
      scores: criteria.flatMap((criterion) => {
        const score = saved.find((s) => s.criterion_id === criterion.id);
        return score === undefined
          ? []
          : [{ criterionId: criterion.id, score: score.score, comment: score.comment }];
      }),
    };
  }

  /**
   * Declares a conflict on the caller's assignment. The submission is locked
   * before the assignment, as assigning does, so no assignment is made for
   * this reviewer at another stage while the declaration is made.
   */
  async function declareConflict({
    tx,
    context,
    input,
  }: AssessmentArgs<ReviewParams>): Promise<undefined> {
    const { assignmentId } = input.params;
    const actor = context.membership.id;
    const db = assessmentDb(tx);
    const row = await findReview(tx, assignmentId, actor);
    await db
      .selectFrom('grants.application')
      .select('id')
      .where('id', '=', row.application_id)
      .forUpdate()
      .execute();
    const locked = await findReview(tx, assignmentId, actor, true);
    if (locked.status !== 'assigned') throw deps.refuse(409, reviewRefusals.submitted);

    // Draft scores and comments of a reviewer who has withdrawn from the review are not kept.
    await db.deleteFrom('grants.score').where('assignment_id', '=', assignmentId).execute();
    await db
      .updateTable('grants.assignment')
      .set({ status: 'conflicted', updated_by: actor })
      .where('id', '=', assignmentId)
      .execute();
    await db
      .insertInto('grants.conflict_declaration')
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        assignment_id: assignmentId,
        declared_by: actor,
      }))
      .execute();
    await context.audit.record({
      action: 'grants.assignment.conflict_declared',
      entityId: assignmentId,
      changes: { [column('status')]: { before: 'assigned', after: 'conflicted' } },
    });
    return undefined;
  }

  /** The caller's open review with the scores checked against its rubric, locked. */
  async function openReview(
    tx: Tx,
    { params, body }: { params: { assignmentId: string }; body: ScoresInput },
    actor: string,
    complete: boolean,
  ) {
    const row = await findReview(tx, params.assignmentId, actor, true);
    if (row.status !== 'assigned') throw deps.refuse(409, scoringRefusals.closed);
    const criteria = (await readCriteria(tx, [row.stage_id])).get(row.stage_id) ?? [];
    const problems = scoreProblems(criteria, body.scores, complete);
    if (problems.length > 0) throw deps.refuse(400, reviewRefusals.scores, problems);
    return { row, criteria };
  }

  const savedScores = (criteria: readonly { id: string }[], scores: ScoresInput['scores']) =>
    criteria.flatMap(({ id }) => scores.filter((score) => score.criterionId === id));

  async function saveReviewScores({
    tx,
    context,
    input,
  }: AssessmentArgs<ReviewParams & { body: ScoresInput }>): Promise<ReviewScores> {
    const { row, criteria } = await openReview(tx, input, context.membership.id, false);
    await writeScores(
      tx,
      { id: row.id, stage_id: row.stage_id },
      context.membership.id,
      input.body.scores,
    );
    return { scores: savedScores(criteria, input.body.scores) };
  }

  async function submitReview({
    tx,
    context,
    input,
  }: AssessmentArgs<ReviewParams & { body: ScoresInput }>): Promise<ReviewSummary> {
    const actor = context.membership.id;
    const { row } = await openReview(tx, input, actor, true);
    const db = assessmentDb(tx);
    await writeScores(tx, { id: row.id, stage_id: row.stage_id }, actor, input.body.scores);
    await db
      .updateTable('grants.assignment')
      .set({ status: 'submitted', updated_by: actor })
      .where('id', '=', row.id)
      .execute();
    await context.audit.record({
      action: 'grants.review.submitted',
      entityId: row.id,
      changes: { [column('status')]: { before: 'assigned', after: 'submitted' } },
    });
    return summaryOf(tx, await findReview(tx, row.id, actor));
  }

  return { listReviews, getReview, declareConflict, saveReviewScores, submitReview };
}
