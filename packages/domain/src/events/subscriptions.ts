// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Who listens to which event (ADR 0016): each subscribing module declares its
// list once in code, and publishing sends one job to each subscriber's queue.

import { moduleIds, type ModuleId } from '../platform/modules.ts';
import { definedEvent, type EventName } from './define.ts';

/** Each module's list, as declared. */
const lists = new Map<ModuleId, string>();
const subscribers = new Map<string, Set<ModuleId>>();

/**
 * Declares the events a module listens to. Refuses an event no module has
 * defined, an event listed twice, and a different list for a module that
 * already has one. Declaring the same list again is allowed, for reloads.
 */
export function defineSubscriptions<const E extends readonly EventName[]>(
  module: ModuleId,
  events: E,
): E {
  if (!(moduleIds as readonly string[]).includes(module)) {
    throw new Error(`Subscriptions are for a module, not ${module}.`);
  }
  for (const name of events) {
    if (definedEvent(name) === undefined) {
      throw new Error(`The ${module} subscriptions list ${name}, which is not defined.`);
    }
  }
  if (new Set(events).size !== events.length) {
    throw new Error(`The ${module} subscriptions list an event twice.`);
  }
  const list = [...events].sort().join();
  const previous = lists.get(module);
  if (previous !== undefined && previous !== list) {
    throw new Error(`The ${module} subscriptions are already declared with a different list.`);
  }
  lists.set(module, list);
  for (const name of events) {
    const modules = subscribers.get(name) ?? new Set();
    subscribers.set(name, modules.add(module));
  }
  return events;
}

/** The modules subscribed to an event, in `moduleIds` order. */
export function eventSubscribers(name: EventName): ModuleId[] {
  if (definedEvent(name) === undefined) throw new Error(`Event ${name} is not defined.`);
  const modules = subscribers.get(name);
  return moduleIds.filter((module) => modules?.has(module) === true);
}

export type EventQueue = `events.${ModuleId}`;

/** A subscribing module's one queue, created in a migration. */
export function eventQueue(module: ModuleId): EventQueue {
  return `events.${module}`;
}
