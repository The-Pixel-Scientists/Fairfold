// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkRoute, type RouteContract } from '@pixel-scientists/domain/api';
import { fieldForIssue, messageForIssue } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import * as contracts from './index.ts';

const routes = Object.values(contracts.privacyRoutes) as RouteContract[];

const nameOf = (route: RouteContract) =>
  Object.entries(contracts.privacyRoutes).find(([, value]) => value === route)?.[0];

const requestsOf = (route: RouteContract) =>
  [route.params, route.query, route.body].filter(
    (schema): schema is z.ZodType => schema instanceof z.ZodType,
  );

const responsesOf = (route: RouteContract) =>
  Object.values(route.responses).filter((body): body is z.ZodType => body instanceof z.ZodType);

/** Every key a schema names, at any depth. */
function keysOf(schema: z.ZodType): string[] {
  const keys: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (typeof node === 'object' && node !== null) {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'properties') keys.push(...Object.keys(value as object));
        walk(value);
      }
    }
  };
  walk(z.toJSONSchema(schema, { io: 'input' }));
  return keys;
}

describe('privacy routes', () => {
  it('are every exported route, each keeping every route rule', () => {
    const exported = Object.values(contracts).filter(
      (value) => typeof value === 'object' && 'audience' in value && 'path' in value,
    );
    expect(new Set(exported)).toEqual(new Set(routes));
    for (const route of routes) {
      expect(checkRoute(route), route.path).toEqual([]);
      expect(route).toMatchObject({ audience: 'console', module: 'privacy', scope: 'tenant' });
    }
  });

  it('are these, under the permissions S11-21 added', () => {
    expect(routes.map((route) => `${route.method} ${route.path} ${String(route.permission)}`))
      .toMatchInlineSnapshot(`
        [
          "GET /console/rights-requests privacy.requests.manage",
          "POST /console/rights-requests privacy.requests.manage",
          "GET /console/rights-requests/:requestId privacy.requests.manage",
          "PUT /console/rights-requests/:requestId privacy.requests.manage",
          "POST /console/rights-requests/:requestId/pause privacy.requests.manage",
          "POST /console/rights-requests/:requestId/resume privacy.requests.manage",
          "POST /console/rights-requests/:requestId/extension privacy.requests.manage",
          "POST /console/rights-requests/:requestId/closure privacy.requests.manage",
          "GET /console/rights-requests/:requestId/tasks privacy.requests.manage",
          "POST /console/rights-requests/:requestId/tasks privacy.requests.manage",
          "PUT /console/rights-requests/:requestId/tasks/:taskId privacy.requests.manage",
          "POST /console/rights-requests/:requestId/tasks/:taskId/completion privacy.requests.manage",
          "POST /console/rights-requests/:requestId/export privacy.requests.export",
          "GET /console/rights-requests/:requestId/export privacy.requests.export",
          "POST /console/rights-requests/:requestId/erasure privacy.requests.erase",
          "GET /console/rights-requests/:requestId/erasure privacy.requests.erase",
          "GET /console/breaches privacy.breaches.manage",
          "POST /console/breaches privacy.breaches.manage",
          "GET /console/breaches/:breachId privacy.breaches.manage",
          "PUT /console/breaches/:breachId privacy.breaches.manage",
          "POST /console/breaches/:breachId/assessments privacy.breaches.manage",
          "POST /console/breaches/:breachId/ico-notification privacy.breaches.manage",
          "POST /console/breaches/:breachId/subject-notification privacy.breaches.manage",
          "GET /console/dpias privacy.dpias.manage",
          "POST /console/dpias privacy.dpias.manage",
          "GET /console/dpias/:dpiaId privacy.dpias.manage",
          "PUT /console/dpias/:dpiaId privacy.dpias.manage",
          "POST /console/dpias/:dpiaId/sign-off privacy.dpias.manage",
          "GET /console/records-of-processing privacy.processing.manage",
          "GET /console/processing-activities privacy.processing.manage",
          "POST /console/processing-activities privacy.processing.manage",
          "GET /console/processing-activities/:activityId privacy.processing.manage",
          "PUT /console/processing-activities/:activityId privacy.processing.manage",
          "GET /console/processors privacy.processing.manage",
          "POST /console/processors privacy.processing.manage",
          "PUT /console/processors/:processorId privacy.processing.manage",
          "GET /console/people/:personId/consent-history privacy.requests.manage",
        ]
      `);
  });

  it('need step-up for exactly starting an export or an erasure', () => {
    const stepUp = routes.filter((route) => 'stepUp' in route && route.stepUp === true);
    expect(stepUp.map(nameOf)).toEqual(['startRequestExport', 'startRequestErasure']);
    expect(checkRoute({ ...contracts.startRequestErasure, stepUp: false })).toContain(
      'Changes under privacy.requests.erase need stepUp: true.',
    );
  });

  it('are idempotent for exactly every POST, and answer 202 for exactly export and erasure', () => {
    const idempotent = routes.filter((route) => route.idempotent === true);
    expect(idempotent).toEqual(routes.filter((route) => route.method === 'POST'));
    expect(routes.filter((route) => 202 in route.responses).map(nameOf)).toEqual([
      'startRequestExport',
      'startRequestErasure',
    ]);
  });

  it('start an export with no body, and an erasure with a literal confirmation only', () => {
    expect('body' in contracts.startRequestExport).toBe(false);
    expect(contracts.requestErasureInputSchema.parse({ confirm: true })).toEqual({ confirm: true });
    for (const body of [
      {},
      { confirm: 'true' },
      { confirm: false },
      { confirm: true, reason: 'tenant_instruction' },
      { confirm: true, partyId: '0b8f3a52-6c1d-4e7a-9f20-3d5c8e1b7a64' },
      { confirm: true, scheduledFor: '2027-01-01' },
    ]) {
      expect(
        contracts.requestErasureInputSchema.safeParse(body).success,
        JSON.stringify(body),
      ).toBe(false);
    }
  });

  it('never delete anything, nor change or remove an assessment', () => {
    for (const route of routes) expect(route.method, route.path).not.toBe('DELETE');
    const assessments = routes.filter((route) => route.path.includes('/assessments'));
    expect(assessments).toEqual([contracts.assessBreach]);
  });

  it('take no tenant, acting member, assessor or signer in any request', () => {
    for (const route of routes) {
      for (const schema of requestsOf(route)) {
        for (const key of keysOf(schema)) {
          expect(key, route.path).not.toMatch(
            /tenant|actor|user|assess(?:or|edby)|sign(?:er|edby)|recordedby|decidedby/i,
          );
        }
      }
    }
  });

  it('take no free-form identity evidence', () => {
    for (const schema of [
      contracts.rightsRequestInputSchema,
      contracts.rightsRequestUpdateSchema,
    ]) {
      expect(keysOf(schema).filter((key) => /identity|evidence|proof|document/i.test(key))).toEqual(
        ['identityCheck'],
      );
    }
  });

  it('use strict schemas that refuse unknown keys', () => {
    for (const route of routes) {
      for (const schema of [...requestsOf(route), ...responsesOf(route)]) {
        const walk = (node: unknown): void => {
          if (Array.isArray(node)) node.forEach(walk);
          else if (typeof node === 'object' && node !== null) {
            const object = node as Record<string, unknown>;
            if (object['type'] === 'object' && 'properties' in object) {
              expect(object['additionalProperties'], route.path).toBe(false);
            }
            Object.values(object).forEach(walk);
          }
        };
        walk(z.toJSONSchema(schema, { io: 'input' }));
      }
    }
  });
});

describe('problems from these requests', () => {
  const personId = '7d1e2f3a-4b5c-4d6e-8f70-a1b2c3d4e5f6';
  const recognisable = 'Ada Lovelace asked for her records 1815';

  function problemText(schema: z.ZodType, value: unknown): string {
    const result = schema.safeParse(value);
    expect(result.success).toBe(false);
    return (result.error?.issues ?? [])
      .map((issue) => `${fieldForIssue('body', issue)} ${messageForIssue(issue)}`)
      .join('\n');
  }

  it('never repeat a person id or summary that was sent', () => {
    const bodies: [z.ZodType, unknown][] = [
      [
        contracts.rightsRequestInputSchema,
        {
          personId: recognisable,
          receivedAt: recognisable,
          kind: recognisable,
          channel: recognisable,
          summary: `${recognisable}\u0000`,
          identityCheck: personId,
        },
      ],
      [
        contracts.rightsRequestInputSchema,
        {
          personId,
          receivedAt: '2026-11-02T09:00:00Z',
          kind: 'access',
          channel: 'email',
          summary: recognisable.repeat(100),
          identityCheck: 'verified',
          [recognisable]: personId,
        },
      ],
      [contracts.breachInputSchema, { description: recognisable, [personId]: recognisable }],
      [contracts.requestTaskInputSchema, { title: recognisable, assigneeMembershipId: personId }],
    ];
    for (const [schema, value] of bodies) {
      const text = problemText(schema, value);
      expect(text).not.toContain(recognisable);
      expect(text).not.toContain(personId);
    }
  });

  it('word every bad checked value from the catalogue, saying how to fix it', () => {
    const catalogue = new Set<string>(Object.values(contracts.privacyMessages));
    const bad: [z.ZodType, unknown][] = [
      [contracts.rightsRequestUpdateSchema.shape.kind, 'gdpr'],
      [contracts.rightsRequestUpdateSchema.shape.channel, 'fax'],
      [contracts.rightsRequestUpdateSchema.shape.identityCheck, 'passport'],
      [contracts.rightsRequestQuerySchema.shape.state, 'late'],
      [contracts.rightsRequestQuerySchema.shape.dueWithinDays, '400'],
      [contracts.pauseInputSchema.shape.reason, 'holiday'],
      [contracts.resumeInputSchema.shape.reason, 'other'],
      [contracts.extensionInputSchema.shape.reason, 'busy'],
      [contracts.extensionInputSchema.shape.months, 3],
      [contracts.closeInputSchema.shape.reason, 'ignored'],
      [contracts.requestTaskInputSchema.shape.moduleId, 'payroll'],
      [contracts.breachInputSchema.shape.dataCategories, ['ssn']],
      [contracts.breachInputSchema.shape.dataCategories, []],
      [contracts.assessmentInputSchema.shape.riskLevel, 'low'],
      [contracts.icoNotificationInputSchema.shape.lateReason, 'forgot'],
      [contracts.subjectNotificationInputSchema.shape.method, 'pigeon'],
      [contracts.dpiaUpdateSchema.shape.status, 'signed_off'],
      [contracts.dpiaInputSchema.shape.screening, { q_one: 'maybe' }],
      [contracts.processingActivityInputSchema.shape.legalBasis, 'because'],
      [contracts.processingActivityInputSchema.shape.specialCategoryCondition, 'health'],
      [contracts.processingActivityInputSchema.shape.subjectCategories, ['aliens']],
      [contracts.processorInputSchema.shape.countryCode, 'gb'],
      [contracts.processorInputSchema.shape.transferSafeguard, 'hope'],
    ];
    for (const [schema, value] of bad) {
      const issues = schema.safeParse(value).error?.issues ?? [];
      expect(issues.length, JSON.stringify(value)).toBeGreaterThan(0);
      for (const issue of issues) {
        expect(catalogue.has(messageForIssue(issue)), JSON.stringify(value)).toBe(true);
      }
    }
    for (const message of catalogue) {
      expect(message).toMatch(/^[A-Z].*\.$/);
      expect(message).not.toMatch(/sorry|apolog|please/i);
    }
  });
});
