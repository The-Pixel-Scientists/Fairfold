// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkRoute } from '@pixel-scientists/domain/api';
import { auditEntityType, isAuditAction } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';

import { partyAuditActions } from './audit.ts';
import * as party from './routes.ts';

const routes = Object.values(party.partyRoutes);
const portalRoutes = routes.filter((route) => route.audience === 'portal');
const consoleRoutes = routes.filter((route) => route.audience === 'console');

describe('party routes', () => {
  it('keep every route rule', () => {
    for (const route of routes) expect(checkRoute(route), route.path).toEqual([]);
  });

  it('are all listed in partyRoutes', () => {
    const exported = Object.values(party).filter(
      (value) => typeof value === 'object' && 'audience' in value,
    );
    expect(new Set(exported)).toEqual(new Set(routes));
  });

  it('let applicants reach only their own person and organisations', () => {
    for (const route of portalRoutes) {
      expect(route, route.path).toMatchObject({
        module: 'party',
        permission: 'party.profile.manage',
        scope: route.path.includes(':organisationId') ? 'own_organisation' : 'own_person',
      });
    }
  });

  it('never take a person id from an applicant', () => {
    const params = portalRoutes.flatMap((route) =>
      route.path.split('/').filter((segment) => segment.startsWith(':')),
    );
    expect(new Set(params)).toEqual(new Set([':organisationId']));
  });

  it('let staff with the party permission read the whole tenant, and change nothing', () => {
    expect(consoleRoutes.map((route) => route.path)).toEqual([
      '/console/organisations',
      '/console/organisations/:organisationId',
      '/console/people/:personId',
    ]);
    for (const route of consoleRoutes) {
      expect(route).toMatchObject({
        method: 'GET',
        module: 'party',
        permission: 'party.records.read',
        scope: 'tenant',
      });
    }
  });

  it('answer the portal and the console with separate schemas', () => {
    const portalAnswers = new Set(
      portalRoutes.flatMap((route): unknown[] => Object.values(route.responses)),
    );
    for (const route of consoleRoutes) {
      for (const answer of Object.values(route.responses)) {
        expect(portalAnswers.has(answer), route.path).toBe(false);
      }
    }
  });
});

describe('party audit actions', () => {
  it('are defined for the audit writer', () => {
    for (const action of partyAuditActions) expect(isAuditAction(action), action).toBe(true);
    expect(new Set(partyAuditActions.map(auditEntityType))).toEqual(
      new Set(['party.person', 'party.organisation', 'party.relationship', 'party.consent']),
    );
  });
});
