// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { answersSchema } from '../../forms/answers.ts';
import { exampleAnswers, exampleForm } from '../../forms/fixture.ts';
import { checkRoute, type RouteContract } from '../route.ts';
import {
  isProjectedAnswersSchema,
  projectedAnswers,
  projectedAnswersSchemas,
  type ProjectedAnswers,
} from './projection.ts';

const answering = (answers: z.ZodType): RouteContract => ({
  audience: 'console',
  module: 'grants',
  permission: 'grants.applications.read',
  scope: 'tenant',
  method: 'GET',
  path: '/console/submissions',
  summary: 'Read answers',
  responses: { 200: z.object({ answers }) },
});

const anyShape = 'Response 200 has a union of objects, lists and plain values.';

describe('projected answers in a response', () => {
  it('are allowed only through the schemas for each audience', () => {
    for (const schema of Object.values(projectedAnswersSchemas)) {
      expect(isProjectedAnswersSchema(schema)).toBe(true);
      expect(checkRoute(answering(schema))).toEqual([]);
    }
  });

  it('are refused from any other schema, a copy, or metadata claiming the mark', () => {
    const { staff } = projectedAnswersSchemas;
    const others = [
      answersSchema,
      staff.describe('Answers'),
      staff.optional(),
      answersSchema.meta({ 'x-projected-answers': true } as never),
    ];
    for (const schema of others) {
      expect(isProjectedAnswersSchema(schema)).toBe(false);
      expect(checkRoute(answering(schema))).toEqual([anyShape]);
    }
  });

  it('still refuse anything loose beside the answers', () => {
    const route = answering(projectedAnswersSchemas.staff);
    const loose = {
      ...route,
      responses: { 200: z.object({ answers: projectedAnswersSchemas.staff, extra: z.unknown() }) },
    };
    expect(checkRoute(loose)).toEqual(['Response 200 has a value of any type.']);
  });
});

describe('projectedAnswers', () => {
  it('keeps aggregate-only answers for the applicant alone', () => {
    expect(projectedAnswers(exampleForm, exampleAnswers, 'applicant')).toHaveProperty(
      'f_ethnicity',
    );
    for (const audience of ['staff', 'reviewer', 'blind_reviewer'] as const) {
      expect(projectedAnswers(exampleForm, exampleAnswers, audience)).not.toHaveProperty(
        'f_ethnicity',
      );
    }
  });

  it('drops identity answers for blind reviewers and anything not on the form', () => {
    const blind = projectedAnswers(
      exampleForm,
      { ...exampleAnswers, f_unknown: 'x' },
      'blind_reviewer',
    );
    expect(blind).not.toHaveProperty('f_orgname');
    expect(blind).not.toHaveProperty('f_unknown');
    expect(projectedAnswersSchemas.blind_reviewer.parse(blind)).toEqual(blind);
  });

  it("gives each audience's answers a type no other audience's response takes", () => {
    const applicant = projectedAnswers(exampleForm, exampleAnswers, 'applicant');
    // @ts-expect-error The applicant's projection keeps aggregate-only answers.
    const staff: ProjectedAnswers<'staff'> = applicant;
    expect(staff).toBe(applicant);
  });
});
