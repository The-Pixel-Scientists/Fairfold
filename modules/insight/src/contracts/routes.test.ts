// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkRoute, type RouteContract } from '@pixel-scientists/domain/api';
import { permissions } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import * as routes from './routes.ts';

const insightRoutes: RouteContract[] = Object.values(routes.insightRoutes);

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

describe('insight routes', () => {
  it('keep every route rule, and are all listed in insightRoutes', () => {
    const exported = Object.values(routes).filter(
      (value) => typeof value === 'object' && 'audience' in value,
    );
    expect(new Set(exported)).toEqual(new Set(insightRoutes));
    for (const route of insightRoutes) expect(checkRoute(route), route.path).toEqual([]);
  });

  it('are console routes over the whole tenant, under insight permissions only', () => {
    for (const route of insightRoutes) {
      expect(route).toMatchObject({ audience: 'console', module: 'insight', scope: 'tenant' });
      expect(Object.keys(permissions)).toContain(route.permission);
      expect(route.permission).toMatch(/^insight\./);
    }
  });

  it('give each permission its routes', () => {
    const byPermission: Record<string, string[]> = {};
    for (const route of insightRoutes) {
      (byPermission[String(route.permission)] ??= []).push(`${route.method} ${route.path}`);
    }
    expect(byPermission).toEqual({
      'insight.reports.read': [
        'GET /console/reports',
        'GET /console/reports/:reportId',
        'POST /console/reports/:reportId/runs',
        'GET /console/report-runs/:runId',
        'GET /console/data-contracts',
      ],
      'insight.reports.manage': [
        'POST /console/reports',
        'PUT /console/reports/:reportId',
        'POST /console/reports/:reportId/archive',
      ],
      'insight.monitoring.report': [
        'POST /console/reports/:reportId/monitoring-runs',
        'GET /console/monitoring-report-runs/:runId',
      ],
      'insight.publications.manage': [
        'GET /console/publication-runs',
        'POST /console/publication-runs',
        'GET /console/publication-runs/:runId',
        'POST /console/publication-runs/:runId/mark-submitted',
      ],
      'insight.disclosure_rules.manage': [
        'GET /console/disclosure-rule',
        'PUT /console/disclosure-rule',
      ],
    });
  });

  it('make each create idempotent, and answer runs once without storing a replay', () => {
    const creates = insightRoutes.filter((route) => Object.hasOwn(route.responses, 201));
    expect(creates).toEqual([routes.createReportDefinition, routes.preparePublicationRun]);
    for (const route of creates) expect(route.idempotent).toBe(true);
    for (const route of [routes.runReport, routes.runMonitoringReport]) {
      expect(route.method).toBe('POST');
      expect(Object.keys(route.responses)).toEqual(['200']);
      expect(route).not.toHaveProperty('idempotent');
    }
  });

  it('raise the disclosure rule only after step-up', () => {
    expect(routes.updateDisclosureRule).toMatchObject({ method: 'PUT', stepUp: true });
    const others = insightRoutes.filter((route) => route !== routes.updateDisclosureRule);
    for (const route of others) expect(route, route.path).not.toHaveProperty('stepUp');
  });

  it('name no tenant, user, membership, actor or person in any request', () => {
    for (const route of insightRoutes) {
      for (const part of [route.params, route.query, route.body]) {
        if (part === undefined || !(part instanceof z.ZodType)) continue;
        for (const key of keysIn(part)) {
          expect(key, route.path).not.toMatch(/tenant|user|membership|actor|person|party/i);
        }
      }
    }
  });

  it('mark a publication submitted with no body, and submit nothing anywhere', () => {
    expect(routes.markPublicationRunSubmitted).not.toHaveProperty('body');
    const paths = insightRoutes.map((route) => route.path);
    expect(paths.filter((path) => /submit/.test(path))).toEqual([
      '/console/publication-runs/:runId/mark-submitted',
    ]);
  });
});
