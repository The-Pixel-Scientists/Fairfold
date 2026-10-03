// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { idSchema } from '../id.ts';
import { slugSchema } from '../platform/tenant.ts';
import { paramProblems, requestProblems, responseProblems } from './schema-rules.ts';

const PATH = '/console/programmes/:programmeId';

type Node = z.ZodType;
const Recursive: Node = z.lazy(() => z.strictObject({ children: z.array(Recursive) }));
const Named = z.strictObject({ name: z.string() }).meta({ id: 'SchemaRulesTestNamed' });

describe('requestProblems', () => {
  it('passes strict objects at every depth, and records whose keys are checked', () => {
    const body = z.strictObject({
      title: z.string(),
      stages: z.array(z.strictObject({ name: z.string() })),
      answers: z.record(z.string().regex(/^f_[a-z0-9]+$/), z.string()),
      scores: z.record(idSchema, z.int()),
      lead: Named,
      deputy: Named,
      note: z
        .string()
        .transform((text) => text.trim())
        .pipe(z.string()),
    });
    expect(requestProblems(PATH, 'body', body)).toEqual([]);
  });

  it('refuses a transform whose result is untyped or names the acting user or tenant', () => {
    const a = z.string();
    for (const schema of [
      z.string().transform((text): unknown => JSON.parse(text)),
      z.strictObject({ a }).transform((value) => ({ tenantId: value.a })),
      z.string().pipe(z.custom<string>(() => true)),
      z.codec(z.string(), z.any(), { decode: (text) => text, encode: (value) => String(value) }),
      z
        .string()
        .transform((text) => ({ tenantId: text }))
        .pipe(z.strictObject({ tenantId: z.string() })),
    ]) {
      expect(requestProblems(PATH, 'body', schema)).not.toEqual([]);
      expect(requestProblems(PATH, 'body', z.strictObject({ value: schema }))).not.toEqual([]);
    }
  });

  it('refuses a key that is not a plain ASCII name', () => {
    const message = 'body has a key that is not a plain ASCII name.';
    // A Cyrillic e, fullwidth letters, and names with other characters.
    const cyrillicE = String.fromCodePoint(0x435);
    const fullwidth = String.fromCodePoint(0xff54, 0xff45, 0xff4e, 0xff41, 0xff4e, 0xff54);
    const lookAlikes = [`t${cyrillicE}nantId`, `${fullwidth}Id`];
    for (const key of [...lookAlikes, 'user-id', '1st', 'a key']) {
      expect(requestProblems(PATH, 'body', z.strictObject({ [key]: z.string() }))).toContain(
        message,
      );
    }
  });

  it('counts a record key pattern as a check only if it refuses identity names', () => {
    for (const pattern of [/.*/, /^[a-z_]+$/, /^[A-Za-z]+$/]) {
      const record = z.record(z.string().regex(pattern), z.string());
      expect(requestProblems(PATH, 'body', z.strictObject({ record }))).not.toEqual([]);
    }
  });

  it('refuses an object or record that takes keys it does not name or check, at any depth', () => {
    for (const schema of [
      z.object({ title: z.string() }),
      z.looseObject({}),
      z.strictObject({ stages: z.array(z.object({ name: z.string() })) }),
      z.strictObject({ answers: z.record(z.string(), z.string()) }),
    ]) {
      expect(requestProblems(PATH, 'body', schema)).not.toEqual([]);
    }
  });

  it('refuses values of any type, and custom or recursive schemas', () => {
    for (const value of [z.any(), z.unknown(), z.custom<string>(() => true), z.json(), Recursive]) {
      expect(requestProblems(PATH, 'body', z.strictObject({ value }))).not.toEqual([]);
    }
  });

  it('needs params and query to be objects', () => {
    expect(requestProblems(PATH, 'query', z.string())).toContain('query must be an object.');
  });

  it('refuses the acting user or tenant in any part, spelling or depth', () => {
    const keys = [
      'tenantId',
      'tenant_id',
      'TENANT',
      'targetTenant',
      'userId',
      'USER-ID',
      'actorId',
      'actor_kind',
      'createdBy',
      'updated_by',
    ];
    for (const key of keys) {
      for (const part of ['params', 'query', 'body'] as const) {
        expect(requestProblems(PATH, part, z.strictObject({ [key]: idSchema })), key).not.toEqual(
          [],
        );
      }
    }
    const nested = z.union([
      z.strictObject({ title: z.string() }),
      z.strictObject({ owner: z.strictObject({ userId: idSchema }) }),
    ]);
    expect(requestProblems(PATH, 'body', nested)).not.toEqual([]);
  });

  it('refuses an identity name listed as a record key', () => {
    const record = z.record(z.enum(['tenantId', 'title']), z.string());
    expect(requestProblems(PATH, 'body', z.strictObject({ record }))).not.toEqual([]);
    const single = z.record(z.literal('createdBy'), z.string());
    expect(requestProblems(PATH, 'body', z.strictObject({ single }))).not.toEqual([]);
  });

  it('allows a slug only as the :slug of a public or auth tenant path', () => {
    const slug = z.strictObject({ slug: z.string() });
    expect(requestProblems('/public/tenants/:slug', 'params', slug)).toEqual([]);
    expect(requestProblems('/auth/tenants/:slug/sign-in', 'params', slug)).toEqual([]);
    expect(requestProblems('/console/tenants/:slug', 'params', slug)).not.toEqual([]);
    expect(requestProblems('/public/tenants/:slug', 'query', slug)).not.toEqual([]);
    const body = z.strictObject({ tenantSlug: z.string() });
    expect(requestProblems('/auth/tenants/:slug/sign-in', 'body', body)).not.toEqual([]);
  });

  it('keeps email addresses out of URLs', () => {
    const lookup = z.strictObject({ address: z.email() });
    expect(requestProblems(PATH, 'query', lookup)).not.toEqual([]);
    expect(requestProblems(PATH, 'params', z.strictObject({ email: z.email() }))).not.toEqual([]);
    expect(requestProblems(PATH, 'body', lookup)).toEqual([]);
  });
});

describe('paramProblems', () => {
  it('passes required ids and the tenant slug', () => {
    expect(paramProblems(['programmeId'], z.strictObject({ programmeId: idSchema }))).toEqual([]);
    expect(paramProblems(['slug'], z.strictObject({ slug: slugSchema }))).toEqual([]);
    expect(paramProblems([], undefined)).toEqual([]);
  });

  it('needs params to name exactly the path parameters', () => {
    const message = 'params must name exactly the path parameters.';
    expect(paramProblems(['programmeId'], undefined)).toContain(message);
    const extra = z.strictObject({ programmeId: idSchema, roundId: idSchema });
    expect(paramProblems(['programmeId'], extra)).toContain(message);
  });

  it('refuses a parameter that is free text, optional, or a look-alike of an id or slug', () => {
    for (const programmeId of [
      z.string(),
      z.string().regex(/^[a-z.]+$/),
      idSchema.optional(),
      z.string().meta({ format: 'uuid' }),
    ]) {
      expect(paramProblems(['programmeId'], z.strictObject({ programmeId }))).not.toEqual([]);
    }
    const looseSlug = z.strictObject({ slug: z.string().min(3) });
    expect(paramProblems(['slug'], looseSlug)).not.toEqual([]);
    const idAsSlug = z.strictObject({ slug: idSchema });
    expect(paramProblems(['slug'], idAsSlug)).not.toEqual([]);
  });
});

describe('responseProblems', () => {
  const item = z.object({ id: idSchema, title: z.string(), note: z.string().nullable() });

  it('passes typed objects, nullable values and records with checked keys', () => {
    expect(responseProblems('200', item)).toEqual([]);
    expect(responseProblems('200', z.record(z.enum(['draft', 'open']), z.int()))).toEqual([]);
  });

  it('describes success responses only, with a body except on 202 and 204', () => {
    expect(responseProblems('404', item)).not.toEqual([]);
    expect(responseProblems('200', null)).not.toEqual([]);
    expect(responseProblems('202', null)).toEqual([]);
    expect(responseProblems('204', null)).toEqual([]);
  });

  it('refuses values of any type, unchecked keys, and JSON of any shape', () => {
    for (const schema of [
      z.unknown(),
      z.object({ data: z.any() }),
      z.looseObject({ id: idSchema }),
      z.record(z.string(), z.number()),
      z.record(z.string().regex(/.*/), z.number()),
      z.object({ data: z.json() }),
      Recursive,
      z.object({ data: z.union([z.string(), z.array(z.string()), z.strictObject({})]) }),
      z.object({ when: z.date() }),
      z.object({ count: z.string().transform(Number) }),
    ]) {
      expect(responseProblems('200', schema)).not.toEqual([]);
    }
  });
});
