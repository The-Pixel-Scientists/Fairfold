// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseDefinition } from '@pixel-scientists/domain/forms';
import type { FormDefinition, Question } from '@pixel-scientists/domain/forms';
import { describe, expect, it } from 'vitest';

import {
  blankQuestion,
  blankSection,
  conditionAnswers,
  conditionSources,
  MAX_COLUMNS,
  moved,
  newColumn,
  withColumnType,
  withoutChoice,
  withType,
} from './draft.ts';
import type { ChoiceQuestion, Column, FileQuestion, TableQuestion } from './draft.ts';

function definition(...fields: object[]): FormDefinition {
  const parsed = parseDefinition({ sections: [{ id: 's_one', title: 'One', fields }] });
  if (!parsed.success) throw new Error('The test definition is not valid.');
  return parsed.data;
}

const charity = { id: 'f_charity', type: 'yes_no', label: 'Registered charity?', required: true };
const spend = {
  id: 'f_spend',
  type: 'single_choice',
  label: 'What is it for?',
  required: true,
  options: [
    { value: 'building', label: 'Building' },
    { value: 'kit', label: 'Equipment' },
  ],
  eligibility: { stopValues: ['kit'], explanation: 'We do not fund equipment.' },
};

describe('a new question and section', () => {
  it('are ids that the engine accepts, and a section has a question', () => {
    const section = blankSection();
    const again = blankSection();

    expect(section.id).toMatch(/^s_[a-z0-9]{12}$/);
    expect(section.fields).toHaveLength(1);
    expect(section.fields[0]?.id).toMatch(/^f_[a-z0-9]{12}$/);
    expect(section.id).not.toBe(again.id);
    expect(blankQuestion().id).not.toBe(blankQuestion().id);
  });

  it('start required and seen by everyone', () => {
    expect(blankQuestion()).toMatchObject({
      type: 'short_text',
      required: true,
      identity: false,
      audiences: ['applicant', 'staff', 'reviewer'],
      conditions: [],
    });
  });
});

describe('changing the type of a question', () => {
  const question: Question = {
    ...blankQuestion(),
    label: 'Contact',
    hint: 'Someone we can phone',
    required: false,
    identity: true,
    audiences: ['applicant', 'staff'],
  };

  it('keeps what every question has', () => {
    for (const type of [
      'long_text',
      'number',
      'currency',
      'date',
      'yes_no',
      'uk_address',
    ] as const) {
      expect(withType(question, type)).toMatchObject({
        id: question.id,
        type,
        label: 'Contact',
        hint: 'Someone we can phone',
        required: false,
        identity: true,
        audiences: ['applicant', 'staff'],
      });
    }
  });

  it('gives a choice question two blank choices, each with a value of its own', () => {
    const changed = withType(question, 'single_choice') as ChoiceQuestion;

    expect(changed.options).toHaveLength(2);
    expect(changed.options.map((choice) => choice.label)).toEqual(['', '']);
    expect(changed.options[0]?.value).not.toBe(changed.options[1]?.value);
  });

  it('keeps the choices between types that have them, and drops an eligibility rule', () => {
    const [field] = definition(spend).sections[0]?.fields ?? [];
    const asDropdown = withType(field as Question, 'dropdown');

    expect(asDropdown).toMatchObject({ type: 'dropdown', options: spend.options });
    expect(asDropdown).not.toHaveProperty('eligibility');
  });

  it('starts limits again', () => {
    const limited = { ...question, type: 'short_text', maxWords: 10 } as Question;

    expect(withType(limited, 'long_text')).not.toHaveProperty('maxWords');
  });
});

describe('a table question', () => {
  const table = withType(blankQuestion(), 'table') as TableQuestion;

  it('starts with a row noun, row limits and one blank column, and the form takes it once it is filled in', () => {
    expect(table).toMatchObject({ type: 'table', rowNoun: 'row', minRows: 0, maxRows: 20 });
    expect(table.columns).toHaveLength(1);
    expect(table.columns[0]?.label).toBe('');
    const filled = { ...table, label: 'Costs', columns: [{ ...newColumn(), label: 'Item' }] };
    const parsed = parseDefinition({
      sections: [{ id: 's_one', title: 'One', fields: [filled] }],
    });
    expect(parsed.success).toBe(true);
  });

  it('keeps what every question has when it changes type, and drops its rows and columns', () => {
    const asText = withType({ ...table, label: 'Costs', required: false }, 'long_text');

    expect(asText).toMatchObject({ type: 'long_text', label: 'Costs', required: false });
    expect(asText).not.toHaveProperty('columns');
  });

  it('allows as many columns as the form engine does, and no more', () => {
    const columns = (count: number) =>
      Array.from({ length: count }, () => ({ ...newColumn(), label: 'Item' }));
    const form = (count: number) =>
      parseDefinition({
        sections: [
          {
            id: 's_one',
            title: 'One',
            fields: [{ ...table, label: 'Costs', columns: columns(count) }],
          },
        ],
      });

    expect(form(MAX_COLUMNS).success).toBe(true);
    expect(form(MAX_COLUMNS + 1).success).toBe(false);
  });
});

describe('a table column', () => {
  const ID = /^c_[a-z0-9]{12}$/;

  it('is made with an id that the engine accepts, and never the same one twice', () => {
    const first = newColumn();

    expect(first).toMatchObject({ type: 'short_text', required: true, total: false });
    expect(first.id).toMatch(ID);
    expect(newColumn().id).not.toBe(first.id);
  });

  it('keeps its id, heading and whether it is required when its type changes', () => {
    const column: Column = { ...newColumn(), label: 'Cost', required: false };

    for (const type of ['number', 'currency', 'dropdown', 'short_text'] as const) {
      expect(withColumnType(column, type)).toMatchObject({
        id: column.id,
        type,
        label: 'Cost',
        required: false,
      });
    }
  });

  it('keeps its total between a number and an amount, and loses it for any other type', () => {
    const amount = withColumnType({ ...newColumn(), label: 'Cost' }, 'currency');
    const total = { ...amount, total: true } as Column;

    expect(withColumnType(total, 'number')).toMatchObject({ type: 'number', total: true });
    expect(withColumnType(total, 'short_text')).toMatchObject({ total: false });
    expect(withColumnType(total, 'dropdown')).toMatchObject({ total: false });
  });

  it('starts a dropdown with two blank choices of their own, and a text with the longest limit', () => {
    const dropdown = withColumnType(newColumn(), 'dropdown');
    const text = withColumnType(dropdown, 'short_text');

    expect(dropdown).toMatchObject({ options: [{ label: '' }, { label: '' }] });
    if (dropdown.type !== 'dropdown') throw new Error('Expected a dropdown column.');
    expect(dropdown.options[0]?.value).not.toBe(dropdown.options[1]?.value);
    expect(text).toMatchObject({ type: 'short_text', maxCharacters: 200 });
  });
});

describe('a file question', () => {
  it('starts with every type the platform takes, its largest file and one file, and is a question the engine takes', () => {
    const file = withType({ ...blankQuestion(), label: 'Accounts' }, 'file') as FileQuestion;

    expect(file).toMatchObject({ type: 'file', maxBytes: 10 * 1024 * 1024, maxFiles: 1 });
    expect(file.allowedTypes).toHaveLength(7);
    expect(
      parseDefinition({ sections: [{ id: 's_one', title: 'One', fields: [file] }] }).success,
    ).toBe(true);
  });

  it('is seen by the people the question was, and never only in totals', () => {
    const staff = { ...blankQuestion(), audiences: ['applicant', 'staff'] } as Question;
    const totals = { ...blankQuestion(), audiences: 'aggregate_only' } as Question;

    expect(withType(staff, 'file')).toMatchObject({ audiences: ['applicant', 'staff'] });
    expect(withType(totals, 'file')).toMatchObject({
      audiences: ['applicant', 'staff', 'reviewer'],
    });
  });
});

describe('moved', () => {
  it('moves an item one place, and leaves a list alone at its ends', () => {
    expect(moved(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moved(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    const list = ['a', 'b'];
    expect(moved(list, 0, -1)).toBe(list);
    expect(moved(list, 1, 1)).toBe(list);
  });
});

describe('a choice question without a choice', () => {
  it('loses the choice, and the answers that stop applicants lose it too', () => {
    const [field] = definition(spend).sections[0]?.fields ?? [];
    const question = field as ChoiceQuestion;

    const without = withoutChoice(question, 'building');

    expect(without.options.map((choice) => choice.value)).toEqual(['kit']);
    expect(without).toMatchObject({ eligibility: { stopValues: ['kit'] } });
  });

  it('ends the eligibility rule when no answer is left to stop applicants', () => {
    const [field] = definition(spend).sections[0]?.fields ?? [];

    const without = withoutChoice(field as ChoiceQuestion, 'kit');

    expect(without).toMatchObject({ eligibility: undefined });
  });
});

describe('what a condition can read', () => {
  const form = definition(
    charity,
    { id: 'f_name', type: 'short_text', label: 'Name', required: true },
    spend,
    { id: 'f_who', type: 'multiple_choice', label: 'Who?', options: spend.options },
    { id: 'f_last', type: 'short_text', label: 'Last', required: true },
  );

  it('is the yes or no and choice questions before the question', () => {
    expect(conditionSources(form, 'f_last').map((question) => question.id)).toEqual([
      'f_charity',
      'f_spend',
      'f_who',
    ]);
    expect(conditionSources(form, 'f_spend').map((question) => question.id)).toEqual(['f_charity']);
    expect(conditionSources(form, 'f_charity')).toEqual([]);
  });

  it('lists each answer in words with the condition it makes', () => {
    const [yesNo, single, several] = conditionSources(form, 'f_last');

    expect(conditionAnswers(yesNo as Question)).toEqual([
      { label: 'Yes', condition: { field: 'f_charity', equals: true } },
      { label: 'No', condition: { field: 'f_charity', equals: false } },
    ]);
    expect(conditionAnswers(single as Question)[1]).toEqual({
      label: 'Equipment',
      condition: { field: 'f_spend', equals: 'kit' },
    });
    expect(conditionAnswers(several as Question)[0]).toEqual({
      label: 'Building',
      condition: { field: 'f_who', includes: 'building' },
    });
  });
});
