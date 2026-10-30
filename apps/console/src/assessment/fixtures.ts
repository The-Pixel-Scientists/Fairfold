// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Test helpers for the assessment screens: a round's reviewers, assignments,
// reviews and scores as the API would answer, and the requests the screens
// make. Not part of the app.

import { projectedAnswersSchemas } from '@pixel-scientists/domain/api';
import type {
  Assignment,
  Review,
  ReviewSummary,
  SpreadRow,
  SubmissionScores,
} from '@pixel-scientists/grants/contracts';
import { screen } from '@testing-library/react';

import { stored } from '../forms/fixtures.ts';
import { ids, manager as managerSession, ok, stages } from '../programme/fixtures.ts';
import type { Handlers } from '../programme/fixtures.ts';
import { consoleSession } from '../testing/api.ts';

export { ids, ok, stages };
export type { Handlers };

/** A valid id for the nth thing a test makes up. */
export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const manager = managerSession;

/** A reviewer: someone who holds `grants.reviews.score` and nothing else. */
export const reviewer = () => ({
  'GET /auth/session': ok(consoleSession({ roles: ['reviewer'] })),
});

export const heading = (name: string) => screen.findByRole('heading', { level: 1, name });

export const people = {
  priya: { membershipId: uuid(11), name: 'Priya Shah' },
  tom: { membershipId: uuid(12), name: 'Tom Okafor' },
  hannah: { membershipId: uuid(13), name: 'Hannah Lewis' },
  owen: { membershipId: uuid(14), name: null },
} as const;

/** The Review stage's criteria, which the fixtures' programme already holds. */
export const criteria = stages.find((stage) => stage.id === ids.review)?.criteria ?? [];

export const api = {
  pool: `GET /console/rounds/${ids.round}/reviewers`,
  addToPool: `POST /console/rounds/${ids.round}/reviewers`,
  candidates: `GET /console/rounds/${ids.round}/reviewer-candidates`,
  removeFromPool: (membershipId: string) =>
    `DELETE /console/rounds/${ids.round}/reviewers/${membershipId}`,
  round: `GET /console/rounds/${ids.round}`,
  programme: `GET /console/programmes/${ids.programme}`,
  assignments: (submissionId: string) => `GET /console/submissions/${submissionId}/assignments`,
  assign: (stageId = ids.review) => `POST /console/stages/${stageId}/assignments`,
  automatic: (stageId = ids.review) => `POST /console/stages/${stageId}/assignments/automatic`,
  unassign: (assignmentId: string) => `DELETE /console/assignments/${assignmentId}`,
  reviews: 'GET /console/reviews',
  review: (id: string) => `GET /console/reviews/${id}`,
  conflict: (id: string) => `POST /console/reviews/${id}/conflict`,
  save: (id: string) => `PUT /console/reviews/${id}/scores`,
  submit: (id: string) => `POST /console/reviews/${id}/submit`,
  spread: `GET /console/rounds/${ids.round}/score-spread`,
  scores: (submissionId: string) => `GET /console/submissions/${submissionId}/scores`,
} as const;

export const assignment = (n: number, change: Partial<Assignment> = {}): Assignment => ({
  id: uuid(500 + n),
  submissionId: uuid(100 + n),
  stage: { id: ids.review, name: 'Review' },
  reviewer: people.priya,
  status: 'assigned',
  scored: false,
  assignedAt: '2026-10-22T09:00:00.000Z',
  submittedAt: null,
  ...change,
});

export const summary = (n: number, change: Partial<ReviewSummary> = {}): ReviewSummary => ({
  id: uuid(600 + n),
  applicationId: `3f2a9c1b-0000-4000-8000-${String(n).padStart(12, '0')}`,
  programme: { id: ids.programme, title: 'Community Spaces Fund' },
  round: { id: ids.round, title: 'Autumn 2026' },
  stage: { id: ids.review, name: 'Review' },
  status: 'assigned',
  progress: { scored: 0, total: criteria.length },
  assignedAt: '2026-10-22T09:00:00.000Z',
  submittedAt: null,
  ...change,
});

/** What a blind reviewer is sent: no question that names the applicant. */
export const blindForm = stored({
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
          maxWords: 300,
        },
      ],
    },
  ],
});

export function review(change: Partial<Review> = {}): Review {
  return {
    ...summary(1),
    form: { definition: blindForm },
    answers: projectedAnswersSchemas.blind_reviewer.parse({
      f_story: 'We serve a hot lunch to forty older people every week.',
    }),
    criteria,
    scores: [],
    ...change,
  };
}

export const spreadRow = (n: number, change: Partial<SpreadRow> = {}): SpreadRow => ({
  submissionId: uuid(100 + n),
  organisation: { id: uuid(200 + n), name: `Organisation ${String(n)}` },
  stage: { id: ids.review, name: 'Review' },
  assigned: 2,
  submitted: 2,
  totals: [3, 3.4],
  lowest: 3,
  highest: 3.4,
  range: 0.4,
  mean: 3.2,
  ...change,
});

export const submissionScores: SubmissionScores = {
  stages: [
    {
      stage: { id: ids.review, name: 'Review' },
      criteria,
      reviews: [
        {
          assignmentId: uuid(501),
          reviewer: people.priya,
          submittedAt: '2026-10-25T10:00:00.000Z',
          weightedTotal: 4.5,
          scores: [
            { criterionId: ids.need, score: 5, comment: '' },
            { criterionId: ids.approach, score: 4, comment: '' },
            { criterionId: ids.value, score: 4, comment: '' },
          ],
        },
        {
          assignmentId: uuid(502),
          reviewer: people.tom,
          submittedAt: '2026-10-25T11:00:00.000Z',
          weightedTotal: 2.4,
          scores: [
            { criterionId: ids.need, score: 2, comment: '' },
            { criterionId: ids.approach, score: 3, comment: '' },
            { criterionId: ids.value, score: 3, comment: '' },
          ],
        },
      ],
    },
  ],
};
