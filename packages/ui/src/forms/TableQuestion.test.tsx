// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { helpers, question, SectionHarness } from '../../test/forms.tsx';

const kinds = [
  { value: 'staff', label: 'Staff' },
  { value: 'venue', label: 'Venue' },
];

const pounds = (amount: number) => ({ amountMinor: amount * 100, currency: 'GBP' });

function budget(extra: Record<string, unknown> = {}) {
  return question({
    id: 'f_budget',
    type: 'table',
    label: 'Budget',
    hint: 'Add a row for each cost.',
    required: true,
    rowNoun: 'cost',
    minRows: 0,
    maxRows: 4,
    columns: [
      { id: 'c_item', type: 'short_text', label: 'Item', required: true },
      { id: 'c_kind', type: 'dropdown', label: 'Type of cost', required: true, options: kinds },
      {
        id: 'c_cost',
        type: 'currency',
        label: 'Cost',
        required: true,
        currency: 'GBP',
        total: true,
      },
    ],
    ...extra,
  });
}

const rows = [
  { c_item: 'Venue hire', c_kind: 'venue', c_cost: pounds(2880) },
  { c_item: 'Session leader', c_kind: 'staff', c_cost: pounds(7200) },
  { c_item: 'Refreshments', c_kind: 'staff', c_cost: pounds(2420) },
];

const group = (name: string) => screen.getByRole('group', { name });
const textbox = (row: number, name: string) =>
  within(group(`Cost ${String(row)}`)).getByRole('textbox', { name });

afterEach(() => {
  vi.useRealTimers();
});

describe('TableQuestion', () => {
  it('shows each row as a group named by the noun and number, with a control for each column', () => {
    render(<SectionHarness fields={[budget()]} answers={{ f_budget: rows.slice(0, 2) }} />);

    expect(screen.getByRole('group', { name: 'Budget (required)' })).toBeTruthy();
    expect(
      screen.getAllByRole('group').map((item) => item.querySelector('legend')?.textContent),
    ).toEqual(['Budget (required)', 'Cost 1', 'Cost 2']);
    const second = within(group('Cost 2'));
    expect(second.getByRole<HTMLInputElement>('textbox', { name: 'Item' }).value).toBe(
      'Session leader',
    );
    expect(second.getByRole<HTMLSelectElement>('combobox', { name: 'Type of cost' }).value).toBe(
      'staff',
    );
    expect(second.getByRole<HTMLInputElement>('textbox', { name: 'Cost' }).value).toBe('7200');
  });

  it('ties the hint to the table, and says in words which columns are optional', () => {
    render(
      <SectionHarness
        fields={[
          budget({
            columns: [
              { id: 'c_item', type: 'short_text', label: 'Item', required: true },
              { id: 'c_note', type: 'short_text', label: 'Note', required: false },
            ],
          }),
        ]}
        answers={{ f_budget: [{ c_item: 'Hall' }] }}
      />,
    );

    expect(
      screen.getByRole('group', {
        name: 'Budget (required)',
        description: 'Add a row for each cost.',
      }),
    ).toBeTruthy();
    expect(textbox(1, 'Item')).toBeTruthy();
    expect(textbox(1, 'Note (optional)')).toBeTruthy();
  });

  it('asks for every column as the control that suits it: text, number, amount in pounds, native select', () => {
    render(
      <SectionHarness
        fields={[
          budget({
            minRows: 1,
            columns: [
              { id: 'c_item', type: 'short_text', label: 'Item', required: true },
              { id: 'c_n', type: 'number', label: 'Sessions', required: true, wholeNumber: true },
              { id: 'c_cost', type: 'currency', label: 'Cost', required: true, currency: 'GBP' },
              { id: 'c_kind', type: 'dropdown', label: 'Type', required: true, options: kinds },
            ],
          }),
        ]}
      />,
    );

    const row = within(group('Cost 1'));
    expect(row.getByRole('textbox', { name: 'Item' }).getAttribute('inputmode')).toBeNull();
    expect(row.getByRole('textbox', { name: 'Sessions' }).getAttribute('inputmode')).toBe(
      'numeric',
    );
    expect(row.getByRole('textbox', { name: 'Cost' }).getAttribute('inputmode')).toBe('decimal');
    expect(row.getByText('£')).toBeTruthy();
    expect(row.getByRole('combobox', { name: 'Type' }).tagName).toBe('SELECT');
  });

  it('keeps the answers as a list of rows keyed by column id, and an amount in pence', async () => {
    const user = userEvent.setup();
    const answers: unknown[] = [];
    render(
      <SectionHarness
        fields={[budget({ minRows: 1 })]}
        onAnswer={(_, value) => {
          answers.push(value);
        }}
      />,
    );

    await user.type(textbox(1, 'Item'), 'Hall');
    await user.selectOptions(
      within(group('Cost 1')).getByRole('combobox', { name: 'Type of cost' }),
      'Venue',
    );
    await user.type(textbox(1, 'Cost'), '£1,250.50');

    expect(answers.at(-1)).toEqual([{ c_item: 'Hall', c_kind: 'venue', c_cost: pounds(1250.5) }]);
  });

  describe('rows', () => {
    it('shows the fewest rows from the start, and makes them part of the answer when one changes', async () => {
      const user = userEvent.setup();
      const answers: unknown[] = [];
      render(
        <SectionHarness
          fields={[budget({ minRows: 2 })]}
          onAnswer={(_, value) => {
            answers.push(value);
          }}
        />,
      );

      expect(screen.getByRole('group', { name: 'Cost 1' })).toBeTruthy();
      expect(screen.getByRole('group', { name: 'Cost 2' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
      expect(answers).toEqual([]);

      await user.type(textbox(2, 'Item'), 'a');

      expect(answers.at(-1)).toEqual([{}, { c_item: 'a' }]);
    });

    it('says what to do when there are no rows, and asks for the first', () => {
      render(<SectionHarness fields={[budget()]} />);

      expect(screen.getByText('No costs yet. Add the first one below.')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Add the first cost' })).toBeTruthy();
    });

    it('adds a row and moves focus to its first control', async () => {
      const user = userEvent.setup();
      render(<SectionHarness fields={[budget({ minRows: 1 })]} />);

      await user.click(screen.getByRole('button', { name: 'Add another cost' }));

      expect(screen.getByRole('group', { name: 'Cost 2' })).toBeTruthy();
      expect(document.activeElement).toBe(textbox(2, 'Item'));
      expect((textbox(2, 'Item') as HTMLInputElement).value).toBe('');
    });

    it('adds the first row from nothing, with the keyboard', async () => {
      const user = userEvent.setup();
      render(<SectionHarness fields={[budget()]} />);

      screen.getByRole('button', { name: 'Add the first cost' }).focus();
      await user.keyboard('{Enter}');

      expect(document.activeElement).toBe(textbox(1, 'Item'));
      expect(screen.queryByText(/No costs yet/)).toBeNull();
    });

    it('swaps the add button for words at the most rows, naming the noun in the plural', () => {
      render(<SectionHarness fields={[budget({ maxRows: 3 })]} answers={{ f_budget: rows }} />);

      expect(screen.getByText('You can add up to 3 costs.')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /^Add/ })).toBeNull();
    });

    it('says "activities" and "boxes", as the engine does', () => {
      const { rerender } = render(
        <SectionHarness
          fields={[budget({ rowNoun: 'activity', maxRows: 2 })]}
          answers={{ f_budget: rows.slice(0, 2) }}
        />,
      );
      expect(screen.getByText('You can add up to 2 activities.')).toBeTruthy();

      rerender(
        <SectionHarness
          fields={[budget({ rowNoun: 'box', maxRows: 2 })]}
          answers={{ f_budget: rows.slice(0, 2) }}
        />,
      );
      expect(screen.getByText('You can add up to 2 boxes.')).toBeTruthy();
    });

    it('removes the row, and moves focus to the same place in the next row', async () => {
      const user = userEvent.setup();
      render(<SectionHarness fields={[budget()]} answers={{ f_budget: rows }} />);

      await user.click(screen.getByRole('button', { name: 'Remove cost 2' }));

      expect(screen.queryByRole('group', { name: 'Cost 3' })).toBeNull();
      expect((textbox(2, 'Item') as HTMLInputElement).value).toBe('Refreshments');
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove cost 2' }));
    });

    it('moves focus to the add button when the last row is removed', async () => {
      const user = userEvent.setup();
      render(<SectionHarness fields={[budget()]} answers={{ f_budget: rows }} />);

      await user.click(screen.getByRole('button', { name: 'Remove cost 3' }));

      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add another cost' }));
    });

    it('goes back to nothing when the last row goes, and tells the app there is no answer', async () => {
      const user = userEvent.setup();
      const answers: unknown[] = [];
      render(
        <SectionHarness
          fields={[budget()]}
          answers={{ f_budget: [rows[0]] }}
          onAnswer={(_, value) => {
            answers.push(value);
          }}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Remove cost 1' }));

      expect(answers).toEqual([null]);
      expect(screen.getByText('No costs yet. Add the first one below.')).toBeTruthy();
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Add the first cost' }),
      );
    });

    it('offers no way to remove a row that the table needs, and moves focus to the add button', async () => {
      const user = userEvent.setup();
      render(
        <SectionHarness
          fields={[budget({ minRows: 2 })]}
          answers={{ f_budget: rows.slice(0, 3) }}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Remove cost 3' }));
      expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add another cost' }));
    });

    it('takes up the room when a removed row leaves the next one in its place', async () => {
      const user = userEvent.setup();
      render(<SectionHarness fields={[budget()]} answers={{ f_budget: rows }} />);

      await user.click(screen.getByRole('button', { name: 'Remove cost 1' }));
      await user.click(screen.getByRole('button', { name: 'Remove cost 1' }));

      expect((textbox(1, 'Item') as HTMLInputElement).value).toBe('Refreshments');
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove cost 1' }));
    });

    it('shows a figure that is not an amount as it was typed', () => {
      render(
        <SectionHarness
          fields={[budget()]}
          answers={{ f_budget: [{ c_item: 'Hall', c_cost: 'a lot' }] }}
        />,
      );

      expect((textbox(1, 'Cost') as HTMLInputElement).value).toBe('a lot');
    });
  });

  describe('layout', () => {
    const headings = (container: HTMLElement) =>
      container.querySelector('[aria-hidden="true"].hidden')?.textContent ?? null;

    it('puts the column headings above rows whose fields sit side by side', () => {
      const { container } = render(
        <SectionHarness fields={[budget()]} answers={{ f_budget: [rows[0]] }} />,
      );

      expect(headings(container)).toContain('Item');
      expect(headings(container)).toContain('Cost');
    });

    it('keeps the fields of a row with many columns stacked, each with its own label', () => {
      const columns = ['a', 'b', 'c', 'd', 'e'].map((name) => ({
        id: `c_${name}`,
        type: 'short_text',
        label: `Column ${name}`,
        required: true,
      }));
      const { container } = render(
        <SectionHarness fields={[budget({ columns })]} answers={{ f_budget: [{}] }} />,
      );

      expect(headings(container)).toBeNull();
      expect(screen.getAllByRole('textbox')).toHaveLength(5);
    });
  });

  describe('totals', () => {
    it('shows the total of a totalled column, and says it in a polite live region', () => {
      render(<SectionHarness fields={[budget()]} answers={{ f_budget: rows }} />);

      const status = screen.getByRole('status');
      expect(status.textContent).toBe('Total cost: £12,500');
      expect(screen.getByText('Total cost').nextElementSibling?.textContent).toBe('£12,500');
    });

    it('shows no total, and no sum, when the form passes no way to work one out', () => {
      const counting = {
        countWords: (text: string) => helpers.countWords(text),
        countCharacters: (text: string) => helpers.countCharacters(text),
      };
      render(
        <SectionHarness fields={[budget()]} answers={{ f_budget: rows }} helpers={counting} />,
      );

      expect(screen.getAllByRole('group', { name: /^Cost / })).toHaveLength(3);
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.queryByText('Total cost')).toBeNull();
    });

    it('shows no total until there is a row', () => {
      render(<SectionHarness fields={[budget()]} />);

      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.queryByText('Total cost')).toBeNull();
    });

    it('updates the total as the person types, and tells a screen reader once typing stops', () => {
      vi.useFakeTimers();
      render(<SectionHarness fields={[budget()]} answers={{ f_budget: rows }} />);
      const status = screen.getByRole('status');

      fireEvent.change(textbox(3, 'Cost'), { target: { value: '1000' } });

      expect(screen.getByText('Total cost').nextElementSibling?.textContent).toBe('£11,080');
      expect(status.textContent).toBe('Total cost: £12,500');
      act(() => {
        vi.advanceTimersByTime(1100);
      });
      expect(status.textContent).toBe('Total cost: £11,080');
    });

    it('works out no total while a cell is not an amount, and says so in words', () => {
      render(
        <SectionHarness
          fields={[budget()]}
          answers={{ f_budget: [rows[0], { c_item: 'Extra', c_cost: 'a lot' }] }}
        />,
      );

      expect(screen.getByText('Total cost').nextElementSibling?.textContent).toBe(
        'Not worked out yet',
      );
      expect(screen.getByRole('status').textContent).toBe('Total cost: Not worked out yet');
    });

    it('adds up a number column as a number, and a total for each totalled column', () => {
      render(
        <SectionHarness
          fields={[
            budget({
              columns: [
                { id: 'c_item', type: 'short_text', label: 'Item', required: true },
                {
                  id: 'c_n',
                  type: 'number',
                  label: 'Sessions',
                  required: true,
                  wholeNumber: false,
                  total: true,
                },
                {
                  id: 'c_vat',
                  type: 'currency',
                  label: 'VAT',
                  required: true,
                  currency: 'GBP',
                  total: true,
                },
              ],
            }),
          ]}
          answers={{
            f_budget: [
              { c_item: 'a', c_n: 0.1, c_vat: pounds(20) },
              { c_item: 'b', c_n: 0.2, c_vat: pounds(5) },
            ],
          }}
        />,
      );

      expect(screen.getByRole('status').textContent).toBe('Total sessions: 0.3. Total VAT: £25');
    });

    it('leaves out the total of a column that is not totalled', () => {
      render(
        <SectionHarness
          fields={[
            budget({
              columns: [
                { id: 'c_item', type: 'short_text', label: 'Item', required: true },
                { id: 'c_n', type: 'number', label: 'Sessions', required: true, wholeNumber: true },
              ],
            }),
          ]}
          answers={{ f_budget: [{ c_item: 'a', c_n: 3 }] }}
        />,
      );

      expect(screen.queryByRole('status')).toBeNull();
    });
  });

  describe('problems', () => {
    const problems = [
      { field: 'f_budget', message: 'Fill in cost 3 or remove it.' },
      { field: 'f_budget.2.c_cost', message: 'Enter the amount for cost 2 in pounds.' },
      { field: 'f_budget.2.c_item', message: 'Enter an answer for cost 2.' },
    ];
    const answers = { f_budget: [rows[0], { c_kind: 'staff', c_cost: 'a lot' }, {}] };

    it('shows each message beside the cell its path names, tied to the cell and marked invalid', () => {
      render(<SectionHarness fields={[budget()]} answers={answers} problems={problems} />);

      const cost = textbox(2, 'Cost');
      expect(cost.getAttribute('aria-invalid')).toBe('true');
      expect(cost.getAttribute('aria-describedby')).toContain('f_budget-2-c_cost-error');
      expect(
        within(group('Cost 2')).getByText('Enter the amount for cost 2 in pounds.'),
      ).toBeTruthy();
      expect(textbox(2, 'Item').getAttribute('aria-invalid')).toBe('true');
      expect(textbox(1, 'Cost').getAttribute('aria-invalid')).toBeNull();
      expect(textbox(3, 'Cost').getAttribute('aria-invalid')).toBeNull();
    });

    it('shows a problem with the whole table on the table, and describes it to a screen reader', () => {
      render(<SectionHarness fields={[budget()]} answers={answers} problems={problems} />);

      expect(
        screen.getByRole('group', {
          name: 'Budget (required)',
          description: 'Add a row for each cost. Error: Fill in cost 3 or remove it.',
        }),
      ).toBeTruthy();
    });

    it('lists every problem in the summary, each linking to its cell or to the table', async () => {
      const user = userEvent.setup();
      render(
        <SectionHarness fields={[budget()]} answers={answers} problems={problems} attempt={1} />,
      );

      const summary = screen.getByRole('alert', { name: 'There is a problem' });
      const links = within(summary).getAllByRole('link');
      expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
        ['Fill in cost 3 or remove it.', '#f_budget'],
        ['Enter the amount for cost 2 in pounds.', '#f_budget-2-c_cost'],
        ['Enter an answer for cost 2.', '#f_budget-2-c_item'],
      ]);

      await user.click(links[1] as HTMLElement);
      expect(document.activeElement).toBe(textbox(2, 'Cost'));
      await user.click(links[0] as HTMLElement);
      expect(document.activeElement).toBe(screen.getByRole('group', { name: 'Budget (required)' }));
    });
  });
});
