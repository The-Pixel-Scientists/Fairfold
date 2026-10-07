// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How a question reads to an applicant: what marks it optional, the budget as
// fields that wrap, and the amount the form works out instead of asking for.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { applications } from '../story.ts';

import { formSections, sampleTotals, workedOutAmount } from './formData.ts';
import { QuestionControl } from './QuestionPreview.tsx';

const questions = formSections.flatMap((section) => section.questions);
const find = (id: string) => {
  const found = questions.find((question) => question.id === id);
  if (!found) throw new Error(`No question ${id}`);
  return found;
};
const textbox = (name: string) => screen.getByRole<HTMLInputElement>('textbox', { name });
const textarea = (name: string) => screen.getByRole<HTMLTextAreaElement>('textbox', { name });

describe('the amount applicants are asking for', () => {
  const requested = find('requested');
  const workedOut = requested.workedOut ?? { total: '', less: '' };

  it('is the total cost less other funding, the same as the application', () => {
    expect(sampleTotals).toEqual({ budget: 13_500, 'other-funding': 1_000 });
    expect(workedOutAmount(workedOut, sampleTotals)).toBe(
      applications.find((application) => application.reference === 'NF-CG-0412')?.requested,
    );
  });

  it('is shown as text, not as a box to fill in', () => {
    render(<QuestionControl question={requested} />);

    expect(screen.getByRole('group', { name: 'Amount you are asking for' })).toBeTruthy();
    expect(screen.getByText('£12,500')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('follows the budget as it changes, and never goes below nothing', () => {
    const { rerender } = render(
      <QuestionControl question={requested} totals={{ budget: 14_000, 'other-funding': 1_000 }} />,
    );
    expect(screen.getByText('£13,000')).toBeTruthy();

    rerender(
      <QuestionControl question={requested} totals={{ budget: 500, 'other-funding': 1_000 }} />,
    );
    expect(screen.getByText('£0')).toBeTruthy();
  });
});

describe('the live budget', () => {
  it('wraps the item and the detail, and passes on the new total', () => {
    const onTotal = vi.fn();
    render(<QuestionControl question={find('budget')} onAnswer={vi.fn()} onTotal={onTotal} />);

    expect(textarea('Item, row 1').tagName).toBe('TEXTAREA');
    expect(textarea('Item, row 1').rows).toBe(1);
    expect(textarea('Detail, row 3').tagName).toBe('TEXTAREA');
    expect(textarea('Detail, row 3').rows).toBe(2);
    expect(textarea('Detail, row 3').value).toBe(
      'There and back for 12 people: 48 Tuesdays at £50, plus £220 fuel',
    );
    expect(textbox('Cost, row 1').tagName).toBe('INPUT');

    fireEvent.change(textbox('Cost, row 1'), { target: { value: '£3,380' } });

    expect(onTotal).toHaveBeenLastCalledWith('budget', 14_000);
  });

  it('keeps each cell to one value: Enter does not break the line', () => {
    render(<QuestionControl question={find('budget')} onAnswer={vi.fn()} />);

    expect(fireEvent.keyDown(textbox('Item, row 1'), { key: 'Enter' })).toBe(false);
    expect(fireEvent.keyDown(textbox('Item, row 1'), { key: 'a' })).toBe(true);
  });

  it('wraps the name of a funder, which is the only text in that table', () => {
    render(<QuestionControl question={find('other-funding')} onAnswer={vi.fn()} />);

    expect(textbox('Where the money comes from, row 1').tagName).toBe('TEXTAREA');
    expect(textbox('Amount, row 1').tagName).toBe('INPUT');
  });
});

describe('questions that can be left blank', () => {
  it('say so in the legend of a choice, with the marker kept out of the way', () => {
    render(
      <>
        <QuestionControl question={find('led-by')} />
        <QuestionControl question={find('beneficiaries')} />
        <QuestionControl question={find('areas')} />
      </>,
    );

    expect(
      screen.getByRole('group', { name: 'Who leads your organisation? (optional)' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('group', { name: 'Who will benefit most from your project? (optional)' }),
    ).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Which areas will it serve?' })).toBeTruthy();
    expect([...document.querySelectorAll('legend span')].map((span) => span.textContent)).toEqual([
      '(optional)',
      '(optional)',
    ]);
  });

  it('say so on an upload, and leave it off a required one', () => {
    render(
      <>
        <QuestionControl question={find('funding-evidence')} />
        <QuestionControl question={find('accounts')} />
      </>,
    );

    expect(
      screen.getByRole('group', { name: 'Evidence of other funding (optional)' }),
    ).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Your latest accounts' })).toBeTruthy();
  });
});
