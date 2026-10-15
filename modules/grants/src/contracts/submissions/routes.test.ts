// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkRoute, projectedAnswersSchemas } from '@pixel-scientists/domain/api';
import { describe, expect, it } from 'vitest';

import { submissionPageSchema, submissionSchema } from './answers.ts';
import { MAX_STAGE_MOVE } from './inputs.ts';
import * as submissions from './routes.ts';

const routes = Object.values(submissions.submissionRoutes);
const ID = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';
const ids = (count: number) =>
  Array.from(
    { length: count },
    (_, index) => `5c1d2e3f-4a5b-4c6d-8e7f-${index.toString(16).padStart(12, '0')}`,
  );

describe('submission routes', () => {
  it('keep every route rule', () => {
    for (const route of routes) expect(checkRoute(route), route.path).toEqual([]);
  });

  it('are all listed in submissionRoutes', () => {
    const exported = Object.values(submissions).filter(
      (value) => typeof value === 'object' && 'audience' in value,
    );
    expect(new Set(exported)).toEqual(new Set(routes));
  });

  it('let staff read any submission in their tenant, and triage move them', () => {
    expect(routes.map((route) => [`${route.method} ${route.path}`, route.permission])).toEqual([
      ['GET /console/submissions', 'grants.applications.read'],
      ['GET /console/submissions/:submissionId', 'grants.applications.read'],
      ['POST /console/stages/:stageId/submissions', 'grants.applications.triage'],
    ]);
    for (const route of routes) {
      expect(route).toMatchObject({ audience: 'console', module: 'grants', scope: 'tenant' });
    }
  });
});

describe('submission filters', () => {
  const { query } = submissions.listSubmissions;

  it('take programme, round, stage, status, eligibility, late and a cursor', () => {
    expect(
      query.parse({
        programmeId: ID,
        roundId: ID,
        stageId: ID,
        status: 'withdrawn',
        eligibility: 'stopped',
        late: 'true',
        cursor: 'abc_123',
      }),
    ).toEqual({
      programmeId: ID,
      roundId: ID,
      stageId: ID,
      status: 'withdrawn',
      eligibility: 'stopped',
      late: true,
      cursor: 'abc_123',
    });
    expect(query.parse({})).toEqual({});
  });

  it('refuse answer fields, unknown keys and drafts', () => {
    for (const bad of [
      { f_region: 'north' },
      { answers: 'north' },
      { score: '4' },
      { sort: 'organisation' },
      { search: 'Northfield' },
      { status: 'draft' },
      { eligibility: 'incomplete' },
      { roundId: 'spring' },
      { cursor: 'a b' },
    ]) {
      expect(query.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('moving submissions to a stage', () => {
  const { body } = submissions.moveSubmissionsToStage;

  it(`takes 1 to ${String(MAX_STAGE_MOVE)} submissions, each once`, () => {
    expect(MAX_STAGE_MOVE).toBe(200);
    expect(body.safeParse({ submissionIds: ids(200) }).success).toBe(true);
    for (const bad of [
      { submissionIds: [] },
      { submissionIds: ids(201) },
      { submissionIds: [ID, ID] },
      { submissionIds: [ID], stageId: ID },
      { submissionIds: ['x'] },
    ]) {
      expect(body.safeParse(bad).success).toBe(false);
    }
  });
});

describe('submission responses', () => {
  it('carry answers projected for staff, and never a draft', () => {
    expect(submissionSchema.shape.answers).toBe(projectedAnswersSchemas.staff);
    expect(submissionSchema.shape.status.options).toEqual(['submitted', 'withdrawn']);
  });

  it('drop any field they do not declare', () => {
    const row = {
      id: ID,
      programme: { id: ID, title: 'Community Spaces Fund' },
      round: { id: ID, title: 'Spring 2027' },
      stage: { id: ID, name: 'Intake' },
      organisation: { id: ID, name: 'Northfield Community Trust' },
      status: 'submitted',
      submittedAt: '2027-02-21T10:00:00Z',
      late: false,
      eligibility: 'eligible',
    };
    const page = submissionPageSchema.parse({
      submissions: [{ ...row, answers: { f_region: 'north' }, applicantPersonId: ID }],
      total: 1,
      nextCursor: null,
    });
    expect(page.submissions).toEqual([row]);
  });
});
