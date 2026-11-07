// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { requestProblems } from '../api/schema-rules.ts';
import { idSchema } from '../id.ts';
import { eventDataProblems, markRestricted, payloadLeafProblems } from './payload.ts';

const leaf = (schema: z.ZodType) => payloadLeafProblems(z.strictObject({ value: schema }));

describe('payloadLeafProblems', () => {
  it('passes ids, enums, integers and timestamps in strict objects at any depth', () => {
    const schema = z.strictObject({
      applicationId: idSchema,
      partyId: z.uuidv4(),
      stage: z.enum(['open', 'closed']),
      kind: z.literal('award'),
      count: z.int().positive(),
      round: z.number().int().max(100),
      small: z.int32(),
      at: z.iso.datetime(),
      local: z.iso.datetime({ offset: true, precision: 3 }),
      nested: z.strictObject({ id: idSchema.nullable(), when: z.iso.datetime().optional() }),
      maybe: z.strictObject({ id: idSchema }).optional().nullable(),
    });
    expect(payloadLeafProblems(schema)).toEqual([]);
  });

  it.each([
    ['a plain string', z.string(), 'is a string'],
    ['an email', z.email(), 'is a string'],
    ['a URL', z.url(), 'is a string'],
    ['a regex-checked string', z.string().regex(/^[a-z]+$/), 'has a refinement or transform'],
    ['a string uuid', z.string().check(z.uuid()), 'has a refinement or transform'],
    [
      'a uuid with its own pattern',
      z.uuid({ pattern: /.*/ } as never),
      'is a uuid with its own pattern',
    ],
    ['a local timestamp', z.iso.datetime({ local: true }), 'is a timestamp without an offset'],
    ['a date string', z.iso.date(), 'is a string'],
    ['a number', z.number(), 'is a number that is not an integer'],
    ['a float', z.float64(), 'is a number that is not an integer'],
    ['a refined integer', z.int().refine((n) => n > 0), 'has a refinement or transform'],
    [
      'a float with a float check',
      z.number().check(z.float32()),
      'is a number that is not an integer',
    ],
    ['a boolean', z.boolean(), 'is boolean, not an id, enum, integer or timestamp'],
    ['a date', z.date(), 'is date, not an id, enum, integer or timestamp'],
    ['a bigint', z.bigint(), 'is bigint, not an id, enum, integer or timestamp'],
    ['an array', z.array(idSchema), 'is array, not an id, enum, integer or timestamp'],
    ['a tuple', z.tuple([idSchema]), 'is tuple, not an id, enum, integer or timestamp'],
    ['a record', z.record(idSchema, z.int()), 'is record, not an id, enum, integer or timestamp'],
    ['a map', z.map(idSchema, z.int()), 'is map, not an id, enum, integer or timestamp'],
    ['a set', z.set(idSchema), 'is set, not an id, enum, integer or timestamp'],
    ['a union', z.union([idSchema, z.int()]), 'is union, not an id, enum, integer or timestamp'],
    [
      'an intersection',
      z.intersection(z.strictObject({}), z.strictObject({})),
      'is intersection, not an id, enum, integer or timestamp',
    ],
    ['any', z.any(), 'is any, not an id, enum, integer or timestamp'],
    ['unknown', z.unknown(), 'is unknown, not an id, enum, integer or timestamp'],
    [
      'a transform',
      idSchema.transform((id) => id),
      'is pipe, not an id, enum, integer or timestamp',
    ],
    ['a pipe', idSchema.pipe(idSchema), 'is pipe, not an id, enum, integer or timestamp'],
    [
      'a preprocessor',
      z.preprocess((value) => value, idSchema),
      'is pipe, not an id, enum, integer or timestamp',
    ],
    ['an overwrite', idSchema.overwrite(() => 'Ada'), 'has a refinement or transform'],
    ['a refined id', idSchema.refine(() => true), 'has a refinement or transform'],
    ['a default', z.int().default(1), 'is default, not an id, enum, integer or timestamp'],
    ['a catch', z.int().catch(1), 'is catch, not an id, enum, integer or timestamp'],
    ['a lazy schema', z.lazy(() => idSchema), 'is lazy, not an id, enum, integer or timestamp'],
    ['a number enum', z.enum({ a: 1, b: 2 }), 'is an enum with values that are not strings'],
    ['a number literal', z.literal(1), 'is a literal that is not a string'],
    ['a loose object', z.object({ id: idSchema }), 'is an object that takes unknown keys'],
    ['a passthrough object', z.looseObject({}), 'is an object that takes unknown keys'],
    [
      'an object with a catch-all',
      z.strictObject({}).catchall(z.int()),
      'is an object that takes unknown keys',
    ],
  ])('refuses %s', (_, schema, reason) => {
    expect(leaf(schema)).toEqual([{ path: 'value', reason }]);
  });

  it('names the path of a nested leaf, never its value', () => {
    const schema = z.strictObject({ outer: z.strictObject({ note: z.string().optional() }) });
    expect(payloadLeafProblems(schema)).toEqual([{ path: 'outer.note', reason: 'is a string' }]);
  });

  it('allows the tenant and actor in job payloads, which ADR 0009 requires', () => {
    expect(payloadLeafProblems(z.strictObject({ tenantId: idSchema, userId: idSchema }))).toEqual(
      [],
    );
  });
});

describe('eventDataProblems', () => {
  it('needs a strict object at the root', () => {
    for (const schema of [idSchema, z.strictObject({}).optional()]) {
      expect(eventDataProblems(schema)).toEqual([{ path: '', reason: 'is not a strict object' }]);
    }
  });

  it('refuses a key naming the tenant or acting user, as request bodies do', () => {
    const reason = 'names the tenant or acting user, which the envelope carries';
    for (const key of ['tenantId', 'tenant_id', 'actorId', 'userId', 'user_id', 'createdBy']) {
      expect(requestProblems('/x', 'body', z.strictObject({ [key]: idSchema }))).not.toEqual([]);
      expect(
        eventDataProblems(z.strictObject({ nested: z.strictObject({ [key]: idSchema }) })),
      ).toEqual([{ path: `nested.${key}`, reason }]);
    }
  });

  it('refuses a key that is not a plain ASCII name', () => {
    const lookAlike = `t${String.fromCodePoint(0x435)}nantId`;
    expect(eventDataProblems(z.strictObject({ [lookAlike]: idSchema }))).toEqual([
      { path: lookAlike, reason: 'is not a plain ASCII name' },
    ]);
  });

  it('refuses a restricted schema, however it is wrapped or copied', () => {
    const outcome = markRestricted(z.enum(['awarded', 'declined']));
    const reason = 'reuses a restricted schema';
    for (const schema of [outcome, outcome.optional(), outcome.nullable(), outcome.meta({})]) {
      expect(eventDataProblems(z.strictObject({ outcome: schema }))).toEqual([
        { path: 'outcome', reason },
      ]);
    }
    expect(payloadLeafProblems(z.strictObject({ outcome }))).toEqual([]);
  });
});
