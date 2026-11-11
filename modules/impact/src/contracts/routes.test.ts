// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkRoute, type RouteContract } from '@pixel-scientists/domain/api';
import { permissions, roles } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import * as routes from './routes.ts';

const impactRoutes: RouteContract[] = Object.values(routes.impactRoutes);

/** Every property name anywhere in a schema, on both sides. */
function keysIn(schema: z.ZodType): string[] {
  const keys: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node !== null && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'properties') keys.push(...Object.keys(value as object));
        walk(value);
      }
    }
  };
  for (const io of ['input', 'output'] as const) walk(z.toJSONSchema(schema, { io }));
  return keys;
}

describe('impact routes', () => {
  it('keep every route rule, and are all listed in impactRoutes', () => {
    const exported = Object.values(routes).filter(
      (value) => typeof value === 'object' && 'audience' in value,
    );
    expect(new Set(exported)).toEqual(new Set(impactRoutes));
    for (const route of impactRoutes) expect(checkRoute(route), route.path).toEqual([]);
  });

  it('are console routes over the whole tenant, under impact permissions only', () => {
    for (const route of impactRoutes) {
      expect(route).toMatchObject({ audience: 'console', module: 'impact', scope: 'tenant' });
      expect(Object.keys(permissions)).toContain(route.permission);
      expect(route.permission).toMatch(/^impact\./);
    }
  });

  it('give each permission its routes', () => {
    const byPermission: Record<string, string[]> = {};
    for (const route of impactRoutes) {
      (byPermission[String(route.permission)] ??= []).push(`${route.method} ${route.path}`);
    }
    expect(byPermission).toEqual({
      'impact.frameworks.read': [
        'GET /console/outcome-frameworks',
        'GET /console/outcome-frameworks/:frameworkId',
        'GET /console/outcome-frameworks/:frameworkId/summary',
        'GET /console/outcome-frameworks/:frameworkId/targets',
        'GET /console/indicator-results',
        'GET /console/indicator-results/:resultId',
        'GET /console/outcome-frameworks/:frameworkId/learning-notes',
      ],
      'impact.frameworks.manage': [
        'POST /console/outcome-frameworks',
        'PUT /console/outcome-frameworks/:frameworkId',
        'POST /console/outcome-frameworks/:frameworkId/archive',
        'POST /console/indicator-targets',
        'PUT /console/indicator-targets/:targetId',
        'DELETE /console/indicator-targets/:targetId',
      ],
      'impact.results.manage': [
        'POST /console/indicator-results',
        'PUT /console/indicator-results/:resultId',
        'DELETE /console/indicator-results/:resultId',
        'POST /console/learning-notes',
        'DELETE /console/learning-notes/:noteId',
      ],
    });
  });

  it('let only a read permission read, and every read is a GET', () => {
    for (const route of impactRoutes) {
      expect(route.method === 'GET', route.path).toBe(
        route.permission === 'impact.frameworks.read',
      );
    }
  });

  it('make each create idempotent', () => {
    const creates = impactRoutes.filter((route) => Object.hasOwn(route.responses, 201));
    expect(creates).toEqual([
      routes.createFramework,
      routes.createTarget,
      routes.createResult,
      routes.createLearningNote,
    ]);
    for (const route of creates) expect(route.idempotent).toBe(true);
  });

  it('name no tenant, user, membership, actor, person or party in any request', () => {
    for (const route of impactRoutes) {
      for (const part of [route.params, route.query, route.body]) {
        if (part === undefined || !(part instanceof z.ZodType)) continue;
        for (const key of keysIn(part)) {
          expect(key, route.path).not.toMatch(/tenant|user|membership|actor|person|party/i);
        }
      }
    }
  });

  it('give programme managers every impact permission and analysts the read alone', () => {
    const impact = (role: keyof typeof roles) =>
      roles[role].permissions.filter((permission) => permission.startsWith('impact.'));
    expect(impact('programme_manager')).toEqual([
      'impact.frameworks.read',
      'impact.frameworks.manage',
      'impact.results.manage',
    ]);
    expect(impact('analyst')).toEqual(['impact.frameworks.read']);
    for (const role of [
      'tenant_admin',
      'reviewer',
      'due_diligence_officer',
      'data_protection_lead',
      'applicant',
    ] as const) {
      expect(impact(role), role).toEqual([]);
    }
  });
});
