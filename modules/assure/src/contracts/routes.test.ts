// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkRoute, type RouteContract } from '@pixel-scientists/domain/api';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import * as contracts from './index.ts';

const routes = Object.values(contracts.assureRoutes) as RouteContract[];

const exported = Object.values(contracts).filter(
  (value) => typeof value === 'object' && 'audience' in value && 'path' in value,
);

/** Every key a request schema names, at any depth. */
function requestKeys(schema: z.ZodType): string[] {
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

describe('assure routes', () => {
  it('are every exported route, each keeping every route rule', () => {
    expect(new Set(exported)).toEqual(new Set(routes));
    for (const route of routes) expect(checkRoute(route), route.path).toEqual([]);
  });

  it('are console routes of the assure module, under its permissions', () => {
    expect(routes.map((route) => `${route.method} ${route.path} ${String(route.permission)}`))
      .toMatchInlineSnapshot(`
      [
        "GET /console/organisations/:organisationId/lookups assure.lookup.read",
        "POST /console/organisations/:organisationId/lookups assure.lookup.run",
        "GET /console/lookups/:snapshotId/officers assure.lookup.read",
        "POST /console/lookup-officers/:officerId/link assure.lookup.link",
        "POST /console/parties/:partyId/screening-runs assure.screening.run",
        "GET /console/parties/:partyId/screening-runs assure.screening.read",
        "GET /console/screening-runs/:runId assure.screening.read",
        "GET /console/screening-matches assure.screening.read",
        "GET /console/screening-matches/:matchId assure.screening.read",
        "POST /console/screening-matches/:matchId/decisions assure.screening.decide",
        "GET /console/applications/:applicationId/duplicate-flags assure.duplicates.review",
        "GET /console/parties/:partyId/duplicate-flags assure.duplicates.review",
        "POST /console/duplicate-flags/:flagId/dismissal assure.duplicates.review",
        "GET /console/checklists assure.checklists.manage",
        "GET /console/checklists/:checklistId assure.checklists.manage",
        "POST /console/checklists assure.checklists.manage",
        "POST /console/checklists/:checklistId/versions assure.checklists.manage",
        "GET /console/applications/:applicationId/checklists assure.checklists.complete",
        "GET /console/applications/:applicationId/checklists/:checklistId assure.checklists.complete",
        "PUT /console/applications/:applicationId/checklists/:checklistId assure.checklists.complete",
        "GET /console/visits assure.visits.manage",
        "POST /console/visits assure.visits.manage",
        "GET /console/visits/:visitId assure.visits.manage",
        "PUT /console/visits/:visitId assure.visits.manage",
      ]
    `);
    for (const route of routes) {
      expect(route).toMatchObject({ audience: 'console', module: 'assure', scope: 'tenant' });
    }
  });

  it('make every create and every queued job idempotent', () => {
    const queued = routes.filter((route) => 201 in route.responses || 202 in route.responses);
    expect(queued.map((route) => route.path)).toHaveLength(6);
    for (const route of queued) expect(route.idempotent, route.path).toBe(true);
  });

  it('decide a match only after signing in again, and never change or remove a decision', () => {
    expect(contracts.decideScreeningMatch).toMatchObject({
      method: 'POST',
      permission: 'assure.screening.decide',
      stepUp: true,
    });
    expect(checkRoute({ ...contracts.decideScreeningMatch, stepUp: false })).toContain(
      'Changes under assure.screening.decide need stepUp: true.',
    );
    const decisions = routes.filter((route) => route.path.includes('/decisions'));
    expect(decisions).toEqual([contracts.decideScreeningMatch]);
  });

  it('take no member, automatic outcome, default or threshold in any request', () => {
    for (const route of routes) {
      for (const schema of [route.params, route.query, route.body]) {
        if (schema === undefined || !(schema instanceof z.ZodType)) continue;
        for (const key of requestKeys(schema)) {
          expect(key, route.path).not.toMatch(/auto|default|threshold|decided|dismissed|member/i);
        }
      }
    }
  });
});
