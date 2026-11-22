// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { checkRoute, type RouteContract } from '../../api/route.ts';
import { messageForIssue, messages } from '../messages.ts';
import * as teams from './teams.ts';

const routes: RouteContract[] = Object.values(teams.teamsRoutes);

/** Every property name in a schema, at any depth. */
function keysIn(schema: z.ZodType): string[] {
  const keys: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return;
    const { properties } = node as { properties?: Record<string, unknown> };
    if (properties) keys.push(...Object.keys(properties));
    for (const value of Object.values(node)) walk(value);
  };
  walk(z.toJSONSchema(schema, { io: 'input' }));
  return keys;
}

function firstMessage(value: unknown): string | undefined {
  const issue = teams.teamNameSchema.safeParse(value).error?.issues[0];
  return issue === undefined ? undefined : messageForIssue(issue);
}

describe('team routes', () => {
  it('keep every route rule', () => {
    for (const route of routes) expect(checkRoute(route), route.path).toEqual([]);
  });

  it('are all listed in teamsRoutes', () => {
    const exported = Object.values(teams).filter(
      (value) => typeof value === 'object' && 'audience' in value,
    );
    expect(new Set(exported)).toEqual(new Set(routes));
  });

  it('need the teams permission over the whole tenant in the console', () => {
    for (const route of routes) {
      expect(route).toMatchObject({
        audience: 'console',
        module: 'platform',
        permission: 'platform.teams.manage',
        scope: 'tenant',
      });
    }
  });

  it('need step-up for every change and not to read, and make creating repeatable', () => {
    for (const route of routes) {
      expect('stepUp' in route && route.stepUp, route.path).toBe(route.method !== 'GET');
    }
    expect(routes.filter((route) => 'idempotent' in route)).toEqual([teams.createTeam]);
  });

  it('name a team or member only by its id in the path', () => {
    const params = routes.map((route) => route.path.split('/').filter((s) => s.startsWith(':')));
    expect(new Set(params.flat())).toEqual(new Set([':teamId', ':membershipId']));
    expect(Object.keys(teams.teamNameBodySchema.shape)).toEqual(['name']);
  });

  it('carry no permission, role or email, so a team gives reach only', () => {
    for (const route of routes) {
      const schemas = [route.body, ...Object.values(route.responses)];
      for (const schema of schemas) {
        if (schema instanceof z.ZodType) {
          for (const key of keysIn(schema)) {
            expect(key, route.path).not.toMatch(/role|permission|email|kind/i);
          }
        }
      }
    }
  });
});

describe('the route rules refuse', () => {
  it('a team change without step-up', () => {
    expect(checkRoute({ ...teams.renameTeam, stepUp: undefined })).toContain(
      'Changes under platform.teams.manage need stepUp: true.',
    );
  });

  it('a reach rule under a permission that does not list it', () => {
    expect(checkRoute({ ...teams.listTeams, scope: 'caseload' })).toContain(
      'The scope rule caseload is not one platform.teams.manage uses in the console.',
    );
  });

  it('a portal route on a console-only rule', () => {
    const portal = {
      ...teams.listTeams,
      audience: 'portal',
      module: 'party',
      path: '/portal/teams',
      permission: 'party.profile.manage',
      scope: 'reachable',
    } as const;
    expect(checkRoute(portal)).toContain(
      'The scope rule reachable is not one party.profile.manage uses in the portal.',
    );
  });

  it('a create without the idempotent marker', () => {
    expect(checkRoute({ ...teams.createTeam, idempotent: undefined })).toContain(
      'A POST that creates must be idempotent.',
    );
  });
});

describe('team names', () => {
  it('are trimmed, on one line, of 1 to 100 characters', () => {
    expect(teams.teamNameSchema.parse('  Safeguarding  ')).toBe('Safeguarding');
    expect(teams.teamNameSchema.parse('x'.repeat(100))).toBe('x'.repeat(100));
    expect(firstMessage('   ')).toBe(messages.enterTeamName);
    expect(firstMessage('x'.repeat(101))).toBe(messages.teamNameTooLong);
    for (const name of ['North\nteam', 'North\u202eteam', 'North\u0000team']) {
      expect(firstMessage(name), JSON.stringify(name)).toBe(messages.tenantNameHidden);
    }
    expect(firstMessage('---')).toBe(messages.tenantNameVisible);
  });

  it('come in a body that takes nothing else', () => {
    expect(teams.teamNameBodySchema.safeParse({ name: 'North', tenantId: 'x' }).success).toBe(
      false,
    );
  });
});
