// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkRoute } from '@pixel-scientists/domain/api';
import { permissions } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';

import * as programme from './routes.ts';

const routes = Object.values(programme.programmeRoutes);

describe('programme routes', () => {
  it('keep every route rule', () => {
    for (const route of routes) expect(checkRoute(route), route.path).toEqual([]);
  });

  it('are all listed in programmeRoutes', () => {
    const exported = Object.values(programme).filter(
      (value) => typeof value === 'object' && 'audience' in value,
    );
    expect(new Set(exported)).toEqual(new Set(routes));
  });

  it('let staff who manage programmes reach any in their tenant, and nobody else', () => {
    expect(permissions['grants.programmes.manage']).toMatchObject({ app: 'console' });
    for (const route of routes) {
      expect(route, route.path).toMatchObject({
        audience: 'console',
        module: 'grants',
        permission: 'grants.programmes.manage',
        scope: 'tenant',
      });
      expect(route.path, route.path).toMatch(/^\/console\//);
    }
  });

  it('cover reading and changing each part of the set-up', () => {
    expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      'GET /console/programmes',
      'POST /console/programmes',
      'GET /console/programmes/:programmeId',
      'PUT /console/programmes/:programmeId',
      'GET /console/programmes/:programmeId/rounds',
      'POST /console/programmes/:programmeId/rounds',
      'GET /console/rounds/:roundId',
      'PUT /console/rounds/:roundId',
      'GET /console/rounds/:roundId/stages',
      'PUT /console/rounds/:roundId/stages',
      'PUT /console/stages/:stageId/rubric',
      'GET /console/programmes/:programmeId/email-templates',
      'PUT /console/programmes/:programmeId/email-templates',
      'GET /console/programmes/:programmeId/history',
      'GET /console/rounds/:roundId/history',
    ]);
  });
});
