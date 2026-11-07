// SPDX-License-Identifier: AGPL-3.0-or-later

import { messageForIssue, messages } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { mayContactInputSchema, mayContactSchema, suppressionInputSchema } from './contact.ts';
import { hardSuppressionReasons, skipCodes, skipCodeSchema, suppressionReasons } from './lists.ts';
import { partyMessages } from './messages.ts';

const personId = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';

function problems(schema: z.ZodType, value: unknown): string[] {
  return (schema.safeParse(value).error?.issues ?? []).map((issue) => messageForIssue(issue));
}

describe('may-contact input', () => {
  it('takes a transactional message, or marketing with a purpose', () => {
    for (const message of [
      { kind: 'transactional' },
      { kind: 'marketing', purpose: 'future_funding' },
    ]) {
      const input = { personId, channel: 'email', message };
      expect(mayContactInputSchema.parse(input)).toEqual(input);
    }
  });

  it('refuses marketing without a purpose, a purpose on a service message, or another kind', () => {
    for (const message of [
      { kind: 'marketing' },
      { kind: 'transactional', purpose: 'future_funding' },
      { kind: 'newsletter' },
    ]) {
      const input = { personId, channel: 'email', message };
      expect(mayContactInputSchema.safeParse(input).success, message.kind).toBe(false);
    }
    expect(problems(mayContactInputSchema, { personId, channel: 'email', message: {} })).toEqual([
      messages.chooseAllowedValue,
    ]);
  });

  it('answers allowed, or not allowed with a skip code', () => {
    expect(mayContactSchema.parse({ allowed: true })).toEqual({ allowed: true });
    const refused = { allowed: false, code: 'suppressed' };
    expect(mayContactSchema.parse(refused)).toEqual(refused);
    expect(mayContactSchema.safeParse({ allowed: false }).success).toBe(false);
    expect(mayContactSchema.safeParse({ allowed: true, code: 'suppressed' }).success).toBe(false);
  });
});

describe('skip and reason codes', () => {
  it('are the closed lists ADR 0033 fixes, each with a label', () => {
    expect(Object.keys(skipCodes)).toEqual([
      'no_consent',
      'consent_withdrawn',
      'suppressed',
      'person_erased',
      'no_contact_point',
    ]);
    expect(Object.keys(suppressionReasons)).toEqual([
      'unsubscribed',
      'bounced',
      'complained',
      'fps_request',
      'staff_entry',
    ]);
    expect(hardSuppressionReasons).toEqual(['bounced']);
  });

  it('refuse another value with a message that says how to fix it', () => {
    expect(problems(skipCodeSchema, 'blocked')).toEqual([partyMessages.skipCode]);
    const input = { personId, channel: 'email', reason: 'removed' };
    expect(problems(suppressionInputSchema, input)).toEqual([partyMessages.suppressionReason]);
  });

  it('take a suppression with no purpose, for every marketing purpose', () => {
    const input = { personId, channel: 'post', reason: 'fps_request' };
    expect(suppressionInputSchema.parse(input)).toEqual(input);
  });
});
