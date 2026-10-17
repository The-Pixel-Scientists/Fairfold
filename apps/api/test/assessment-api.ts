// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The assessment routes for integration tests: a round with a rubric at its
// review stage, applications submitted and moved there, and reviewers in the
// tenant, with the requests the tests share.

import type {
  Assigned,
  AssignmentList,
  Review,
  ReviewerPool,
} from '@pixel-scientists/grants/contracts';

import type { LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';

import type { Mail } from '../src/modules.ts';
import { addPerson } from '../../../packages/db/test/party/fixtures.ts';
import { asMigratorIn } from '../../../packages/db/test/tenants.ts';
import {
  accounts,
  charity,
  complete,
  haveWeb,
  startApplicationsApi,
  turnover,
  web,
} from './applications-api.ts';
import { question, title } from './forms-api.ts';
import { answer, criterionBody, type Criterion, type Method, type Stage } from './programme-api.ts';
import { addMember, type Member } from './settings-api.ts';

/** Names the applicant, so blind reviewers never see it. */
const contact = question('f_contact', 'short_text', 'Contact name', { identity: true });
const internal = question('f_internal', 'short_text', 'Internal note', {
  audiences: ['applicant', 'staff'],
});
const summary = question('f_summary', 'long_text', 'Describe the project');

export const reviewFields = [
  charity,
  title,
  haveWeb,
  web,
  turnover,
  accounts,
  contact,
  internal,
  summary,
];

/** What the applicant answers, including each kind of answer a blind reviewer must not read. */
export const SECRETS = {
  contact: 'Ada Applicant-Secret',
  internal: 'Staff-only note',
  turnover: 7_654_321,
} as const;

export const reviewAnswers = {
  ...complete,
  f_turnover: SECRETS.turnover,
  f_contact: SECRETS.contact,
  f_internal: SECRETS.internal,
  f_summary: 'A new roof for the village hall',
};

export const ORGANISATION = 'Northfield Allotment Society';

/** Expects a response with no content. */
export async function noContent(response: Promise<LightMyRequestResponse>): Promise<void> {
  const answered = await response;
  expect(answered.statusCode, answered.body).toBe(204);
}

export async function startAssessmentApi(port: string, mail?: Mail) {
  const t = await startApplicationsApi(port, mail);
  const [grace, alan, edsger] = await Promise.all([
    addMember(t.tenantA, 'console', 'reviewer'),
    addMember(t.tenantA, 'console', 'reviewer'),
    addMember(t.tenantA, 'console', 'reviewer'),
  ]);
  await asMigratorIn(t.tenantA.id, (client) =>
    addPerson(client, t.tenantA, {
      user_id: grace.userId,
      given_name: 'Grace',
      family_name: 'Hopper',
    }),
  );
  const reviewerB = await addMember(t.tenantB, 'console', 'reviewer');

  type Open = Awaited<ReturnType<typeof t.openRound>>;

  /** A round whose review stage has a rubric of two criteria: Need (weight 2) and Impact (weight 1), each scored 1 to 5. */
  async function reviewRound(change: { round?: object; fields?: object[] } = {}) {
    const open = await t.openRound(t.managerA, change.fields ?? reviewFields, change);
    const [intake, review] = await t.stagesOf(open.round.id);
    if (intake === undefined || review === undefined) throw new Error('The round has no stages.');
    const rubric = await answer<Stage>(
      t.send(t.managerA, 'PUT', `/console/stages/${review.id}/rubric`, {
        criteria: [criterionBody('Need', { weight: 2 }), criterionBody('Impact', { weight: 1 })],
      }),
    );
    const [need, impact] = rubric.criteria as [Criterion, Criterion];
    return { open, intake, review, need, impact };
  }

  type ReviewRound = Awaited<ReturnType<typeof reviewRound>>;

  /** A submission from a new organisation, moved to the review stage. */
  async function submission(
    round: ReviewRound,
    applicant: Member = t.ann,
    answers: object = reviewAnswers,
  ): Promise<string> {
    const draft = await t.aDraft(applicant, round.open.round.id);
    const application = await t.saved(applicant, draft, answers);
    await answer(t.submit(applicant, application));
    await answer(
      t.send(t.managerA, 'POST', `/console/stages/${round.review.id}/submissions`, {
        submissionIds: [application.id],
      }),
    );
    return application.id;
  }

  const pool = (open: Open, ...members: Member[]) =>
    t.send(t.managerA, 'POST', `/console/rounds/${open.round.id}/reviewers`, {
      membershipIds: members.map((member) => member.membershipId),
    });

  const assign = (stageId: string, submissionIds: string[], ...members: Member[]) =>
    t.send(t.managerA, 'POST', `/console/stages/${stageId}/assignments`, {
      submissionIds,
      membershipIds: members.map((member) => member.membershipId),
    });

  /** A round, a submission in its review stage, and `members` in the pool and assigned to it. */
  async function assigned(...members: Member[]) {
    const round = await reviewRound();
    const submissionId = await submission(round);
    await answer<ReviewerPool>(pool(round.open, ...members));
    await answer<Assigned>(assign(round.review.id, [submissionId], ...members));
    return { round, submissionId };
  }

  /** The assignment id each reviewer has on the submission. */
  async function assignmentsOf(submissionId: string) {
    const { assignments } = await answer<AssignmentList>(
      t.send(t.managerA, 'GET', `/console/submissions/${submissionId}/assignments`),
    );
    return new Map(
      assignments.map((assignment) => [assignment.reviewer.membershipId, assignment.id]),
    );
  }

  const review = (member: Member, assignmentId: string) =>
    t.send(member, 'GET', `/console/reviews/${assignmentId}`);
  const readReview = (member: Member, assignmentId: string) =>
    answer<Review>(review(member, assignmentId));

  /** Every reviewer route, with a valid request for the assignment given. */
  const reviewerRoutes = (
    assignmentId: string,
    criterionId: string,
  ): [Method, string, unknown][] => {
    const scores = { scores: [{ criterionId, score: 3, comment: '' }] };
    return [
      ['GET', '/console/reviews', undefined],
      ['GET', `/console/reviews/${assignmentId}`, undefined],
      ['POST', `/console/reviews/${assignmentId}/conflict`, undefined],
      ['PUT', `/console/reviews/${assignmentId}/scores`, scores],
      ['POST', `/console/reviews/${assignmentId}/submit`, scores],
    ];
  };

  return {
    ...t,
    grace,
    alan,
    edsger,
    reviewerB,
    reviewRound,
    submission,
    pool,
    assign,
    assigned,
    assignmentsOf,
    review,
    readReview,
    reviewerRoutes,
  };
}

export type AssessmentApi = Awaited<ReturnType<typeof startAssessmentApi>>;
