// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { checkDefinition } from './check.ts';

const text = (id: string, label: string) => ({ id, type: 'short_text', label });

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
    const { problems, definition } = checkDefinition({
      sections: [
        { id: 's_one', title: 'One', fields: [text('f_a', 'First'), text('f_b', '')] },
        { id: 's_two', title: '', fields: [text('f_c', 'Third')] },
      ],
    });

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

  it('finds a special category question that staff can see', () => {
    const { problems } = checkDefinition({
      sections: [
        {
          id: 's_one',
          title: 'One',
          fields: [{ ...text('f_a', 'First'), classification: 'special_category' }],
        },
      ],
    });

    expect(problems.map((problem) => problem.path.join('.'))).toContain(
      'sections.0.fields.0.audiences',
    );
  });
});
