// SPDX-License-Identifier: AGPL-3.0-or-later

import { idSchema } from '@pixel-scientists/domain';
import { defineEvent, eventSubscribers, isEventName } from '@pixel-scientists/domain/events';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { crmEventNames, declareCrmSubscriptions, subscribedEvents } from './events.ts';
import { interactionKinds } from './records.ts';

describe('crm subscriptions', () => {
  it('name grants events, each adding a kind of timeline item', () => {
    expect(crmEventNames).toEqual([
      'grants.application_submitted.v1',
      'grants.decision_released.v1',
    ]);
    for (const name of crmEventNames) {
      expect(isEventName(name)).toBe(true);
      expect(interactionKinds).toContain(subscribedEvents[name]);
    }
  });

  it('are refused until the events are defined, then declared once', () => {
    expect(() => declareCrmSubscriptions()).toThrow('not defined');
    // Stand-ins for S11-58's events, in this test's own registry.
    defineEvent('grants.application_submitted.v1', {
      read: 'grants.applications.read',
      data: z.strictObject({ applicationId: idSchema, partyId: idSchema }),
    });
    defineEvent('grants.decision_released.v1', {
      read: 'grants.applications.read',
      data: z.strictObject({ decisionId: idSchema, applicationId: idSchema }),
    });
    expect(declareCrmSubscriptions()).toEqual(crmEventNames);
    expect(eventSubscribers('grants.decision_released.v1')).toEqual(['crm']);
  });
});
