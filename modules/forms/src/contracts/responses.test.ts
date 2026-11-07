// SPDX-License-Identifier: AGPL-3.0-or-later

import { projectedAnswers } from '@pixel-scientists/domain/api';
import { answerClassifications, formDefinitionSchema } from '@pixel-scientists/domain/forms';
import { messageForIssue } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';

import { formsMessages } from './messages.ts';
import {
  referenceInputSchema,
  responseQuerySchema,
  responseSchema,
  spamInputSchema,
} from './responses.ts';

const id = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';

const definition = formDefinitionSchema.parse({
  sections: [
    {
      id: 's_about',
      title: 'About you',
      fields: [
        {
          id: 'f_rating',
          type: 'yes_no',
          label: 'Did the session help?',
          classification: 'internal',
        },
        {
          id: 'f_staffonly',
          type: 'short_text',
          label: 'Case number',
          audiences: ['applicant', 'staff'],
        },
        {
          id: 'f_health',
          type: 'yes_no',
          label: 'Do you have a long-term health condition?',
          audiences: 'aggregate_only',
          classification: 'special_category',
        },
      ],
    },
  ],
});

const stored = { f_rating: true, f_staffonly: 'C-12', f_health: true };

const summary = {
  id,
  formId: id,
  formVersionId: id,
  version: 2,
  route: 'signed_in',
  personId: id,
  submittedAt: '2027-03-02T10:00:00Z',
  sentWithoutCheck: false,
  spamReason: null,
};

describe('a response for staff', () => {
  it('carries only the answers staff may see, never aggregate-only or special category ones', () => {
    const answers = projectedAnswers(definition, stored, 'staff');
    expect(answers).toEqual({ f_rating: true, f_staffonly: 'C-12' });
    const parsed = responseSchema.parse({ ...summary, definition, answers });
    expect(parsed.answers).not.toHaveProperty('f_health');
    expect(answerClassifications(definition)['f_health']).toBe('special_category');
  });

  it('carries no token, proof or client data', () => {
    const answers = projectedAnswers(definition, stored, 'staff');
    for (const extra of [
      { respondentToken: 'x' },
      { proofHash: 'x' },
      { ipAddress: '192.0.2.1' },
    ]) {
      expect(responseSchema.safeParse({ ...summary, definition, answers, ...extra }).success).toBe(
        false,
      );
    }
  });

  it('lists received responses unless asked for those without the check or spam', () => {
    expect(responseQuerySchema.parse({})).toEqual({ view: 'received' });
    expect(responseQuerySchema.safeParse({ view: 'deleted' }).success).toBe(false);
    expect(responseQuerySchema.safeParse({ personId: id }).success).toBe(false);
  });

  it('marks spam only with a reason from the list', () => {
    expect(spamInputSchema.parse({ reason: 'automated' })).toEqual({ reason: 'automated' });
    const result = spamInputSchema.safeParse({ reason: 'looks fake' });
    expect(result.error?.issues.map(messageForIssue)).toEqual([formsMessages.spamReason]);
  });

  it('finds a response by its reference, refused with a fixed message that repeats nothing', () => {
    const reference = 'B'.repeat(42) + 'A';
    expect(referenceInputSchema.parse({ reference })).toEqual({ reference });
    const result = referenceInputSchema.safeParse({ reference: 'not-a-reference' });
    expect(result.error?.issues.map(messageForIssue)).toEqual([formsMessages.reference]);
  });
});
