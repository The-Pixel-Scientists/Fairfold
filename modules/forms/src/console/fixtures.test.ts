// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Synthetic forms, versions and responses for tests of the screens. Not part
// of the screens.

import { projectedAnswers } from '@pixel-scientists/domain/api';
import { formDefinitionSchema } from '@pixel-scientists/domain/forms';
import { describe, expect, it } from 'vitest';

import {
  formDraftSchema,
  formSchema,
  formVersionSchema,
  responseSchema,
  responseSummarySchema,
} from '../contracts/index.ts';

import { id } from './harness.test.tsx';

export const definition = formDefinitionSchema.parse({
  sections: [
    {
      id: 's_about',
      title: 'About the session',
      fields: [
        {
          id: 'f_helped',
          type: 'yes_no',
          label: 'Did the session help?',
          classification: 'internal',
        },
        {
          id: 'f_comment',
          type: 'long_text',
          label: 'Anything else to tell us?',
          maxWords: 100,
          classification: 'personal',
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

export const formId = id(1);

export const form = {
  id: formId,
  title: 'Drop-in feedback',
  description: '',
  respondents: 'signed_in',
  opensAt: null,
  closesAt: null,
  retentionMonths: 12,
  confirmationMessage: '',
  status: 'draft',
  latestVersion: null,
  createdAt: '2027-01-04T09:00:00Z',
  updatedAt: '2027-01-04T09:00:00Z',
} as const;

export const summaryOf = (over: Record<string, unknown> = {}) => ({
  id: form.id,
  title: form.title,
  respondents: form.respondents,
  opensAt: form.opensAt,
  closesAt: form.closesAt,
  status: form.status,
  latestVersion: form.latestVersion,
  updatedAt: form.updatedAt,
  ...over,
});

export const draft = { formId, definition, updatedAt: '2027-01-04T10:00:00Z' };

export const version = (n: number) => ({
  id: id(100 + n),
  formId,
  version: n,
  respondents: 'signed_in',
  publishedAt: '2027-01-05T09:00:00Z',
  definition,
});

export const responseId = id(7);

export const responseSummary = (over: Record<string, unknown> = {}) => ({
  id: responseId,
  formId,
  formVersionId: id(101),
  version: 1,
  route: 'signed_in',
  personId: id(55),
  submittedAt: '2027-03-02T10:00:00Z',
  sentWithoutCheck: false,
  spamReason: null,
  ...over,
});

/** A response as the staff projection returns it: the health answer is never in it. */
export const response = (over: Record<string, unknown> = {}) => ({
  ...responseSummary(over),
  definition,
  answers: projectedAnswers(
    definition,
    { f_helped: true, f_comment: 'The volunteers were kind.', f_health: true },
    'staff',
  ),
});

export const versionSummary = (n: number) => ({
  id: id(100 + n),
  version: n,
  respondents: 'signed_in',
  publishedAt: '2027-01-05T09:00:00Z',
});

describe('the fixtures', () => {
  it('are valid against the contracts, so a test cannot pass on a shape the API would refuse', () => {
    expect(formSchema.safeParse(form).success).toBe(true);
    expect(formDraftSchema.safeParse(draft).success).toBe(true);
    expect(formVersionSchema.safeParse(version(1)).success).toBe(true);
    expect(responseSummarySchema.safeParse(responseSummary()).success).toBe(true);
    expect(responseSchema.safeParse(response()).success).toBe(true);
    expect(response().answers).not.toHaveProperty('f_health');
  });
});
