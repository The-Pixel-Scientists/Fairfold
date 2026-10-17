// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reading decisions as the staff contracts answer them (ADR 0004). Nothing
// here is for an applicant: they see a decision only once it is released,
// through the application routes.

import type { Money } from '@pixel-scientists/domain/platform';
import { organisationSummaries } from '@pixel-scientists/party/server';

import type { Decision, DecisionList, DecisionRow } from '../../contracts/index.ts';
import { weightedTotal, spreadOf } from '../assessment/totals.ts';
import { readRound } from '../programme/read.ts';
import type { Tx } from '../programme/tables.ts';
import { decisionsDb } from './tables.ts';

export const money = (amountMinor: string): Money => ({
  amountMinor: Number(amountMinor),
  currency: 'GBP',
});

interface DecisionColumns {
  readonly outcome: Decision['outcome'];
  readonly amount_minor: string | null;
  readonly recorded_at: Date;
  readonly released_at: Date | null;
}

export const toDecision = (row: DecisionColumns): Decision => ({
  outcome: row.outcome,
  amount: row.amount_minor === null ? null : money(row.amount_minor),
  recordedAt: row.recorded_at.toISOString(),
  releasedAt: row.released_at?.toISOString() ?? null,
});

/** The mean weighted total and the count of each application's submitted reviews in the round. */
async function reviewsOf(
  tx: Tx,
  roundId: string,
): Promise<ReadonlyMap<string, { mean: number | null; reviews: number }>> {
  const rows = await decisionsDb(tx)
    .selectFrom('grants.assignment as a')
    .innerJoin('grants.score as s', 's.assignment_id', 'a.id')
    .innerJoin('grants.rubric_criterion as c', 'c.id', 's.criterion_id')
    .select(['a.application_id', 'a.id as assignment_id', 's.score', 'c.weight'])
    .where('a.round_id', '=', roundId)
    .where('a.status', '=', 'submitted')
    .execute();
  type Scores = { weight: number; score: number }[];
  const totals = new Map<string, Map<string, Scores>>();
  for (const { application_id, assignment_id, ...scored } of rows) {
    const reviews = totals.get(application_id) ?? new Map<string, Scores>();
    reviews.set(assignment_id, [...(reviews.get(assignment_id) ?? []), scored]);
    totals.set(application_id, reviews);
  }
  return new Map(
    [...totals].map(([applicationId, reviews]) => {
      const spread = spreadOf([...reviews.values()].map((scores) => weightedTotal(scores)));
      return [applicationId, { mean: spread.mean, reviews: reviews.size }];
    }),
  );
}

/** The round's submitted submissions, highest mean score first, with their decisions and emails. */
export async function readDecisionList(tx: Tx, roundId: string): Promise<DecisionList | undefined> {
  const round = await readRound(tx, roundId);
  if (round === undefined) return undefined;

  const rows = await decisionsDb(tx)
    .selectFrom('grants.application as a')
    .innerJoin('grants.stage as s', 's.id', 'a.stage_id')
    .leftJoin('grants.decision as d', 'd.application_id', 'a.id')
    .leftJoin('grants.decision_email as e', 'e.decision_id', 'd.id')
    .select([
      'a.id',
      'a.organisation_id',
      's.id as stage_id',
      's.name as stage_name',
      'd.outcome',
      'd.amount_minor',
      'd.recorded_at',
      'd.released_at',
      'e.status as email_status',
    ])
    .where('a.round_id', '=', roundId)
    .where('a.status', '=', 'submitted')
    .execute();
  const reviews = await reviewsOf(tx, roundId);
  const names = new Map(
    (await organisationSummaries(tx, [...new Set(rows.map((row) => row.organisation_id))])).map(
      ({ id, name }) => [id, { id, name }],
    ),
  );

  let awarded = 0;
  let unsentEmails = 0;
  const submissions = rows.flatMap((row): DecisionRow[] => {
    const organisation = names.get(row.organisation_id);
    if (organisation === undefined) return [];
    const decision =
      row.outcome === null || row.recorded_at === null
        ? null
        : toDecision({ ...row, outcome: row.outcome, recorded_at: row.recorded_at });
    awarded += Number(row.amount_minor ?? 0);
    if (row.email_status === 'pending' || row.email_status === 'failed') unsentEmails++;
    const scored = reviews.get(row.id);
    return [
      {
        submissionId: row.id,
        organisation,
        stage: { id: row.stage_id, name: row.stage_name },
        meanScore: scored?.mean ?? null,
        reviews: scored?.reviews ?? 0,
        decision,
        email: row.email_status,
      },
    ];
  });
  submissions.sort(
    (a, b) =>
      Number(a.meanScore === null) - Number(b.meanScore === null) ||
      (b.meanScore ?? 0) - (a.meanScore ?? 0) ||
      a.organisation.name.localeCompare(b.organisation.name) ||
      a.submissionId.localeCompare(b.submissionId),
  );
  return {
    round: {
      id: round.id,
      title: round.title,
      budget: round.budget,
      awardMinimum: round.awardMinimum,
      awardMaximum: round.awardMaximum,
    },
    submissions,
    awarded: { amountMinor: awarded, currency: round.budget.currency },
    unsentEmails,
  };
}
