// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkRoute } from '@pixel-scientists/domain/api';
import { describe, expect, it } from 'vitest';

import { MAX_ASSIGN_SUBMISSIONS, MAX_POOL_ADD, MAX_REVIEWERS_PER_SUBMISSION } from './inputs.ts';
import * as assessment from './routes.ts';

const routes = Object.values(assessment.assessmentRoutes);
const ID = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';
const ids = (count: number) =>
  Array.from(
    { length: count },
    (_, index) => `5c1d2e3f-4a5b-4c6d-8e7f-${index.toString(16).padStart(12, '0')}`,
  );

describe('staff assessment routes', () => {
  it('keep every route rule', () => {
    for (const route of routes) expect(checkRoute(route), route.path).toEqual([]);
  });

  it('are all listed in assessmentRoutes', () => {
    const exported = Object.values(assessment).filter(
      (value) => typeof value === 'object' && 'audience' in value,
    );
    expect(new Set(exported)).toEqual(new Set(routes));
  });

  it('let members who assign reviews reach any round or submission in their tenant', () => {
    expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      'GET /console/rounds/:roundId/reviewers',
      'GET /console/rounds/:roundId/reviewer-candidates',
      'POST /console/rounds/:roundId/reviewers',
      'DELETE /console/rounds/:roundId/reviewers/:membershipId',
      'GET /console/submissions/:submissionId/assignments',
      'POST /console/stages/:stageId/assignments',
      'DELETE /console/assignments/:assignmentId',
    ]);
    for (const route of routes) {
      expect(route, route.path).toMatchObject({
        audience: 'console',
        module: 'grants',
        permission: 'grants.reviews.assign',
        scope: 'tenant',
      });
    }
  });
});

describe('adding reviewers to a pool', () => {
  const { body } = assessment.addReviewers;

  it(`takes 1 to ${String(MAX_POOL_ADD)} members, each once`, () => {
    expect(body.safeParse({ membershipIds: ids(MAX_POOL_ADD) }).success).toBe(true);
    for (const bad of [
      { membershipIds: [] },
      { membershipIds: ids(MAX_POOL_ADD + 1) },
      { membershipIds: [ID, ID] },
      { membershipIds: ['x'] },
      { membershipIds: [ID], roundId: ID },
    ]) {
      expect(body.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('assigning reviewers', () => {
  const { body } = assessment.assignReviewers;

  it(`takes up to ${String(MAX_ASSIGN_SUBMISSIONS)} submissions and ${String(MAX_REVIEWERS_PER_SUBMISSION)} reviewers, each once`, () => {
    expect(body.safeParse({ submissionIds: ids(200), membershipIds: ids(5) }).success).toBe(true);
    for (const bad of [
      { submissionIds: [], membershipIds: [ID] },
      { submissionIds: [ID], membershipIds: [] },
      { submissionIds: ids(201), membershipIds: [ID] },
      { submissionIds: [ID], membershipIds: ids(6) },
      { submissionIds: [ID, ID], membershipIds: [ID] },
      { submissionIds: [ID], membershipIds: [ID], stageId: ID },
    ]) {
      expect(body.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
