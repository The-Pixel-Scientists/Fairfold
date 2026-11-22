// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { defineEvent, definedEvent } from '../events/define.ts';
import { approvalDecided } from './events.ts';

describe('platform.approval_decided.v1', () => {
  it('is defined with ids, an outcome and a time, read under the approvals permission', () => {
    expect(definedEvent('platform.approval_decided.v1')).toBe(approvalDecided);
    expect(approvalDecided.read).toBe('platform.approvals.read');
    expect(Object.keys(approvalDecided.data.shape)).toEqual(['requestId', 'outcome', 'decidedAt']);
  });

  it.each([
    ['a reason', { reason: z.string() }],
    ['a step label', { stepLabel: z.string().max(100) }],
    ['the approver', { actorMembershipId: z.uuid() }],
  ])('could not carry %s', (_name, extra) => {
    const data = approvalDecided.data.extend(extra);
    expect(() =>
      defineEvent('platform.approval_noted.v1', { read: 'platform.approvals.read', data }),
    ).toThrow('may carry only ids, enums, integers and timestamps');
  });
});
