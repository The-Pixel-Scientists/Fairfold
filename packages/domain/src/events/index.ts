// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Event contracts (ADR 0016, ADR 0034): the `/events` subpath of the domain
// package. Publishing and the outbox live in packages/db.

import '../jitless/index.ts';

export {
  defineEvent,
  definedEvent,
  isEventName,
  type EventDefinition,
  type EventName,
} from './define.ts';
export { EventParseError, eventEnvelope, parseEvent, type EventEnvelope } from './envelope.ts';
export { markRestricted, payloadLeafProblems, type LeafProblem } from './payload.ts';
export {
  defineSubscriptions,
  eventQueue,
  eventSubscribers,
  type EventQueue,
} from './subscriptions.ts';
