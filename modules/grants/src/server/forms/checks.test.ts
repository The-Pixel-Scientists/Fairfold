// SPDX-License-Identifier: AGPL-3.0-or-later

import { formMessages, parseDefinition, type FormDefinition } from '@pixel-scientists/domain/forms';
import { describe, expect, it } from 'vitest';

import { formRefusals, recheck, typeProblems } from './checks.ts';

function define(...fields: object[]): FormDefinition {
  const parsed = parseDefinition({
    sections: [{ id: 's_about', title: 'About your project', fields }],
  });
  if (!parsed.success) throw new Error('The test definition is not valid.');
  return parsed.data;
}

const title = { id: 'f_title', type: 'short_text', label: 'Project title' };
const budget = { id: 'f_budget', type: 'currency', label: 'Total cost' };
const costs = (amount: object) => ({
  id: 'f_costs',
  type: 'table',
  label: 'Costs',
  rowNoun: 'cost',
  columns: [{ id: 'c_item', type: 'short_text', label: 'Item' }, amount],
});

describe('typeProblems', () => {
  it('names a question given another type, at its type', () => {
    const earlier = [define(title, budget)];
    const next = define(title, { ...budget, type: 'number' });

    expect(typeProblems(earlier, next, 'body.definition')).toEqual([
      {
        field: 'body.definition.sections.0.fields.1.type',
        message: formRefusals.questionType('f_budget'),
      },
    ]);
  });

  it('names an id that was removed in a later version and returns with another type', () => {
    const earlier = [define(title, budget), define(title)];
    const next = define(title, { ...budget, type: 'short_text' });

    expect(typeProblems(earlier, next, 'definition')).toEqual([
      {
        field: 'definition.sections.0.fields.1.type',
        message: formRefusals.questionType('f_budget'),
      },
    ]);
  });

  it('names a table column given another type, at the column', () => {
    const earlier = [define(costs({ id: 'c_amount', type: 'currency', label: 'Amount' }))];
    const next = define(costs({ id: 'c_amount', type: 'number', label: 'Amount' }));

    expect(typeProblems(earlier, next, 'body.definition')).toEqual([
      {
        field: 'body.definition.sections.0.fields.0.columns.1.type',
        message: formRefusals.columnType('c_amount'),
      },
    ]);
  });

  it('has nothing to say where types are kept, ids are new or questions are removed', () => {
    const earlier = [define(title, budget)];

    expect(typeProblems(earlier, define(title, { ...budget, label: 'Cost' }), 'x')).toEqual([]);
    expect(typeProblems(earlier, define({ ...title, id: 'f_name' }), 'x')).toEqual([]);
    expect(typeProblems([], define(title), 'x')).toEqual([]);
  });
});

describe('recheck', () => {
  it('gives back the definition as the form engine parses it', () => {
    expect(
      recheck({ sections: [{ id: 's_a', title: ' About ', fields: [title] }] }, 'definition'),
    ).toEqual({
      definition: {
        sections: [
          { id: 's_a', title: 'About', conditions: [], fields: [expect.objectContaining(title)] },
        ],
      },
    });
  });

  it('names what is wrong by path, without repeating a value', () => {
    const result = recheck(
      { sections: [{ id: 's_a', title: 'About', fields: [title, { ...title, label: 'Secret' }] }] },
      'definition',
    );

    expect(result).toEqual({
      problems: [{ field: 'definition.sections.0.fields.1.id', message: formMessages.idUsedTwice }],
    });
    expect(JSON.stringify(result)).not.toContain('Secret');
  });
});
