// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  classificationOf,
  definitionProblems,
  formDefinitionSchema,
  type FormDefinition,
  type FormField,
} from '@pixel-scientists/domain/forms';
import { describe, expect, it } from 'vitest';

import { monitoringDefinitionProblems } from './check.ts';
import { monitoringMessages as m } from './messages.ts';
import { monitoringQuestions, monitoringTemplate, preferNotToSay } from './questions.ts';

/** A form of one question: the set's ethnic group question with `change` applied. */
function withField(change: (field: FormField) => FormField): FormDefinition {
  const template = monitoringTemplate();
  const [section] = template.sections;
  const field = section?.fields.find((each) => each.id === 'f_ethnicgroup');
  if (section === undefined || field === undefined) throw new Error('The set lost a question.');
  return { sections: [{ ...section, fields: [change(field)] }] };
}

const problemOf = (change: (field: FormField) => FormField) =>
  monitoringDefinitionProblems(withField(change)).map((problem) => problem.message);

describe('the monitoring question set', () => {
  it('passes the form engine and the monitoring rules, as stored and as parsed', () => {
    const template = monitoringTemplate();
    expect(definitionProblems(template)).toEqual([]);
    expect(monitoringDefinitionProblems(template)).toEqual([]);
    const parsed = formDefinitionSchema.parse(JSON.parse(JSON.stringify(template)));
    expect(monitoringDefinitionProblems(parsed)).toEqual([]);
  });

  it('asks only optional, aggregate-only, special category choices about the person answering', () => {
    for (const field of monitoringQuestions.values()) {
      expect(field).toMatchObject({
        audiences: 'aggregate_only',
        required: false,
        identity: false,
      });
      expect(classificationOf(field)).toBe('special_category');
      expect(field.label).toMatch(/\byour?\b/i);
      expect('options' in field && field.options.at(-1)).toEqual(preferNotToSay);
    }
  });

  it('lets a funder choose and reorder questions, not change them', () => {
    const template = monitoringTemplate();
    const [section] = template.sections;
    if (section === undefined) throw new Error('No section.');
    const chosen = { sections: [{ ...section, fields: section.fields.slice(0, 3).reverse() }] };
    expect(monitoringDefinitionProblems(chosen)).toEqual([]);
    const reworded = problemOf((field) => ({ ...field, label: 'What is your race?' }));
    expect(reworded).toEqual([m.fromQuestionSet]);
    expect(monitoringTemplate().sections[0]?.fields[0]).toEqual(section.fields[0]);
  });
});

describe('monitoringDefinitionProblems', () => {
  it('refuses a question seen by anyone but in totals', () => {
    expect(problemOf((field) => ({ ...field, audiences: ['applicant', 'staff'] }))).toEqual([
      m.onlyInTotals,
    ]);
  });

  it('refuses a question classified below special category', () => {
    expect(problemOf((field) => ({ ...field, classification: 'personal' }))).toEqual([
      m.specialCategory,
    ]);
  });

  it('refuses an identity question', () => {
    expect(problemOf((field) => ({ ...field, identity: true }))).toEqual([m.identityQuestion]);
  });

  it('refuses a file question', () => {
    const file = (field: FormField): FormField => ({
      id: field.id,
      type: 'file',
      label: 'Upload proof of your ethnic group',
      required: false,
      identity: false,
      audiences: 'aggregate_only',
      classification: 'special_category',
      conditions: [],
      allowedTypes: ['application/pdf'],
      maxBytes: 1024 * 1024,
      maxFiles: 1,
    });
    expect(problemOf(file)).toEqual([m.fileQuestion]);
  });

  it('refuses a required question', () => {
    expect(problemOf((field) => ({ ...field, required: true }))).toEqual([m.optional]);
  });

  it('refuses a choice without "Prefer not to say"', () => {
    const without = (field: FormField): FormField =>
      'options' in field
        ? {
            ...field,
            options: field.options.filter((option) => option.value !== preferNotToSay.value),
          }
        : field;
    expect(problemOf(without)).toEqual([m.preferNotToSay]);
  });

  it('refuses free text, content and any question not in the set, naming each field', () => {
    const text = (field: FormField): FormField => ({
      id: field.id,
      type: 'short_text',
      label: 'Describe your ethnic group',
      required: false,
      identity: false,
      audiences: 'aggregate_only',
      classification: 'special_category',
      conditions: [],
    });
    expect(problemOf(text)).toEqual([m.fromQuestionSet]);
    const content = { id: 'f_intro', type: 'content', body: 'Tell us more.', conditions: [] };
    expect(problemOf(() => content as FormField)).toEqual([m.fromQuestionSet]);
    expect(problemOf((field) => ({ ...field, id: 'f_ethnicity' }))).toEqual([m.fromQuestionSet]);
    const [problem] = monitoringDefinitionProblems(
      withField((field) => ({ ...field, required: true })),
    );
    expect(problem?.path).toEqual(['sections', 0, 'fields', 0]);
  });
});
