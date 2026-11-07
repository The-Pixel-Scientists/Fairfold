// SPDX-License-Identifier: AGPL-3.0-or-later

import { projectedAnswers } from '@pixel-scientists/domain/api';
import { formDefinitionSchema } from '@pixel-scientists/domain/forms';
import { describe, expect, it } from 'vitest';

import { myResponseSchema, portalAnswersInputSchema } from './portal.ts';

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

describe('a response for the respondent', () => {
  it('shows them every answer of theirs, and no staff data or spam state', () => {
    const answers = projectedAnswers(definition, stored, 'respondent');
    expect(answers).toEqual(stored);
    const mine = {
      id,
      formId: id,
      formTitle: 'Feedback',
      submittedAt: '2027-03-02T10:00:00Z',
      formVersionId: id,
      definition,
      answers,
    };
    expect(myResponseSchema.parse(mine)).toEqual(mine);
    for (const extra of [{ spamReason: null }, { personId: id }, { sentWithoutCheck: false }]) {
      expect(myResponseSchema.safeParse({ ...mine, ...extra }).success).toBe(false);
    }
  });

  it('sends the version answered and the answers, never a person', () => {
    const body = { formVersionId: id, answers: { f_rating: true } };
    expect(portalAnswersInputSchema.parse(body)).toEqual(body);
    expect(portalAnswersInputSchema.safeParse({ ...body, personId: id }).success).toBe(false);
  });
});
