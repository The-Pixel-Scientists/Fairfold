// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The form components with the real form engine behind them, as the portal
// and the scoring workspace will use them.

import { formMessages } from '@pixel-scientists/domain/forms';
import { messages } from '@pixel-scientists/domain/platform';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  AnswerExample,
  ConditionalExample,
  EligibilityExample,
  EmptyQuestionsExample,
  ProblemQuestionsExample,
  SaveStatusExample,
} from './FormExamples.tsx';

const checkAnswers = () => screen.getByText('Check answers');
const problemSummary = () => screen.getByLabelText('There is a problem');

/** Enters an answer in one step: these forms are large, and typing key by key is slow to simulate. */
function enter(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('every question type, with nothing answered', () => {
  it('shows a control of each type, with required questions said in words', () => {
    render(<EmptyQuestionsExample />);

    expect([...document.querySelectorAll('legend')].map((legend) => legend.textContent)).toEqual([
      'When will the project start? (required)',
      'What will the money pay for? (required)',
      'Is your organisation a registered charity? (required)',
      'Who will take part? (required)',
      'Organisation address (required)',
    ]);
    expect(screen.getByLabelText('Organisation name (required)').tagName).toBe('INPUT');
    expect(screen.getByLabelText(/What will you do with the money/).tagName).toBe('TEXTAREA');
    expect(screen.getByLabelText('Contact phone number (optional)').tagName).toBe('INPUT');
    expect(screen.getByLabelText('Website (optional)').tagName).toBe('INPUT');
    expect(screen.getByLabelText(/Which region/).tagName).toBe('SELECT');
    expect(screen.getByText('Answer every question marked required.')).toBeTruthy();
  });

  it('counts the words left as the person types, with the same count as the engine', () => {
    render(<EmptyQuestionsExample />);

    // "�" is not a word; "well-known," and "�25,000" are one each.
    enter(
      /What will you do with the money/,
      'Weekly lunch club � well-known, �25,000 for 3 sessions',
    );

    expect(screen.getAllByText('You have 12 words left').length).toBeGreaterThan(0);
  });

  it('lists every required question the engine finds unanswered, each linking to its control', () => {
    render(<EmptyQuestionsExample />);

    fireEvent.click(checkAnswers());

    const summary = problemSummary();
    expect(document.activeElement).toBe(summary);
    const links = within(summary).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '#f_ename',
      '#f_estory',
      '#f_epeople',
      '#f_eamount',
      '#f_estart',
      '#f_eemail',
      '#f_espend',
      '#f_echarity',
      '#f_ewho',
      '#f_eaddress',
    ]);
    expect(within(summary).getAllByText(formMessages.enterAnswer)).toHaveLength(7);

    fireEvent.click(links[1] as HTMLElement);
    expect(document.activeElement).toBe(screen.getByLabelText(/What will you do with the money/));
  });

  it('takes the problem away when the person answers that question', () => {
    render(<EmptyQuestionsExample />);
    fireEvent.click(checkAnswers());

    enter('Organisation name (required)', 'Trust');

    const links = within(problemSummary()).getAllByRole('link');
    expect(links).toHaveLength(9);
    expect(links.map((link) => link.getAttribute('href'))).not.toContain('#f_ename');
  });

  it('accepts a full set of answers, as the server would', () => {
    render(<EmptyQuestionsExample />);

    enter(/Organisation name/, 'Trust');
    enter(/What will you do/, 'Run a lunch club');
    enter(/How many people/, '40');
    enter(/How much are you asking/, '12,500');
    enter('Day', '1');
    enter('Month', '4');
    enter('Year', '2027');
    enter(/Contact email/, 'ada@example.org');
    fireEvent.click(screen.getByLabelText('Equipment'));
    fireEvent.click(screen.getByLabelText('Yes'));
    fireEvent.click(screen.getByLabelText('Families'));
    enter('Address line 1', '1 High Street');
    enter('Town or city', 'Northfield');
    enter('Postcode', 'NF1 1AA');
    fireEvent.click(checkAnswers());

    expect(screen.queryByRole('alert')).toBeNull();
    expect(
      screen.getByText('Your answers are valid. Nothing was saved, because this is an example.'),
    ).toBeTruthy();
  });
});

describe('every question type, with answers that break a rule', () => {
  it('says the answer is over its limit before it is checked, in the engine count', () => {
    render(<ProblemQuestionsExample />);

    expect(screen.getAllByText('You have 12 words too many').length).toBeGreaterThan(0);
  });

  it('shows the engine message beside each field and in the summary, the same words', () => {
    render(<ProblemQuestionsExample />);

    fireEvent.click(checkAnswers());

    const summary = problemSummary();
    const texts = within(summary)
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(texts).toEqual([
      formMessages.tooManyWords(20, 32),
      formMessages.numberBetween(1, 10_000),
      formMessages.amountBetween(
        { amountMinor: 100_000, currency: 'GBP' },
        { amountMinor: 5_000_000, currency: 'GBP' },
      ),
      formMessages.realDate,
      messages.email,
      formMessages.phone,
      formMessages.webAddress,
      formMessages.chooseAnswer,
      formMessages.chooseAtMost(2),
      formMessages.addressTown,
      formMessages.postcode,
    ]);
    for (const message of texts) {
      expect(screen.getAllByText(message).length).toBeGreaterThanOrEqual(2);
    }
    expect(
      screen.getByRole('textbox', { name: /How many people/ }).getAttribute('aria-invalid'),
    ).toBe('true');
    expect(screen.getByRole('textbox', { name: 'Town or city' }).getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(
      screen.getByRole('textbox', { name: 'Address line 1' }).getAttribute('aria-invalid'),
    ).toBeNull();
  });

  it('shows a date that is not real in its three boxes, as typed', () => {
    render(<ProblemQuestionsExample />);

    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Day' }).value).toBe('31');
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Month' }).value).toBe('2');
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Year' }).value).toBe('2027');
  });
});

describe('questions that come and go', () => {
  it('shows a question when an earlier answer calls for it, and takes it away with its answer', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ConditionalExample />);
    expect(screen.queryByRole('textbox', { name: /Website address/ })).toBeNull();

    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    await user.type(screen.getByRole('textbox', { name: /Website address/ }), 'x');
    expect(screen.getByRole('textbox', { name: /Website address/ })).toBeTruthy();

    await user.click(screen.getByRole('radio', { name: 'No' }));
    expect(screen.queryByRole('textbox', { name: /Website address/ })).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: /Website address/ }).value).toBe(
      '',
    );
  });

  it('shows a whole section, and a question inside another, when a choice is ticked', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ConditionalExample />);
    expect(screen.queryByRole('heading', { name: 'Planning permission' })).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: 'Building work' }));
    expect(screen.getByRole('heading', { name: 'Planning permission' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /Describe the building work/ })).toBeTruthy();
    expect(screen.getByRole('group', { name: /planning permission/ })).toBeTruthy();

    await user.click(screen.getByRole('checkbox', { name: 'Equipment' }));
    expect(screen.getByRole('heading', { name: 'Planning permission' })).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: 'Building work' }));
    expect(screen.queryByRole('heading', { name: 'Planning permission' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: /Describe the building work/ })).toBeNull();
  });

  it('does not ask for an answer to a question that is not shown', () => {
    render(<ConditionalExample />);

    fireEvent.click(checkAnswers());

    const links = within(screen.getByRole('alert')).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['#f_cweb', '#f_cspend']);
  });
});

describe('answers that stop an applicant', () => {
  it('shows what the answer means and what to do, and takes away the way to go on', async () => {
    const user = userEvent.setup({ delay: null });
    render(<EligibilityExample />);
    const charity = screen.getByRole('group', { name: /registered charity/ });

    await user.click(within(charity).getByRole('radio', { name: 'No' }));

    const notice = screen.getByRole('alert', { name: 'You cannot apply with this answer' });
    expect(notice.textContent).toContain('This fund is open to registered charities only.');
    expect(screen.queryByRole('button', { name: 'Check answers' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Change your answer' }));
    expect(document.activeElement).toBe(
      within(charity)
        .getByRole('radio', { name: 'Yes' })
        .closest('fieldset')
        ?.querySelector('input'),
    );

    await user.click(within(charity).getByRole('radio', { name: 'Yes' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(checkAnswers()).toBeTruthy();
  });

  it('stops on a choice, with that choice explanation', async () => {
    const user = userEvent.setup({ delay: null });
    render(<EligibilityExample />);

    await user.click(screen.getByRole('radio', { name: 'Paying off loans' }));

    expect(screen.getByRole('alert').textContent).toContain(
      'We cannot pay off loans or other debts.',
    );
  });
});

describe('answers to read', () => {
  it('shows staff the identity fields and "Not answered", and never the aggregate-only answer', () => {
    render(<AnswerExample />);

    const staff = screen.getByRole('heading', { name: 'Staff' }).parentElement as HTMLElement;
    expect(within(staff).getByText('Organisation name')).toBeTruthy();
    expect(within(staff).getByText('Northfield Community Trust')).toBeTruthy();
    expect(within(staff).getByText('Website').nextElementSibling?.textContent).toBe('Not answered');
    expect(within(staff).getByText('£15,000')).toBeTruthy();
    expect(within(staff).getByText('1 April 2027')).toBeTruthy();
    expect(within(staff).queryByText('Equality monitoring')).toBeNull();
    expect(within(staff).queryByText('Group two')).toBeNull();
  });

  it('gives a blind reviewer no identity field, label or answer, in the document at all', () => {
    render(<AnswerExample />);

    const blind = screen.getByRole('heading', { name: 'Blind reviewer' })
      .parentElement as HTMLElement;
    for (const hidden of [
      'Organisation name',
      'Northfield Community Trust',
      'Contact email address',
      'hello@northfield.example',
      'Organisation address',
      '1 High Street',
    ]) {
      expect(within(blind).queryByText(hidden)).toBeNull();
    }
    expect(blind.textContent).not.toContain('Northfield');
    expect(within(blind).getByText('What will you do with the money?')).toBeTruthy();
    expect(within(blind).getByRole('heading', { name: 'About your organisation' })).toBeTruthy();
  });
});

describe('save status', () => {
  it('shows the three messages', () => {
    render(<SaveStatusExample />);

    expect(screen.getAllByRole('status').map((status) => status.textContent)).toEqual([
      'Saving…',
      'Saved at 2:14pm',
      'Not saved. Check your connection and try again',
    ]);
  });
});
