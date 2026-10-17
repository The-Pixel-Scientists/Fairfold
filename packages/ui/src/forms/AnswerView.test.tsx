// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { fileHelpers, helpers, question } from '../../test/forms.tsx';
import { AnswerView } from './AnswerView.tsx';
import type { AnswerViewProps } from './AnswerView.tsx';
import type { AttachedFile, FormFieldDefinition, FormSectionDefinition } from './types.ts';

const options = [
  { value: 'north', label: 'North' },
  { value: 'south', label: 'South' },
];

function show(
  fields: readonly FormFieldDefinition[],
  answers: Record<string, unknown>,
  visible: readonly { id: string }[] = fields,
  sections: readonly FormSectionDefinition[] = [{ id: 's_one', title: 'About you', fields }],
) {
  return render(
    <AnswerView sections={sections} visible={visible} answers={answers} helpers={helpers} />,
  );
}

/** The text shown beside a question's label. */
function answerTo(label: string): string {
  const term = screen.getByText(label);
  expect(term.tagName).toBe('DT');
  return term.nextElementSibling?.textContent ?? '';
}

describe('AnswerView', () => {
  it('lists each section by title, with each question and its answer as a term and description', () => {
    show([question({ id: 'f_name', type: 'short_text', label: 'Name' })], { f_name: 'Ada' });

    expect(screen.getByRole('heading', { level: 3, name: 'About you' })).toBeTruthy();
    expect(answerTo('Name')).toBe('Ada');
  });

  it('says "Not answered" where there is no answer', () => {
    show(
      [
        question({ id: 'f_one', type: 'short_text', label: 'One' }),
        question({ id: 'f_two', type: 'short_text', label: 'Two' }),
        question({ id: 'f_three', type: 'multiple_choice', label: 'Three', options }),
        question({ id: 'f_four', type: 'uk_address', label: 'Four' }),
        question({ id: 'f_five', type: 'yes_no', label: 'Five' }),
      ],
      { f_one: null, f_two: '   ', f_three: [] },
    );

    for (const label of ['One', 'Two', 'Three', 'Four', 'Five']) {
      expect(answerTo(label)).toBe('Not answered');
    }
  });

  it('shows no as an answer, and zero', () => {
    show(
      [
        question({ id: 'f_charity', type: 'yes_no', label: 'Charity' }),
        question({ id: 'f_count', type: 'number', label: 'Count', wholeNumber: true }),
      ],
      { f_charity: false, f_count: 0 },
    );

    expect(answerTo('Charity')).toBe('No');
    expect(answerTo('Count')).toBe('0');
  });

  it('shows each type as people read it', () => {
    show(
      [
        question({ id: 'f_story', type: 'long_text', label: 'Story' }),
        question({ id: 'f_people', type: 'number', label: 'People', wholeNumber: false }),
        question({ id: 'f_amount', type: 'currency', label: 'Amount', currency: 'GBP' }),
        question({ id: 'f_start', type: 'date', label: 'Start' }),
        question({ id: 'f_region', type: 'single_choice', label: 'Region', options }),
        question({ id: 'f_drop', type: 'dropdown', label: 'Drop', options }),
        question({ id: 'f_where', type: 'multiple_choice', label: 'Where', options }),
        question({ id: 'f_address', type: 'uk_address', label: 'Address' }),
      ],
      {
        f_story: 'One\nTwo',
        f_people: 12_500.25,
        f_amount: { amountMinor: 2_500_000, currency: 'GBP' },
        f_start: '2027-04-01',
        f_region: 'south',
        f_drop: 'north',
        f_where: ['north', 'south'],
        f_address: { line1: '1 High Street', town: 'Northfield', postcode: 'NF1 1AA' },
      },
    );

    expect(answerTo('Story')).toBe('One\nTwo');
    expect(answerTo('People')).toBe('12,500.25');
    expect(answerTo('Amount')).toBe('£25,000');
    expect(answerTo('Start')).toBe('1 April 2027');
    expect(answerTo('Region')).toBe('South');
    expect(answerTo('Drop')).toBe('North');
    const where = screen.getByText('Where').nextElementSibling as HTMLElement;
    expect(
      within(where)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['North', 'South']);
    expect(answerTo('Address')).toBe('1 High StreetNorthfieldNF1 1AA');
  });

  it('does not show a field that is not in the list it is given, even with an answer', () => {
    const fields = [
      question({ id: 'f_name', type: 'short_text', label: 'Organisation name' }),
      question({ id: 'f_site', type: 'url', label: 'Website' }),
    ];
    show(fields, { f_name: 'Northfield Trust', f_site: 'https://example.org' }, [{ id: 'f_site' }]);

    expect(screen.queryByText('Organisation name')).toBeNull();
    expect(screen.queryByText('Northfield Trust')).toBeNull();
    expect(answerTo('Website')).toBe('https://example.org');
  });

  it('leaves out a section with nothing to show, and content blocks', () => {
    const sections: FormSectionDefinition[] = [
      {
        id: 's_one',
        title: 'Shown',
        fields: [
          { id: 'f_note', type: 'content', body: 'Read this first.' },
          question({ id: 'f_name', type: 'short_text', label: 'Name' }),
        ],
      },
      {
        id: 's_two',
        title: 'Hidden section',
        fields: [question({ id: 'f_other', type: 'short_text', label: 'Other' })],
      },
    ];
    show([], { f_name: 'Ada', f_other: 'x' }, [{ id: 'f_note' }, { id: 'f_name' }], sections);

    expect(screen.getByRole('heading', { name: 'Shown' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Hidden section' })).toBeNull();
    expect(screen.queryByText('Read this first.')).toBeNull();
  });

  it('shows an answer that does not fit its field as no answer, never as what it holds', () => {
    show(
      [
        question({ id: 'f_name', type: 'short_text', label: 'Name' }),
        question({ id: 'f_amount', type: 'currency', label: 'Amount', currency: 'GBP' }),
        question({ id: 'f_address', type: 'uk_address', label: 'Address' }),
      ],
      { f_name: { secret: 'x' }, f_amount: 'lots', f_address: 'somewhere' },
    );

    expect(answerTo('Name')).toBe('Not answered');
    expect(answerTo('Amount')).toBe('Not answered');
    expect(answerTo('Address')).toBe('Not answered');
  });

  it('puts the section titles at the heading level asked for', () => {
    render(
      <AnswerView
        headingLevel="h2"
        sections={[
          { id: 's_one', title: 'Title', fields: [question({ id: 'f_a', type: 'short_text' })] },
        ]}
        visible={[{ id: 'f_a' }]}
        answers={{}}
        helpers={helpers}
      />,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Title' })).toBeTruthy();
  });

  describe('a table answer', () => {
    const pounds = (amount: number) => ({ amountMinor: amount * 100, currency: 'GBP' });
    const kinds = [
      { value: 'staff', label: 'Staff' },
      { value: 'venue', label: 'Venue' },
    ];
    const budget = question({
      id: 'f_budget',
      type: 'table',
      label: 'Budget',
      rowNoun: 'cost',
      minRows: 0,
      maxRows: 20,
      columns: [
        { id: 'c_item', type: 'short_text', label: 'Item', required: true },
        { id: 'c_kind', type: 'dropdown', label: 'Type of cost', required: false, options: kinds },
        { id: 'c_n', type: 'number', label: 'Sessions', required: false, wholeNumber: false },
        {
          id: 'c_cost',
          type: 'currency',
          label: 'Cost',
          required: true,
          currency: 'GBP',
          total: true,
        },
      ],
    });
    const answer = [
      { c_item: 'Venue hire', c_kind: 'venue', c_n: 48, c_cost: pounds(2880) },
      { c_item: 'Session leader', c_kind: 'staff', c_cost: pounds(7200) },
    ];

    function table() {
      return screen.getByRole('table', { name: 'Budget' });
    }

    it('shows a table whose caption is the question, with a heading for each column', () => {
      show([budget], { f_budget: answer }, [budget], undefined);

      expect(
        within(table())
          .getAllByRole('columnheader')
          .map((heading) => heading.textContent),
      ).toEqual(['Item', 'Type of cost', 'Sessions', 'Cost']);
      expect(table().querySelector('caption')?.textContent).toBe('Budget');
    });

    it('shows one row for each answer row, with each cell as people read it', () => {
      show([budget], { f_budget: answer });

      const body = table().querySelector('tbody') as HTMLElement;
      const rows = within(body)
        .getAllByRole('row')
        .map((row) =>
          within(row)
            .getAllByRole('cell')
            .map((cell) => cell.textContent),
        );
      expect(rows).toEqual([
        ['Venue hire', 'Venue', '48', '£2,880'],
        ['Session leader', 'Staff', '–Not answered', '£7,200'],
      ]);
    });

    it('puts the totals in the footer, under the column they add up', () => {
      show([budget], { f_budget: answer });

      const foot = table().querySelector('tfoot') as HTMLElement;
      const cells = within(foot).getAllByRole('cell');
      expect(within(foot).getByRole('rowheader').textContent).toBe('Total');
      expect(cells.map((cell) => cell.textContent)).toEqual(['', '', '£10,080']);
    });

    it('right-aligns numbers and amounts, in figures that line up', () => {
      show([budget], { f_budget: answer });

      const [first] = within(table().querySelector('tbody') as HTMLElement).getAllByRole('row');
      const cells = within(first as HTMLElement).getAllByRole('cell');
      expect(cells.map((cell) => cell.className.includes('text-end'))).toEqual([
        false,
        false,
        true,
        true,
      ]);
      expect(cells[3]?.className).toContain('tabular-nums');
      const headings = within(table()).getAllByRole('columnheader');
      expect(headings.map((heading) => heading.className.includes('text-end'))).toEqual([
        false,
        false,
        true,
        true,
      ]);
    });

    it('puts the question above a table that needs the whole width', () => {
      show([budget], { f_budget: answer });

      const term = screen.getByText('Budget', { selector: 'dt' });
      expect(term.parentElement?.className).not.toContain('sm:grid');
      expect(term.nextElementSibling?.contains(table())).toBe(true);
    });

    it('scrolls a wide table inside a named region that the keyboard can reach', () => {
      show([budget], { f_budget: answer });

      const region = screen.getByRole('region', { name: 'Budget' });
      expect(region.getAttribute('tabindex')).toBe('0');
      expect(region.className).toContain('overflow-x-auto');
      expect(region.contains(table())).toBe(true);
    });

    it('says "Not answered" when there are no rows, and for anything that is not a list of rows', () => {
      const { unmount } = show([budget], { f_budget: [] });
      expect(screen.queryByRole('table')).toBeNull();
      expect(answerTo('Budget')).toBe('Not answered');
      unmount();

      show([budget], { f_budget: 'lots' });
      expect(screen.queryByRole('table')).toBeNull();
      expect(answerTo('Budget')).toBe('Not answered');
    });

    it('says a cell is not answered, to a screen reader, where it is empty or does not fit its column', () => {
      show([budget], {
        f_budget: [{ c_item: 'Hall', c_kind: 'moon', c_n: 'many', c_cost: 'lots' }],
      });

      const body = table().querySelector('tbody') as HTMLElement;
      const cells = within(body).getAllByRole('cell');
      expect(cells.map((cell) => cell.textContent)).toEqual([
        'Hall',
        'moon',
        '–Not answered',
        '–Not answered',
      ]);
    });

    it('shows no totals row without the totals helper, and never an unchecked sum', () => {
      render(
        <AnswerView
          sections={[{ id: 's_one', title: 'About you', fields: [budget] }]}
          visible={[budget]}
          answers={{ f_budget: answer }}
          helpers={{ formatMoney: (money) => helpers.formatMoney(money) }}
        />,
      );

      expect(table().querySelector('tfoot')).toBeNull();
    });

    it('shows no total for a column that is not totalled, and no footer at all when none is', () => {
      const plain = question({
        id: 'f_plain',
        type: 'table',
        label: 'People',
        rowNoun: 'person',
        minRows: 0,
        maxRows: 5,
        columns: [{ id: 'c_name', type: 'short_text', label: 'Name', required: true }],
      });
      show([plain], { f_plain: [{ c_name: 'Ada' }] });

      expect(screen.getByRole('table', { name: 'People' }).querySelector('tfoot')).toBeNull();
    });

    it('shows a table only to the audience that is given the field', () => {
      show([budget], { f_budget: answer }, []);

      expect(screen.queryByRole('table')).toBeNull();
      expect(screen.queryByText('Venue hire')).toBeNull();
      expect(screen.queryByText('Budget')).toBeNull();
    });
  });

  describe('a file answer', () => {
    const PDF = 'application/pdf';
    const accounts = question({
      id: 'f_accounts',
      type: 'file',
      label: 'Accounts',
      allowedTypes: [PDF],
      maxBytes: 10 * 1024 * 1024,
      maxFiles: 3,
    });
    const attached = (id: string, name: string, extra: Partial<AttachedFile> = {}) => ({
      id,
      fieldId: 'f_accounts',
      name,
      type: PDF,
      bytes: 2_202_010,
      ...extra,
    });
    const files = [attached('a1', 'accounts.pdf'), attached('a2', 'plan.pdf', { bytes: 856_064 })];

    function showFiles(props: Partial<AnswerViewProps> = {}) {
      return render(
        <AnswerView
          sections={[{ id: 's_one', title: 'Documents', fields: [accounts] }]}
          visible={[accounts]}
          answers={{ f_accounts: ['a1', 'a2'] }}
          helpers={{ ...helpers, ...fileHelpers }}
          files={files}
          {...props}
        />,
      );
    }

    it('lists the files as links to download them, each with its type and size', () => {
      showFiles({ hrefFor: (id) => `/files/${id}` });

      const links = within(screen.getByRole('list')).getAllByRole('link');
      expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
        'Download accounts.pdf, PDF, 2.1 MB',
        'Download plan.pdf, PDF, 836 KB',
      ]);
      expect(links.map((link) => link.getAttribute('href'))).toEqual(['/files/a1', '/files/a2']);
      expect(answerTo('Accounts')).toContain('PDF, 2.1 MB');
    });

    it('lists the names, as text, when it is not told where the files download from', () => {
      showFiles();

      expect(screen.queryByRole('link')).toBeNull();
      expect(
        within(screen.getByRole('list'))
          .getAllByRole('listitem')
          .map((item) => item.textContent),
      ).toEqual(['accounts.pdfPDF, 2.1 MB', 'plan.pdfPDF, 836 KB']);
    });

    it('shows a type as its own name when the labels are not given', () => {
      showFiles({ helpers });

      expect(answerTo('Accounts')).toContain('application/pdf, 2.1 MB');
    });

    it('says "Not answered" when the question has no files, and shows none that answer another question', () => {
      showFiles({ files: [attached('b1', 'other.pdf', { fieldId: 'f_other' })] });

      expect(answerTo('Accounts')).toBe('Not answered');
      expect(screen.queryByText('other.pdf')).toBeNull();
    });

    it('shows only the files it is given, never what the answer holds', () => {
      showFiles({ files: [] });

      expect(answerTo('Accounts')).toBe('Not answered');
    });

    it('shows no file, and not even the question, to an audience that is not given the field', () => {
      showFiles({ visible: [], hrefFor: (id) => `/files/${id}` });

      expect(screen.queryByText('Accounts')).toBeNull();
      expect(screen.queryByText('accounts.pdf')).toBeNull();
      expect(screen.queryByRole('link')).toBeNull();
    });

    it('shows a name as text only', () => {
      showFiles({
        files: [attached('a3', '<img src=x onerror=alert(1)>.pdf')],
        hrefFor: (id) => `/files/${id}`,
      });

      expect(document.querySelector('img')).toBeNull();
      expect(screen.getByRole('link').textContent).toBe('<img src=x onerror=alert(1)>.pdf');
    });
  });
});
