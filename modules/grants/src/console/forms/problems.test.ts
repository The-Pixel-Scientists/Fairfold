// SPDX-License-Identifier: AGPL-3.0-or-later

import { ProblemError } from '@pixel-scientists/domain/api';
import type { FormDefinition } from '@pixel-scientists/domain/forms';
import { describe, expect, it } from 'vitest';

import {
  checkDefinition,
  fieldControlId,
  flaggedIds,
  inWords,
  messagesAt,
  placeOf,
  refusedProblems,
  sectionControlId,
  summaryOf,
} from './problems.ts';

const text = (id: string, label: string) => ({ id, type: 'short_text', label });

const draft = {
  sections: [
    { id: 's_one', title: 'One', fields: [text('f_a', 'First'), text('f_b', '')] },
    { id: 's_two', title: '', fields: [text('f_c', 'Third')] },
  ],
};

describe('checking a definition', () => {
  it('gives the definition as the server reads it, when it has no problems', () => {
    const checked = checkDefinition({
      sections: [{ id: 's_one', title: '  One  ', fields: [text('f_a', 'First')] }],
    });

    expect(checked.problems).toEqual([]);
    expect(checked.definition?.sections[0]?.title).toBe('One');
    expect(checked.definition?.sections[0]?.fields[0]).toMatchObject({ required: false });
  });

  it('says what is wrong and where, in the words the server uses', () => {
    const { problems, definition } = checkDefinition(draft);

    expect(definition).toBeNull();
    expect(problems).toEqual([
      { path: ['sections', 0, 'fields', 1, 'label'], message: 'Enter at least 1 character.' },
      { path: ['sections', 1, 'title'], message: 'Enter at least 1 character.' },
    ]);
  });

  it('finds the rules between questions, such as a condition that reads a later question', () => {
    const { problems } = checkDefinition({
      sections: [
        {
          id: 's_one',
          title: 'One',
          fields: [
            { ...text('f_a', 'First'), conditions: [{ field: 'f_b', equals: true }] },
            { id: 'f_b', type: 'yes_no', label: 'Second' },
          ],
        },
      ],
    });

    expect(problems).toEqual([
      {
        path: ['sections', 0, 'fields', 0, 'conditions', 0, 'field'],
        message: 'Choose a question that comes before this one.',
      },
    ]);
  });

  it('asks for a section when there is none', () => {
    expect(checkDefinition({ sections: [] }).problems).toEqual([
      { path: ['sections'], message: 'Add at least 1 item.' },
    ]);
  });
});

describe('what the server refused', () => {
  it('names a problem by its place in the definition, from the request or from the stored form', () => {
    const saved = new ProblemError(400, 'Some fields are not valid.', {
      errors: [
        { field: 'body.definition.sections.0.fields.1.type', message: 'Keep its type.' },
        { field: 'definition.sections.2.title', message: 'Enter text.' },
      ],
    });

    expect(refusedProblems(saved)).toEqual([
      { path: ['sections', 0, 'fields', 1, 'type'], message: 'Keep its type.' },
      { path: ['sections', 2, 'title'], message: 'Enter text.' },
    ]);
  });

  it('keeps the words for the whole request, which has no place', () => {
    const changed = new ProblemError(409, 'This draft changed while you were working on it.');

    expect(refusedProblems(changed)).toEqual([
      { path: [], message: 'This draft changed while you were working on it.' },
    ]);
  });

  it('does not show what it did not expect', () => {
    expect(refusedProblems(new TypeError('boom'))).toEqual([
      { path: [], message: 'Something went wrong. Try again.' },
    ]);
  });
});

describe('where a problem is', () => {
  it('is a section and a question by position, and the path inside them', () => {
    expect(placeOf(['sections', 1, 'fields', 2, 'options', 0, 'label'])).toEqual({
      section: 1,
      field: 2,
      key: 'options.0.label',
    });
    expect(placeOf(['sections', 1, 'title'])).toEqual({ section: 1, key: 'title' });
    expect(placeOf(['sections', 1, 'fields'])).toEqual({ section: 1, key: 'fields' });
    expect(placeOf(['sections'])).toEqual({ key: 'sections' });
    expect(placeOf([])).toEqual({ key: '' });
  });

  it('is said as "Section 2, question 3"', () => {
    expect(inWords({ path: ['sections', 1, 'fields', 2, 'label'], message: 'Enter text.' })).toBe(
      'Section 2, question 3: Enter text.',
    );
    expect(inWords({ path: ['sections', 0, 'title'], message: 'Enter text.' })).toBe(
      'Section 1: Enter text.',
    );
    expect(inWords({ path: [], message: 'Try again.' })).toBe('Try again.');
  });

  it('names the column when a table has the problem in one', () => {
    const at = (...rest: (string | number)[]) => ['sections', 0, 'fields', 1, 'columns', ...rest];

    expect(inWords({ path: at(2, 'label'), message: 'Enter text.' })).toBe(
      'Section 1, question 2, column 3: Enter text.',
    );
    expect(inWords({ path: at(0, 'options', 1, 'label'), message: 'Enter text.' })).toBe(
      'Section 1, question 2, column 1: Enter text.',
    );
    expect(inWords({ path: at(), message: 'Add at least 1 item.' })).toBe(
      'Section 1, question 2: Add at least 1 item.',
    );
  });

  it('names the box that a problem is about', () => {
    expect(fieldControlId('label')).toBe('field-label');
    expect(fieldControlId('options.2.label')).toBe('field-options-2-label');
    expect(fieldControlId('options')).toBe('field-options-add');
    expect(fieldControlId('conditions.0.field')).toBe('field-conditions-0');
    expect(fieldControlId('conditions')).toBe('field-conditions-add');
    expect(fieldControlId('eligibility.explanation')).toBe('field-eligibility-explanation');
    expect(fieldControlId('eligibility.stopValues')).toBe('field-eligibility');
    expect(fieldControlId('rowNoun')).toBe('field-rowNoun');
    expect(fieldControlId('allowedTypes')).toBe('field-allowedTypes');
    expect(fieldControlId('columns')).toBe('field-columns-add');
    expect(fieldControlId('columns.1.label')).toBe('field-columns-1-label');
    expect(fieldControlId('columns.1.total')).toBe('field-columns-1-total');
    expect(fieldControlId('columns.1.maxCharacters')).toBe('field-columns-1-maxCharacters');
    expect(fieldControlId('columns.1.options')).toBe('field-columns-1-options-add');
    expect(fieldControlId('columns.1.options.0.label')).toBe('field-columns-1-options-0-label');
    expect(fieldControlId('columns.1.id')).toBe('field-columns-1-label');
    expect(fieldControlId('columns.1')).toBe('field-columns-1-label');
    expect(sectionControlId('title')).toBe('section-title');
    expect(sectionControlId('introduction')).toBe('section-introduction');
    expect(sectionControlId('fields')).toBe('add-question');
  });
});

describe('the problems of what is selected', () => {
  const { problems } = checkDefinition(draft);
  const definition = draft as unknown as FormDefinition;

  it('are keyed by their path inside the question or the section', () => {
    expect(messagesAt(problems, 0, 1)).toEqual(new Map([['label', 'Enter at least 1 character.']]));
    expect(messagesAt(problems, 1, undefined)).toEqual(
      new Map([['title', 'Enter at least 1 character.']]),
    );
    expect(messagesAt(problems, 0, 0).size).toBe(0);
  });

  it('flag the sections and questions that have one', () => {
    expect(flaggedIds(problems, definition)).toEqual(new Set(['s_one', 'f_b', 's_two']));
  });

  it('link from the summary to the box when it is selected, and to the list when it is not', () => {
    const items = (sectionId: string, fieldId: string | null) =>
      summaryOf(problems, definition, { sectionId, fieldId });

    expect(items('s_one', 'f_b')).toEqual([
      { fieldId: 'field-label', message: 'Section 1, question 2: Enter at least 1 character.' },
      { fieldId: 'outline-s_two', message: 'Section 2: Enter at least 1 character.' },
    ]);
    expect(items('s_one', 'f_a')[0]?.fieldId).toBe('outline-f_b');
    expect(items('s_two', null)).toEqual([
      { fieldId: 'outline-s_one', message: 'Section 1, question 2: Enter at least 1 character.' },
      { fieldId: 'section-title', message: 'Section 2: Enter at least 1 character.' },
    ]);
  });

  it('send a problem with the whole request to the save button, and a missing section to adding one', () => {
    const items = summaryOf(
      [
        { path: [], message: 'This draft changed.' },
        { path: ['sections'], message: 'Add at least 1 item.' },
      ],
      { sections: [] },
      { sectionId: '', fieldId: null },
    );

    expect(items.map((item) => item.fieldId)).toEqual(['save-draft', 'add-section']);
  });
});
