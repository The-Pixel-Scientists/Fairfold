// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkRoute, type RouteContract } from '@pixel-scientists/domain/api';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import * as messages from './routes.ts';

const routes = Object.values(messages.messageRoutes);
const ID = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';

describe('message routes', () => {
  it('keep every route rule and are all listed in messageRoutes', () => {
    for (const route of routes) expect(checkRoute(route), route.path).toEqual([]);
    const exported = Object.values(messages).filter(
      (value) => typeof value === 'object' && 'audience' in value,
    );
    expect(new Set(exported)).toEqual(new Set(routes));
  });

  it("let the applicant reach their own application's thread, and staff a submission's", () => {
    expect(routes.map((route) => [`${route.method} ${route.path}`, route.scope])).toEqual([
      ['GET /portal/applications/:applicationId/messages', 'own_application'],
      ['POST /portal/applications/:applicationId/messages', 'own_application'],
      ['POST /portal/applications/:applicationId/messages/read', 'own_application'],
      ['GET /console/submissions/:submissionId/messages', 'tenant'],
      ['POST /console/submissions/:submissionId/messages', 'tenant'],
      ['POST /console/submissions/:submissionId/messages/read', 'tenant'],
    ]);
    for (const route of routes) {
      expect(route, route.path).toMatchObject(
        route.audience === 'portal'
          ? { module: 'grants', permission: 'grants.applications.apply' }
          : { audience: 'console', module: 'grants', permission: 'grants.applications.read' },
      );
    }
  });

  it('send idempotently, and mark read with no body or answer', () => {
    expect(messages.sendApplicantMessage.idempotent).toBe(true);
    expect(messages.sendStaffMessage.idempotent).toBe(true);
    for (const route of [messages.markApplicantThreadRead, messages.markStaffThreadRead]) {
      expect(route).not.toHaveProperty('body');
      expect(route.responses).toEqual({ 204: null });
    }
  });

  it('take a body only: the side comes from the audience and the author from the session', () => {
    const { sendMessageInputSchema } = messages;
    expect(sendMessageInputSchema.parse({ body: ' When do you decide? ' })).toEqual({
      body: 'When do you decide?',
    });
    for (const extra of ['side', 'authorId', 'author', 'tenantId', 'threadId', 'applicationId']) {
      expect(sendMessageInputSchema.safeParse({ body: 'Hi', [extra]: ID }).success, extra).toBe(
        false,
      );
    }
  });

  it("answer each audience in its own strict shape, the applicant's with no staff name", () => {
    const keys = (route: RouteContract, status: number) =>
      Object.keys(
        (z.toJSONSchema(route.responses[status] as z.ZodType) as { properties: object }).properties,
      );
    expect(keys(messages.sendApplicantMessage, 201)).not.toContain('authorName');
    expect(keys(messages.sendStaffMessage, 201)).toContain('authorName');
    expect(keys(messages.getApplicantThread, 200)).toEqual(['messages', 'unreadCount']);
    expect(messages.getApplicantThread.responses[200]).not.toBe(
      messages.getStaffThread.responses[200],
    );
  });
});

describe('grants contracts', () => {
  it('give no reviewer route any note or message data', { timeout: 30_000 }, async () => {
    const contracts = await import('../index.ts');
    const all = Object.values<unknown>(contracts).filter(
      (value): value is RouteContract =>
        typeof value === 'object' && value !== null && 'audience' in value && 'path' in value,
    );
    const reviewer = all.filter(
      (route) => route.scope === 'assigned_review' || route.permission === 'grants.reviews.score',
    );
    expect(reviewer.length).toBeGreaterThan(0);
    for (const route of reviewer) {
      expect(route.path, route.path).not.toMatch(/notes|messages|mention/);
      for (const body of Object.values(route.responses)) {
        if (body === null || 'raw' in body) continue;
        const schema = JSON.stringify(
          z.toJSONSchema(body, { io: 'output', unrepresentable: 'any' }),
        );
        expect(schema, route.path).not.toMatch(/"(?:notes|mentions|unreadCount|authorName)"/);
      }
    }
    const carrying = all.filter((route) =>
      /\/(?:notes|messages|mentionable-members)/.test(route.path),
    );
    expect(carrying).toHaveLength(9);
    for (const route of carrying) expect(route.scope, route.path).not.toBe('assigned_review');
  });
});
