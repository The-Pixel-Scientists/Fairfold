// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Test helpers for the form builder screens: the Autumn round's form as the
// API would answer, and the requests the screens make. Not part of the app.

import { parseDefinition } from '@pixel-scientists/domain/forms';
import type { FormDefinition } from '@pixel-scientists/domain/forms';
import type { FormVersion } from '@pixel-scientists/grants/contracts';

import { ids as programmeIds, manager, ok, programme, round } from '../programme/fixtures.ts';
import type { Handlers } from '../programme/fixtures.ts';

export { manager, ok, programme, round };
export type { Handlers };

export const ids = {
  ...programmeIds,
  draft: 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f',
  published: 'd2e3f4a5-b6c7-4d8e-9f0a-1b2c3d4e5f60',
} as const;

/** A definition as a client sends it, written out as the engine stores it. */
export function stored(input: unknown): FormDefinition {
  const parsed = parseDefinition(input);
  if (!parsed.success) throw new Error('The test definition is not valid.');
  return parsed.data;
}

const text = (id: string, label: string, more: object = {}) => ({
  id,
  type: 'short_text',
  label,
  required: true,
  ...more,
});

/** Two sections: who the applicant is, with a question that stops some and one that depends on it, and the project. */
export const organisationForm = stored({
  sections: [
    {
      id: 's_org',
      title: 'About your organisation',
      introduction: 'Tell us who you are.',
      fields: [
        text('f_name', 'Organisation name', { audiences: ['applicant', 'staff'], identity: true }),
        {
          id: 'f_charity',
          type: 'yes_no',
          label: 'Is your organisation a registered charity?',
          required: true,
          eligibility: { stopWhen: false, explanation: 'We only fund registered charities.' },
        },
        text('f_number', 'Registered charity number', {
          conditions: [{ field: 'f_charity', equals: true }],
        }),
      ],
    },
    {
      id: 's_project',
      title: 'Your project',
      fields: [
        {
          id: 'f_story',
          type: 'long_text',
          label: 'What will you do with the money?',
          hint: 'Say who it is for.',
          required: true,
          maxWords: 300,
        },
        {
          id: 'f_spend',
          type: 'single_choice',
          label: 'What will the money pay for?',
          required: true,
          options: [
            { value: 'building', label: 'Building work' },
            { value: 'training', label: 'Training' },
          ],
        },
      ],
    },
  ],
});

const author = { membershipId: ids.author, name: 'Ada Reed' };

export function version(
  id: string,
  number: number,
  status: 'draft' | 'published',
  definition: FormDefinition | null,
): FormVersion {
  return {
    id,
    roundId: ids.round,
    version: number,
    status,
    definition,
    updatedAt: '2026-10-14T13:15:00.000Z',
    publishedAt: status === 'published' ? '2026-10-13T09:00:00.000Z' : null,
    publishedBy: status === 'published' ? author : null,
  };
}

/** One section with a table of costs, three columns, and a file question for the latest accounts. */
export const budgetForm = stored({
  sections: [
    {
      id: 's_budget',
      title: 'Your budget',
      fields: [
        {
          id: 'f_costs',
          type: 'table',
          label: 'Costs',
          required: true,
          rowNoun: 'cost',
          minRows: 1,
          maxRows: 10,
          columns: [
            { id: 'c_item', type: 'short_text', label: 'Item', maxCharacters: 80 },
            { id: 'c_cost', type: 'currency', label: 'Cost', total: true },
            {
              id: 'c_kind',
              type: 'dropdown',
              label: 'Kind',
              required: false,
              options: [
                { value: 'staff', label: 'Staff' },
                { value: 'kit', label: 'Equipment' },
              ],
            },
          ],
        },
        {
          id: 'f_accounts',
          type: 'file',
          label: 'Latest accounts',
          hint: 'Sign-off by your trustees is not needed.',
          required: true,
          allowedTypes: ['application/pdf', 'application/vnd.oasis.opendocument.spreadsheet'],
          maxBytes: 5 * 1024 * 1024,
          maxFiles: 2,
        },
      ],
    },
  ],
});

export const draft = version(ids.draft, 2, 'draft', organisationForm);
export const budgetDraft = version(ids.draft, 2, 'draft', budgetForm);
export const published = version(ids.published, 1, 'published', organisationForm);

/** What a list shows of a version. */
export const summary = (item: FormVersion) => ({
  id: item.id,
  version: item.version,
  status: item.status,
  updatedAt: item.updatedAt,
  publishedAt: item.publishedAt,
  publishedBy: item.publishedBy,
});

/** The address of a route, like the key stubApi() answers by. */
export const api = {
  round: `GET /console/rounds/${ids.round}`,
  programme: `GET /console/programmes/${ids.programme}`,
  versions: `GET /console/rounds/${ids.round}/form-versions`,
  createDraft: `POST /console/rounds/${ids.round}/form-versions`,
  version: (id: string) => `GET /console/form-versions/${id}`,
  save: (id: string) => `PUT /console/form-versions/${id}/definition`,
  publish: (id: string) => `POST /console/form-versions/${id}/publish`,
  discard: (id: string) => `DELETE /console/form-versions/${id}`,
} as const;

/** What every form page reads, for a round whose versions are `versions`. */
export const reads = (...versions: FormVersion[]): Handlers => ({
  ...manager(),
  [api.round]: ok(round),
  [api.programme]: ok(programme),
  [api.versions]: ok({ versions: versions.map(summary) }),
  ...Object.fromEntries(versions.map((item) => [api.version(item.id), ok(item)])),
});
