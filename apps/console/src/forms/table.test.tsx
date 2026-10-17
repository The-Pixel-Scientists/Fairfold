// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { setUpConsoleTests } from '../testing/render.tsx';
import {
  actionButton,
  editor,
  openDraft,
  questionButton,
  saves,
  savedDefinition,
} from './builder.ts';
import { budgetDraft } from './fixtures.ts';

setUpConsoleTests();

type User = ReturnType<typeof userEvent.setup>;

const COSTS = 'Costs';

/** A box of one column, named as a screen reader reads it. */
const of = (label: string, number: number) =>
  new RegExp(`^${label}\\s*of column ${String(number)}$`);
const COLUMN_ID = /^c_[a-z0-9]{12}$/;

const openBudget = () => openDraft(saves, budgetDraft);
const panel = () => within(editor());
const column = (number: number) => within(panel().getByRole('group', { name: `Column ${number}` }));
const headings = () =>
  panel()
    .getAllByRole<HTMLInputElement>('textbox', { name: /^Heading\s*of column/ })
    .map((input) => input.value);

/** Saves the draft and gives the columns of the table that were sent. */
async function savedColumns(user: User, sent: Awaited<ReturnType<typeof openDraft>>) {
  await user.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText(/^Saved /);
  const costs = savedDefinition(sent).sections[0]?.fields[0] as { columns: { id: string }[] };
  return costs.columns;
}

describe('adding a table question', () => {
  it('is chosen from the types, and starts with a name for a row, limits on rows and one column to fill in', async () => {
    const user = userEvent.setup();
    await openDraft(saves);
    await user.click(screen.getByRole('button', { name: 'Add question' }));

    await user.selectOptions(panel().getByRole('combobox', { name: 'Type' }), 'Table');

    expect(panel().getByText(/^Applicants add rows of answers/)).toBeTruthy();
    expect(panel().getByRole('textbox', { name: 'Name for one row' })).toHaveProperty(
      'value',
      'row',
    );
    expect(panel().getByRole('textbox', { name: 'Fewest rows' })).toHaveProperty('value', '0');
    expect(panel().getByRole('textbox', { name: 'Most rows' })).toHaveProperty('value', '20');
    expect(column(1).getByRole('textbox', { name: of('Heading', 1) })).toHaveProperty('value', '');
    expect(column(1).getByRole('combobox', { name: of('Type', 1) })).toHaveProperty(
      'value',
      'short_text',
    );
    expect(
      column(1).getByRole<HTMLInputElement>('checkbox', {
        name: 'Applicants must fill this in on every row',
      }).checked,
    ).toBe(true);
    expect(questionButton('Untitled question').textContent).toContain('Table');
  });

  it('is changed to another type of question, which keeps the words and drops the columns', async () => {
    const user = userEvent.setup();
    const sent = await openBudget();

    await user.selectOptions(panel().getByRole('combobox', { name: 'Type' }), 'Short text');

    expect(panel().queryByRole('group', { name: 'Column 1' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText(/^Saved /);
    const costs = savedDefinition(sent).sections[0]?.fields[0];
    expect(costs).toMatchObject({ id: 'f_costs', type: 'short_text', label: COSTS });
    expect(costs).not.toHaveProperty('columns');
  });
});

describe('the settings of a table', () => {
  it('are its rows and its columns, as saved', async () => {
    const user = userEvent.setup();
    await openBudget();

    expect(panel().getByRole('textbox', { name: 'Name for one row' })).toHaveProperty(
      'value',
      'cost',
    );
    expect(panel().getByRole('textbox', { name: 'Fewest rows' })).toHaveProperty('value', '1');
    expect(panel().getByRole('textbox', { name: 'Most rows' })).toHaveProperty('value', '10');
    expect(headings()).toEqual(['Item', 'Cost', 'Kind']);
    expect(
      column(3).getByRole<HTMLInputElement>('checkbox', {
        name: 'Applicants must fill this in on every row',
      }).checked,
    ).toBe(false);
    expect(panel().getByText('A table has 1 to 6 columns.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(screen.getByText('Saved 14 October 2026 at 2:15pm.')).toBeTruthy();
  });

  it('are changed, and sent with the columns under the ids they were made with', async () => {
    const user = userEvent.setup();
    const sent = await openBudget();
    const noun = panel().getByRole('textbox', { name: 'Name for one row' });
    await user.clear(noun);
    await user.type(noun, 'activity');
    await user.clear(panel().getByRole('textbox', { name: 'Fewest rows' }));
    await user.type(panel().getByRole('textbox', { name: 'Fewest rows' }), '2');
    await user.clear(column(2).getByRole('textbox', { name: of('Heading', 2) }));
    await user.type(column(2).getByRole('textbox', { name: of('Heading', 2) }), 'Price');

    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText(/^Saved /);

    expect(savedDefinition(sent).sections[0]?.fields[0]).toMatchObject({
      id: 'f_costs',
      rowNoun: 'activity',
      minRows: 2,
      maxRows: 10,
      columns: [
        { id: 'c_item', label: 'Item' },
        { id: 'c_cost', label: 'Price' },
        { id: 'c_kind', label: 'Kind' },
      ],
    });
  });

  it('never show the id of a column, which the person cannot edit', async () => {
    await openBudget();

    const boxes = [...editor().querySelectorAll('input, select, textarea')] as HTMLInputElement[];
    expect(boxes.every((box) => !/\bc_[a-z0-9]{3,}/.test(box.value))).toBe(true);
    expect(editor().textContent).not.toMatch(/\bc_[a-z0-9]{3,}/);
  });

  it('keep a whole number in each limit, up to the most the form engine allows', async () => {
    const user = userEvent.setup();
    await openBudget();
    const most = panel().getByRole('textbox', { name: 'Most rows' });

    await user.clear(most);
    await user.type(most, '1a2');
    expect((most as HTMLInputElement).value).toBe('12');
    await user.clear(most);
    await user.type(most, '99');
    expect((most as HTMLInputElement).value).toBe('50');
    await user.clear(most);
    expect((most as HTMLInputElement).value).toBe('');
  });
});

describe('the columns of a table', () => {
  it('ask for what their type needs: a limit for text, a total for numbers and amounts, choices for a list', async () => {
    const user = userEvent.setup();
    await openBudget();

    expect(column(1).getByRole('textbox', { name: of('Character limit', 1) })).toHaveProperty(
      'value',
      '80',
    );
    expect(column(1).queryByRole('group', { name: 'Total' })).toBeNull();
    expect(
      column(2).getByRole<HTMLInputElement>('checkbox', {
        name: 'Add up this column under the table',
      }).checked,
    ).toBe(true);
    expect(column(2).queryByRole('textbox', { name: /^Character limit/ })).toBeNull();
    expect(column(3).getByRole('textbox', { name: 'Choice 1' })).toHaveProperty('value', 'Staff');
    expect(column(3).getByRole('textbox', { name: 'Choice 2' })).toHaveProperty(
      'value',
      'Equipment',
    );

    await user.selectOptions(column(1).getByRole('combobox', { name: of('Type', 1) }), ['Number']);
    expect(column(1).queryByRole('textbox', { name: /^Character limit/ })).toBeNull();
    expect(column(1).getByRole('group', { name: 'Total' })).toBeTruthy();

    await user.selectOptions(column(2).getByRole('combobox', { name: of('Type', 2) }), [
      'Short text',
    ]);
    expect(column(2).queryByRole('group', { name: 'Total' })).toBeNull();
    expect(column(2).getByRole('textbox', { name: of('Character limit', 2) })).toHaveProperty(
      'value',
      '200',
    );
  });

  it('keep their id and heading when the type changes, and keep a total only where it fits', async () => {
    const user = userEvent.setup();
    const sent = await openBudget();
    await user.selectOptions(column(1).getByRole('combobox', { name: of('Type', 1) }), [
      'Amount in pounds',
    ]);
    await user.click(
      column(1).getByRole('checkbox', { name: 'Add up this column under the table' }),
    );
    await user.selectOptions(column(2).getByRole('combobox', { name: of('Type', 2) }), ['Number']);
    await user.selectOptions(column(1).getByRole('combobox', { name: of('Type', 1) }), [
      'Short text',
    ]);

    const columns = await savedColumns(user, sent);

    expect(columns).toMatchObject([
      { id: 'c_item', type: 'short_text', label: 'Item', total: false },
      { id: 'c_cost', type: 'number', label: 'Cost', total: true },
      { id: 'c_kind', type: 'dropdown' },
    ]);
  });

  it('are added at the end, with the cursor in the new heading', async () => {
    const user = userEvent.setup();
    const sent = await openBudget();

    await user.click(screen.getByRole('button', { name: 'Add column' }));

    expect(document.activeElement).toBe(column(4).getByRole('textbox', { name: of('Heading', 4) }));
    await user.keyboard('Notes');
    expect(headings()).toEqual(['Item', 'Cost', 'Kind', 'Notes']);
    const columns = await savedColumns(user, sent);
    expect(columns[3]?.id).toMatch(COLUMN_ID);
  });

  it('stop at the most a table can have, and say so', async () => {
    const user = userEvent.setup();
    await openBudget();
    const add = screen.getByRole('button', { name: 'Add column' });

    await user.click(add);
    await user.click(add);
    await user.click(add);
    expect(headings()).toHaveLength(6);
    await user.click(add);

    expect(headings()).toHaveLength(6);
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(add.getAttribute('aria-describedby')).toBeTruthy();
    expect(panel().getByText('A table has 1 to 6 columns.')).toBeTruthy();
  });

  it('are moved with buttons, which keep the focus and say where the column went', async () => {
    const user = userEvent.setup();
    const sent = await openBudget();
    expect(actionButton('Move up', 'column 1').getAttribute('aria-disabled')).toBe('true');
    expect(actionButton('Move down', 'column 3').getAttribute('aria-disabled')).toBe('true');

    await user.click(actionButton('Move down', 'column 1'));

    expect(headings()).toEqual(['Cost', 'Item', 'Kind']);
    expect(panel().getByText('Column moved to position 2 of 3')).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(actionButton('Move down', 'column 2'));
    });
    await user.click(actionButton('Move up', 'column 3'));
    expect(headings()).toEqual(['Cost', 'Kind', 'Item']);
    expect(document.activeElement).toBe(actionButton('Move up', 'column 2'));

    const columns = await savedColumns(user, sent);
    expect(columns.map(({ id }) => id)).toEqual(['c_cost', 'c_kind', 'c_item']);
  });

  it('are removed with a button, which leaves the cursor in the column that takes its place', async () => {
    const user = userEvent.setup();
    const sent = await openBudget();

    await user.click(actionButton('Remove', 'column 2'));

    expect(headings()).toEqual(['Item', 'Kind']);
    expect(panel().getByText('Column removed')).toBeTruthy();
    expect(document.activeElement).toBe(column(2).getByRole('textbox', { name: of('Heading', 2) }));
    await user.click(actionButton('Remove', 'column 2'));
    expect(document.activeElement).toBe(column(1).getByRole('textbox', { name: of('Heading', 1) }));
    const columns = await savedColumns(user, sent);
    expect(columns.map(({ id }) => id)).toEqual(['c_item']);
  });

  it('keep at least one, and say why the last cannot be removed', async () => {
    const user = userEvent.setup();
    await openBudget();
    await user.click(actionButton('Remove', 'column 3'));
    await user.click(actionButton('Remove', 'column 2'));

    const remove = actionButton('Remove', 'column 1');
    await user.click(remove);

    expect(headings()).toEqual(['Item']);
    expect(remove.getAttribute('aria-disabled')).toBe('true');
    expect(
      panel().getByText(
        'A table keeps at least one column. Add another before you remove this one.',
      ),
    ).toBeTruthy();
  });

  it('get a new id when a column that was removed is added again', async () => {
    const user = userEvent.setup();
    const sent = await openBudget();
    await user.click(actionButton('Remove', 'column 2'));
    await user.click(screen.getByRole('button', { name: 'Add column' }));
    await user.keyboard('Cost');

    const columns = await savedColumns(user, sent);

    expect(columns).toHaveLength(3);
    expect(columns.map(({ id }) => id).slice(0, 2)).toEqual(['c_item', 'c_kind']);
    expect(columns[2]?.id).toMatch(COLUMN_ID);
    expect(columns.map(({ id }) => id)).not.toContain('c_cost');
  });

  it('give a list column choices that can be added and removed, two at least', async () => {
    const user = userEvent.setup();
    const sent = await openBudget();
    const kind = column(3);

    await user.click(kind.getByRole('button', { name: 'Add choice' }));
    expect(document.activeElement).toBe(kind.getByRole('textbox', { name: 'Choice 3' }));
    await user.keyboard('Travel');
    await user.click(kind.getByRole('button', { name: /^Remove\s*choice 1$/ }));
    expect(
      kind.getAllByRole<HTMLInputElement>('textbox', { name: /^Choice/ }).map((box) => box.value),
    ).toEqual(['Equipment', 'Travel']);
    expect(document.activeElement).toBe(kind.getByRole('button', { name: 'Add choice' }));
    expect(
      kind.getByRole('button', { name: /^Remove\s*choice 1$/ }).getAttribute('aria-disabled'),
    ).toBe('true');

    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText(/^Saved /);
    const costs = savedDefinition(sent).sections[0]?.fields[0] as {
      columns: { id: string; options?: { value: string; label: string }[] }[];
    };
    expect(costs.columns[2]?.options?.map(({ label }) => label)).toEqual(['Equipment', 'Travel']);
    expect(costs.columns[2]?.options?.[0]?.value).toBe('kit');
  });
});

describe('the problems of a table', () => {
  it('show beside the boxes they are about and in the summary, which names the column, and send nothing', async () => {
    const user = userEvent.setup();
    const sent = await openBudget();
    await user.click(screen.getByRole('button', { name: 'Add column' }));
    await user.clear(panel().getByRole('textbox', { name: 'Name for one row' }));
    await user.clear(panel().getByRole('textbox', { name: 'Most rows' }));
    await user.selectOptions(column(1).getByRole('combobox', { name: of('Type', 1) }), [
      'Choose one from a list',
    ]);

    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    const errors = await screen.findByRole('alert', { name: 'There is a problem' });
    expect(
      within(errors)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      'Section 1, question 1: Enter at least 1 character.',
      'Section 1, question 1: Enter 1 or more.',
      'Section 1, question 1, column 1: Enter at least 1 character.',
      'Section 1, question 1, column 1: Enter at least 1 character.',
      'Section 1, question 1, column 4: Enter at least 1 character.',
      'Section 1, question 1: Make the lowest value no higher than the highest.',
    ]);
    const noun = panel().getByRole('textbox', { name: 'Name for one row' });
    expect(noun.getAttribute('aria-invalid')).toBe('true');
    expect(noun.getAttribute('aria-describedby')).toContain('field-rowNoun-error');
    expect(panel().getByRole('textbox', { name: 'Most rows' }).getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(
      column(4)
        .getByRole('textbox', { name: of('Heading', 4) })
        .getAttribute('aria-invalid'),
    ).toBe('true');
    expect(questionButton(COSTS).textContent).toContain('Has a problem');
    expect(sent.some(({ key }) => key.startsWith('PUT'))).toBe(false);
  });

  it('link from the summary to the box of a column', async () => {
    const user = userEvent.setup();
    await openBudget();
    await user.click(screen.getByRole('button', { name: 'Add column' }));
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    const errors = await screen.findByRole('alert', { name: 'There is a problem' });

    await user.click(within(errors).getByRole('link', { name: /column 4:/ }));

    expect(document.activeElement).toBe(column(4).getByRole('textbox', { name: of('Heading', 4) }));
  });

  it('say when the fewest rows are more than the most, beside the fewest', async () => {
    const user = userEvent.setup();
    await openBudget();
    await user.clear(panel().getByRole('textbox', { name: 'Fewest rows' }));
    await user.type(panel().getByRole('textbox', { name: 'Fewest rows' }), '12');

    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    const fewest = panel().getByRole('textbox', { name: 'Fewest rows' });
    expect(fewest.getAttribute('aria-invalid')).toBe('true');
    expect(panel().getByText('Make the lowest value no higher than the highest.')).toBeTruthy();
  });

  it('link from the summary to the choices of a column that has none', async () => {
    const user = userEvent.setup();
    await openBudget();
    await user.click(actionButton('Remove', 'column 3'));
    await user.selectOptions(column(2).getByRole('combobox', { name: of('Type', 2) }), [
      'Choose one from a list',
    ]);
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    const errors = await screen.findByRole('alert', { name: 'There is a problem' });

    const [first] = within(errors).getAllByRole('link', { name: /column 2: Enter at least 1/ });
    if (first === undefined) throw new Error('Expected a link to the choices.');
    await user.click(first);

    expect(document.activeElement).toBe(column(2).getByRole('textbox', { name: 'Choice 1' }));
  });
});
