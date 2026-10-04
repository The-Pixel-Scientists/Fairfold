// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { exampleAnswers, exampleForm } from './fixture.ts';
import { formDefinitionSchema } from './rules.ts';
import { visibleFields, type Answers } from './visibility.ts';

const ids = (answers: Answers, form = exampleForm) =>
  visibleFields(form, answers).map((field) => field.id);

describe('visibleFields', () => {
  it('shows every field, content included, when every condition holds', () => {
    expect(ids(exampleAnswers)).toContain('f_works');
    expect(ids(exampleAnswers)).toContain('f_planning');
    expect(ids(exampleAnswers)).toContain('f_intro');
  });

  it('hides a field, or a whole section, whose condition does not hold', () => {
    const equipment = { ...exampleAnswers, f_kind: 'equipment' };
    expect(ids(equipment)).not.toContain('f_works');
    expect(ids(equipment)).not.toContain('f_planning');
    expect(ids({})).not.toContain('f_works');
  });

  it('compares answers exactly, with no conversion', () => {
    const form = formDefinitionSchema.parse({
      sections: [
        {
          id: 's_one',
          title: 'One',
          fields: [
            { id: 'f_ok', type: 'yes_no', label: 'OK?' },
            {
              id: 'f_why',
              type: 'short_text',
              label: 'Why?',
              conditions: [{ field: 'f_ok', equals: true }],
            },
          ],
        },
      ],
    });
    expect(ids({ f_ok: true }, form)).toContain('f_why');
    for (const value of ['true', 1, 'yes', null]) {
      expect(ids({ f_ok: value }, form)).not.toContain('f_why');
    }
  });

  it('joins conditions with and, reads includes on a list, and hides what depends on a hidden field', () => {
    const form = formDefinitionSchema.parse({
      sections: [
        {
          id: 's_one',
          title: 'One',
          fields: [
            { id: 'f_ok', type: 'yes_no', label: 'OK?' },
            {
              id: 'f_who',
              type: 'multiple_choice',
              label: 'Who?',
              options: [
                { value: 'a', label: 'A' },
                { value: 'b', label: 'B' },
              ],
              conditions: [{ field: 'f_ok', equals: true }],
            },
            {
              id: 'f_more',
              type: 'yes_no',
              label: 'More?',
              conditions: [
                { field: 'f_ok', equals: true },
                { field: 'f_who', includes: 'b' },
              ],
            },
          ],
        },
      ],
    });
    expect(ids({ f_ok: true, f_who: ['a', 'b'] }, form)).toContain('f_more');
    expect(ids({ f_ok: true, f_who: ['a'] }, form)).not.toContain('f_more');
    expect(ids({ f_ok: true, f_who: 'b' }, form)).not.toContain('f_more');
    // f_who is hidden, so its stored answer counts as no answer.
    expect(ids({ f_ok: false, f_who: ['b'] }, form)).toEqual(['f_ok']);
  });

  it('reads only answers the applicant owns, never inherited properties', () => {
    const answers = Object.create({ f_kind: 'building' }) as Answers;
    expect(ids(answers)).not.toContain('f_works');
  });
});
