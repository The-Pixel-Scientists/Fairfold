// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { messageForIssue } from '../platform/messages.ts';
import { answersSchema, answerValueSchema } from './answers.ts';
import { projectionAudiences } from './audience.ts';
import { budgetAnswers, budgetForm, budgetInput, exampleForm, exampleInput } from './fixture.ts';
import type { TableField } from './definition.ts';
import { formMessages as m } from './messages.ts';
import { projectAnswers } from './project.ts';
import { changedFieldTypes, formDefinitionSchema, parseDefinition } from './rules.ts';
import { tableTotals } from './table.ts';
import { validateAnswers } from './validate.ts';

type Input = typeof budgetInput;
type Field = Record<string, unknown> & { columns: Record<string, unknown>[] };

/** A copy of the budget form with one change to the budget table, made by `change`. */
function variant(change: (budget: Field, input: Input) => void): unknown {
  const copy = JSON.parse(JSON.stringify(budgetInput)) as Input;
  change(copy.sections[0]?.fields[0] as unknown as Field, copy);
  return copy;
}

const budgetWith = (change: (budget: Field) => void) => formDefinitionSchema.parse(variant(change));

function budgetTable(form = budgetForm): TableField {
  const field = form.sections[0]?.fields.find((each) => each.id === 'f_budget');
  if (field?.type !== 'table') throw new Error('The budget form has no budget table.');
  return field;
}

function refusals(input: unknown): { path: string; message: string }[] {
  const result = parseDefinition(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: messageForIssue(issue),
      }));
}

const budgetAt = 'sections.0.fields.0';
const pounds = (amountMinor: number) => ({ amountMinor, currency: 'GBP' });
const row = (item: unknown, cost: unknown) => ({ c_item: item, c_cost: cost });

/** Problems with the budget answers after giving the budget table these rows. */
function withRows(rows: unknown, mode: 'draft' | 'submit' = 'submit', form = budgetForm) {
  return validateAnswers(form, { ...budgetAnswers, f_budget: rows }, mode);
}

const problem = (field: string, message: string) => [{ field, message }];

describe('a table question', () => {
  it('parses with every default written out', () => {
    expect(refusals(budgetInput)).toEqual([]);
    expect(budgetForm.sections[0]?.fields[1]).toEqual({
      id: 'f_trustees',
      type: 'table',
      label: 'Who are your trustees?',
      required: false,
      identity: true,
      audiences: ['applicant', 'staff', 'reviewer'],
      conditions: [],
      rowNoun: 'trustee',
      minRows: 0,
      maxRows: 20,
      columns: [
        {
          id: 'c_name',
          type: 'short_text',
          label: 'Name',
          required: true,
          total: false,
          maxCharacters: 200,
        },
        {
          id: 'c_role',
          type: 'dropdown',
          label: 'Role',
          required: false,
          total: false,
          options: [
            { value: 'chair', label: 'Chair' },
            { value: 'treasurer', label: 'Treasurer' },
            { value: 'trustee', label: 'Trustee' },
          ],
        },
      ],
    });
  });

  it('refuses a table outside its limits', () => {
    const options = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ value: `o${index}`, label: 'Option' }));
    const text = { id: 'c_text', type: 'short_text', label: 'Text' };
    for (const [name, change] of [
      ['no noun', (field: Field) => (field['rowNoun'] = '')],
      ['a long noun', (field: Field) => (field['rowNoun'] = 'x'.repeat(41))],
      ['too few rows', (field: Field) => (field['minRows'] = -1)],
      ['too many rows', (field: Field) => (field['minRows'] = 51)],
      ['no rows', (field: Field) => (field['maxRows'] = 0)],
      ['over 50 rows', (field: Field) => (field['maxRows'] = 51)],
      ['no columns', (field: Field) => (field.columns = [])],
      ['seven columns', (field: Field) => (field.columns = Array.from({ length: 7 }, () => text))],
      ['a bad column id', (field: Field) => (field.columns[0] = { ...text, id: 'item' })],
      ['a long label', (field: Field) => (field.columns[0] = { ...text, label: 'x'.repeat(101) })],
      ['long text', (field: Field) => (field.columns[0] = { ...text, maxCharacters: 201 })],
      ['a long text column', (field: Field) => (field.columns[0] = { ...text, type: 'long_text' })],
      ['dollars', (field: Field) => (field.columns[1] = { ...field.columns[1], currency: 'USD' })],
      ['an eligibility rule', (field: Field) => (field['eligibility'] = { stopWhen: true })],
      [
        'one option',
        (field: Field) =>
          (field.columns[0] = { id: 'c_a', type: 'dropdown', label: 'A', options: options(1) }),
      ],
      [
        '51 options',
        (field: Field) =>
          (field.columns[0] = { id: 'c_a', type: 'dropdown', label: 'A', options: options(51) }),
      ],
    ] as const) {
      expect(parseDefinition(variant(change)).success, name).toBe(false);
    }
  });

  it('refuses a column id used twice in a table, but not in two tables', () => {
    const twice = variant((field) => (field.columns[1] = { ...field.columns[1], id: 'c_item' }));
    expect(refusals(twice)).toEqual([
      { path: `${budgetAt}.columns.1.id`, message: m.columnIdUsedTwice },
    ]);
    // f_trustees has a c_name column too.
    const shared = variant((field) => (field.columns[0] = { ...field.columns[0], id: 'c_name' }));
    expect(refusals(shared)).toEqual([]);
  });

  it('refuses a total on a text or dropdown column', () => {
    const input = variant((field, form) => {
      field.columns[0] = { ...field.columns[0], total: true };
      const trustees = form.sections[0]?.fields[1] as unknown as Field;
      trustees.columns[1] = { ...trustees.columns[1], total: true };
    });
    expect(refusals(input)).toEqual([
      { path: `${budgetAt}.columns.0.total`, message: m.totalType },
      { path: 'sections.0.fields.1.columns.1.total', message: m.totalType },
    ]);
  });

  it('refuses more fewest rows than most, and column limits out of order', () => {
    const input = variant((field) => {
      Object.assign(field, { minRows: 5, maxRows: 4 });
      field.columns[1] = { ...field.columns[1], minMinor: 10, maxMinor: 9 };
      field.columns.push({ id: 'c_qty', type: 'number', label: 'Quantity', min: 2, max: 1 });
      field.columns.push({
        id: 'c_kind',
        type: 'dropdown',
        label: 'Kind',
        options: [
          { value: 'a', label: 'A' },
          { value: 'a', label: 'Also A' },
        ],
      });
    });
    expect(refusals(input)).toEqual([
      { path: `${budgetAt}.minRows`, message: m.limitOrder },
      { path: `${budgetAt}.columns.1.minMinor`, message: m.limitOrder },
      { path: `${budgetAt}.columns.2.min`, message: m.limitOrder },
      { path: `${budgetAt}.columns.3.options`, message: m.optionsUnique },
    ]);
  });

  it('refuses a condition that reads a table', () => {
    const input = variant((_, form) => {
      (form.sections[0]?.fields as object[]).push({
        id: 'f_more',
        type: 'short_text',
        label: 'Tell us more',
        conditions: [{ field: 'f_budget', equals: 'x' }],
      });
    });
    expect(refusals(input)).toEqual([
      { path: 'sections.0.fields.2.conditions.0', message: m.conditionType },
    ]);
  });
});

describe('table answers', () => {
  it('parse as rows of cells keyed by column id, beside every other answer type', () => {
    expect(answersSchema.parse(budgetAnswers)).toEqual(budgetAnswers);
    expect(answerValueSchema.safeParse([{ c_a: null, c_b: 2.5 }, {}]).success).toBe(true);
    for (const value of [
      Array(51).fill({}),
      [{ tenantId: 'x' }],
      [{ c_a: true }],
      [{ c_a: ['x'] }],
      [{ c_a: { nested: 1 } }],
      [{ c_a: 'x'.repeat(401) }],
      [{ c_a: { ...pounds(1), extra: 1 } }],
      [{ c_a: 'x' }, 'row'],
    ]) {
      expect(answerValueSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
  });
});

describe('validateAnswers on a table', () => {
  it('passes valid rows in both modes', () => {
    expect(validateAnswers(budgetForm, budgetAnswers, 'submit')).toEqual([]);
    expect(validateAnswers(budgetForm, budgetAnswers, 'draft')).toEqual([]);
  });

  it('refuses anything that is not a list of rows, in both modes', () => {
    for (const mode of ['draft', 'submit'] as const) {
      for (const value of ['rows', 1, { c_item: 'x' }, [1], [null], [['x']], [{}, 'x']]) {
        expect(withRows(value, mode), JSON.stringify(value)).toEqual(
          problem('f_budget', m.tableRows),
        );
      }
    }
  });

  it('refuses a column the table does not have, without naming it', () => {
    const rows = JSON.parse('[{"c_item":"Paint","__proto__":{"c_cost":1}}]') as unknown;
    for (const value of [[{ ...row('Paint', pounds(100)), c_other: 'x' }], rows]) {
      expect(withRows(value, 'draft')).toEqual(problem('f_budget', m.notInTable));
    }
  });

  it('refuses more rows than the most, in both modes', () => {
    const rows = Array.from({ length: 11 }, () => row('Paint', pounds(100)));
    expect(withRows(rows, 'draft')).toEqual(problem('f_budget', 'Add no more than 10 costs.'));
    expect(withRows(rows.slice(1), 'submit')).toEqual([]);
  });

  it('converts no cell, and checks each against its column, naming the cell', () => {
    for (const mode of ['draft', 'submit'] as const) {
      expect(withRows([row(42, '1000'), row('Two\nlines', 1000)], mode)).toEqual([
        { field: 'f_budget.1.c_item', message: 'Enter text for cost 1.' },
        { field: 'f_budget.1.c_cost', message: 'Enter the amount for cost 1 in pounds.' },
        { field: 'f_budget.2.c_item', message: 'Enter the answer for cost 2 on one line.' },
        { field: 'f_budget.2.c_cost', message: 'Enter the amount for cost 2 in pounds.' },
      ]);
    }
    expect(withRows([row('x'.repeat(101), pounds(99)), row('Paint', pounds(1.5))])).toEqual([
      {
        field: 'f_budget.1.c_item',
        message: 'Enter 100 characters or fewer for cost 1. You have 101.',
      },
      { field: 'f_budget.1.c_cost', message: 'Enter an amount from £1 to £25,000 for cost 1.' },
      { field: 'f_budget.2.c_cost', message: 'Enter the amount for cost 2 in pounds.' },
    ]);
    expect(withRows([row('Paint', { amountMinor: 100, currency: 'USD' })])).toEqual(
      problem('f_budget.1.c_cost', 'Enter the amount for cost 1 in pounds.'),
    );
  });

  it('checks number and dropdown cells as their questions do', () => {
    const form = budgetWith((field) => {
      field.columns.push(
        { id: 'c_qty', type: 'number', label: 'Quantity', wholeNumber: true, min: 1, max: 9 },
        {
          id: 'c_kind',
          type: 'dropdown',
          label: 'Kind',
          required: false,
          options: [
            { value: 'goods', label: 'Goods' },
            { value: 'staff', label: 'Staff' },
          ],
        },
      );
    });
    const cells = (qty: unknown, kind: unknown) => [
      { ...row('Paint', pounds(100)), c_qty: qty, c_kind: kind },
    ];
    expect(withRows(cells(2, 'goods'), 'submit', form)).toEqual([]);
    expect(withRows(cells('2', 'other'), 'draft', form)).toEqual([
      { field: 'f_budget.1.c_qty', message: 'Enter a number for cost 1.' },
      { field: 'f_budget.1.c_kind', message: 'Choose one of the options given for cost 1.' },
    ]);
    expect(withRows(cells(2.5, ' '), 'submit', form)).toEqual(
      problem('f_budget.1.c_qty', 'Enter a whole number for cost 1.'),
    );
    expect(withRows(cells(10, null), 'submit', form)).toEqual(
      problem('f_budget.1.c_qty', 'Enter a number from 1 to 9 for cost 1.'),
    );
    expect(withRows(cells(null, null), 'submit', form)).toEqual(
      problem('f_budget.1.c_qty', 'Enter a number for cost 1.'),
    );
    expect(withRows(cells('', null), 'draft', form)).toEqual(
      problem('f_budget.1.c_qty', 'Enter a number for cost 1.'),
    );
  });

  it('on submit, needs the fewest rows', () => {
    expect(withRows([], 'draft')).toEqual([]);
    expect(withRows(null)).toEqual(problem('f_budget', 'Add at least 1 cost.'));
    expect(withRows([])).toEqual(problem('f_budget', 'Add at least 1 cost.'));
    const two = budgetWith((field) => (field['minRows'] = 2));
    const one = [row('Paint', pounds(100))];
    expect(withRows(one, 'submit', two)).toEqual(problem('f_budget', 'Add at least 2 costs.'));
    expect(withRows(one, 'draft', two)).toEqual([]);
    const optional = budgetWith((field) => Object.assign(field, { required: false, minRows: 2 }));
    expect(withRows([], 'submit', optional)).toEqual(problem('f_budget', 'Add at least 2 costs.'));
    const none = budgetWith((field) => (field['required'] = false));
    expect(withRows([], 'submit', none)).toEqual([]);
  });

  it('on submit, needs required cells filled and no blank row', () => {
    const rows = [row('Paint', pounds(100)), row('  ', null), row('Ladder', null), {}];
    expect(withRows(rows, 'draft')).toEqual([]);
    expect(withRows(rows)).toEqual([
      { field: 'f_budget', message: 'Fill in cost 2 or remove it.' },
      { field: 'f_budget.3.c_cost', message: 'Enter an amount for cost 3.' },
      { field: 'f_budget', message: 'Fill in cost 4 or remove it.' },
    ]);
    const trustees = [{ c_role: 'chair' }, { c_name: 'Alex Northfield', c_role: '' }];
    expect(
      validateAnswers(budgetForm, { ...budgetAnswers, f_trustees: trustees }, 'submit'),
    ).toEqual(problem('f_trustees.1.c_name', 'Enter an answer for trustee 1.'));
    const roles = budgetWith((field) => {
      field.columns[0] = {
        id: 'c_kind',
        type: 'dropdown',
        label: 'Kind',
        options: [
          { value: 'goods', label: 'Goods' },
          { value: 'staff', label: 'Staff' },
        ],
      };
    });
    expect(withRows([{ c_cost: pounds(100) }], 'submit', roles)).toEqual(
      problem('f_budget.1.c_kind', 'Choose an answer for cost 1.'),
    );
  });

  it('refuses rows for a table that is not shown', () => {
    const input = variant((field, form) => {
      field['conditions'] = [{ field: 'f_gate', equals: true }];
      form.sections[0]?.fields.unshift({ id: 'f_gate', type: 'yes_no', label: 'Gate' } as never);
    });
    const form = formDefinitionSchema.parse(input);
    expect(validateAnswers(form, { ...budgetAnswers, f_gate: false }, 'draft')).toEqual(
      problem('f_budget', m.notShown),
    );
    expect(validateAnswers(form, { f_gate: false, f_budget: [] }, 'submit')).toEqual([]);
  });

  it('names rows with the plural the noun needs', () => {
    expect(m.rowsAtLeast(1, 'activity')).toBe('Add at least 1 activity.');
    expect(m.rowsAtLeast(2, 'activity')).toBe('Add at least 2 activities.');
    expect(m.rowsAtMost(3, 'box')).toBe('Add no more than 3 boxes.');
    expect(m.rowsAtMost(3, 'day')).toBe('Add no more than 3 days.');
    expect(m.rowsAtMost(20, 'cost')).toBe('Add no more than 20 costs.');
  });
});

describe('projectAnswers on a table', () => {
  it('keeps or drops a table whole, by its audiences and identity', () => {
    const keys = (form = budgetForm) =>
      Object.fromEntries(
        projectionAudiences.map((who) => [
          who,
          Object.keys(projectAnswers(form, budgetAnswers, who)),
        ]),
      );
    expect(keys()).toEqual({
      applicant: ['f_budget', 'f_trustees'],
      staff: ['f_budget', 'f_trustees'],
      reviewer: ['f_budget', 'f_trustees'],
      blind_reviewer: ['f_budget'],
    });
    expect(projectAnswers(budgetForm, budgetAnswers, 'staff')['f_trustees']).toBe(
      budgetAnswers.f_trustees,
    );
    const hidden = budgetWith((field) => (field['audiences'] = 'aggregate_only'));
    expect(keys(hidden)['staff']).toEqual(['f_trustees']);
    const staffOnly = budgetWith((field) => (field['audiences'] = ['applicant', 'staff']));
    expect(keys(staffOnly)['reviewer']).toEqual(['f_trustees']);
  });

  it('lets no row or cell of an identity table reach a blind reviewer', () => {
    const text = JSON.stringify(projectAnswers(budgetForm, budgetAnswers, 'blind_reviewer'));
    for (const value of ['Alex Northfield', 'Sam Southfield', 'chair', 'c_name', 'f_trustees']) {
      expect(text).not.toContain(value);
    }
  });
});

describe('changedFieldTypes with tables', () => {
  it('finds a column id given another type, against the latest version with it', () => {
    const asNumber = budgetWith((field) => {
      field.columns[1] = { id: 'c_cost', type: 'number', label: 'Cost' };
    });
    const dropped = budgetWith((field) => field.columns.pop());
    expect(changedFieldTypes([budgetForm], budgetForm)).toEqual([]);
    expect(changedFieldTypes([budgetForm], asNumber)).toEqual(['f_budget.c_cost']);
    expect(changedFieldTypes([budgetForm, dropped], asNumber)).toEqual(['f_budget.c_cost']);
    expect(changedFieldTypes([budgetForm, asNumber], asNumber)).toEqual([]);
  });

  it('finds a field id changed to or from a table', () => {
    const tableInput = JSON.parse(JSON.stringify(exampleInput)) as typeof exampleInput;
    const fields = tableInput.sections[1]?.fields as object[];
    fields[6] = { ...budgetInput.sections[0]?.fields[0], id: 'f_region' };
    const toTable = formDefinitionSchema.parse(tableInput);
    expect(changedFieldTypes([exampleForm], toTable)).toEqual(['f_region']);
    expect(changedFieldTypes([toTable], exampleForm)).toEqual(['f_region']);
  });
});

describe('tableTotals', () => {
  it('sums each totalled column in minor units, ignoring blank cells', () => {
    expect(tableTotals(budgetTable(), budgetAnswers.f_budget)).toEqual({
      c_cost: pounds(1_250_050),
    });
    const form = budgetWith((field) => {
      field.columns.push({ id: 'c_qty', type: 'number', label: 'Quantity', total: true });
    });
    const table = budgetTable(form);
    expect(tableTotals(table, [])).toEqual({ c_cost: pounds(0), c_qty: 0 });
    expect(
      tableTotals(table, [
        { c_cost: pounds(100), c_qty: 1.5 },
        { c_cost: null, c_qty: null },
        { c_item: 'Paint' },
        { c_cost: pounds(250), c_qty: 2 },
      ]),
    ).toEqual({ c_cost: pounds(350), c_qty: 3.5 });
  });

  it('gives no total for a column with a cell that is not its type', () => {
    const table = budgetTable();
    for (const cost of ['100', 100, { amountMinor: 100, currency: 'USD' }, pounds(0.5)]) {
      expect(tableTotals(table, [{ c_cost: pounds(1) }, { c_cost: cost }])).toEqual({
        c_cost: null,
      });
    }
    const huge = { c_cost: pounds(Number.MAX_SAFE_INTEGER) };
    expect(tableTotals(table, [huge, huge])).toEqual({ c_cost: null });
  });
});
