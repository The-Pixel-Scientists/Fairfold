// SPDX-License-Identifier: AGPL-3.0-or-later

import { classifications, formDefinitionSchema } from '@pixel-scientists/domain/forms';
import {
  warehouseColumns,
  warehouseTableNames,
  warehouseTables,
  type WarehouseColumn,
} from '@pixel-scientists/domain/warehouse';
import { describe, expect, it } from 'vitest';

import { classification, SENSITIVITIES } from '../classification.ts';
import { communitySpacesForm } from '../seed/configured.ts';
import { answersAtOrBelow, classifyAnswers } from './classification-answers.ts';

const choices = [
  { value: 'one', label: 'Group one' },
  { value: 'two', label: 'Group two' },
];

/** One question at each level. */
const form = formDefinitionSchema.parse({
  sections: [
    {
      id: 's_all',
      title: 'Every level',
      fields: [
        { id: 'f_title', type: 'short_text', label: 'Project name', classification: 'public' },
        { id: 'f_ready', type: 'yes_no', label: 'Is the hall ready?', classification: 'internal' },
        { id: 'f_email', type: 'email', label: 'Contact email', classification: 'personal' },
        {
          id: 'f_group',
          type: 'single_choice',
          label: 'Which group leads your organisation?',
          audiences: 'aggregate_only',
          classification: 'special_category',
          options: choices,
        },
      ],
    },
  ],
});

const answers = {
  f_title: 'Hall roof',
  f_ready: true,
  f_email: 'contact@example.test',
  f_group: 'two',
  f_stray: 'not a question',
};

describe('classifyAnswers', () => {
  it('gives each answer its question’s class, and an unknown key special category without its value', () => {
    expect(classifyAnswers(form, answers)).toEqual({
      f_title: { classification: 'public', value: 'Hall roof' },
      f_ready: { classification: 'internal', value: true },
      f_email: { classification: 'personal', value: 'contact@example.test' },
      f_group: { classification: 'special_category', value: 'two' },
      f_stray: { classification: 'special_category' },
    });
  });

  it('classes every MVP1 question personal, and an old aggregate-only one special category', () => {
    const old = formDefinitionSchema.parse({
      sections: [
        ...communitySpacesForm.sections,
        {
          id: 's_monitoring',
          title: 'Equality monitoring',
          fields: [
            {
              id: 'f_group',
              type: 'single_choice',
              label: 'Which group leads your organisation?',
              audiences: 'aggregate_only',
              options: choices,
            },
          ],
        },
      ],
    });
    const stored = { f_local: true, f_title: 'Hall roof', f_amount: 1, f_group: 'one' };
    expect(
      Object.fromEntries(
        Object.entries(classifyAnswers(old, stored)).map(([id, a]) => [id, a.classification]),
      ),
    ).toEqual({
      f_local: 'personal',
      f_title: 'personal',
      f_amount: 'personal',
      f_group: 'special_category',
    });
  });
});

describe('answersAtOrBelow', () => {
  it('lets no special category answer or unknown key past the warehouse or export ceiling', () => {
    expect(answersAtOrBelow(form, answers, 'internal')).toEqual({
      f_title: 'Hall roof',
      f_ready: true,
    });
    expect(answersAtOrBelow(form, answers, 'personal')).toEqual({
      f_title: 'Hall roof',
      f_ready: true,
      f_email: 'contact@example.test',
    });
    expect(answersAtOrBelow(form, answers, 'special_category')).toEqual({
      f_title: 'Hall roof',
      f_ready: true,
      f_email: 'contact@example.test',
      f_group: 'two',
    });
  });
});

describe('the answers column', () => {
  it('uses the engine’s levels, in the map’s order', () => {
    expect(classifications).toEqual(SENSITIVITIES);
  });

  it('is per field, at special category, kept for the tenant’s lifetime', () => {
    expect(classification['grants.application']?.['answers']).toEqual({
      sensitivity: 'special_category',
      retention: { kind: 'tenant_lifetime' },
      perField: {
        versionColumn: 'form_version_id',
        definition: { table: 'grants.form_version', column: 'definition' },
      },
    });
  });

  it('never reaches the warehouse', () => {
    for (const table of warehouseTableNames) {
      const columns = warehouseTables[table].columns as Record<string, WarehouseColumn>;
      const sources = warehouseColumns(table, classification).flatMap((name) => {
        const { from } = columns[name] ?? { from: 'module' };
        return from === 'module' ? [] : from;
      });
      expect(sources).not.toContain('grants.application.answers');
    }
  });
});
