// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Automatic assignment through the whole API against the test database, as
// app_api: reviewers with the fewest open assignments are picked, nobody is
// picked twice or against a conflict, the choice repeats, a request that
// names a bad submission assigns nothing, and each assignment is audited.

import { randomUUID } from 'node:crypto';

import type { AutomaticAssignResult } from '@pixel-scientists/grants/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { noContent, startAssessmentApi, type AssessmentApi } from './assessment-api.ts';
import { answer, type Problem } from './programme-api.ts';
import { events } from './settings-api.ts';
import { expectLooksMissing } from './support.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

let t: AssessmentApi;

beforeAll(async () => {
  t = await startAssessmentApi('41042');
}, 60_000);

afterAll(async () => {
  await t.close();
});

const automatic = (stageId: string, submissionIds: string[], reviewersPerSubmission: number) =>
  t.send(t.managerA, 'POST', `/console/stages/${stageId}/assignments/automatic`, {
    submissionIds,
    reviewersPerSubmission,
  });

/** A round with `count` submissions at its review stage and the three reviewers in the pool. */
async function pooled(count: number) {
  const round = await t.reviewRound();
  const submissions: string[] = [];
  for (let i = 0; i < count; i += 1) submissions.push(await t.submission(round));
  await answer(t.pool(round.open, t.grace, t.alan, t.edsger));
  return { round, submissions };
}

const reviewersOn = async (submissionId: string) =>
  [...(await t.assignmentsOf(submissionId)).keys()].sort();

const sorted = (...members: { membershipId: string }[]) =>
  members.map((member) => member.membershipId).sort();

describe('automatic assignment', () => {
  it('picks the pool members with the fewest open assignments, and audits each assignment', async () => {
    const { round, submissions } = await pooled(4);
    const [first, second, ...busy] = submissions as [string, string, string, string];
    // Edsger already has two open assignments in the round.
    await answer(t.assign(round.review.id, busy, t.edsger));

    const result = await answer<AutomaticAssignResult>(
      automatic(round.review.id, [first, second], 2),
    );

    expect(result).toEqual({ assigned: 4, unfilled: [] });
    expect(await reviewersOn(first)).toEqual(sorted(t.grace, t.alan));
    expect(await reviewersOn(second)).toEqual(sorted(t.grace, t.alan));
    const created = (await events(t.tenantA, 'grants.assignment.created')).filter((event) =>
      [first, second].includes(event.changes['grants.assignment.application_id']?.after as string),
    );
    expect(created).toHaveLength(4);
    expect(created.every((event) => event.actor_id === t.managerA.membershipId)).toBe(true);
  });

  it('spreads work evenly and repeats: the same state gives the same choice, ties broken by id', async () => {
    const choose = async () => {
      const { round, submissions } = await pooled(3);
      await answer(automatic(round.review.id, submissions, 1));
      return Promise.all(submissions.map(reviewersOn));
    };

    const first = await choose();
    const second = await choose();

    expect(first.flat().sort()).toEqual(sorted(t.grace, t.alan, t.edsger));
    expect(first.map(([id]) => id)).toEqual(sorted(t.grace, t.alan, t.edsger));
    expect(second).toEqual(first);
  });

  it('tops up a submission that has some reviewers, and a second run assigns nothing more', async () => {
    const { round, submissions } = await pooled(1);
    const [only] = submissions as [string];
    await answer(t.assign(round.review.id, [only], t.grace));

    expect(await answer(automatic(round.review.id, [only], 2))).toEqual({
      assigned: 1,
      unfilled: [],
    });
    expect(await reviewersOn(only)).toHaveLength(2);
    expect(await reviewersOn(only)).toContain(t.grace.membershipId);
    expect(await answer(automatic(round.review.id, [only], 2))).toEqual({
      assigned: 0,
      unfilled: [],
    });
  });

  it('never picks a reviewer in conflict on the submission, and reports what the pool cannot fill', async () => {
    const { round, submissions } = await pooled(2);
    const [a, b] = submissions as [string, string];
    await answer(t.assign(round.review.id, [a], t.alan));
    const alans = (await t.assignmentsOf(a)).get(t.alan.membershipId);
    await noContent(t.send(t.alan, 'POST', `/console/reviews/${alans}/conflict`));

    const result = await answer<AutomaticAssignResult>(automatic(round.review.id, [a], 3));

    expect(result).toEqual({ assigned: 2, unfilled: [{ submissionId: a, missing: 1 }] });
    expect(await reviewersOn(a)).toEqual(sorted(t.alan, t.grace, t.edsger));
    expect(
      await t.rows<{ status: string }>('SELECT status FROM grants.assignment WHERE id = $1', [
        alans,
      ]),
    ).toEqual([{ status: 'conflicted' }]);

    // A pool member who has lost the reviewer role is not picked.
    const setRoles = (roles: string) =>
      t.rows(`UPDATE app.membership SET roles = ARRAY['${roles}'] WHERE id = $1`, [
        t.edsger.membershipId,
      ]);
    await setRoles('applicant');
    try {
      expect(await answer(automatic(round.review.id, [b], 3))).toEqual({
        assigned: 2,
        unfilled: [{ submissionId: b, missing: 1 }],
      });
    } finally {
      await setRoles('reviewer');
    }
  });

  it('refuses, assigning nothing, a stage with no rubric and a draft, withdrawn or unknown submission', async () => {
    const { round, submissions } = await pooled(2);
    const [good, withdrawn] = submissions as [string, string];
    await answer(t.send(t.ann, 'POST', t.path(withdrawn, '/withdraw')));
    const draft = await t.aDraft(t.ann, round.open.round.id);

    const refused = await automatic(round.review.id, [good, draft.id, withdrawn, randomUUID()], 2);

    expect(refused.statusCode).toBe(409);
    expect(refused.json<Problem>().errors?.map((error) => error.field)).toEqual([
      'body.submissionIds.1',
      'body.submissionIds.2',
      'body.submissionIds.3',
    ]);
    expect(await reviewersOn(good)).toEqual([]);
    const noRubric = await automatic(round.intake.id, [good], 1);
    expect(noRubric.statusCode).toBe(409);
    expect(noRubric.json<Problem>().detail).toContain('no rubric');
    for (const body of [
      { submissionIds: [good], reviewersPerSubmission: 0 },
      { submissionIds: [good], reviewersPerSubmission: 6 },
      { submissionIds: [good, good], reviewersPerSubmission: 1 },
      { submissionIds: [], reviewersPerSubmission: 1 },
    ]) {
      const url = `/console/stages/${round.review.id}/assignments/automatic`;
      expect((await t.send(t.managerA, 'POST', url, body)).statusCode).toBe(400);
    }
  });

  it('shows another tenant nothing: its manager gets 404, as for a stage that does not exist', async () => {
    const { round, submissions } = await pooled(1);
    const send = (stageId: string) =>
      t.send(t.managerB, 'POST', `/console/stages/${stageId}/assignments/automatic`, {
        submissionIds: submissions,
        reviewersPerSubmission: 1,
      });

    expectLooksMissing(await send(round.review.id), await send(randomUUID()));
    expect(await reviewersOn(submissions[0] ?? '')).toEqual([]);
  });
});
