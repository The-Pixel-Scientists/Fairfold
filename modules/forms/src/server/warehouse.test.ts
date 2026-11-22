// SPDX-License-Identifier: AGPL-3.0-or-later

import { classifications, formDefinitionSchema } from '@pixel-scientists/domain/forms';
import { describe, expect, it } from 'vitest';

import { warehouseAnswers, warehouseClassifications } from './warehouse.ts';

const definition = formDefinitionSchema.parse({
  sections: [
    {
      id: 's_all',
      title: 'Every class',
      fields: [
        { id: 'f_public', type: 'short_text', label: 'Public one', classification: 'public' },
        { id: 'f_internal', type: 'yes_no', label: 'Internal one', classification: 'internal' },
        { id: 'f_personal', type: 'short_text', label: 'Personal one', classification: 'personal' },
        {
          id: 'f_special',
          type: 'single_choice',
          label: 'Special one',
          classification: 'special_category',
          audiences: 'aggregate_only',
          options: [
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ],
        },
        { id: 'f_unclassified', type: 'short_text', label: 'No class given' },
        {
          id: 'f_file',
          type: 'file',
          label: 'A file',
          maxFiles: 1,
        },
        {
          id: 'f_hidden',
          type: 'short_text',
          label: 'Shown only if yes',
          classification: 'internal',
          conditions: [{ field: 'f_internal', equals: true }],
        },
      ],
    },
  ],
});

describe('warehouseAnswers', () => {
  it('keeps only public and internal answers, one field of each class', () => {
    const answers = {
      f_public: 'p',
      f_internal: false,
      f_personal: 'Ada Example',
      f_special: 'a',
      f_unclassified: 'no class',
      f_file: ['0b6f3c1e-58a2-4d1b-9c47-2e8d5f1a7b30'],
      f_hidden: 'not shown',
      f_unknown: 'not on the form',
    };
    expect(warehouseAnswers(definition, answers)).toEqual({ f_public: 'p', f_internal: false });
  });

  it('keeps an internal answer to a question that is shown', () => {
    expect(warehouseAnswers(definition, { f_internal: true, f_hidden: 'yes' })).toEqual({
      f_internal: true,
      f_hidden: 'yes',
    });
  });

  it('decides every classification there is, and sends only the two lowest', () => {
    expect(Object.keys(warehouseClassifications).sort()).toEqual([...classifications].sort());
    expect(Object.entries(warehouseClassifications).filter(([, sent]) => sent)).toEqual([
      ['public', true],
      ['internal', true],
    ]);
  });
});
