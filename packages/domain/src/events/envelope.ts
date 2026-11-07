// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The envelope every event travels in (ADR 0034): set by the publish helper
// from the transaction and session, never from the publisher's data. The
// tenant, request and causing membership are for audit only, never for
// permission checks (ADR 0009). The webhook envelope leaves them out.

import { z } from 'zod';

import { idSchema } from '../id.ts';
import { definedEvent, isEventName, type EventDefinition, type EventName } from './define.ts';

const envelopeFields = {
  id: idSchema,
  tenantId: idSchema,
  /** The tenant's number, assigned by the outbox; null until the outbox writes it. */
  sequence: z.int().positive().nullable(),
  occurredAt: z.iso.datetime({ offset: true }),
  requestId: idSchema,
  /** The membership whose action caused the event; null for the system. */
  causedBy: idSchema.nullable(),
};

/** The strict envelope of one event, its `data` checked by the event's own schema. */
export function eventEnvelope<N extends EventName, D extends z.ZodObject>(
  event: EventDefinition<N, D>,
) {
  return z.strictObject({ ...envelopeFields, type: z.literal(event.name), data: event.data });
}

export type EventEnvelope<E extends EventDefinition = EventDefinition> = z.infer<
  ReturnType<typeof eventEnvelope<E['name'], E['data']>>
>;

/** Names the event's type (when it is a well-formed name) and the failing paths, never a value. */
export class EventParseError extends Error {
  readonly type: EventName | null;
  readonly paths: readonly string[];

  constructor(type: EventName | null, paths: readonly string[]) {
    super(`Event ${type ?? 'of unknown type'} is not valid at ${paths.join(', ')}.`);
    this.name = 'EventParseError';
    this.type = type;
    this.paths = paths;
  }
}

/** Validates an envelope against its defined event, as the outbox writer and relay do. */
export function parseEvent(input: unknown): EventEnvelope {
  const type: unknown =
    typeof input === 'object' && input !== null ? (input as { type?: unknown }).type : undefined;
  const event = typeof type === 'string' ? definedEvent(type) : undefined;
  if (event === undefined) {
    throw new EventParseError(typeof type === 'string' && isEventName(type) ? type : null, [
      'type',
    ]);
  }
  const result = eventEnvelope(event).safeParse(input);
  if (!result.success) {
    const paths = result.error.issues.map(({ path }) => path.join('.') || 'the envelope');
    throw new EventParseError(event.name, [...new Set(paths)]);
  }
  return result.data;
}
