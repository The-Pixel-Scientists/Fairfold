// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkRoute } from '@pixel-scientists/domain/api';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { applicationListSchema, applicationSchema } from '../applications/answers.ts';
import * as adjustments from './routes.ts';

const routes = Object.values(adjustments.adjustmentRoutes);
const ID = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';

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

describe('adjustment routes', () => {
  it('keep every route rule, for staff who manage adjustments in the tenant', () => {
    for (const route of routes) {
      expect(checkRoute(route), route.path).toEqual([]);
      expect(route, route.path).toMatchObject({
        audience: 'console',
        module: 'grants',
        permission: 'grants.adjustments.manage',
        scope: 'tenant',
      });
    }
    expect(adjustments.grantAdjustment.idempotent).toBe(true);
  });

  it('cover listing for a round and a submission, granting and removing', () => {
    expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      'GET /console/rounds/:roundId/adjustments',
      'GET /console/submissions/:submissionId/adjustments',
      'POST /console/rounds/:roundId/adjustments',
      'POST /console/adjustments/:adjustmentId/revoke',
    ]);
  });

  it('take a closing time for an extension only, a reason code and never a member or free text', () => {
    const { body } = adjustments.grantAdjustment;
    const extension = {
      kind: 'deadline_extension',
      organisationId: ID,
      closesAt: '2027-04-08T17:00',
      reasonCode: 'caring_responsibilities',
    };
    const route = { kind: 'alternative_route', organisationId: ID, reasonCode: 'access_needs' };
    expect(body.parse(extension)).toEqual(extension);
    expect(body.parse({ ...extension, applicationId: ID })).toEqual({
      ...extension,
      applicationId: ID,
    });
    expect(body.parse(route)).toEqual(route);
    for (const bad of [
      // The alternative route is for the organisation in the round, never an existing application.
      { ...route, applicationId: ID },
      { ...extension, closesAt: undefined },
      { ...extension, closesAt: '2027-04-08T16:00:00Z' },
      { ...route, closesAt: '2027-04-08T17:00' },
      { ...extension, reasonCode: 'depression' },
      { ...extension, reason: 'Recovering from surgery' },
      { ...extension, grantedBy: ID },
      { ...extension, membershipId: ID },
      { ...extension, kind: 'fee_waiver' },
    ]) {
      expect(body.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    const revoke = adjustments.revokeAdjustment.body;
    expect(revoke.safeParse({ reasonCode: 'no_longer_needed' }).success).toBe(true);
    expect(revoke.safeParse({}).success).toBe(false);
    expect(revoke.safeParse({ reasonCode: 'other', note: 'x' }).success).toBe(false);
  });

  it('leave the portal only the effective closing time, never the reason, kind or member', () => {
    for (const schema of [applicationSchema, applicationListSchema]) {
      const names = keys(schema);
      expect(names).toContain('closesAt');
      for (const name of names) {
        expect(name).not.toMatch(/adjust|reason|kind|grant|revok|membership|submittedBy/i);
      }
    }
  });
});
