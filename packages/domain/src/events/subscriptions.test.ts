// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { ModuleId } from '../platform/modules.ts';
import type * as Events from './index.ts';

// A fresh registry for each test.
let events: typeof Events;

beforeEach(async () => {
  vi.resetModules();
  events = await import('./index.ts');
  for (const name of ['grants.decision_released.v1', 'party.party_erased.v1'] as const) {
    events.defineEvent(name, {
      read: 'party.records.read',
      data: z.strictObject({ partyId: z.uuid() }),
    });
  }
});

it('lists subscribers in module order, and none for an event nobody hears', () => {
  events.defineSubscriptions('insight', ['party.party_erased.v1']);
  events.defineSubscriptions('crm', ['party.party_erased.v1', 'grants.decision_released.v1']);
  expect(events.eventSubscribers('party.party_erased.v1')).toEqual(['crm', 'insight']);
  expect(events.eventSubscribers('grants.decision_released.v1')).toEqual(['crm']);
  events.defineEvent('grants.round_closed.v1', {
    read: 'grants.applications.read',
    data: z.strictObject({ roundId: z.uuid() }),
  });
  expect(events.eventSubscribers('grants.round_closed.v1')).toEqual([]);
  expect(() => events.eventSubscribers('grants.round_opened.v1')).toThrow(
    'Event grants.round_opened.v1 is not defined.',
  );
});

it('refuses an undefined event or one listed twice', () => {
  expect(() => events.defineSubscriptions('crm', ['grants.round_opened.v1'])).toThrow(
    'The crm subscriptions list grants.round_opened.v1, which is not defined.',
  );
  expect(() =>
    events.defineSubscriptions('crm', ['party.party_erased.v1', 'party.party_erased.v1']),
  ).toThrow('The crm subscriptions list an event twice.');
});

it('refuses a second, different list, but allows the same list again', () => {
  events.defineSubscriptions('crm', ['party.party_erased.v1', 'grants.decision_released.v1']);
  events.defineSubscriptions('crm', ['grants.decision_released.v1', 'party.party_erased.v1']);
  expect(() => events.defineSubscriptions('crm', ['party.party_erased.v1'])).toThrow(
    'The crm subscriptions are already declared with a different list.',
  );
  expect(events.eventSubscribers('grants.decision_released.v1')).toEqual(['crm']);
});

it('refuses a subscriber that is not a module', () => {
  expect(() => events.defineSubscriptions('ledger' as ModuleId, ['party.party_erased.v1'])).toThrow(
    'Subscriptions are for a module, not ledger.',
  );
});

it('names one queue per subscribing module', () => {
  expect(events.eventQueue('crm')).toBe('events.crm');
});
