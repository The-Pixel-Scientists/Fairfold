// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The spread of scores through the whole API against the test database, as
// app_api: only submitted reviews count, the arithmetic is the contract's,
// and only programme managers read it, within their own tenant.

import { randomUUID } from 'node:crypto';

import type { ScoreSpread, SubmissionScores } from '@pixel-scientists/grants/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  noContent,
  ORGANISATION,
  startAssessmentApi,
  type AssessmentApi,
} from './assessment-api.ts';
import { answer } from './programme-api.ts';
import type { Member } from './settings-api.ts';
import { expectLooksMissing } from './support.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

let t: AssessmentApi;

beforeAll(async () => {
  t = await startAssessmentApi('41043');
}, 60_000);

afterAll(async () => {
  await t.close();
});

type Round = Awaited<ReturnType<typeof t.reviewRound>>;

/** Submits `member`'s review of `submissionId`, scoring Need and then Impact. */
async function submit(
  round: Round,
  submissionId: string,
  member: Member,
  need: number,
  impact: number,
  comment = '',
) {
  const id = (await t.assignmentsOf(submissionId)).get(member.membershipId);
  await answer(
    t.send(member, 'POST', `/console/reviews/${id}/submit`, {
      scores: [
        { criterionId: round.need.id, score: need, comment },
        { criterionId: round.impact.id, score: impact, comment: '' },
      ],
    }),
  );
  return id ?? '';
}

describe('the spread of scores', () => {
  it('counts submitted reviews only, with weighted totals, lowest, highest, range and mean', async () => {
    const round = await t.reviewRound();
    const s1 = await t.submission(round);
    const s2 = await t.submission(round);
    const s3 = await t.submission(round);
    await answer(t.pool(round.open, t.grace, t.alan, t.edsger));
    await answer(t.assign(round.review.id, [s1], t.grace, t.alan, t.edsger));
    await answer(t.assign(round.review.id, [s2], t.grace));
    await answer(t.assign(round.review.id, [s3], t.grace, t.alan));
    // Weights are Need 2 and Impact 1: (2 * 4 + 2) / 3 = 3.33, and (2 * 5 + 5) / 3 = 5.
    await submit(round, s1, t.grace, 4, 2);
    await submit(round, s1, t.alan, 5, 5);
    const edsgers = (await t.assignmentsOf(s1)).get(t.edsger.membershipId);
    await noContent(t.send(t.edsger, 'POST', `/console/reviews/${edsgers}/conflict`));
    await submit(round, s3, t.grace, 1, 2);
    await submit(round, s3, t.alan, 2, 2);
    await answer(t.send(t.ann, 'POST', t.path(s3, '/withdraw')));

    const { submissions } = await answer<ScoreSpread>(
      t.send(t.managerA, 'GET', `/console/rounds/${round.open.round.id}/score-spread`),
    );

    expect(submissions.map((row) => row.submissionId).sort()).toEqual([s1, s2].sort());
    const organisation = { id: expect.any(String) as string, name: ORGANISATION };
    expect(submissions.find((row) => row.submissionId === s1)).toEqual({
      submissionId: s1,
      organisation,
      stage: { id: round.review.id, name: round.review.name },
      assigned: 2,
      submitted: 2,
      totals: [3.33, 5],
      lowest: 3.33,
      highest: 5,
      range: 1.67,
      mean: 4.17,
    });
    expect(submissions.find((row) => row.submissionId === s2)).toEqual({
      submissionId: s2,
      organisation,
      stage: { id: round.review.id, name: round.review.name },
      assigned: 1,
      submitted: 0,
      totals: [],
      lowest: null,
      highest: null,
      range: null,
      mean: null,
    });
  });

  it('shows a submission’s scores by reviewer and criterion, with names, submitted reviews only', async () => {
    const round = await t.reviewRound();
    const s1 = await t.submission(round);
    await answer(t.pool(round.open, t.grace, t.alan, t.edsger));
    await answer(t.assign(round.review.id, [s1], t.grace, t.alan, t.edsger));
    const graces = await submit(round, s1, t.grace, 4, 2, 'Strong case for need.');
    // Alan has saved a draft only, and Edsger nothing.
    const alans = (await t.assignmentsOf(s1)).get(t.alan.membershipId);
    await answer(
      t.send(t.alan, 'PUT', `/console/reviews/${alans}/scores`, {
        scores: [{ criterionId: round.need.id, score: 1, comment: 'Draft words.' }],
      }),
    );

    const response = await t.send(t.managerA, 'GET', `/console/submissions/${s1}/scores`);
    const { stages } = response.json<SubmissionScores>();

    expect(response.statusCode).toBe(200);
    expect(stages).toHaveLength(1);
    expect(stages[0]?.stage).toEqual({ id: round.review.id, name: round.review.name });
    expect(stages[0]?.criteria.map((c) => c.label)).toEqual(['Need', 'Impact']);
    expect(stages[0]?.reviews).toEqual([
      {
        assignmentId: graces,
        reviewer: { membershipId: t.grace.membershipId, name: 'Grace Hopper' },
        submittedAt: expect.stringMatching(/Z$/) as string,
        weightedTotal: 3.33,
        scores: [
          { criterionId: round.need.id, score: 4, comment: 'Strong case for need.' },
          { criterionId: round.impact.id, score: 2, comment: '' },
        ],
      },
    ]);
    expect(response.body).not.toContain('Draft words.');
  });

  it('is for programme managers, and other tenants’ rounds and submissions read as missing', async () => {
    const round = await t.reviewRound();
    const s1 = await t.submission(round);
    const draft = await t.aDraft(t.ann, round.open.round.id);
    const spread = (id: string) => `/console/rounds/${id}/score-spread`;
    const scores = (id: string) => `/console/submissions/${id}/scores`;

    for (const url of [spread(round.open.round.id), scores(s1)]) {
      expect((await t.send(t.grace, 'GET', url)).statusCode, `reviewer ${url}`).toBe(403);
      expect((await t.send(t.adminA, 'GET', url)).statusCode, `administrator ${url}`).toBe(403);
      const asApplicant = await t.send(t.ann, 'GET', url, undefined, 'console');
      expect(asApplicant.statusCode, `applicant ${url}`).toBe(403);
      expect((await t.send(undefined, 'GET', url)).statusCode, `signed out ${url}`).toBe(401);
    }
    expectLooksMissing(
      await t.send(t.managerB, 'GET', spread(round.open.round.id)),
      await t.send(t.managerB, 'GET', spread(randomUUID())),
    );
    expectLooksMissing(
      await t.send(t.managerB, 'GET', scores(s1)),
      await t.send(t.managerB, 'GET', scores(randomUUID())),
    );
    // A draft is no submission.
    expect((await t.send(t.managerA, 'GET', scores(draft.id))).statusCode).toBe(404);
    expect((await t.send(t.managerA, 'GET', spread(randomUUID()))).statusCode).toBe(404);
  });
});
