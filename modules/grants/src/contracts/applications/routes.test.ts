// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkRoute, projectedAnswersSchemas } from '@pixel-scientists/domain/api';
import { permissions, scopeRules } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { applicationSchema, applicationSummarySchema } from './answers.ts';
import * as applications from './routes.ts';
import { applicantOutcomeSchema } from './status.ts';

const routes = Object.values(applications.applicationRoutes);
const ID = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';

/** Each property's path in a JSON Schema, by property names. */
function propertyPaths(node: unknown, path: string[] = []): string[][] {
  if (typeof node !== 'object' || node === null) return [];
  if (Array.isArray(node)) return node.flatMap((child) => propertyPaths(child, path));
  return Object.entries(node as Record<string, unknown>).flatMap(([key, child]) =>
    key === 'properties' && typeof child === 'object' && child !== null
      ? Object.entries(child as Record<string, unknown>).flatMap(([name, value]) => [
          [...path, name],
          ...propertyPaths(value, [...path, name]),
        ])
      : propertyPaths(child, path),
  );
}

const DECISION_WORDS = /stage|score|review|decision|feedback|release|outcome|assess|budget|late/i;

describe('application routes', () => {
  it('keep every route rule', () => {
    for (const route of routes) expect(checkRoute(route), route.path).toEqual([]);
  });

  it('are all listed in applicationRoutes', () => {
    const exported = Object.values(applications).filter(
      (value) => typeof value === 'object' && 'audience' in value,
    );
    expect(new Set(exported)).toEqual(new Set(routes));
  });

  it('let applicants reach open rounds and their own applications, and nothing else', () => {
    expect(permissions['grants.applications.apply'].scopes).toEqual([
      'own_application',
      'open_round',
    ]);
    expect(scopeRules.open_round).toEqual({ module: 'grants', app: 'portal' });
    for (const route of routes) {
      expect(route, route.path).toMatchObject({
        audience: 'portal',
        module: 'grants',
        permission: 'grants.applications.apply',
        scope: route.path.startsWith('/portal/rounds') ? 'open_round' : 'own_application',
      });
    }
  });

  it('cover finding a round, starting, saving, checking, submitting and withdrawing', () => {
    expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      'GET /portal/rounds',
      'GET /portal/rounds/:roundId',
      'POST /portal/rounds/:roundId/applications',
      'GET /portal/applications',
      'GET /portal/applications/:applicationId',
      'PUT /portal/applications/:applicationId/answers',
      'POST /portal/applications/:applicationId/eligibility-check',
      'POST /portal/applications/:applicationId/submit',
      'POST /portal/applications/:applicationId/withdraw',
    ]);
  });

  it('take strict inputs that never name the applicant', () => {
    const { startApplication, saveApplicationAnswers, submitApplication } = applications;
    expect(startApplication.body.safeParse({ organisationId: ID }).success).toBe(true);
    for (const extra of [{ personId: ID }, { applicantPersonId: ID }, { roundId: ID }]) {
      expect(startApplication.body.safeParse({ organisationId: ID, ...extra }).success).toBe(false);
    }
    const save = { basedOn: 3, answers: { f_name: 'Northfield Trust', f_amount: null } };
    expect(saveApplicationAnswers.body.parse(save)).toEqual(save);
    for (const bad of [
      { ...save, basedOn: 0 },
      { ...save, basedOn: 1.5 },
      { answers: save.answers },
      { ...save, answers: { name: 'x' } },
      { ...save, status: 'submitted' },
    ]) {
      expect(saveApplicationAnswers.body.safeParse(bad).success).toBe(false);
    }
    expect(submitApplication.body.safeParse({ basedOn: 3 }).success).toBe(true);
    expect(submitApplication.body.safeParse({ basedOn: 3, late: false }).success).toBe(false);
    for (const route of routes) {
      if ('params' in route) {
        expect(route.params.safeParse({ roundId: 'x', applicationId: 'x' }).success).toBe(false);
      }
    }
  });
});

describe('portal responses', () => {
  it('carry no decision, stage, score or reviewer field outside the outcome', () => {
    for (const route of routes) {
      for (const schema of Object.values(route.responses)) {
        const paths = propertyPaths(z.toJSONSchema(schema, { io: 'output' }));
        const outside = paths
          .map((path) => path.slice(0, path.indexOf('outcome') + 1 || undefined))
          .filter((path) => path.some((name) => DECISION_WORDS.test(name) && name !== 'outcome'));
        expect(outside, route.path).toEqual([]);
        expect(paths.some((path) => path.includes('amount') && !path.includes('outcome'))).toBe(
          false,
        );
      }
    }
  });

  it('hold the outcome only as applicantOutcome() gives it, and answers projected for the applicant', () => {
    expect(applicationSummarySchema.shape.outcome.unwrap()).toBe(applicantOutcomeSchema);
    expect(applicationSchema.shape.answers).toBe(projectedAnswersSchemas.applicant);
  });

  it('drop any field they do not declare', () => {
    const view = {
      id: ID,
      round: {
        id: ID,
        title: 'Spring 2027',
        programmeTitle: 'Community Spaces Fund',
        closesAt: '2027-03-01T17:00',
        timeZone: 'Europe/London',
      },
      organisation: { id: ID, name: 'Northfield Community Trust' },
      status: 'under_review',
      updatedAt: '2027-02-20T10:00:00Z',
      submittedAt: '2027-02-21T10:00:00Z',
      outcome: null,
      form: {
        id: ID,
        definition: {
          sections: [
            {
              id: 's_about',
              title: 'About you',
              fields: [{ id: 'f_name', type: 'short_text', label: 'Name' }],
            },
          ],
        },
      },
      answers: { f_name: 'Northfield Community Trust' },
      answersVersion: 4,
      eligibility: { status: 'eligible' },
      withdrawnAt: null,
    };
    const leaked = {
      ...view,
      stage: { id: ID, name: 'Review' },
      score: 4.2,
      decision: { outcome: 'accepted', released: false },
      submittedLate: true,
      eligibility: { status: 'eligible', checkedBy: ID },
    };
    const parsed = applicationSchema.parse(leaked);
    for (const key of ['stage', 'score', 'decision', 'submittedLate']) {
      expect(parsed).not.toHaveProperty(key);
    }
    expect(parsed.eligibility).toEqual({ status: 'eligible' });
    expect(applicationSchema.safeParse({ ...view, outcome: { result: 'accepted' } }).success).toBe(
      false,
    );
  });
});
