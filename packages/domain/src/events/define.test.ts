// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { idSchema } from '../id.ts';
import type { Permission } from '../platform/access.ts';
import { defineEvent, definedEvent, isEventName, type EventName } from './define.ts';

const read = 'grants.applications.read';
const data = () => z.strictObject({ applicationId: idSchema });

describe('defineEvent', () => {
  it('defines a versioned fact and finds it by name', () => {
    const event = defineEvent('grants.application_submitted.v1', { read, data: data() });
    expect(event.name).toBe('grants.application_submitted.v1');
    expect(definedEvent('grants.application_submitted.v1')).toBe(event);
    expect(definedEvent('grants.application_submitted.v2')).toBeUndefined();
  });

  it.each([
    'grants.DecisionReleased.v1',
    'grants.decision-released.v1',
    'grants._released.v1',
    'grants.released',
    'grants.released.v0',
    'grants.released.v01',
    'grants.released.v1.5',
    'grants.decision.released.v1',
    'ledger.released.v1',
    'Grants.released.v1',
  ])('refuses the name %s', (name) => {
    expect(() => defineEvent(name as EventName, { read, data: data() })).toThrow(
      `Event ${name} must be <module>.<fact>.v<n>`,
    );
    expect(isEventName(name)).toBe(false);
  });

  it('checks names at compile time too', () => {
    // @ts-expect-error -- not a module
    expect(() => defineEvent('ledger.paid.v1', { read, data: data() })).toThrow();
    // @ts-expect-error -- no version
    expect(() => defineEvent('grants.paid', { read, data: data() })).toThrow();
  });

  it('needs a known read permission', () => {
    for (const permission of [undefined, 'grants.everything.read', 'toString']) {
      expect(() =>
        defineEvent('grants.unread.v1', { read: permission as Permission, data: data() }),
      ).toThrow('Event grants.unread.v1 must name the permission needed to read it.');
    }
  });

  it('names the event and the path of each refused leaf', () => {
    const schema = z.strictObject({ name: z.string(), flags: z.strictObject({ on: z.boolean() }) });
    expect(() => defineEvent('crm.person_named.v1', { read, data: schema })).toThrow(
      'Event crm.person_named.v1 may carry only ids, enums, integers and timestamps: ' +
        'name is a string; flags.on is boolean, not an id, enum, integer or timestamp.',
    );
    expect(definedEvent('crm.person_named.v1')).toBeUndefined();
  });

  it('allows the same definition again, as after a reload', () => {
    const first = defineEvent('grants.decision_released.v1', { read, data: data() });
    const again = defineEvent('grants.decision_released.v1', { read, data: data() });
    expect(definedEvent(first.name)).toBe(again);
  });

  it('refuses a different payload or permission under a defined name', () => {
    defineEvent('grants.round_closed.v1', { read, data: data() });
    const changed = z.strictObject({ applicationId: idSchema, roundId: idSchema });
    expect(() => defineEvent('grants.round_closed.v1', { read, data: changed })).toThrow(
      'Event grants.round_closed.v1 is already defined differently; publish a new version.',
    );
    expect(() =>
      defineEvent('grants.round_closed.v1', { read: 'grants.data.export', data: data() }),
    ).toThrow('already defined differently');
  });

  it('keeps v1 and v2 of a fact side by side', () => {
    const v1 = defineEvent('assure.screening_match_found.v1', {
      read: 'assure.screening.read',
      data: z.strictObject({ partyId: idSchema }),
    });
    const v2 = defineEvent('assure.screening_match_found.v2', {
      read: 'assure.screening.read',
      data: z.strictObject({ partyId: idSchema, checkId: idSchema }),
    });
    expect(definedEvent(v1.name)).toBe(v1);
    expect(definedEvent(v2.name)).toBe(v2);
  });
});
