// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The events crm listens to (ADR 0016, ADR 0034): each adds an item to a
// timeline, by reference only. crm publishes no event in v1; a merge is
// party's (`party.party.merged`), and party publishes no event yet.
//
// defineSubscriptions() refuses an event no module has defined, and the
// grants events arrive with S11-58, so the crm server declares the list
// once every module's contracts have loaded (S12-51).

import { defineSubscriptions, type EventName } from '@pixel-scientists/domain/events';

import type { InteractionKind } from './records.ts';

/** Each event, and the kind of timeline item it adds. */
export const subscribedEvents = {
  'grants.application_submitted.v1': 'application_submitted',
  'grants.decision_released.v1': 'decision_released',
} as const satisfies Record<EventName<'grants'>, InteractionKind>;

export type CrmEventName = keyof typeof subscribedEvents;

export const crmEventNames = Object.keys(subscribedEvents) as CrmEventName[];

/** Declares crm's subscriptions; throws while an event is not defined. */
export function declareCrmSubscriptions(): readonly CrmEventName[] {
  return defineSubscriptions('crm', crmEventNames);
}
