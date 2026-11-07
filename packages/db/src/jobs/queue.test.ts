// SPDX-License-Identifier: AGPL-3.0-or-later

import { idSchema } from '@pixel-scientists/domain';
import {
  defineEvent,
  defineSubscriptions,
  eventEnvelope,
  eventSubscribers,
  payloadLeafProblems,
} from '@pixel-scientists/domain/events';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { defineQueue, definedQueues, eventJobQueue, isDefinedQueue } from './queue.ts';

let count = 0;
const fresh = () => `test_queue_${String((count += 1))}`;

describe('defineQueue', () => {
  it('declares a tenant queue whose payload adds the reserved fields, strict', () => {
    const queue = defineQueue(fresh(), 'tenant', z.strictObject({ applicationId: idSchema }));
    const id = '0b9f7a52-6f0e-4a8b-9a1c-1d2e3f405162';
    const platformJob = { applicationId: id, requestId: id, causingUserId: null };
    const job = { ...platformJob, tenantId: id };
    expect(queue.payload.safeParse(job).success).toBe(true);
    expect(queue.payload.safeParse({ ...job, extra: 1 }).success).toBe(false);
    const platform = defineQueue(fresh(), 'platform', z.strictObject({ applicationId: idSchema }));
    expect(platform.payload.safeParse(platformJob).success).toBe(true);
    expect(platform.payload.safeParse(job).success).toBe(false);
  });

  it.each([
    ['an object that takes unknown keys', z.object({ id: idSchema }), 'takes unknown keys'],
    ['a passthrough object', z.looseObject({ id: idSchema }), 'takes unknown keys'],
    ['free text', z.strictObject({ note: z.string() }), 'note is a string'],
    ['an email address', z.strictObject({ to: z.email() }), 'to is a string'],
    ['a decimal', z.strictObject({ score: z.number() }), 'score is a number'],
    ['a default', z.strictObject({ id: idSchema.default(() => '') }), 'id is default'],
    ['a nested string', z.strictObject({ a: z.strictObject({ b: z.string() }) }), 'a.b is'],
    ['a payload that is not an object', z.strictObject({}).or(z.strictObject({})), 'not an'],
  ])('refuses %s, naming the path', (_, schema, message) => {
    expect(() => defineQueue(fresh(), 'tenant', schema as z.ZodObject)).toThrow(message);
  });

  it.each([
    'tenantId',
    'requestId',
    'causingUserId',
    'tenant_id',
    'actorId',
    'createdBy',
    'updated_by',
    'applicantUserId',
  ])('refuses a %s key, at any depth', (key) => {
    const flat = z.strictObject({ [key]: idSchema });
    const nested = z.strictObject({ about: z.strictObject({ [key]: idSchema }).nullable() });
    expect(() => defineQueue(fresh(), 'tenant', flat)).toThrow(`${key} is set by the send helper`);
    expect(() => defineQueue(fresh(), 'platform', nested)).toThrow(`about.${key} is set`);
  });

  it('refuses a name defined twice, an events. name and an unknown kind', () => {
    const name = fresh();
    const schema = z.strictObject({ id: idSchema });
    defineQueue(name, 'tenant', schema);
    expect(() => defineQueue(name, 'tenant', schema)).toThrow('already defined');
    expect(() => defineQueue('events.grants', 'tenant', schema)).toThrow('events.');
    expect(() => defineQueue('Bad Name', 'tenant', schema)).toThrow('lower-case');
    expect(() => defineQueue(fresh(), 'global' as 'tenant', schema)).toThrow('tenant or platform');
  });

  it('never quotes a value in a refusal', () => {
    const schema = z.strictObject({ kind: z.literal('secret-value').or(z.literal(7)) });
    expect(() => defineQueue(fresh(), 'tenant', schema as z.ZodObject)).not.toThrow(/secret-value/);
  });
});

describe('a defined queue', () => {
  it('is frozen, and a copy of it is not a defined queue', () => {
    const queue = defineQueue(fresh(), 'tenant', z.strictObject({ id: idSchema }));
    expect(Object.isFrozen(queue)).toBe(true);
    expect(isDefinedQueue(queue)).toBe(true);
    expect(isDefinedQueue({ ...queue })).toBe(false);
    expect(isDefinedQueue({ ...queue, data: z.looseObject({}) })).toBe(false);
  });
});

describe('an event queue', () => {
  const event = defineEvent('grants.jobs_queue_test_fact.v1', {
    read: 'grants.applications.read',
    data: z.strictObject({ applicationId: idSchema }),
  });
  const id = '0b9f7a52-6f0e-4a8b-9a1c-1d2e3f405162';
  const envelope = {
    id,
    type: event.name,
    tenantId: id,
    sequence: null,
    occurredAt: '2026-11-17T09:00:00.000Z',
    requestId: id,
    causedBy: null,
    data: { applicationId: id },
  };

  it('takes only an envelope its defined event accepts, naming paths only', () => {
    const { data } = eventJobQueue('privacy');
    expect(data.safeParse({ event: envelope })).toMatchObject({
      success: true,
      data: { event: envelope },
    });
    for (const [bad, path] of [
      [{ email: 'jane@example.test', note: 'free text' }, 'event.type'],
      [{ ...envelope, data: { applicationId: id, email: 'jane@example.test' } }, 'event.data'],
      [{ ...envelope, extra: 'free text' }, 'event'],
      [{ ...envelope, type: 'grants.unknown.v1' }, 'event.type'],
    ] as const) {
      const result = data.safeParse({ event: bad });
      expect(result.success).toBe(false);
      const paths = result.error?.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain(path);
      expect(
        JSON.stringify(result.error?.issues.map(({ path: p, message }) => [p, message])),
      ).not.toMatch(/jane|free text/);
    }
  });
});

describe('every queue payload', () => {
  it('holds only ids, enums, integers and timestamps, event envelopes included', () => {
    const event = defineEvent('grants.jobs_test_fact.v1', {
      read: 'grants.applications.read',
      data: z.strictObject({ applicationId: idSchema, stage: z.enum(['open', 'closed']) }),
    });
    defineSubscriptions('crm', [event.name]);
    const subscribers = eventSubscribers(event.name).map((module) => eventJobQueue(module).name);
    expect(subscribers).toEqual(['events.crm']);

    for (const queue of definedQueues()) {
      // Only eventJobQueue() makes an events. queue; its envelopes are checked below.
      if (queue.name.startsWith('events.')) continue;
      expect(payloadLeafProblems(queue.data), queue.name).toEqual([]);
    }
    expect(payloadLeafProblems(eventEnvelope(event))).toEqual([]);
  });
});
