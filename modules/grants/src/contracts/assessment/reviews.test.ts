// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkRoute, projectedAnswersSchemas } from '@pixel-scientists/domain/api';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import * as reviews from './reviews.ts';

const routes = Object.values(reviews.reviewRoutes);
const ID = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';
const OTHER = '6d2e3f4a-5b6c-4d7e-8f90-b1c2d3e4f5a6';

/** Every property name anywhere in a schema's JSON Schema output. */
function keysOf(schema: z.ZodType): string[] {
  const keys: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (typeof node === 'object' && node !== null) {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === 'properties' && typeof value === 'object' && value !== null) {
          keys.push(...Object.keys(value));
        }
        walk(value);
      }
    }
  };
  walk(z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' }));
  return keys;
}

describe('reviewer routes', () => {
  it('keep every route rule', () => {
    for (const route of routes) expect(checkRoute(route), route.path).toEqual([]);
  });

  it('are all listed in reviewRoutes', () => {
    const exported = Object.values(reviews).filter(
      (value) => typeof value === 'object' && 'audience' in value,
    );
    expect(new Set(exported)).toEqual(new Set(routes));
  });

  it("reach only the caller's own assignments that are not conflicted", () => {
    expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      'GET /console/reviews',
      'GET /console/reviews/:assignmentId',
      'POST /console/reviews/:assignmentId/conflict',
      'PUT /console/reviews/:assignmentId/scores',
      'POST /console/reviews/:assignmentId/submit',
    ]);
    for (const route of routes) {
      expect(route, route.path).toMatchObject({
        audience: 'console',
        module: 'grants',
        permission: 'grants.reviews.score',
        scope: 'assigned_review',
      });
    }
  });
});

describe('reviewer responses', () => {
  const responses = routes.flatMap((route) =>
    Object.values(route.responses).filter((body): body is z.ZodType => body !== null),
  );

  it('carry answers projected for blind review', () => {
    expect(reviews.reviewSchema.shape.answers).toBe(projectedAnswersSchemas.blind_reviewer);
  });

  it('name no organisation, person, contact, other reviewer or decision', () => {
    const forbidden =
      /organi[sz]ation|person|contact|email|given|family|applicant|reviewer|membership|decision|outcome|award/i;
    expect(keysOf(reviews.reviewSchema)).toEqual(
      expect.arrayContaining(['applicationId', 'answers', 'criteria', 'criterionId', 'comment']),
    );
    for (const schema of responses) {
      expect(keysOf(schema).filter((key) => forbidden.test(key))).toEqual([]);
    }
  });

  it('never show a conflicted assignment', () => {
    expect(reviews.reviewSummarySchema.shape.status.options).toEqual(['assigned', 'submitted']);
  });

  it('drop any field they do not declare', () => {
    const summary = {
      id: ID,
      applicationId: OTHER,
      programme: { id: ID, title: 'Community Spaces Fund' },
      round: { id: ID, title: 'Spring 2027' },
      stage: { id: ID, name: 'Review' },
      status: 'assigned',
      progress: { scored: 1, total: 3 },
      assignedAt: '2027-03-01T09:00:00Z',
      submittedAt: null,
    };
    const list = reviews.reviewListSchema.parse({
      reviews: [
        {
          ...summary,
          organisation: { id: ID, name: 'Northfield Community Trust' },
          contact: { email: 'sam@example.org' },
          reviewers: [{ name: 'Priya Shah' }],
        },
      ],
    });
    expect(list.reviews).toEqual([summary]);
  });
});

describe('saving scores', () => {
  const { body } = reviews.saveReviewScores;
  const score = { criterionId: ID, score: 4 };

  it('takes each criterion once, with an optional comment', () => {
    expect(body.parse({ scores: [score] })).toEqual({ scores: [{ ...score, comment: '' }] });
    expect(body.parse({ scores: [] })).toEqual({ scores: [] });
    expect(
      body.parse({ scores: [{ ...score, comment: '  Clear need.\r\nGood plan.  ' }] }).scores[0]
        ?.comment,
    ).toBe('Clear need.\nGood plan.');
  });

  it('refuses a criterion twice, a score off any scale and unknown keys', () => {
    for (const bad of [
      { scores: [score, score] },
      { scores: [{ ...score, score: -1 }] },
      { scores: [{ ...score, score: 11 }] },
      { scores: [{ ...score, score: 2.5 }] },
      { scores: [{ ...score, comment: 'a'.repeat(2001) }] },
      { scores: [{ ...score, comment: 'Hidden\u202etext' }] },
      { scores: [{ ...score, assignmentId: ID }] },
      { scores: [score], submitted: true },
    ]) {
      expect(body.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('submits with the same rules, and the server checks every criterion is scored', () => {
    expect(reviews.submitReview.body).toBe(body);
  });
});
