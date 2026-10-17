// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Recording decisions through the whole API against the test database, as
// app_api: one and in bulk, inside the round's award range, privately and
// with an audit event each. Only programme managers record and read them,
// within their own tenant.

import { randomUUID } from 'node:crypto';

import type { DecisionList } from '@pixel-scientists/grants/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  accepted,
  declined,
  pounds,
  startDecisionsApi,
  waitlisted,
  type DecisionsApi,
} from './decisions-api.ts';
import { answer, programmeBody, roundBody, type Problem } from './programme-api.ts';
import { expectLooksMissing } from './support.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

let t: DecisionsApi;

beforeAll(async () => {
  t = await startDecisionsApi('41050');
}, 60_000);

afterAll(async () => {
  await t.close();
});

/** A round with one submission in its review stage. */
async function oneSubmission() {
  const round = await t.reviewRound();
  return { round, roundId: round.open.round.id, submissionId: await t.submission(round) };
}

describe('recording a decision', () => {
  it('records an award privately, with its audit event, and changes it while unreleased', async () => {
    const { roundId, submissionId } = await oneSubmission();

    const first = await t.recorded(submissionId, accepted(15_000));
    expect(first).toMatchObject({
      outcome: 'accepted',
      amount: pounds(15_000),
      releasedAt: null,
    });
    const [row] = await t.decisions<{ id: string; released_at: Date | null }>(
      'd.application_id = $1',
      [submissionId],
    );
    expect(row?.released_at).toBeNull();
    const [event] = await t.events<{ actor_id: string; changes: object }>(
      'grants.decision.recorded',
      [row?.id ?? ''],
    );
    expect(event).toMatchObject({
      actor_id: t.managerA.membershipId,
      changes: {
        'grants.decision.outcome': { before: null, after: 'accepted' },
        'grants.decision.amount_minor': { before: null, after: 1_500_000 },
      },
    });

    const second = await t.recorded(submissionId, declined);
    expect(second).toMatchObject({ outcome: 'declined', amount: null, releasedAt: null });
    const [changed] = await t.events<{ changes: object }>('grants.decision.changed', [
      row?.id ?? '',
    ]);
    expect(changed?.changes).toEqual({
      'grants.decision.outcome': { before: 'accepted', after: 'declined' },
      'grants.decision.amount_minor': { before: 1_500_000, after: null },
    });
    // Nothing was sent, and no email row exists.
    expect(t.sent).toEqual([]);
    expect(await t.emails([submissionId])).toEqual([]);
    expect((await t.list(roundId)).unsentEmails).toBe(0);
  });

  it('records the same decision twice as one change, and a waiting list entry has no amount', async () => {
    const { submissionId } = await oneSubmission();
    await t.recorded(submissionId, waitlisted);
    await t.recorded(submissionId, waitlisted);

    const [row] = await t.decisions<{ id: string }>('d.application_id = $1', [submissionId]);
    expect(await t.events('grants.decision.recorded', [row?.id ?? ''])).toHaveLength(1);
    expect(await t.events('grants.decision.changed', [row?.id ?? ''])).toHaveLength(0);

    const bad = await t.record(submissionId, { outcome: 'waitlisted', amount: pounds(15_000) });
    expect(bad.statusCode).toBe(400);
  });

  it('keeps an award inside the round range, naming the amount', async () => {
    const { submissionId } = await oneSubmission();
    for (const amount of [999, 25_001]) {
      const response = await t.record(submissionId, accepted(amount));
      expect(response.statusCode).toBe(400);
      expect(response.json<Problem>().errors).toEqual([
        { field: 'body.amount', message: 'Enter an amount between £1,000 and £25,000.' },
      ]);
    }
    expect(await t.decisions('d.application_id = $1', [submissionId])).toEqual([]);
    expect((await t.record(submissionId, accepted(1_000))).statusCode).toBe(200);
    expect((await t.record(submissionId, accepted(25_000))).statusCode).toBe(200);
  });

  it('records only for submitted applications', async () => {
    const round = await t.reviewRound();
    const draft = await t.aDraft(t.ann, round.open.round.id);
    expect((await t.record(draft.id, declined)).statusCode).toBe(404);

    const withdrawn = await t.submission(round);
    await answer(t.send(t.ann, 'POST', t.path(withdrawn, '/withdraw')));
    const response = await t.record(withdrawn, declined);
    expect(response.statusCode).toBe(409);
    expect(response.json<Problem>().detail).toMatch(/withdrawn/);
    expect(await t.decisions('d.application_id = ANY($1)', [[draft.id, withdrawn]])).toEqual([]);
  });

  it('records a bulk request all or nothing, and in one change each', async () => {
    const round = await t.reviewRound();
    const roundId = round.open.round.id;
    const [a, b, c] = [
      await t.submission(round),
      await t.submission(round),
      await t.submission(round),
    ];
    const path = t.roundPath(roundId);

    const refused = await t.send(t.managerA, 'POST', path, {
      decisions: [
        { submissionId: a, decision: accepted(10_000) },
        { submissionId: b, decision: accepted(90_000) },
        { submissionId: randomUUID(), decision: declined },
      ],
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json<Problem>().errors).toEqual([
      {
        field: 'body.decisions.1.decision.amount',
        message: 'Enter an amount between £1,000 and £25,000.',
      },
    ]);
    expect(await t.decisions('d.application_id = ANY($1)', [[a, b, c]])).toEqual([]);

    const missing = await t.send(t.managerA, 'POST', path, {
      decisions: [
        { submissionId: a, decision: declined },
        { submissionId: randomUUID(), decision: declined },
      ],
    });
    expect(missing.statusCode).toBe(409);
    expect(missing.json<Problem>().errors?.map((error) => error.field)).toEqual([
      'body.decisions.1.decision',
    ]);
    expect(await t.decisions('d.application_id = ANY($1)', [[a, b, c]])).toEqual([]);

    const done = await answer<{ recorded: number }>(
      t.send(t.managerA, 'POST', path, {
        decisions: [
          { submissionId: a, decision: accepted(10_000) },
          { submissionId: b, decision: waitlisted },
          { submissionId: c, decision: declined },
        ],
      }),
    );
    expect(done).toEqual({ recorded: 3 });
    expect(await t.decisions('d.application_id = ANY($1)', [[a, b, c]])).toHaveLength(3);
    const ids = (await t.decisions<{ id: string }>('d.application_id = ANY($1)', [[a, b, c]])).map(
      (row) => row.id,
    );
    expect(await t.events('grants.decision.recorded', ids)).toHaveLength(3);
  });

  it('refuses a submission of another round in a bulk request', async () => {
    const one = await oneSubmission();
    const other = await oneSubmission();
    const response = await t.send(t.managerA, 'POST', t.roundPath(one.roundId), {
      decisions: [{ submissionId: other.submissionId, decision: declined }],
    });
    expect(response.statusCode).toBe(409);
    expect(await t.decisions('d.application_id = $1', [other.submissionId])).toEqual([]);
  });
});

describe('the round decision list', () => {
  it('shows mean scores, decisions, the total awarded against the budget, and unsent emails', async () => {
    const round = await t.reviewRound();
    const [s1, s2, s3] = [
      await t.submission(round),
      await t.submission(round),
      await t.submission(round),
    ];
    await answer(t.pool(round.open, t.grace, t.alan));
    await answer(t.assign(round.review.id, [s1, s3], t.grace, t.alan));
    const score = async (
      submissionId: string,
      member: typeof t.grace,
      need: number,
      impact: number,
    ) => {
      const id = (await t.assignmentsOf(submissionId)).get(member.membershipId);
      await answer(
        t.send(member, 'POST', `/console/reviews/${id}/submit`, {
          scores: [
            { criterionId: round.need.id, score: need, comment: '' },
            { criterionId: round.impact.id, score: impact, comment: '' },
          ],
        }),
      );
    };
    // Need weighs 2 and Impact 1: 4 and 2 total 3.33, 5 and 5 total 5, and 1 and 2 total 1.33.
    await score(s1, t.grace, 4, 2);
    await score(s1, t.alan, 5, 5);
    await score(s3, t.grace, 1, 2);
    // Over the round's budget of £50,000: shown, not refused.
    await t.recorded(s1, accepted(25_000));
    await t.recorded(s2, accepted(25_000));
    await t.recorded(s3, accepted(10_000));

    const listed: DecisionList = await t.list(round.open.round.id);

    expect(listed.submissions.map((row) => [row.submissionId, row.meanScore, row.reviews])).toEqual(
      [
        [s1, 4.17, 2],
        [s3, 1.33, 1],
        [s2, null, 0],
      ],
    );
    expect(listed.round).toMatchObject({
      title: round.open.round.title,
      budget: pounds(50_000),
      awardMinimum: pounds(1_000),
      awardMaximum: pounds(25_000),
    });
    expect(listed.awarded).toEqual(pounds(60_000));
    expect(listed.unsentEmails).toBe(0);
    expect(listed.submissions[0]).toMatchObject({
      decision: { outcome: 'accepted', amount: pounds(25_000), releasedAt: null },
      email: null,
      stage: { id: round.review.id },
    });
  });

  it('leaves out drafts and withdrawn applications', async () => {
    const round = await t.reviewRound();
    const draft = await t.aDraft(t.ann, round.open.round.id);
    const withdrawn = await t.submission(round);
    await answer(t.send(t.ann, 'POST', t.path(withdrawn, '/withdraw')));
    const kept = await t.submission(round);

    const ids = (await t.list(round.open.round.id)).submissions.map((row) => row.submissionId);

    expect(ids).toEqual([kept]);
    expect(ids).not.toContain(draft.id);
  });
});

describe('the email preview', () => {
  it("fills the programme's latest template with the applicant's name and organisation", async () => {
    const { submissionId } = await oneSubmission();
    await t.personOf(t.ann, 'Ada', `ada-${randomUUID()}@example.org`);
    await t.recorded(submissionId, accepted(15_000));

    const preview = await answer<{ subject: string; body: string }>(
      t.send(t.managerA, 'GET', `${t.decisionPath(submissionId)}/email`),
    );

    expect(preview.subject).toMatch(/^Community Spaces Fund: we are offering you a grant$/);
    expect(preview.body).toContain('Dear Ada,');
    expect(preview.body).toContain('for Northfield Allotment Society.');
    expect(preview.body).toContain('a grant of £15,000.');
    expect(preview.body).not.toContain('{{');
    expect(t.sent).toEqual([]);
  });

  it('is a 404 until a decision is recorded', async () => {
    const { submissionId } = await oneSubmission();
    expect(
      (await t.send(t.managerA, 'GET', `${t.decisionPath(submissionId)}/email`)).statusCode,
    ).toBe(404);
  });
});

describe('who may use the decision routes', () => {
  it('refuses a reviewer, an applicant and a signed-out caller on every route', async () => {
    const { roundId, submissionId } = await oneSubmission();
    const routes: [Parameters<typeof t.send>[1], string, unknown][] = [
      ['GET', t.roundPath(roundId), undefined],
      ['PUT', t.decisionPath(submissionId), declined],
      ['POST', t.roundPath(roundId), { decisions: [{ submissionId, decision: declined }] }],
      ['GET', `${t.decisionPath(submissionId)}/email`, undefined],
      ['POST', t.roundPath(roundId, '/release'), { release: 'all' }],
      ['POST', `/console/rounds/${roundId}/decision-emails/send`, undefined],
    ];
    for (const [method, url, body] of routes) {
      const reviewer = await t.send(t.reviewerA, method, url, body, 'console', new Date());
      expect(reviewer.statusCode, `${method} ${url} as a reviewer`).toBe(403);
      const applicant = await t.send(t.applicantA, method, url, body, 'portal', new Date());
      expect([401, 403, 404], `${method} ${url} as an applicant`).toContain(applicant.statusCode);
      expect(applicant.statusCode).not.toBe(200);
      const signedOut = await t.send(undefined, method, url, body);
      expect(signedOut.statusCode, `${method} ${url} signed out`).toBe(401);
    }
    expect(await t.decisions('d.application_id = $1', [submissionId])).toEqual([]);
  });
});

describe('another tenant', () => {
  it("cannot reach this tenant's rounds or submissions, and the refusal reads as a missing one", async () => {
    const { roundId, submissionId } = await oneSubmission();
    await t.recorded(submissionId, declined);
    const nothing = randomUUID();
    const routes: [Parameters<typeof t.send>[1], (id: string, round: string) => string, unknown][] =
      [
        ['GET', (_s, r) => t.roundPath(r), undefined],
        ['PUT', (s) => t.decisionPath(s), declined],
        ['GET', (s) => `${t.decisionPath(s)}/email`, undefined],
      ];
    for (const [method, url, body] of routes) {
      const outside = await t.send(t.managerB, method, url(submissionId, roundId), body);
      const missing = await t.send(t.managerB, method, url(nothing, nothing), body);
      expectLooksMissing(outside, missing);
    }

    // The bulk body names an id of tenant A: tenant B's round has no such submission.
    const programme = await answer<{ id: string }>(
      t.send(t.managerB, 'POST', '/console/programmes', programmeBody()),
      201,
    );
    const round = await answer<{ id: string }>(
      t.send(t.managerB, 'POST', `/console/programmes/${programme.id}/rounds`, roundBody()),
      201,
    );
    const bulk = await t.send(t.managerB, 'POST', t.roundPath(round.id), {
      decisions: [{ submissionId, decision: accepted(10_000) }],
    });
    expect(bulk.statusCode).toBe(409);
    const [kept] = await t.decisions<{ outcome: string }>('d.application_id = $1', [submissionId]);
    expect(kept?.outcome).toBe('declined');
  });
});
