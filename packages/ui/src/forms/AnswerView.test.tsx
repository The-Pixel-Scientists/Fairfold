// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { helpers, question } from '../../test/forms.tsx';
import { AnswerView } from './AnswerView.tsx';
import type { FormFieldDefinition, FormSectionDefinition } from './types.ts';

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
});
