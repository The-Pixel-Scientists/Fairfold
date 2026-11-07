// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Event names (ADR 0016, ADR 0034): a versioned, past-tense fact such as
// `grants.decision_released.v1`, defined once in the publisher's contracts
// with the permission needed to read it and its ids-only payload. A change is
// a new version beside the old one, never an edit.

import { z } from 'zod';

import { permissions, type Permission } from '../platform/access.ts';
import { moduleIds, type ModuleId } from '../platform/modules.ts';
import { eventDataProblems } from './payload.ts';

export type EventName<M extends ModuleId = ModuleId> = `${M}.${string}.v${number}`;

export interface EventDefinition<
  N extends EventName = EventName,
  D extends z.ZodObject = z.ZodObject,
> {
  readonly name: N;
  /** Who may read the event, for webhook subscriptions and feeds (ADR 0034). */
  readonly read: Permission;
  readonly data: D;
}

const NAME = /^([a-z]+)\.[a-z][a-z_]*\.v[1-9]\d*$/;

/** Each defined event, with what it was defined with. */
const defined = new Map<string, { event: EventDefinition; signature: string }>();

/** Whether a string is in the form `<module>.<fact>.v<n>`, for a known module. */
export function isEventName(name: string): name is EventName {
  const module = NAME.exec(name)?.[1];
  return module !== undefined && (moduleIds as readonly string[]).includes(module);
}

export function definedEvent(name: string): EventDefinition | undefined {
  return defined.get(name)?.event;
}

/**
 * Defines an event. Refuses a name in the wrong form or for an unknown
 * module, a missing read permission, a payload that could carry more than
 * ids, enums, integers and timestamps, and a name already defined
 * differently. Defining the same event again is allowed, since development
 * servers re-run a module when they reload it.
 */
export function defineEvent<const N extends EventName, D extends z.ZodObject>(
  name: N,
  contract: { readonly read: Permission; readonly data: D },
): EventDefinition<N, D> {
  const text: string = name;
  if (!isEventName(text)) {
    throw new Error(
      `Event ${text} must be <module>.<fact>.v<n>: a module id, a lower-case snake_case fact and a version from 1.`,
    );
  }
  if (!Object.hasOwn(permissions, contract.read)) {
    throw new Error(`Event ${name} must name the permission needed to read it.`);
  }
  const problems = eventDataProblems(contract.data);
  if (problems.length > 0) {
    const list = problems.map(({ path, reason }) => `${path || 'the payload'} ${reason}`);
    throw new Error(
      `Event ${name} may carry only ids, enums, integers and timestamps: ${list.join('; ')}.`,
    );
  }
  const signature = JSON.stringify([contract.read, z.toJSONSchema(contract.data)]);
  const previous = defined.get(name);
  if (previous !== undefined && previous.signature !== signature) {
    throw new Error(`Event ${name} is already defined differently; publish a new version.`);
  }
  const event = { name, read: contract.read, data: contract.data };
  defined.set(name, { event, signature });
  return event;
}
