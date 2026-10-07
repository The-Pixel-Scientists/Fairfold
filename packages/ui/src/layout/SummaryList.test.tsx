// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SummaryList } from './SummaryList.tsx';

const organisation = { term: 'Organisation', value: 'Eastmere Community Hub' };
const amount = { term: 'Amount requested', value: '£18,500' };
const items = [organisation, amount];

/** The row that holds a term. */
function rowOf(term: string): HTMLElement {
  const row = screen.getByText(term).closest('dl > div');
  if (!(row instanceof HTMLElement)) throw new Error(`No row holds ${term}.`);
  return row;
}

describe('SummaryList', () => {
  it('lists each term with its value', () => {
    render(<SummaryList items={items} />);

    expect(screen.getAllByRole('term').map((term) => term.textContent)).toEqual([
      'Organisation',
      'Amount requested',
    ]);
    expect(screen.getAllByRole('definition').map((value) => value.textContent)).toEqual([
      'Eastmere Community Hub',
      '£18,500',
    ]);
  });

  it('groups each term with its own value and action', () => {
    render(
      <SummaryList
        items={[
          {
            term: 'Stage',
            value: 'In review',
            action: <button type="button">Change stage</button>,
          },
          { term: 'Submitted', value: '28 March 2027' },
        ]}
      />,
    );

    const stage = rowOf('Stage');
    expect(within(stage).getByRole('button', { name: 'Change stage' })).toBeTruthy();
    expect(within(stage).getAllByRole('definition')).toHaveLength(2);
    expect(within(rowOf('Submitted')).getAllByRole('definition')).toHaveLength(1);
  });

  it('takes a value that is more than text', () => {
    render(
      <SummaryList
        items={[
          { term: 'Contact', value: <a href="mailto:amara@example.org">amara@example.org</a> },
        ]}
      />,
    );

    expect(screen.getByRole('link', { name: 'amara@example.org' })).toBeTruthy();
  });

  it('sets aside a column for actions only when a row has one', () => {
    const { rerender } = render(<SummaryList items={items} />);
    expect(document.querySelector('dl')?.className).toContain(
      'sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]',
    );

    rerender(
      <SummaryList items={[{ ...organisation, action: <a href="/change">Change</a> }, amount]} />,
    );
    expect(document.querySelector('dl')?.className).toContain(
      'sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]',
    );
  });

  it('stacks the rows below sm and divides them with hairlines', () => {
    render(<SummaryList items={items} />);

    const list = document.querySelector('dl');
    expect(list?.className).toContain('divide-y');
    expect(list?.className).toContain('divide-divider');
    expect(list?.className).not.toMatch(/(^| )grid-cols-/);
  });
});
