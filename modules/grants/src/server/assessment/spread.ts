// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The spread of scores (ADR 0004), for staff. Only submitted reviews count,
// and only on submissions still submitted: a withdrawn one has no spread.
// A conflicted assignment is no reviewer, so it counts toward nothing.

import { organisationSummaries } from '@pixel-scientists/party/server';

import type { ScoreSpread, SpreadRow, SubmissionScores } from '../../contracts/index.ts';
import { readCriteria } from '../programme/read.ts';
import type { Tx } from '../programme/tables.ts';
import type { AssessmentArgs, AssessmentDependencies } from './context.ts';
import { namesOf } from './names.ts';
import { assessmentDb } from './tables.ts';
import { spreadOf, weightedTotal } from './totals.ts';

/** The weighted total, in hundredths, of each given assignment's scores. */
async function totalsOf(tx: Tx, assignmentIds: readonly string[]): Promise<Map<string, number>> {
  if (assignmentIds.length === 0) return new Map();
  const rows = await assessmentDb(tx)
    .selectFrom('grants.score as s')
    .innerJoin('grants.rubric_criterion as c', 'c.id', 's.criterion_id')
    .select(['s.assignment_id', 's.score', 'c.weight'])
    .where('s.assignment_id', 'in', assignmentIds)
    .execute();
  const byAssignment = new Map<string, { weight: number; score: number }[]>();
  for (const { assignment_id, ...scored } of rows) {
    byAssignment.set(assignment_id, [...(byAssignment.get(assignment_id) ?? []), scored]);
  }
  return new Map([...byAssignment].map(([id, scores]) => [id, weightedTotal(scores)]));
}

export function spreadHandlers(deps: AssessmentDependencies) {
  async function getScoreSpread({
    tx,
    input,
  }: AssessmentArgs<{ params: { roundId: string } }>): Promise<ScoreSpread> {
    const { roundId } = input.params;
    const db = assessmentDb(tx);
    const round = await db
      .selectFrom('grants.round')
      .select('id')
      .where('id', '=', roundId)
      .executeTakeFirst();
    if (round === undefined) throw deps.notFound();

    const assignments = await db
      .selectFrom('grants.assignment as a')
      .innerJoin('grants.application as p', 'p.id', 'a.application_id')
      .innerJoin('grants.stage as s', 's.id', 'a.stage_id')
      .select([
        'a.id',
        'a.application_id',
        'a.status',
        'p.organisation_id',
        's.id as stage_id',
        's.name as stage_name',
        's.position',
      ])
      .where('a.round_id', '=', roundId)
      .where('p.status', '=', 'submitted')
      .execute();
    const totals = await totalsOf(
      tx,
      assignments.filter((row) => row.status === 'submitted').map((row) => row.id),
    );
    const organisations = new Map(
      (
        await organisationSummaries(tx, [...new Set(assignments.map((row) => row.organisation_id))])
      ).map(({ id, name }) => [id, { id, name }]),
    );

    // One row for each submission at each stage that has an assignment.
    const groups = new Map<string, typeof assignments>();
    for (const row of assignments) {
      const key = `${row.application_id}:${row.stage_id}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const name = (group: typeof assignments) =>
      organisations.get(group[0]?.organisation_id ?? '')?.name ?? '';
    const ordered = [...groups.values()].sort(
      (a, b) =>
        name(a).localeCompare(name(b)) ||
        (a[0]?.application_id ?? '').localeCompare(b[0]?.application_id ?? '') ||
        (a[0]?.position ?? 0) - (b[0]?.position ?? 0),
    );
    const rows: SpreadRow[] = [];
    for (const group of ordered) {
      const [first] = group;
      const organisation = organisations.get(first?.organisation_id ?? '');
      if (first === undefined || organisation === undefined) continue;
      const done = group.filter((row) => row.status === 'submitted');
      rows.push({
        submissionId: first.application_id,
        organisation,
        stage: { id: first.stage_id, name: first.stage_name },
        assigned: group.filter((row) => row.status !== 'conflicted').length,
        submitted: done.length,
        ...spreadOf(done.flatMap((row) => totals.get(row.id) ?? [])),
      });
    }
    return { submissions: rows };
  }

  async function getSubmissionScores({
    tx,
    input,
  }: AssessmentArgs<{ params: { submissionId: string } }>): Promise<SubmissionScores> {
    const { submissionId } = input.params;
    const db = assessmentDb(tx);
    const submission = await db
      .selectFrom('grants.application')
      .select('id')
      .where('id', '=', submissionId)
      .where('status', '<>', 'draft')
      .executeTakeFirst();
    if (submission === undefined) throw deps.notFound();

    const reviews = await db
      .selectFrom('grants.assignment as a')
      .innerJoin('grants.stage as s', 's.id', 'a.stage_id')
      .select([
        'a.id',
        'a.reviewer_membership_id',
        'a.submitted_at',
        's.id as stage_id',
        's.name as stage_name',
        's.position',
      ])
      .where('a.application_id', '=', submissionId)
      .where('a.status', '=', 'submitted')
      .orderBy('s.position')
      .orderBy('a.submitted_at')
      .orderBy('a.id')
      .execute();
    const ids = reviews.map((review) => review.id);
    const scores =
      ids.length === 0
        ? []
        : await db
            .selectFrom('grants.score')
            .select(['assignment_id', 'criterion_id', 'score', 'comment'])
            .where('assignment_id', 'in', ids)
            .execute();
    const totals = await totalsOf(tx, ids);
    const names = await namesOf(
      tx,
      reviews.map((review) => review.reviewer_membership_id),
    );
    const stageIds = [...new Set(reviews.map((review) => review.stage_id))];
    const criteria = await readCriteria(tx, stageIds);

    return {
      stages: stageIds.map((stageId) => {
        const stageCriteria = criteria.get(stageId) ?? [];
        const here = reviews.filter((review) => review.stage_id === stageId);
        return {
          stage: { id: stageId, name: here[0]?.stage_name ?? '' },
          criteria: stageCriteria,
          reviews: here.map((review) => ({
            assignmentId: review.id,
            reviewer: {
              membershipId: review.reviewer_membership_id,
              name: names.get(review.reviewer_membership_id) ?? null,
            },
            submittedAt: (review.submitted_at ?? new Date(0)).toISOString(),
            weightedTotal: (totals.get(review.id) ?? 0) / 100,
            scores: stageCriteria.flatMap((criterion) => {
              const saved = scores.find(
                (row) => row.assignment_id === review.id && row.criterion_id === criterion.id,
              );
              return saved === undefined
                ? []
                : [{ criterionId: criterion.id, score: saved.score, comment: saved.comment }];
            }),
          })),
        };
      }),
    };
  }

  return { getScoreSpread, getSubmissionScores };
}
