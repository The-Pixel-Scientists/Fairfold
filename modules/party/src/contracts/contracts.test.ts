// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkRoute, type RouteContract } from '@pixel-scientists/domain/api';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import * as party from './index.ts';

const routes = (Object.values(party) as unknown[]).filter(
  (value): value is RouteContract =>
    typeof value === 'object' && value !== null && 'audience' in value && 'path' in value,
);

/** Every key any node of a schema names, on the given side. */
function keys(schema: z.ZodType, io: 'input' | 'output'): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (typeof node === 'object' && node !== null) {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === 'properties' && typeof value === 'object' && value !== null) {
          found.push(...Object.keys(value));
        }
        walk(value);
      }
    }
  };
  walk(z.toJSONSchema(schema, { io, unrepresentable: 'any' }));
  return found;
}

function requestSchemas(route: RouteContract): z.ZodType[] {
  return [route.params, route.query, route.body].filter(
    (schema): schema is z.ZodType => schema instanceof z.ZodType,
  );
}

function responseSchemas(route: RouteContract): z.ZodType[] {
  return Object.values(route.responses).filter(
    (schema): schema is z.ZodType => schema instanceof z.ZodType,
  );
}

describe('every party route', () => {
  it('keeps every route rule and belongs to party', () => {
    expect(routes.length).toBeGreaterThan(20);
    for (const route of routes) {
      expect(checkRoute(route), route.path).toEqual([]);
      expect(route.module, route.path).toBe('party');
    }
  });

  it('is idempotent when it is a POST that creates', () => {
    for (const route of routes.filter((r) => r.method === 'POST' && 201 in r.responses)) {
      expect(route.idempotent, route.path).toBe(true);
    }
  });

  it('never takes the tenant, actor, verifier or deciding member from a request', () => {
    const named = /tenant|actor|user|member|verifi|decid|recordedby|changedby|takenby/i;
    const serverInputs = [
      party.mergeInputSchema,
      party.mayContactInputSchema,
      party.suppressionInputSchema,
    ];
    for (const schema of [...routes.flatMap(requestSchemas), ...serverInputs]) {
      expect(keys(schema, 'input').filter((key) => named.test(key))).toEqual([]);
    }
  });

  it('lets staff change records only with the manage permission', () => {
    for (const route of Object.values(party.partyRecordRoutes)) {
      expect(route).toMatchObject({ permission: 'party.records.manage', scope: 'tenant' });
    }
  });
});

describe('portal responses', () => {
  const portalRoutes = routes.filter((route) => route.audience !== 'console');

  it('never show verification, merge state, duplicates or value history', () => {
    const banned = /verif|merge|duplicate|signal|history|previous|contacts|relationship|status/i;
    for (const route of portalRoutes) {
      for (const schema of responseSchemas(route)) {
        expect(
          keys(schema, 'output').filter((key) => banned.test(key)),
          route.path,
        ).toEqual([]);
      }
    }
  });

  it('are never the schemas the console answers with', () => {
    const portal = new Set(portalRoutes.flatMap(responseSchemas));
    for (const route of routes.filter((r) => r.audience === 'console')) {
      for (const schema of responseSchemas(route))
        expect(portal.has(schema), route.path).toBe(false);
    }
  });

  it('reach only the person in the session, or a public token', () => {
    for (const route of Object.values(party.partyPreferenceRoutes)) {
      expect(route).toMatchObject({ permission: 'party.profile.manage', scope: 'own_person' });
      expect(route.path).not.toContain(':');
    }
    for (const route of Object.values(party.partyPublicRoutes) as RouteContract[]) {
      expect(route).toMatchObject({ audience: 'public', permission: null, scope: null });
      expect(route.params ?? route.body).toBeUndefined();
      expect(keys(route.query as z.ZodType, 'input')).toEqual(['token']);
    }
  });

  it('are walked deeply enough to find a nested key', () => {
    const leaky = z.object({ identifiers: z.array(z.object({ verified: z.boolean() })) });
    expect(keys(leaky, 'output')).toContain('verified');
  });
});

describe('the unsubscribe token', () => {
  it('is base64url under a length cap', () => {
    expect(party.unsubscribeTokenSchema.safeParse('A'.repeat(32)).success).toBe(true);
    expect(party.unsubscribeTokenSchema.safeParse('a-b_C'.repeat(100)).success).toBe(true);
    for (const token of [
      'A'.repeat(31),
      'A'.repeat(513),
      `${'A'.repeat(40)}=`,
      `${'A'.repeat(40)}.`,
    ]) {
      expect(party.unsubscribeTokenSchema.safeParse(token).success).toBe(false);
    }
  });
});

describe('strict schemas', () => {
  it('refuse unknown keys', () => {
    const id = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';
    const cases: [z.ZodType, Record<string, unknown>][] = [
      [party.mergeInputSchema, { loserId: id, survivorId: id, kind: 'person' }],
      [party.relationshipInputSchema, { type: 'contact_for', personId: id }],
      [party.endRelationshipSchema, { endsOn: '2026-11-12' }],
      [party.valueHistoryQuerySchema, {}],
      [party.suppressionInputSchema, { personId: id, channel: 'email', reason: 'staff_entry' }],
    ];
    for (const [schema, value] of cases) {
      expect(schema.safeParse(value).success).toBe(true);
      expect(schema.safeParse({ ...value, tenantId: id }).success).toBe(false);
    }
  });
});
