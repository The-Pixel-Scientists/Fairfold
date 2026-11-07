// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkRoute, type RouteContract } from '@pixel-scientists/domain/api';
import { permissions } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import * as contracts from './index.ts';
import { isPersonal } from './schemas.ts';

const routes = Object.values(contracts.crmRoutes) as RouteContract[];

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

const schemas = (route: RouteContract) =>
  [route.params, route.query, route.body].filter((schema) => schema instanceof z.ZodType);

describe('crm routes', () => {
  it('are every exported route, each keeping every route rule', () => {
    expect(new Set(exported)).toEqual(new Set(routes));
    for (const route of routes) expect(checkRoute(route), route.path).toEqual([]);
  });

  it('are console routes of the crm module in the tenant, under its own permissions', () => {
    expect(routes.map((route) => `${route.method} ${route.path} ${String(route.permission)}`))
      .toMatchInlineSnapshot(`
        [
          "POST /console/crm/search crm.records.read",
          "GET /console/crm/organisations/:organisationId crm.records.read",
          "GET /console/crm/people/:personId crm.records.read",
          "GET /console/crm/parties/:partyId/timeline crm.records.read",
          "POST /console/crm/parties/:partyId/interactions crm.records.manage",
          "GET /console/crm/parties/:partyId/external-references crm.records.read",
          "POST /console/crm/parties/:partyId/external-references crm.records.manage",
          "DELETE /console/crm/parties/:partyId/external-references/:referenceId crm.records.manage",
          "POST /console/crm/duplicates/query crm.duplicates.review",
          "GET /console/crm/parties/:partyId/duplicates crm.duplicates.review",
          "POST /console/crm/duplicate-dismissals crm.duplicates.review",
          "POST /console/crm/merges/preview crm.parties.merge",
          "POST /console/crm/merges crm.parties.merge",
          "POST /console/crm/merges/:mergeRecordId/reversal crm.parties.merge",
          "GET /console/crm/merges/:mergeRecordId crm.records.read",
          "GET /console/crm/parties/:partyId/merges crm.records.read",
          "GET /console/crm/lists crm.records.read",
          "POST /console/crm/lists crm.lists.manage",
          "PATCH /console/crm/lists/:listId crm.lists.manage",
          "POST /console/crm/lists/:listId/archive crm.lists.manage",
          "GET /console/crm/lists/:listId/members crm.records.read",
          "POST /console/crm/lists/:listId/members crm.lists.manage",
          "POST /console/crm/lists/:listId/members/removal crm.lists.manage",
          "GET /console/crm/segments crm.records.read",
          "GET /console/crm/segments/:segmentId crm.records.read",
          "POST /console/crm/segments crm.segments.manage",
          "PUT /console/crm/segments/:segmentId crm.segments.manage",
          "POST /console/crm/segments/:segmentId/archive crm.segments.manage",
          "GET /console/crm/segments/:segmentId/members crm.records.read",
          "POST /console/crm/imports crm.imports.run",
          "GET /console/crm/imports/:importId crm.imports.run",
          "GET /console/crm/imports/:importId/rows crm.imports.run",
          "POST /console/crm/imports/:importId/confirmation crm.imports.run",
        ]
      `);
    for (const route of routes) {
      expect(route).toMatchObject({ audience: 'console', module: 'crm', scope: 'tenant' });
      expect(route.path.startsWith('/console/crm/'), route.path).toBe(true);
      expect(Object.hasOwn(permissions, route.permission as string)).toBe(true);
    }
  });

  it('make every create and every queued job idempotent', () => {
    const creates = routes.filter((route) => 201 in route.responses || 202 in route.responses);
    expect(creates.map((route) => route.path)).toHaveLength(8);
    for (const route of creates) expect(route.idempotent, route.path).toBe(true);
  });

  it('need step-up to preview, confirm or reverse a merge, and to start or confirm an import', () => {
    const stepUp = routes.filter((route) => 'stepUp' in route && route.stepUp === true);
    expect(stepUp).toEqual([
      contracts.previewMerge,
      contracts.confirmMerge,
      contracts.reverseMerge,
      contracts.startImport,
      contracts.confirmImport,
    ]);
    expect(checkRoute({ ...contracts.confirmMerge, stepUp: false })).toContain(
      'Changes under crm.parties.merge need stepUp: true.',
    );
    expect(checkRoute({ ...contracts.confirmImport, stepUp: false })).toContain(
      'Changes under crm.imports.run need stepUp: true.',
    );
  });

  it('never change or remove a merge record', () => {
    const merges = routes.filter((route) => route.path.startsWith('/console/crm/merges'));
    expect(merges.every((route) => route.method === 'GET' || route.method === 'POST')).toBe(true);
    expect(
      routes.some(
        (route) =>
          route.path.includes('merge') && route.method !== 'GET' && route.method !== 'POST',
      ),
    ).toBe(false);
  });

  it('carry no search term or filter in a path or query: a query holds a cursor at most', () => {
    for (const route of routes) {
      if (route.query instanceof z.ZodType) {
        expect(requestKeys(route.query), route.path).toEqual(['cursor']);
      }
      const params = route.params instanceof z.ZodType ? requestKeys(route.params) : [];
      for (const key of params) expect(key, route.path).toMatch(/Id$/);
    }
    expect(requestKeys(contracts.searchParties.body)).toContain('term');
  });

  it('name no member, decider, importer or tenant in any request', () => {
    for (const route of routes) {
      for (const schema of schemas(route)) {
        for (const key of requestKeys(schema)) {
          expect(key, route.path).not.toMatch(
            /member|decided|decider|importer|imported|actor|tenant|user|verif(?!ication$)|merged/i,
          );
        }
      }
    }
  });

  it('refuse unknown keys in every body', () => {
    for (const route of routes) {
      const { body } = route;
      if (!(body instanceof z.ZodObject)) continue;
      expect(body.safeParse({ unexpected: true }).success, route.path).toBe(false);
    }
    for (const body of [contracts.mergeConfirmInputSchema, contracts.importStartSchema]) {
      const issues = body.safeParse({ unexpected: true }).error?.issues ?? [];
      expect(issues.some((issue) => issue.code === 'unrecognized_keys')).toBe(true);
    }
  });

  it('audit every read that answers a field marked personal, whatever the party kind', () => {
    const answersPersonal = (route: RouteContract) =>
      Object.values(route.responses).some(
        (schema) =>
          schema instanceof z.ZodType &&
          JSON.stringify(z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' })).includes(
            '"x-personal":true',
          ),
      );
    const personalRoutes = Object.entries(contracts.crmRoutes)
      .filter(([, route]) => answersPersonal(route as RouteContract))
      .map(([name]) => name);
    expect(personalRoutes).toEqual(
      expect.arrayContaining(['getOrganisationRecord', 'getTimeline']),
    );
    const audited = Object.keys(contracts.crmReadAudits);
    for (const name of audited) expect(Object.hasOwn(contracts.crmRoutes, name), name).toBe(true);
    // Recording an interaction answers the summary just written, under its own change action.
    expect(personalRoutes.filter((name) => !audited.includes(name))).toEqual(['recordInteraction']);
    expect(contracts.crmReadAudits).toMatchObject({
      getOrganisationRecord: 'crm.party.viewed',
      getPersonRecord: 'crm.party.viewed',
      getTimeline: 'crm.timeline.viewed',
    });
  });

  it('mark the personal parts of records, previews and import rows', () => {
    const current = (schema: z.ZodDiscriminatedUnion) => schema.options[0] as z.ZodObject;
    expect(
      isPersonal(current(contracts.organisationRecordSchema).shape['organisation'] as z.ZodType),
    ).toBe(true);
    expect(isPersonal(current(contracts.personRecordSchema).shape['person'] as z.ZodType)).toBe(
      true,
    );
    expect(isPersonal(contracts.mergePreviewSchema.shape.fields)).toBe(true);
    expect(isPersonal(contracts.importRowSchema.shape.values)).toBe(true);
    expect(isPersonal(contracts.interactionSchema.shape.summary.unwrap())).toBe(true);
  });
});
