// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stands in for the API for the assessment specs: a funder with one round at
// its Review stage, a pool of reviewers, a crowd of submissions and a
// reviewer's own assignments. It keeps what is saved, so a spec can assign
// reviewers, score a review and see the spread afterwards. Answers are plain
// JSON in the shape of the contracts in modules/grants/src/contracts/assessment;
// the console checks each one against its contract, and so does this stand-in
// for what it takes.

import { formDefinitionSchema } from '@pixel-scientists/domain/forms';
import {
  assignInputSchema,
  automaticAssignInputSchema,
  scoresInputSchema,
} from '@pixel-scientists/grants/contracts';
import type { Criterion, SubmissionSummary } from '@pixel-scientists/grants/contracts';
import type { Page } from '@playwright/test';

import { problem } from './auth-api.ts';
import type { Reply } from './auth-api.ts';
import { ids, programme, round } from './programme-api.ts';
import { crowd, stubSubmissions } from './submissions-api.ts';
import type { SubmissionStub } from './submissions-api.ts';

export { ids };

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const people = {
  priya: { membershipId: uuid(11), name: 'Priya Shah' },
  tom: { membershipId: uuid(12), name: 'Tom Okafor' },
  hannah: { membershipId: uuid(13), name: 'Hannah Lewis' },
  owen: { membershipId: uuid(14), name: 'Owen Hughes' },
} as const;

type Person = (typeof people)[keyof typeof people];

const criterion = (id: string, label: string, weight: number, guidance: string): Criterion => ({
  id,
  label,
  guidance,
  weight,
  scaleMin: 1,
  scaleMax: 5,
});

export const criteria: Criterion[] = [
  criterion(ids.more[0], 'Need', 5, 'Is there evidence of local need?'),
  criterion(ids.more[1], 'Approach', 3, 'Will the plan work?'),
  criterion(ids.more[2], 'Value for money', 2, 'Are the costs reasonable?'),
];

/** What a blind reviewer is sent of the form: nothing that names the applicant. */
const blindForm = formDefinitionSchema.parse({
  sections: [
    {
      id: 's_project',
      title: 'Your project',
      fields: [
        {
          id: 'f_story',
          type: 'long_text',
          label: 'What will you do with the money?',
          required: true,
        },
      ],
    },
  ],
});

interface Held {
  id: string;
  submissionId: string;
  reviewer: Person;
  status: 'assigned' | 'submitted' | 'conflicted';
  scores: { criterionId: string; score: number; comment: string }[];
  assignedAt: string;
  submittedAt: string | null;
}

export interface AssessmentStub extends SubmissionStub {
  /** Every assignment in the funder. A spec may change it between steps. */
  assignments: Held[];
  /** The members in the round's pool. */
  pool: Person[];
  /** Members who can review and are not in the pool. */
  candidates: Person[];
}

export interface AssessmentOptions {
  /** Who is signed in: a programme manager, or a reviewer who is `priya`. */
  as: 'manager' | 'reviewer';
  /** The submissions in Review. The first this many are at the Review stage. */
  inReview?: number;
}

const ok = (body: unknown): Reply => ({ status: 200, body });

const weightedTotal = (scores: Held['scores']) => {
  const weights = scores.reduce(
    (sum, { criterionId }) => sum + (criteria.find((item) => item.id === criterionId)?.weight ?? 0),
    0,
  );
  const points = scores.reduce(
    (sum, { criterionId, score }) =>
      sum + (criteria.find((item) => item.id === criterionId)?.weight ?? 0) * score,
    0,
  );
  return Math.round((points / weights) * 100) / 100;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Reviewer's assignments to start with: Priya has three reviews, one scored in part. */
function reviewerStart(held: readonly SubmissionSummary[]): Held[] {
  return held.slice(0, 3).map((item, index) => ({
    id: uuid(700 + index),
    submissionId: item.id,
    reviewer: people.priya,
    status: 'assigned',
    scores:
      index === 1 ? [{ criterionId: criteria[0]?.id ?? '', score: 4, comment: 'Local.' }] : [],
    assignedAt: '2026-11-04T09:00:00.000Z',
    submittedAt: null,
  }));
}

/** Managers start with Tom and Priya in the pool, Hannah to add, and two submitted reviews on one submission to compare. */
function managerStart(held: readonly SubmissionSummary[]): Held[] {
  const first = held[0]?.id ?? '';
  const submitted = (n: number, reviewer: Person, scores: number[]): Held => ({
    id: uuid(800 + n),
    submissionId: first,
    reviewer,
    status: 'submitted',
    scores: criteria.map((item, index) => ({
      criterionId: item.id,
      score: scores[index] ?? 1,
      comment: '',
    })),
    assignedAt: '2026-11-04T09:00:00.000Z',
    submittedAt: '2026-11-05T09:00:00.000Z',
  });
  return [submitted(1, people.priya, [5, 4, 4]), submitted(2, people.owen, [2, 3, 3])];
}

export async function stubAssessment(
  page: Page,
  { as, inReview = 6 }: AssessmentOptions,
  held: SubmissionSummary[] = crowd(),
): Promise<AssessmentStub> {
  held.slice(0, inReview).forEach((item) => {
    item.stage = { id: ids.review, name: 'Review' };
    item.status = 'submitted';
  });
  const manager = as === 'manager';
  const state: Pick<AssessmentStub, 'assignments' | 'pool' | 'candidates'> = {
    assignments: manager ? managerStart(held) : reviewerStart(held),
    pool: manager ? [people.priya, people.tom, people.owen] : [],
    candidates: manager ? [people.hannah] : [],
  };

  const stub = await stubSubmissions(
    page,
    held,
    {
      [`GET /console/rounds/${ids.round}`]: ok(round),
      [`GET /console/programmes/${ids.programme}`]: ok({ ...programme, status: 'open' }),
    },
    manager
      ? [
          'party.records.read',
          'grants.programmes.manage',
          'grants.applications.read',
          'grants.applications.triage',
          'grants.reviews.assign',
        ]
      : ['grants.reviews.score'],
  );
  const result: AssessmentStub = { ...stub, ...state };

  const mine = () =>
    result.assignments.filter(
      (item) =>
        item.reviewer.membershipId === people.priya.membershipId && item.status !== 'conflicted',
    );
  const stage = { id: ids.review, name: 'Review' };
  const open = (member: Person) =>
    result.assignments.filter((item) => item.reviewer === member && item.status === 'assigned')
      .length;
  const staffView = (item: Held) => ({
    id: item.id,
    submissionId: item.submissionId,
    stage,
    reviewer: item.reviewer,
    status: item.status,
    scored: item.scores.length > 0,
    assignedAt: item.assignedAt,
    submittedAt: item.submittedAt,
  });
  const summary = (item: Held) => ({
    id: item.id,
    applicationId: item.submissionId,
    programme: { id: ids.programme, title: programme.title },
    round: { id: ids.round, title: round.title },
    stage,
    status: item.status === 'submitted' ? 'submitted' : 'assigned',
    progress: { scored: item.scores.length, total: criteria.length },
    assignedAt: item.assignedAt,
    submittedAt: item.submittedAt,
  });
  const poolBody = () => ({
    reviewers: result.pool.map((member) => ({
      ...member,
      openAssignments: open(member),
      assignments: result.assignments.filter((item) => item.reviewer === member).length,
    })),
  });

  const spreadRows = () => {
    const rows = new Map<string, Held[]>();
    for (const item of result.assignments) {
      if (item.status === 'conflicted') continue;
      rows.set(item.submissionId, [...(rows.get(item.submissionId) ?? []), item]);
    }
    return [...rows].map(([submissionId, items]) => {
      const submission = held.find((candidate) => candidate.id === submissionId);
      const totals = items
        .filter((item) => item.status === 'submitted')
        .map((item) => weightedTotal(item.scores))
        .sort((a, b) => a - b);
      const lowest = totals[0] ?? null;
      const highest = totals.at(-1) ?? null;
      return {
        submissionId,
        organisation: submission?.organisation ?? { id: uuid(0), name: 'Unknown' },
        stage,
        assigned: items.length,
        submitted: totals.length,
        totals,
        lowest,
        highest,
        range: lowest === null || highest === null ? null : round2(highest - lowest),
        mean:
          totals.length === 0 ? null : round2(totals.reduce((a, b) => a + b, 0) / totals.length),
      };
    });
  };

  await page.route(
    (url) =>
      /^\/api\/console\/(rounds|stages|assignments|reviews|submissions)\//.test(url.pathname) ||
      url.pathname === '/api/console/reviews',
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname.replace(/^\/api\/console/, '');
      const method = request.method();
      const body: unknown = request.postData() === null ? undefined : request.postDataJSON();
      const match = (pattern: RegExp) => pattern.exec(path);

      const reply = ((): Reply | null => {
        if (method === 'GET' && path === `/rounds/${ids.round}/reviewers`) return ok(poolBody());
        if (method === 'GET' && path === `/rounds/${ids.round}/reviewer-candidates`) {
          return ok({ members: result.candidates });
        }
        if (method === 'POST' && path === `/rounds/${ids.round}/reviewers`) {
          const { membershipIds } = body as { membershipIds: string[] };
          const added = result.candidates.filter((item) =>
            membershipIds.includes(item.membershipId),
          );
          result.pool.push(...added);
          result.candidates = result.candidates.filter((item) => !added.includes(item));
          return ok(poolBody());
        }
        const removePool = match(new RegExp(`^/rounds/${ids.round}/reviewers/([^/]+)$`));
        if (method === 'DELETE' && removePool) {
          const member = result.pool.find((item) => item.membershipId === removePool[1]);
          if (member === undefined) return problem(404, 'There is no reviewer with this address.');
          if (result.assignments.some((item) => item.reviewer === member)) {
            return problem(409, 'This reviewer has reviews assigned, so they cannot be removed.');
          }
          result.pool = result.pool.filter((item) => item !== member);
          result.candidates.push(member);
          return { status: 204 };
        }
        const assignments = match(/^\/submissions\/([^/]+)\/assignments$/);
        if (method === 'GET' && assignments) {
          return ok({
            assignments: result.assignments
              .filter((item) => item.submissionId === assignments[1])
              .map(staffView),
          });
        }
        const assign = match(/^\/stages\/([^/]+)\/assignments$/);
        if (method === 'POST' && assign) {
          const { submissionIds, membershipIds } = assignInputSchema.parse(body);
          const chosen = submissionIds.map((id) => held.find((item) => item.id === id));
          const refused = chosen.flatMap((item, index) =>
            item?.status === 'withdrawn'
              ? [
                  {
                    field: `body.submissionIds.${String(index)}`,
                    message: 'This submission was withdrawn.',
                  },
                ]
              : [],
          );
          if (refused.length > 0) return problem(409, 'Nothing was assigned.', refused);
          let made = 0;
          for (const id of submissionIds) {
            for (const membershipId of membershipIds) {
              const reviewer = result.pool.find((item) => item.membershipId === membershipId);
              if (reviewer === undefined) continue;
              result.assignments.push({
                id: uuid(900 + result.assignments.length),
                submissionId: id,
                reviewer,
                status: 'assigned',
                scores: [],
                assignedAt: '2026-11-06T09:00:00.000Z',
                submittedAt: null,
              });
              made += 1;
            }
          }
          return ok({ assigned: made });
        }
        const automatic = match(/^\/stages\/([^/]+)\/assignments\/automatic$/);
        if (method === 'POST' && automatic) {
          const { submissionIds, reviewersPerSubmission } = automaticAssignInputSchema.parse(body);
          let made = 0;
          const unfilled: { submissionId: string; missing: number }[] = [];
          for (const id of submissionIds) {
            const has = result.assignments.filter((item) => item.submissionId === id);
            const free = result.pool
              .filter((member) => !has.some((item) => item.reviewer === member))
              .sort((a, b) => open(a) - open(b) || a.membershipId.localeCompare(b.membershipId));
            const needed =
              reviewersPerSubmission - has.filter((item) => item.status !== 'conflicted').length;
            for (const reviewer of free.slice(0, Math.max(0, needed))) {
              result.assignments.push({
                id: uuid(900 + result.assignments.length),
                submissionId: id,
                reviewer,
                status: 'assigned',
                scores: [],
                assignedAt: '2026-11-06T09:00:00.000Z',
                submittedAt: null,
              });
              made += 1;
            }
            if (needed > free.length)
              unfilled.push({ submissionId: id, missing: needed - free.length });
          }
          return ok({ assigned: made, unfilled });
        }
        const unassign = match(/^\/assignments\/([^/]+)$/);
        if (method === 'DELETE' && unassign) {
          result.assignments = result.assignments.filter((item) => item.id !== unassign[1]);
          return { status: 204 };
        }
        if (method === 'GET' && path === `/rounds/${ids.round}/score-spread`) {
          return ok({ submissions: spreadRows() });
        }
        const scores = match(/^\/submissions\/([^/]+)\/scores$/);
        if (method === 'GET' && scores) {
          const reviews = result.assignments.filter(
            (item) => item.submissionId === scores[1] && item.status === 'submitted',
          );
          return ok({
            stages: [
              {
                stage,
                criteria,
                reviews: reviews.map((item) => ({
                  assignmentId: item.id,
                  reviewer: item.reviewer,
                  submittedAt: item.submittedAt,
                  weightedTotal: weightedTotal(item.scores),
                  scores: item.scores,
                })),
              },
            ],
          });
        }
        if (method === 'GET' && path === '/reviews') return ok({ reviews: mine().map(summary) });
        const one = match(/^\/reviews\/([^/]+)(?:\/(conflict|scores|submit))?$/);
        if (one) {
          const item = mine().find((candidate) => candidate.id === one[1]);
          if (item === undefined) return problem(404, 'There is no review with this address.');
          if (method === 'GET' && one[2] === undefined) {
            return ok({
              ...summary(item),
              form: { definition: blindForm },
              answers: { f_story: 'We run a weekly lunch for older neighbours.' },
              criteria,
              scores: item.scores,
            });
          }
          if (method === 'POST' && one[2] === 'conflict') {
            item.status = 'conflicted';
            item.scores = [];
            return { status: 204 };
          }
          if (item.status === 'submitted') return problem(409, 'This review is already submitted.');
          if (method === 'PUT' && one[2] === 'scores') {
            const input = scoresInputSchema.parse(body);
            item.scores = input.scores;
            return ok({ scores: item.scores });
          }
          if (method === 'POST' && one[2] === 'submit') {
            const input = scoresInputSchema.parse(body);
            if (input.scores.length < criteria.length) {
              return problem(409, 'Score every criterion before you submit.');
            }
            item.scores = input.scores;
            item.status = 'submitted';
            item.submittedAt = '2026-11-06T10:00:00.000Z';
            return ok(summary(item));
          }
        }
        return null;
      })();

      if (reply === null) {
        await route.fallback();
        return;
      }
      stub.sent.push({ key: `${method} /console${path}`, body });
      await route.fulfill({
        status: reply.status,
        contentType: 'application/json',
        body: reply.body === undefined ? undefined : JSON.stringify(reply.body),
      });
    },
  );
  return result;
}
