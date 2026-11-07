// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkRoute, type RouteContract } from '@pixel-scientists/domain/api';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import * as contracts from '../index.ts';
import { monitoringQuestions } from './questions.ts';
import * as monitoring from './routes.ts';

const routes = Object.values(monitoring.monitoringRoutes);
const ID = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';

/** The applicant's own monitoring routes: the only ones that may carry an answer or say one exists. */
const own: readonly RouteContract[] = [
  monitoring.getMonitoringForm,
  monitoring.getMonitoringResponse,
  monitoring.saveMonitoringResponse,
  monitoring.withdrawMonitoringResponse,
];

/** Every property name in a schema's JSON Schema, at any depth. */
function keys(schema: z.ZodType): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return;
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'properties' && typeof child === 'object' && child !== null) {
        found.push(...Object.keys(child));
      }
      walk(child);
    }
  };
  walk(z.toJSONSchema(schema, { io: 'output' }));
  return found;
}

describe('monitoring routes', () => {
  it('keep every route rule', () => {
    for (const route of routes) expect(checkRoute(route), route.path).toEqual([]);
  });

  it("reach only the applicant's own applications in the portal, and round set-up in the console", () => {
    for (const route of own) {
      expect(route).toMatchObject({
        audience: 'portal',
        module: 'grants',
        permission: 'grants.applications.apply',
        scope: 'own_application',
      });
    }
    for (const route of [monitoring.getRoundMonitoringForm, monitoring.setRoundMonitoringForm]) {
      expect(route).toMatchObject({
        audience: 'console',
        permission: 'grants.programmes.manage',
        scope: 'tenant',
      });
    }
  });

  it('answer with a PUT to the one response, so the answers never reach the idempotency store', () => {
    expect(monitoring.saveMonitoringResponse).toMatchObject({
      method: 'PUT',
      path: monitoring.getMonitoringResponse.path,
    });
    for (const route of routes) expect('idempotent' in route, route.path).toBe(false);
  });

  it('refuse answers without consent, and any key that names the respondent', () => {
    const { body } = monitoring.saveMonitoringResponse;
    const answer = {
      formVersionId: ID,
      answers: { f_ethnicgroup: 'prefer_not_to_say' },
      consent: true,
      privacyNoticeVersion: '2026-11',
    };
    expect(body.parse(answer)).toEqual(answer);
    const refused = body.safeParse({ ...answer, consent: false });
    expect(refused.error?.issues.map((issue) => issue.message)).toEqual([
      contracts.monitoringMessages.consent,
    ]);
    for (const bad of [
      { ...answer, consent: undefined },
      { ...answer, privacyNoticeVersion: '' },
      { ...answer, personId: ID },
      { ...answer, applicationId: ID },
    ]) {
      expect(body.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('every other grants route', () => {
  const others = Object.values<unknown>(contracts).filter(
    (value): value is RouteContract =>
      typeof value === 'object' &&
      value !== null &&
      'audience' in value &&
      'path' in value &&
      !own.includes(value as RouteContract),
  );
  const questionIds = [...monitoringQuestions.keys()];

  it('carries no monitoring answer, consent or fact about a response', () => {
    expect(others.length).toBeGreaterThan(50);
    for (const route of others) {
      const schemas = [route.body, ...Object.values<unknown>(route.responses)].filter(
        (schema) => schema instanceof z.ZodType,
      );
      for (const name of schemas.flatMap(keys)) {
        expect(name, route.path).not.toMatch(/monitor|consent|privacy|equalit|answered/i);
        expect(questionIds, route.path).not.toContain(name);
      }
    }
  });

  it('never returns the response schemas outside the portal', () => {
    const responseSchemas = [contracts.monitoringResponseSchema, contracts.monitoringAnswerSchema];
    for (const route of others) {
      for (const schema of Object.values(route.responses)) {
        expect(responseSchemas, route.path).not.toContain(schema);
      }
    }
  });
});
