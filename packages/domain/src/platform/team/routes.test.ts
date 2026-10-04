// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { checkRoute } from '../../api/route.ts';
import * as team from './routes.ts';

const routes = Object.values(team.teamRoutes);

describe('team routes', () => {
  it('keep every route rule', () => {
    for (const route of routes) expect(checkRoute(route), route.path).toEqual([]);
  });

  it('are all listed in teamRoutes', () => {
    const exported = Object.values(team).filter(
      (value) => typeof value === 'object' && 'audience' in value,
    );
    expect(new Set(exported)).toEqual(new Set(routes));
  });

  it('need the members permission over the whole tenant in the console', () => {
    for (const route of routes) {
      expect(route).toMatchObject({
        audience: 'console',
        module: 'platform',
        permission: 'platform.members.manage',
        scope: 'tenant',
      });
    }
  });

  it('need step-up for every change, and not to read the team', () => {
    for (const route of routes) {
      expect('stepUp' in route && route.stepUp, route.path).toBe(route.method !== 'GET');
    }
    expect(routes.filter((route) => route.method === 'GET')).toEqual([team.getTeam]);
  });

  it('name a member or invitation only by its id', () => {
    const params = routes.map((route) => route.path.split('/').filter((s) => s.startsWith(':')));
    expect(new Set(params.flat())).toEqual(new Set([':invitationId', ':membershipId']));
  });

  it('take roles and an address only where they are set', () => {
    expect(Object.keys(team.inviteMember.body.shape)).toEqual(['email', 'roles']);
    expect(Object.keys(team.changeMemberRoles.body.shape)).toEqual(['roles']);
    for (const route of routes) {
      if (route !== team.inviteMember && route !== team.changeMemberRoles) {
        expect('body' in route, route.path).toBe(false);
      }
    }
  });
});
