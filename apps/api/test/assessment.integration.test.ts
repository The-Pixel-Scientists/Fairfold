// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The reviewer pool and manual assignment routes through the whole API
// against the test database, as app_api, for two tenants: who may set up
// reviewers, what is refused and that a refusal changes nothing, and the
// audit events each change leaves behind.

import { randomUUID } from 'node:crypto';

import type {
  Assigned,
  AssignmentList,
  ReviewerCandidates,
  ReviewerPool,
} from '@pixel-scientists/grants/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { noContent, startAssessmentApi, type AssessmentApi } from './assessment-api.ts';
import { answer, criterionBody, type Problem } from './programme-api.ts';
import { events } from './settings-api.ts';
import { expectLooksMissing } from './support.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

let t: AssessmentApi;

beforeAll(async () => {
  t = await startAssessmentApi('41040');
}, 60_000);

afterAll(async () => {
  await t.close();
});

const rows = <T extends object>(text: string, values: unknown[] = []) => t.rows<T>(text, values);

describe('the reviewer pool', () => {
  it('lists the members who can review and are not in the pool, by name', async () => {
    const { open } = await t.reviewRound();
    await answer(t.pool(open, t.alan));

    const { members } = await answer<ReviewerCandidates>(
      t.send(t.managerA, 'GET', `/console/rounds/${open.round.id}/reviewer-candidates`),
    );

    const ids = members.map((member) => member.membershipId);
    expect(ids).toContain(t.grace.membershipId);
    expect(ids).toContain(t.edsger.membershipId);
    expect(ids).not.toContain(t.alan.membershipId);
    // Not a reviewer: a programme manager, an administrator, an applicant, or another tenant's.
    for (const other of [t.managerA, t.adminA, t.applicantA, t.reviewerB]) {
      expect(ids).not.toContain(other.membershipId);
    }
    expect(members[0]).toEqual({ membershipId: t.grace.membershipId, name: 'Grace Hopper' });
    expect(members.at(-1)?.name).toBeNull();
  });

  it('adds reviewers all or none, names them, and records each in the audit log', async () => {
    const { open } = await t.reviewRound();

    const pool = await answer<ReviewerPool>(t.pool(open, t.edsger, t.grace));

    expect(pool.reviewers).toEqual([
      {
        membershipId: t.grace.membershipId,
        name: 'Grace Hopper',
        openAssignments: 0,
        assignments: 0,
      },
      { membershipId: t.edsger.membershipId, name: null, openAssignments: 0, assignments: 0 },
    ]);
    expect(
      await answer<ReviewerPool>(
        t.send(t.managerA, 'GET', `/console/rounds/${open.round.id}/reviewers`),
      ),
    ).toEqual(pool);
    const added = (await events(t.tenantA, 'grants.reviewer.added')).filter((event) =>
      [t.edsger, t.grace].some(
        (member) => event.changes['grants.reviewer.membership_id']?.after === member.membershipId,
      ),
    );
    expect(added).toHaveLength(2);
    expect(added.every((event) => event.actor_id === t.managerA.membershipId)).toBe(true);
  });

  it('refuses with 409, adding no one, anyone who cannot review, is in the pool already or is in another tenant', async () => {
    const { open } = await t.reviewRound();
    await answer(t.pool(open, t.alan));
    const before = await rows('SELECT id FROM grants.reviewer WHERE round_id = $1', [
      open.round.id,
    ]);

    const refused = await t.pool(open, t.grace, t.managerA, t.alan, t.reviewerB);

    expect(refused.statusCode).toBe(409);
    expect(refused.json<Problem>().errors?.map((error) => error.field)).toEqual([
      'body.membershipIds.1',
      'body.membershipIds.2',
      'body.membershipIds.3',
    ]);
    expect(
      await rows('SELECT id FROM grants.reviewer WHERE round_id = $1', [open.round.id]),
    ).toEqual(before);
    for (const body of [
      { membershipIds: [] },
      { membershipIds: [t.grace.membershipId, t.grace.membershipId] },
      { membershipIds: [randomUUID()], extra: 1 },
    ]) {
      expect(
        (await t.send(t.managerA, 'POST', `/console/rounds/${open.round.id}/reviewers`, body))
          .statusCode,
      ).toBe(400);
    }
  });

  it('removes a reviewer with no assignments, and refuses one with some', async () => {
    const { round, submissionId } = await t.assigned(t.grace);
    const roundId = round.open.round.id;
    await answer(t.pool(round.open, t.alan));
    const remove = (member: { membershipId: string }) =>
      t.send(t.managerA, 'DELETE', `/console/rounds/${roundId}/reviewers/${member.membershipId}`);

    const refused = await remove(t.grace);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<Problem>().detail).toContain('has assignments');
    expect((await remove(t.alan)).statusCode).toBe(204);
    expect((await remove(t.alan)).statusCode).toBe(404);

    const removed = (await events(t.tenantA, 'grants.reviewer.removed')).filter(
      (event) => event.changes['grants.reviewer.membership_id']?.before === t.alan.membershipId,
    );
    expect(removed).toHaveLength(1);
    expect([...(await t.assignmentsOf(submissionId)).keys()]).toEqual([t.grace.membershipId]);
  });

  it('is for programme managers: a reviewer, an applicant and a signed-out caller are refused', async () => {
    const { open } = await t.reviewRound();
    const routes = [
      ['GET', `/console/rounds/${open.round.id}/reviewers`, undefined],
      ['GET', `/console/rounds/${open.round.id}/reviewer-candidates`, undefined],
      [
        'POST',
        `/console/rounds/${open.round.id}/reviewers`,
        { membershipIds: [t.grace.membershipId] },
      ],
      ['DELETE', `/console/rounds/${open.round.id}/reviewers/${t.grace.membershipId}`, undefined],
    ] as const;
    for (const [method, url, body] of routes) {
      expect((await t.send(t.grace, method, url, body)).statusCode, `reviewer ${url}`).toBe(403);
      expect((await t.send(t.adminA, method, url, body)).statusCode, `admin ${url}`).toBe(403);
      expect(
        (await t.send(t.ann, method, url, body, 'console')).statusCode,
        `applicant ${url}`,
      ).toBe(403);
      expect((await t.send(undefined, method, url, body)).statusCode, `signed out ${url}`).toBe(
        401,
      );
    }
    expect(
      await rows('SELECT id FROM grants.reviewer WHERE round_id = $1', [open.round.id]),
    ).toEqual([]);
  });

  it('shows nothing of another tenant: its rounds read as missing, and its members cannot be added', async () => {
    const { open } = await t.reviewRound();
    for (const [method, tail, body] of [
      ['GET', 'reviewers', undefined],
      ['GET', 'reviewer-candidates', undefined],
      ['POST', 'reviewers', { membershipIds: [t.reviewerB.membershipId] }],
    ] as const) {
      const outside = await t.send(
        t.managerB,
        method,
        `/console/rounds/${open.round.id}/${tail}`,
        body,
      );
      const missing = await t.send(
        t.managerB,
        method,
        `/console/rounds/${randomUUID()}/${tail}`,
        body,
      );
      expectLooksMissing(outside, missing);
    }
    const outside = await t.send(
      t.managerB,
      'DELETE',
      `/console/rounds/${open.round.id}/reviewers/${t.grace.membershipId}`,
    );
    expect(outside.statusCode).toBe(404);
    expect(
      await rows('SELECT id FROM grants.reviewer WHERE membership_id = $1', [
        t.reviewerB.membershipId,
      ]),
    ).toEqual([]);
  });
});

describe('assigning reviewers by hand', () => {
  it('assigns every reviewer to every submission, audits each assignment, and lists them with names', async () => {
    const round = await t.reviewRound();
    const [a, b] = [await t.submission(round), await t.submission(round)];
    await answer(t.pool(round.open, t.grace, t.alan));

    expect(await answer<Assigned>(t.assign(round.review.id, [a, b], t.grace, t.alan))).toEqual({
      assigned: 4,
    });

    const { assignments } = await answer<AssignmentList>(
      t.send(t.managerA, 'GET', `/console/submissions/${a}/assignments`),
    );
    expect(assignments).toHaveLength(2);
    expect(assignments[0]).toMatchObject({
      id: expect.any(String) as string,
      submissionId: a,
      stage: { id: round.review.id, name: round.review.name },
      reviewer: { membershipId: expect.any(String) as string },
      status: 'assigned',
      scored: false,
      assignedAt: expect.stringMatching(/Z$/) as string,
      submittedAt: null,
    });
    expect(assignments.map((x) => x.reviewer.name).sort()).toEqual(['Grace Hopper', null]);
    const created = (await events(t.tenantA, 'grants.assignment.created')).filter((event) =>
      [a, b].includes(event.changes['grants.assignment.application_id']?.after as string),
    );
    expect(created).toHaveLength(4);
    expect(created.every((event) => event.actor_id === t.managerA.membershipId)).toBe(true);
    const pool = await answer<ReviewerPool>(
      t.send(t.managerA, 'GET', `/console/rounds/${round.open.round.id}/reviewers`),
    );
    expect(pool.reviewers.map((r) => r.openAssignments)).toEqual([2, 2]);
  });

  it('refuses, assigning no one, a reviewer outside the pool, one already assigned, and one in conflict', async () => {
    const round = await t.reviewRound();
    const [a, b] = [await t.submission(round), await t.submission(round)];
    await answer(t.pool(round.open, t.grace, t.alan, t.edsger));
    await answer(t.assign(round.review.id, [a], t.grace));
    await answer(t.assign(round.review.id, [a], t.alan));
    const alans = (await t.assignmentsOf(a)).get(t.alan.membershipId);
    await noContent(t.send(t.alan, 'POST', `/console/reviews/${alans}/conflict`));

    const refused = await t.assign(round.review.id, [a, b], t.edsger, t.reviewerB, t.grace, t.alan);

    expect(refused.statusCode).toBe(409);
    expect(refused.json<Problem>().errors?.map((error) => error.field)).toEqual([
      'body.membershipIds.1',
      'body.membershipIds.2',
      'body.membershipIds.3',
    ]);
    expect([...(await t.assignmentsOf(b)).keys()]).toEqual([]);
    expect([...(await t.assignmentsOf(a)).keys()].sort()).toEqual(
      [t.grace.membershipId, t.alan.membershipId].sort(),
    );
  });

  it('refuses a conflicted reviewer at another stage of the same submission', async () => {
    const round = await t.reviewRound();
    const a = await t.submission(round);
    await answer(t.pool(round.open, t.grace));
    await answer(t.assign(round.review.id, [a], t.grace));
    const id = (await t.assignmentsOf(a)).get(t.grace.membershipId);
    await noContent(t.send(t.grace, 'POST', `/console/reviews/${id}/conflict`));
    const stages = await t.stagesOf(round.open.round.id);
    const other = stages[2];
    await answer(
      t.send(t.managerA, 'PUT', `/console/stages/${other?.id}/rubric`, {
        criteria: [criterionBody('Fit')],
      }),
    );
    await answer(
      t.send(t.managerA, 'POST', `/console/stages/${other?.id}/submissions`, {
        submissionIds: [a],
      }),
    );

    const refused = await t.assign(other?.id ?? '', [a], t.grace);

    expect(refused.statusCode).toBe(409);
    expect(refused.json<Problem>().errors?.[0]?.message).toContain('conflict');
  });

  it('refuses a stage with no rubric, a draft, a withdrawn submission, one in another stage, and another tenant’s', async () => {
    const round = await t.reviewRound();
    const inStage = await t.submission(round);
    const withdrawn = await t.submission(round);
    await answer(t.send(t.ann, 'POST', t.path(withdrawn, '/withdraw')));
    const draft = await t.aDraft(t.ann, round.open.round.id);
    const elsewhere = await t.submission(round);
    await answer(
      t.send(t.managerA, 'POST', `/console/stages/${round.intake.id}/submissions`, {
        submissionIds: [elsewhere],
      }),
    );
    await answer(t.pool(round.open, t.grace));

    const noRubric = await t.assign(round.intake.id, [elsewhere], t.grace);
    expect(noRubric.statusCode).toBe(409);
    expect(noRubric.json<Problem>().detail).toContain('no rubric');

    const refused = await t.assign(
      round.review.id,
      [inStage, withdrawn, draft.id, elsewhere, randomUUID()],
      t.grace,
    );
    expect(refused.statusCode).toBe(409);
    expect(refused.json<Problem>().errors?.map((error) => error.field)).toEqual([
      'body.submissionIds.1',
      'body.submissionIds.2',
      'body.submissionIds.3',
      'body.submissionIds.4',
    ]);
    expect([...(await t.assignmentsOf(inStage)).keys()]).toEqual([]);

    // Another tenant's manager meets neither the stage nor the submissions.
    expectLooksMissing(
      await t.send(t.managerB, 'POST', `/console/stages/${round.review.id}/assignments`, {
        submissionIds: [inStage],
        membershipIds: [t.reviewerB.membershipId],
      }),
      await t.send(t.managerB, 'POST', `/console/stages/${randomUUID()}/assignments`, {
        submissionIds: [inStage],
        membershipIds: [t.reviewerB.membershipId],
      }),
    );
    expect(
      (await t.send(t.managerB, 'GET', `/console/submissions/${inStage}/assignments`)).statusCode,
    ).toBe(404);
  });

  it('removes an assignment that is not scored, and refuses one that is scored, submitted or a conflict', async () => {
    const { round, submissionId } = await t.assigned(t.grace, t.alan, t.edsger);
    const ids = await t.assignmentsOf(submissionId);
    const scored = ids.get(t.grace.membershipId) ?? '';
    const conflicted = ids.get(t.alan.membershipId) ?? '';
    const plain = ids.get(t.edsger.membershipId) ?? '';
    await answer(
      t.send(t.grace, 'PUT', `/console/reviews/${scored}/scores`, {
        scores: [{ criterionId: round.need.id, score: 3, comment: '' }],
      }),
    );
    await noContent(t.send(t.alan, 'POST', `/console/reviews/${conflicted}/conflict`));
    const remove = (id: string) => t.send(t.managerA, 'DELETE', `/console/assignments/${id}`);

    expect((await remove(scored)).statusCode).toBe(409);
    const refused = await remove(conflicted);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<Problem>().detail).toContain('conflict');
    expect((await remove(plain)).statusCode).toBe(204);
    expect((await remove(plain)).statusCode).toBe(404);

    expect([...(await t.assignmentsOf(submissionId)).values()].sort()).toEqual(
      [scored, conflicted].sort(),
    );
    const removed = await events(t.tenantA, 'grants.assignment.removed');
    expect(removed.filter((event) => event.entity_id === plain)).toHaveLength(1);
    expect(
      removed.some((event) => event.entity_id === scored || event.entity_id === conflicted),
    ).toBe(false);
  });

  it('is for programme managers, and another tenant’s manager cannot remove an assignment', async () => {
    const { round, submissionId } = await t.assigned(t.grace);
    const id = (await t.assignmentsOf(submissionId)).get(t.grace.membershipId) ?? '';
    const routes = [
      ['GET', `/console/submissions/${submissionId}/assignments`, undefined],
      [
        'POST',
        `/console/stages/${round.review.id}/assignments`,
        { submissionIds: [submissionId], membershipIds: [t.alan.membershipId] },
      ],
      [
        'POST',
        `/console/stages/${round.review.id}/assignments/automatic`,
        { submissionIds: [submissionId], reviewersPerSubmission: 1 },
      ],
      ['DELETE', `/console/assignments/${id}`, undefined],
    ] as const;
    for (const [method, url, body] of routes) {
      expect((await t.send(t.grace, method, url, body)).statusCode, `reviewer ${url}`).toBe(403);
      expect(
        (await t.send(t.ann, method, url, body, 'console')).statusCode,
        `applicant ${url}`,
      ).toBe(403);
      expect((await t.send(undefined, method, url, body)).statusCode, `signed out ${url}`).toBe(
        401,
      );
    }
    expect((await t.send(t.managerB, 'DELETE', `/console/assignments/${id}`)).statusCode).toBe(404);
    expect([...(await t.assignmentsOf(submissionId)).keys()]).toEqual([t.grace.membershipId]);
  });
});
