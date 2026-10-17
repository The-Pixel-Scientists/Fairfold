// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseDefinition } from '@pixel-scientists/domain/forms';
import type { FormDefinition, Question } from '@pixel-scientists/domain/forms';
import { describe, expect, it } from 'vitest';

import {
  blankQuestion,
  blankSection,
  conditionAnswers,
  conditionSources,
  moved,
  withoutChoice,
  withType,
} from './draft.ts';
import type { ChoiceQuestion } from './draft.ts';

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
