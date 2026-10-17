// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseDefinition, type FormDefinition } from '@pixel-scientists/domain/forms';
import { describe, expect, it } from 'vitest';

import { blindDefinition } from './blind.ts';

function define(sections: { id: string; fields: object[] }[]): FormDefinition {
  const parsed = parseDefinition({ sections: sections.map((s) => ({ ...s, title: 'Section' })) });
  if (!parsed.success) throw new Error('The test definition is not valid.');
  return parsed.data;
}

const field = (id: string, type: string, change: object = {}) => ({
  id,
  type,
  label: `Label of ${id}`,
  ...change,
});

const idsOf = (definition: FormDefinition | null) =>
  definition?.sections.flatMap((section) => section.fields.map((f) => f.id));

describe('blindDefinition', () => {
  it('keeps the questions a blind reviewer may answer from and drops every other, labels with them', () => {
    const definition = define([
      {
        id: 's_one',
        fields: [
          field('f_idea', 'long_text'),
          field('f_contact', 'short_text', { identity: true }),
          field('f_turnover', 'number', { audiences: 'aggregate_only' }),
          field('f_accounts', 'file'),
          field('f_staff', 'short_text', { audiences: ['applicant', 'staff'] }),
          { id: 'f_note', type: 'content', body: 'Read this first.' },
          field('f_budget', 'currency', { audiences: ['applicant', 'reviewer'] }),
        ],
      },
    ]);

    const blind = blindDefinition(definition);

    expect(idsOf(blind)).toEqual(['f_idea', 'f_budget']);
    const text = JSON.stringify(blind);
    for (const gone of [
      'f_contact',
      'f_turnover',
      'f_accounts',
      'f_staff',
      'f_note',
      'Read this',
    ]) {
      expect(text).not.toContain(gone);
    }
  });

  it('drops a section left with no question, and returns null when nothing is left', () => {
    const only = define([
      { id: 's_one', fields: [field('f_idea', 'long_text')] },
      { id: 's_two', fields: [field('f_name', 'short_text', { identity: true })] },
    ]);
    expect(blindDefinition(only)?.sections.map((section) => section.id)).toEqual(['s_one']);

    const none = define([
      { id: 's_one', fields: [field('f_name', 'short_text', { identity: true })] },
    ]);
    expect(blindDefinition(none)).toBeNull();
  });
});
