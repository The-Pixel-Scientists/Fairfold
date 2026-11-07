// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Job queues (ADR 0009, "Payloads, results and classification"): each is
// declared once with its kind and a strict payload schema whose leaves are
// only ids, enums, integers and timestamps. The send helper owns the
// reserved fields, so no queue schema may declare them or any other key
// naming the tenant or acting user.

import { idSchema } from '@pixel-scientists/domain';
import {
  EventParseError,
  eventQueue,
  parseEvent,
  payloadLeafProblems,
  type EventEnvelope,
} from '@pixel-scientists/domain/events';
import type { ModuleId } from '@pixel-scientists/domain/platform';
import { z } from 'zod';

export type QueueKind = 'tenant' | 'platform';

export interface Queue<S extends z.ZodObject = z.ZodObject, K extends QueueKind = QueueKind> {
  readonly name: string;
  readonly kind: K;
  /** What the caller sends, without the reserved fields. */
  readonly data: S;
  /** The stored payload: `data` and the reserved fields, strict. */
  readonly payload: z.ZodObject;
}

/** The words api/schema-rules.ts refuses in keys, and the request id the helper sets. */
const IDENTITY_WORDS = ['tenant', 'actor', 'createdby', 'updatedby', 'userid', 'requestid'];
const NAME = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/;

const defined = new Map<string, Queue>();

function identityKeys(schema: z.core.$ZodType, path: string): string[] {
  const def = schema._zod.def;
  if (def.type === 'optional' || def.type === 'nullable') {
    return identityKeys((def as z.core.$ZodOptionalDef).innerType, path);
  }
  if (def.type !== 'object') return [];
  return Object.entries((def as z.core.$ZodObjectDef).shape).flatMap(([key, value]) => {
    const at = path === '' ? key : `${path}.${key}`;
    const name = key.toLowerCase().replaceAll('_', '');
    const own = IDENTITY_WORDS.some((word) => name.includes(word)) ? [at] : [];
    return [...own, ...identityKeys(value, at)];
  });
}

function register<S extends z.ZodObject, K extends QueueKind>(
  name: string,
  kind: K,
  data: S,
): Queue<S, K> {
  if (defined.has(name)) throw new Error(`Queue ${name} is already defined.`);
  const reserved = { requestId: idSchema, causingUserId: idSchema.nullable() };
  const payload = data.extend(kind === 'tenant' ? { ...reserved, tenantId: idSchema } : reserved);
  const queue = Object.freeze({ name, kind, data, payload });
  defined.set(name, queue);
  return queue;
}

/** Whether `queue` is the instance defineQueue() or eventJobQueue() made, not a look-alike. */
export function isDefinedQueue(queue: Queue): boolean {
  return defined.get(queue.name) === queue;
}

/**
 * Declares a queue. Refuses a name already defined or in the event queues'
 * `events.` namespace, a schema that is not a strict object, any leaf other
 * than an id, enum, integer or timestamp, and any key that names the
 * tenant, the acting user or the request. Errors name paths, never values.
 */
export function defineQueue<S extends z.ZodObject, K extends QueueKind>(
  name: string,
  kind: K,
  data: S,
): Queue<S, K> {
  if (!NAME.test(name) || name.startsWith('events.')) {
    throw new Error(`Queue name ${name} must be lower-case words and not start with events.`);
  }
  if ((kind as string) !== 'tenant' && (kind as string) !== 'platform') {
    throw new Error(`Queue ${name} must be a tenant or platform queue.`);
  }
  const problems = payloadLeafProblems(data).map(({ path, reason }) => `${path} ${reason}`);
  if ((data._zod.def as { type: string }).type !== 'object') {
    problems.unshift('the payload is not an object');
  }
  problems.push(...identityKeys(data, '').map((path) => `${path} is set by the send helper`));
  if (problems.length > 0) {
    throw new Error(`Queue ${name} payload is refused: ${problems.join('; ')}.`);
  }
  return register(name, kind, data);
}

/** An event job's envelope, checked against its defined event as the outbox does. */
const envelope = z.unknown().transform((value, ctx): EventEnvelope => {
  try {
    return parseEvent(value);
  } catch (error) {
    if (!(error instanceof EventParseError)) throw error;
    for (const path of error.paths) {
      // parseEvent() names a refusal of the envelope as a whole 'the envelope'.
      const at = path === 'the envelope' ? [] : path.split('.');
      ctx.addIssue({ code: 'custom', message: 'is not a valid event', path: at });
    }
    return z.NEVER;
  }
});
const eventJob = z.strictObject({ event: envelope });

/** A subscribing module's event queue, whose jobs carry one event envelope each. */
export function eventJobQueue(module: ModuleId): Queue<typeof eventJob, 'tenant'> {
  const name = eventQueue(module);
  const queue = defined.get(name);
  return (
    (queue as Queue<typeof eventJob, 'tenant'> | undefined) ?? register(name, 'tenant', eventJob)
  );
}

/** Every queue this process has defined, event queues included. */
export function definedQueues(): readonly Queue[] {
  return [...defined.values()];
}
