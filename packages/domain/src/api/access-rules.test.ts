// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { accessProblems, authSessions } from './access-rules.ts';

/** Access fields that keep every rule; each test breaks one. */
const member = {
  method: 'PATCH',
  audience: 'console',
  module: 'grants',
  permission: 'grants.programmes.manage',
  scope: 'tenant',
};

const auth = {
  method: 'POST',
  audience: 'auth',
  module: 'platform',
  permission: null,
  scope: null,
  session: 'any',
};

function problemsWith(change: Record<string, unknown>, base: object = member): string[] {
  return accessProblems({ ...member, ...base, ...change });
}

describe('accessProblems for console and portal routes', () => {
  it('passes a permission of the route module and app with a scope it uses', () => {
    expect(accessProblems(member)).toEqual([]);
  });

  it('needs a known permission of the route module and app, and a known scope', () => {
    for (const change of [
      { permission: 'grants.everything.do' },
      { permission: 'party.records.read' },
      { permission: 'grants.applications.apply' },
      { permission: null },
      { permission: 'toString' },
      { scope: 'everyone' },
      { scope: 'toString' },
      { scope: null },
      { session: 'none' },
    ]) {
      expect(problemsWith(change)).not.toEqual([]);
    }
  });

  it('needs a scope rule of the route app that the permission uses', () => {
    expect(problemsWith({ scope: 'own_application' })).not.toEqual([]);
    expect(problemsWith({ scope: 'assigned_review' })).not.toEqual([]);
    const score = { permission: 'grants.reviews.score', scope: 'tenant' };
    expect(problemsWith(score)).not.toEqual([]);
    expect(problemsWith({ ...score, scope: 'assigned_review' })).toEqual([]);
    const portal = { audience: 'portal', permission: 'grants.applications.apply', scope: 'tenant' };
    expect(problemsWith(portal)).not.toEqual([]);
    expect(problemsWith({ ...portal, scope: 'own_application' })).toEqual([]);
  });

  it('needs stepUp: true for changes under a step-up permission, and a boolean always', () => {
    const release = { method: 'POST', permission: 'grants.decisions.release' };
    expect(problemsWith(release)).toEqual([
      'Changes under grants.decisions.release need stepUp: true.',
    ]);
    expect(problemsWith({ ...release, stepUp: false })).not.toEqual([]);
    expect(problemsWith({ ...release, stepUp: true })).toEqual([]);
    expect(problemsWith({ ...release, method: 'GET' })).toEqual([]);
    const members = { method: 'DELETE', permission: 'platform.members.manage', module: 'platform' };
    expect(problemsWith(members)).not.toEqual([]);
    for (const stepUp of ['yes', 1, null]) {
      expect(problemsWith({ ...release, stepUp })).toContain('stepUp is true or false.');
    }
  });
});

describe('accessProblems for auth and public routes', () => {
  it('passes each session an auth route can need', () => {
    for (const session of authSessions) expect(problemsWith({ session }, auth)).toEqual([]);
  });

  it('gives them no permission, scope or step-up, and only auth routes a session', () => {
    for (const change of [
      { permission: 'platform.settings.manage' },
      { scope: 'tenant' },
      { session: 'sometimes' },
      { session: undefined },
      { stepUp: true },
      { stepUp: false },
    ]) {
      expect(problemsWith(change, auth)).not.toEqual([]);
    }
    const publicRoute = { audience: 'public' };
    expect(problemsWith(publicRoute, auth)).toEqual(['Only auth routes state a session.']);
    expect(problemsWith({ ...publicRoute, session: undefined }, auth)).toEqual([]);
  });
});
