// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stands in for the API for the form builder specs: a round that keeps its
// form versions, so a spec can build a form, preview it and publish it, and
// see it afterwards in the list. It checks every saved definition with the
// engine and the contract's text rules, as the server does, and answers a
// refusal in the server's words. Answers are plain JSON in the shape of the
// contracts in modules/grants/src/contracts/forms.

import { formDefinitionInputSchema } from '@pixel-scientists/grants/contracts';
import type { FormVersion } from '@pixel-scientists/grants/contracts';
import { fieldForIssue, messageForIssue, messages } from '@pixel-scientists/domain/platform';
import type { Page } from '@playwright/test';

import { problem, stubSignedIn } from './auth-api.ts';
import type { Handler, SentRequest } from './auth-api.ts';
import { ids as programmeIds, programme, round } from './programme-api.ts';

export const ids = {
  ...programmeIds,
  /** For the versions a spec starts, in the order it starts them. */
  versions: [
    'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f',
    'd2e3f4a5-b6c7-4d8e-9f0a-1b2c3d4e5f60',
    'e3f4a5b6-c7d8-4e9f-8a1b-2c3d4e5f6071',
  ],
} as const;

const base = `/console/rounds/${ids.round}`;
const author = { membershipId: ids.author, name: 'Ada Reed' };

export interface FormStub {
  /** What the round holds, oldest first. A spec may change it between steps. */
  versions: FormVersion[];
  sent: SentRequest[];
}

const summary = ({ id, version, status, updatedAt, publishedAt, publishedBy }: FormVersion) => ({
  id,
  version,
  status,
  updatedAt,
  publishedAt,
  publishedBy,
});

/** A version as the API stores one. A published one has the date it was published. */
export function version(
  number: number,
  status: 'draft' | 'published',
  definition: FormVersion['definition'],
): FormVersion {
  return {
    id: ids.versions[number - 1] ?? ids.versions[0],
    roundId: ids.round,
    version: number,
    status,
    definition,
    updatedAt: '2026-10-14T13:15:00.000Z',
    publishedAt: status === 'published' ? '2026-10-13T09:00:00.000Z' : null,
    publishedBy: status === 'published' ? author : null,
  };
}

const parsed = (input: unknown) => {
  const result = formDefinitionInputSchema.safeParse(input);
  if (!result.success) throw new Error('The form in the spec is not valid.');
  return result.data;
};

const text = (id: string, label: string, more: object = {}) => ({
  id,
  type: 'short_text',
  label,
  required: true,
  ...more,
});

/** Three sections: who the applicant is, with a question that stops some and one that depends on it, the project, and the money. */
export const organisationForm = parsed({
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
        { id: 'f_email', type: 'email', label: 'Contact email', audiences: ['applicant', 'staff'] },
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
        {
          id: 'f_who',
          type: 'multiple_choice',
          label: 'Who will take part?',
          options: [
            { value: 'young', label: 'Young people' },
            { value: 'older', label: 'Older people' },
          ],
          minSelections: 1,
        },
      ],
    },
    {
      id: 's_money',
      title: 'Your budget',
      fields: [
        { id: 'f_amount', type: 'currency', label: 'How much are you asking for?', required: true },
        { id: 'f_start', type: 'date', label: 'When will the project start?' },
      ],
    },
  ],
});

/** Questions that the builder edits in other ways: a choice that stops applicants, a text block, and a table and a file it cannot edit yet. */
export const richForm = parsed({
  sections: [
    {
      id: 's_rich',
      title: 'Every kind of question',
      fields: [
        {
          id: 'f_kind',
          type: 'single_choice',
          label: 'What kind of organisation are you?',
          required: true,
          options: [
            { value: 'charity', label: 'Registered charity' },
            { value: 'company', label: 'Company' },
          ],
          eligibility: { stopValues: ['company'], explanation: 'We only fund charities.' },
        },
        {
          id: 'f_intro',
          type: 'content',
          body: 'Answer every question marked required.',
          conditions: [{ field: 'f_kind', equals: 'charity' }],
        },
        {
          id: 'f_costs',
          type: 'table',
          label: 'Costs',
          rowNoun: 'cost',
          columns: [
            { id: 'c_item', type: 'short_text', label: 'Item' },
            { id: 'c_cost', type: 'currency', label: 'Cost', total: true },
          ],
        },
        {
          id: 'f_accounts',
          type: 'file',
          label: 'Latest accounts',
          allowedTypes: ['application/pdf'],
        },
      ],
    },
  ],
});

/** A round with a published version 1 and a draft of version 2 that starts from it. */
export const withDraft = (): FormVersion[] => [
  version(1, 'published', organisationForm),
  version(2, 'draft', organisationForm),
];

/**
 * A signed-in programme manager of a funder whose round keeps its form
 * versions. `more` adds or replaces answers, keyed like `GET /console/rounds/…`.
 */
export async function stubForms(
  page: Page,
  start: FormVersion[] = [],
  more: Record<string, Handler> = {},
  permissions?: string[],
): Promise<FormStub> {
  const stub: FormStub = { versions: start, sent: [] };
  const ok = (body: unknown) => ({ status: 200, body });
  const touch = (item: FormVersion, changes: Partial<FormVersion>) => {
    const index = stub.versions.indexOf(item);
    const changed = { ...item, ...changes };
    stub.versions[index] = changed;
    return changed;
  };

  /** The handlers for one version's address, which look the version up when asked. */
  const forVersion = (id: string): Record<string, Handler> => {
    const find = () => stub.versions.find((item) => item.id === id);
    const address = `/console/form-versions/${id}`;
    return {
      [`GET ${address}`]: () => {
        const found = find();
        return found ? ok(found) : problem(404, 'We cannot find this form version.');
      },
      [`PUT ${address}/definition`]: (body) => {
        const found = find();
        if (!found) return problem(404, 'We cannot find this form version.');
        if (found.status === 'published') {
          return problem(
            409,
            'This version is published, so it cannot be changed. Start a new draft to make changes.',
          );
        }
        const result = formDefinitionInputSchema.safeParse(
          (body as { definition: unknown }).definition,
        );
        if (!result.success) {
          return problem(
            400,
            messages.fixFields,
            result.error.issues.map((issue) => ({
              field: fieldForIssue('body.definition', issue),
              message: messageForIssue(issue),
            })),
          );
        }
        return ok(touch(found, { definition: result.data, updatedAt: '2026-10-15T10:00:00.000Z' }));
      },
      [`POST ${address}/publish`]: () => {
        const found = find();
        if (!found) return problem(404, 'We cannot find this form version.');
        if (found.status === 'published') return problem(409, 'This version is already published.');
        if (found.definition === null) {
          return problem(
            409,
            'This draft has no questions yet. Add a section with a question, save, then publish.',
          );
        }
        return ok(
          touch(found, {
            status: 'published',
            publishedAt: '2026-10-20T10:00:00.000Z',
            publishedBy: author,
          }),
        );
      },
      [`DELETE ${address}`]: () => {
        const found = find();
        if (!found) return problem(404, 'We cannot find this form version.');
        stub.versions.splice(stub.versions.indexOf(found), 1);
        return { status: 204 };
      },
    };
  };

  stub.sent = await stubSignedIn(page, permissions ? { permissions } : {}, {
    [`GET ${base}`]: () => ok(round),
    [`GET /console/programmes/${ids.programme}`]: () => ok(programme),
    [`GET ${base}/form-versions`]: () =>
      ok({ versions: [...stub.versions].reverse().map(summary) }),
    [`POST ${base}/form-versions`]: () => {
      if (stub.versions.some((item) => item.status === 'draft')) {
        return problem(
          409,
          'This round already has a draft form. Open the draft, or discard it to start again.',
        );
      }
      const latest = stub.versions.at(-1);
      const created = version(stub.versions.length + 1, 'draft', latest?.definition ?? null);
      stub.versions.push(created);
      return { status: 201, body: created };
    },
    ...Object.fromEntries(ids.versions.flatMap((id) => Object.entries(forVersion(id)))),
    ...more,
  });
  return stub;
}
