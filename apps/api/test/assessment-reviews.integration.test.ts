// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The reviewer routes through the whole API against the test database, as
// app_api, for two tenants: that a reviewer reaches only an assignment of
// their own with no declared conflict, that no identity field, aggregate-only
// answer or organisation reaches them, and the rules for scores and
// conflicts. Everything a reviewer cannot reach answers exactly as a missing
// record does.

import { randomUUID } from 'node:crypto';

import type {
  AssignmentList,
  ReviewList,
  ReviewScores,
  ReviewSummary,
} from '@pixel-scientists/grants/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  noContent,
  ORGANISATION,
  SECRETS,
  startAssessmentApi,
  type AssessmentApi,
} from './assessment-api.ts';
import { question } from './forms-api.ts';
import { answer, type Problem } from './programme-api.ts';
import { events } from './settings-api.ts';
import { expectLooksMissing } from './support.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

let t: AssessmentApi;

beforeAll(async () => {
  t = await startAssessmentApi('41041');
}, 60_000);

afterAll(async () => {
  await t.close();
});

/** Grace's assignment, on a submission Alan is assigned to as well. */
async function setUp() {
  const { round, submissionId } = await t.assigned(t.grace, t.alan);
  const ids = await t.assignmentsOf(submissionId);
  const graces = ids.get(t.grace.membershipId) ?? '';
  const alans = ids.get(t.alan.membershipId) ?? '';
  const scores = (...values: [string, number][]) => ({
    scores: values.map(([criterionId, score]) => ({ criterionId, score, comment: '' })),
  });
  return { round, submissionId, graces, alans, scores };
}

describe('reading a review', () => {
  it('lists only the caller’s own reviews, the earliest assigned first', async () => {
    const { graces, round } = await setUp();
    const second = await t.assigned(t.grace);

    const mine = await answer<ReviewList>(t.send(t.grace, 'GET', '/console/reviews'));
    const own = mine.reviews.filter((review) => review.stage.id === round.review.id);

    expect(own.map((review) => review.id)).toContain(graces);
    expect(mine.reviews.map((review) => review.id)).toContain(
      (await t.assignmentsOf(second.submissionId)).get(t.grace.membershipId),
    );
    expect(own[0]).toEqual({
      id: expect.any(String) as string,
      applicationId: expect.any(String) as string,
      programme: { id: round.open.programmeId, title: 'Community Spaces Fund' },
      round: { id: round.open.round.id, title: 'Autumn 2026' },
      stage: { id: round.review.id, name: round.review.name },
      status: 'assigned',
      progress: { scored: 0, total: 2 },
      assignedAt: expect.stringMatching(/Z$/) as string,
      submittedAt: null,
    });
    expect(await answer<ReviewList>(t.send(t.edsger, 'GET', '/console/reviews'))).toEqual({
      reviews: [],
    });
  });

  it('sends only what a blind reviewer may see, with the form and answers cut to match, and audits the read', async () => {
    const { alans, submissionId, round } = await setUp();

    const review = await t.readReview(t.alan, alans);

    expect(review.answers).toEqual({
      f_charity: true,
      f_title: 'Village hall roof',
      f_haveweb: false,
      f_summary: 'A new roof for the village hall',
    });
    expect(review.form.definition.sections.flatMap((s) => s.fields.map((f) => f.id))).toEqual([
      'f_charity',
      'f_title',
      'f_haveweb',
      'f_web',
      'f_summary',
    ]);
    expect(review.criteria.map((c) => c.label)).toEqual(['Need', 'Impact']);
    expect(review.scores).toEqual([]);
    expect(review.applicationId).toBe(submissionId);

    const body = (await t.review(t.alan, alans)).body;
    for (const hidden of [
      SECRETS.contact,
      SECRETS.internal,
      String(SECRETS.turnover),
      ORGANISATION,
      'f_contact',
      'f_turnover',
      'f_internal',
      'f_accounts',
      'Contact name',
      'Internal note',
      'Your accounts',
      'Annual turnover',
      'Grace Hopper',
      t.grace.membershipId,
      t.ann.userId,
      t.managerA.membershipId,
    ]) {
      expect(body, hidden).not.toContain(hidden);
    }
    for (const field of [
      'organisation',
      'person',
      'applicant',
      'contact',
      'decision',
      'reviewer',
    ]) {
      expect(Object.keys(review), field).not.toContain(field);
    }

    const viewed = (await events(t.tenantA, 'grants.application.viewed')).filter(
      (event) => event.actor_id === t.alan.membershipId,
    );
    expect(viewed.length).toBeGreaterThanOrEqual(2);
    expect(viewed.every((event) => event.entity_id === submissionId)).toBe(true);
    expect(round.review.id).toBeTruthy();
  });

  it('refuses a form with no question a blind reviewer may read', async () => {
    const round = await t.reviewRound({
      fields: [question('f_name', 'short_text', 'Contact name', { identity: true })],
    });
    const submissionId = await t.submission(round, t.ann, { f_name: 'Ada Applicant-Secret' });
    await answer(t.pool(round.open, t.grace));
    await answer(t.assign(round.review.id, [submissionId], t.grace));
    const id = (await t.assignmentsOf(submissionId)).get(t.grace.membershipId) ?? '';

    const refused = await t.review(t.grace, id);

    expect(refused.statusCode).toBe(409);
    expect(refused.body).not.toContain('Applicant-Secret');
  });

  it('answers 404, as a missing record does, for another reviewer’s assignment, an unassigned reviewer and another tenant', async () => {
    const { graces, round } = await setUp();
    const gone = randomUUID();

    for (const outsider of [t.alan, t.edsger, t.reviewerB]) {
      const own = t.reviewerRoutes(graces, round.need.id);
      const missing = t.reviewerRoutes(gone, round.need.id);
      for (const [index, [method, url, body]] of own.entries()) {
        if (index === 0) continue;
        const [, missingUrl] = missing[index] ?? [];
        expectLooksMissing(
          await t.send(outsider, method, url, body),
          await t.send(outsider, method, missingUrl ?? '', body),
        );
      }
    }
    // Nothing was changed by those requests.
    expect((await t.readReview(t.grace, graces)).scores).toEqual([]);
    expect((await t.assignmentsOf((await t.readReview(t.grace, graces)).applicationId)).size).toBe(
      2,
    );
  });

  it('answers 404 once the applicant withdraws the application', async () => {
    const { graces, submissionId } = await setUp();
    await answer(t.send(t.ann, 'POST', t.path(submissionId, '/withdraw')));

    expect((await t.review(t.grace, graces)).statusCode).toBe(404);
    const mine = await answer<ReviewList>(t.send(t.grace, 'GET', '/console/reviews'));
    expect(mine.reviews.map((review) => review.id)).not.toContain(graces);
  });

  it('is for reviewers: a programme manager, an administrator, an applicant and a signed-out caller are refused', async () => {
    const { graces, round } = await setUp();

    for (const [method, url, body] of t.reviewerRoutes(graces, round.need.id)) {
      for (const [who, member] of [
        ['manager', t.managerA],
        ['administrator', t.adminA],
        ['applicant', t.ann],
      ] as const) {
        const status = (await t.send(member, method, url, body, 'console')).statusCode;
        expect(status, `${who} ${url}`).toBe(403);
      }
      expect((await t.send(undefined, method, url, body)).statusCode, `signed out ${url}`).toBe(
        401,
      );
    }
    expect((await t.readReview(t.grace, graces)).status).toBe('assigned');
  });
});

describe('declaring a conflict', () => {
  it('ends the assignment for good: every reviewer route answers 404, and staff see the declaration', async () => {
    const { graces, alans, round, submissionId, scores } = await setUp();
    await answer(
      t.send(t.grace, 'PUT', `/console/reviews/${graces}/scores`, scores([round.need.id, 4])),
    );

    await noContent(t.send(t.grace, 'POST', `/console/reviews/${graces}/conflict`));

    const gone = randomUUID();
    for (const [index, [method, url, body]] of t.reviewerRoutes(graces, round.need.id).entries()) {
      if (index === 0) continue;
      const [, missingUrl] = t.reviewerRoutes(gone, round.need.id)[index] ?? [];
      expectLooksMissing(
        await t.send(t.grace, method, url, body),
        await t.send(t.grace, method, missingUrl ?? '', body),
      );
    }
    const mine = await answer<ReviewList>(t.send(t.grace, 'GET', '/console/reviews'));
    expect(mine.reviews.map((review) => review.id)).not.toContain(graces);
    const { assignments } = await answer<AssignmentList>(
      t.send(t.managerA, 'GET', `/console/submissions/${submissionId}/assignments`),
    );
    expect(assignments.find((assignment) => assignment.id === graces)).toMatchObject({
      status: 'conflicted',
      scored: false,
    });
    expect(
      await t.rows('SELECT declared_by FROM grants.conflict_declaration WHERE assignment_id = $1', [
        graces,
      ]),
    ).toEqual([{ declared_by: t.grace.membershipId }]);
    const declared = (await events(t.tenantA, 'grants.assignment.conflict_declared')).filter(
      (event) => event.entity_id === graces,
    );
    expect(declared).toHaveLength(1);
    expect(declared[0]).toMatchObject({
      actor_id: t.grace.membershipId,
      changes: { 'grants.assignment.status': { before: 'assigned', after: 'conflicted' } },
    });
    // The other reviewer is unaffected.
    expect((await t.readReview(t.alan, alans)).status).toBe('assigned');
  });

  it('is refused once the review is submitted', async () => {
    const { graces, round, scores } = await setUp();
    await answer(
      t.send(
        t.grace,
        'POST',
        `/console/reviews/${graces}/submit`,
        scores([round.need.id, 4], [round.impact.id, 2]),
      ),
    );

    const refused = await t.send(t.grace, 'POST', `/console/reviews/${graces}/conflict`);

    expect(refused.statusCode).toBe(409);
    expect((await t.readReview(t.grace, graces)).status).toBe('submitted');
    expect(await events(t.tenantA, 'grants.assignment.conflict_declared')).not.toContainEqual(
      expect.objectContaining({ entity_id: graces }),
    );
  });
});

describe('scoring a review', () => {
  it('saves a draft as a set that replaces the last, in the order of the criteria, without auditing it', async () => {
    const { graces, round, scores } = await setUp();
    const before = (await events(t.tenantA, 'grants.review.submitted')).length;

    const saved = await answer<ReviewScores>(
      t.send(t.grace, 'PUT', `/console/reviews/${graces}/scores`, {
        scores: [
          { criterionId: round.impact.id, score: 2, comment: 'Thin on delivery.' },
          { criterionId: round.need.id, score: 5, comment: '' },
        ],
      }),
    );
    expect(saved.scores).toEqual([
      { criterionId: round.need.id, score: 5, comment: '' },
      { criterionId: round.impact.id, score: 2, comment: 'Thin on delivery.' },
    ]);
    expect((await t.readReview(t.grace, graces)).progress).toEqual({ scored: 2, total: 2 });

    await answer(
      t.send(t.grace, 'PUT', `/console/reviews/${graces}/scores`, scores([round.need.id, 3])),
    );
    const review = await t.readReview(t.grace, graces);
    expect(review.scores).toEqual([{ criterionId: round.need.id, score: 3, comment: '' }]);
    expect(review.progress).toEqual({ scored: 1, total: 2 });
    expect(review.status).toBe('assigned');
    expect((await events(t.tenantA, 'grants.review.submitted')).length).toBe(before);
    // Another reviewer's draft is their own.
    expect(
      (
        await t.readReview(
          t.alan,
          (await t.assignmentsOf(review.applicationId)).get(t.alan.membershipId) ?? '',
        )
      ).scores,
    ).toEqual([]);
  });

  it('refuses a score outside the criterion’s scale, an unknown criterion and a bad body, saving nothing', async () => {
    const { graces, round, scores } = await setUp();
    const other = (await t.reviewRound()).need.id;
    await answer(
      t.send(t.grace, 'PUT', `/console/reviews/${graces}/scores`, scores([round.need.id, 3])),
    );
    const put = (body: unknown) =>
      t.send(t.grace, 'PUT', `/console/reviews/${graces}/scores`, body);

    const low = await put(scores([round.need.id, 0]));
    expect(low.statusCode).toBe(400);
    expect(low.json<Problem>().errors).toEqual([
      { field: 'body.scores.0.score', message: 'Enter a score from 1 to 5.' },
    ]);
    const high = await put(scores([round.need.id, 4], [round.impact.id, 6]));
    expect(high.json<Problem>().errors?.map((e) => e.field)).toEqual(['body.scores.1.score']);
    const unknown = await put(scores([other, 3]));
    expect(unknown.json<Problem>().errors?.map((e) => e.field)).toEqual([
      'body.scores.0.criterionId',
    ]);
    for (const body of [
      scores([round.need.id, 11]),
      scores([round.need.id, -1]),
      scores([round.need.id, 2.5]),
      scores([round.need.id, 2], [round.need.id, 3]),
      { scores: [{ criterionId: round.need.id, score: 2 }], extra: true },
      { scores: [{ criterionId: 'x', score: 2 }] },
    ]) {
      expect((await put(body)).statusCode).toBe(400);
    }
    expect((await t.readReview(t.grace, graces)).scores).toEqual([
      { criterionId: round.need.id, score: 3, comment: '' },
    ]);
  });

  it('submits only with every criterion scored, then fixes the scores and audits the submission', async () => {
    const { graces, round, scores } = await setUp();
    const url = (tail: string) => `/console/reviews/${graces}/${tail}`;

    const incomplete = await t.send(t.grace, 'POST', url('submit'), scores([round.need.id, 4]));
    expect(incomplete.statusCode).toBe(400);
    expect(incomplete.json<Problem>().errors).toEqual([
      { field: 'body.scores', message: 'Score every criterion before you submit.' },
    ]);
    expect((await t.readReview(t.grace, graces)).status).toBe('assigned');

    const done = await answer<ReviewSummary>(
      t.send(t.grace, 'POST', url('submit'), scores([round.need.id, 4], [round.impact.id, 2])),
    );
    expect(done).toMatchObject({
      id: graces,
      status: 'submitted',
      progress: { scored: 2, total: 2 },
      submittedAt: expect.stringMatching(/Z$/) as string,
    });
    const submitted = (await events(t.tenantA, 'grants.review.submitted')).filter(
      (event) => event.entity_id === graces,
    );
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({
      actor_id: t.grace.membershipId,
      changes: { 'grants.assignment.status': { before: 'assigned', after: 'submitted' } },
    });

    for (const [method, tail] of [
      ['PUT', 'scores'],
      ['POST', 'submit'],
    ] as const) {
      const refused = await t.send(
        t.grace,
        method,
        url(tail),
        scores([round.need.id, 1], [round.impact.id, 1]),
      );
      expect(refused.statusCode, tail).toBe(409);
    }
    const review = await t.readReview(t.grace, graces);
    expect(review.scores.map((s) => s.score)).toEqual([4, 2]);
    expect(
      (await events(t.tenantA, 'grants.review.submitted')).filter(
        (event) => event.entity_id === graces,
      ),
    ).toHaveLength(1);
  });
});
