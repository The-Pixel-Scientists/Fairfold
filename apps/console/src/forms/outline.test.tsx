// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { setUpConsoleTests } from '../testing/render.tsx';
import {
  actionButton,
  editor,
  expectQuestions,
  openDraft,
  questionButton,
  questionList,
  sectionButton,
  sectionList,
} from './builder.ts';

setUpConsoleTests();

const ORG = 'Organisation name';
const CHARITY = 'Is your organisation a registered charity?';
const NUMBER = 'Registered charity number';
const STORY = 'What will you do with the money?';
const SPEND = 'What will the money pay for?';

const button = actionButton;

const sectionOrder = () =>
  within(sectionList())
    .getAllByRole('button')
    .map((item) => item.textContent);

describe('the outline of a draft', () => {
  it('lists the sections and the questions of the first, with the first question selected', async () => {
    await openDraft();

    expect(sectionButton('About your organisation').getAttribute('aria-current')).toBe('true');
    expect(sectionButton('Your project').getAttribute('aria-current')).toBeNull();
    expectQuestions(ORG, CHARITY, NUMBER);
    expect(questionButton(ORG).getAttribute('aria-current')).toBe('true');
    expect(within(editor()).getByRole('textbox', { name: 'Question' })).toHaveProperty(
      'value',
      ORG,
    );
    expect(editor().textContent).toContain('Question 1 of 3 in About your organisation');
    expect(questionButton(ORG).textContent).toContain(
      'Required · Hidden from reviewers · Hidden from blind reviewers',
    );
    expect(questionButton(CHARITY).textContent).toContain('Stops some applicants');
    expect(questionButton(NUMBER).textContent).toContain('Shown only for some answers');
    expect(screen.getByText('Tell us who you are.')).toBeTruthy();
  });

  it('shows the questions of another section, and its own settings, when it is selected', async () => {
    const user = userEvent.setup();
    await openDraft();

    await user.click(sectionButton('Your project'));

    expect(sectionButton('Your project').getAttribute('aria-current')).toBe('true');
    expectQuestions(STORY, SPEND);
    expect(within(editor('Edit section')).getByRole('textbox', { name: 'Title' })).toHaveProperty(
      'value',
      'Your project',
    );
    expect(within(editor('Edit section')).getByText('Section 2 of 2')).toBeTruthy();
  });

  it('selects a question to edit it', async () => {
    const user = userEvent.setup();
    await openDraft();

    await user.click(questionButton(CHARITY));

    expect(questionButton(CHARITY).getAttribute('aria-current')).toBe('true');
    expect(questionButton(ORG).getAttribute('aria-current')).toBeNull();
    expect(within(editor()).getByRole('textbox', { name: 'Question' })).toHaveProperty(
      'value',
      CHARITY,
    );
  });
});

describe('the questions of a section', () => {
  it('are moved with buttons, which keep focus, and each move is said', async () => {
    const user = userEvent.setup();
    await openDraft();

    await user.click(button('Move down', ORG));

    expectQuestions(CHARITY, ORG, NUMBER);
    expect(screen.getByText('Question moved to position 2 of 3')).toBeTruthy();
    expect(document.activeElement).toBe(button('Move down', ORG));
    expect(button('Move up', ORG).getAttribute('aria-disabled')).toBeNull();
    await user.click(button('Move down', ORG));
    expect(button('Move down', ORG).getAttribute('aria-disabled')).toBe('true');
    await user.click(button('Move down', ORG));
    expectQuestions(CHARITY, NUMBER, ORG);
  });

  it('are moved from the keyboard alone', async () => {
    const user = userEvent.setup();
    await openDraft();

    button('Move down', ORG).focus();
    await user.keyboard('{Enter}');

    expectQuestions(CHARITY, ORG, NUMBER);
    expect(document.activeElement).toBe(button('Move down', ORG));
  });

  it('start with an added question, which is selected with the cursor in its box', async () => {
    const user = userEvent.setup();
    await openDraft();

    await user.click(screen.getByRole('button', { name: 'Add question' }));

    expectQuestions(ORG, CHARITY, NUMBER, 'Untitled question');
    expect(questionButton('Untitled question').getAttribute('aria-current')).toBe('true');
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(editor()).getByRole('textbox', { name: 'Question' }),
      );
    });
    expect(screen.getByText('Question added')).toBeTruthy();
    expect(editor().textContent).toContain('Question 4 of 4');
  });

  it('are removed, which selects the next one, and a section keeps at least one', async () => {
    const user = userEvent.setup();
    await openDraft();

    await user.click(button('Remove', ORG));

    expectQuestions(CHARITY, NUMBER);
    expect(screen.getByText('Question removed')).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(questionButton(CHARITY));
    });
    expect(questionButton(CHARITY).getAttribute('aria-current')).toBe('true');

    await user.click(button('Remove', CHARITY));
    const last = button('Remove', NUMBER);
    expect(last.getAttribute('aria-disabled')).toBe('true');
    expect(last.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText(/A section keeps at least one question/)).toBeTruthy();
    await user.click(last);
    expectQuestions(NUMBER);
  });
});

describe('the sections of a draft', () => {
  it('start with an added section, which is selected with the cursor in its title', async () => {
    const user = userEvent.setup();
    await openDraft();

    await user.click(screen.getByRole('button', { name: 'Add section' }));

    expect(sectionOrder()).toEqual([
      '1. About your organisation3 questions',
      '2. Your project2 questions',
      '3. Untitled section1 questions',
    ]);
    expect(sectionButton('Untitled section').getAttribute('aria-current')).toBe('true');
    expectQuestions('Untitled question');
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(editor('Edit section')).getByRole('textbox', { name: 'Title' }),
      );
    });
    expect(screen.getByText('Section added')).toBeTruthy();
  });

  it('are given a title and an introduction, which the outline shows', async () => {
    const user = userEvent.setup();
    await openDraft();
    await user.click(sectionButton('Your project'));

    const panel = within(editor('Edit section'));
    await user.clear(panel.getByRole('textbox', { name: 'Title' }));
    await user.type(panel.getByRole('textbox', { name: 'Title' }), 'The work');
    await user.type(panel.getByRole('textbox', { name: /Introduction/ }), 'What you will do.');

    expect(sectionButton('The work').getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('heading', { level: 2, name: 'The work' })).toBeTruthy();
    expect(questionList().parentElement?.textContent).toContain('What you will do.');
  });

  it('are moved, and each move is said', async () => {
    const user = userEvent.setup();
    await openDraft();
    await user.click(sectionButton('Your project'));

    await user.click(button('Move up', 'Your project'));

    expect(sectionOrder()).toEqual([
      '1. Your project2 questions',
      '2. About your organisation3 questions',
    ]);
    expect(screen.getByText('Your project moved to position 1 of 2')).toBeTruthy();
    expect(button('Move up', 'Your project').getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(button('Move up', 'Your project'));
  });

  it('are removed only after asking, with the questions they hold named', async () => {
    const user = userEvent.setup();
    await openDraft();
    await user.click(sectionButton('Your project'));

    await user.click(button('Remove', 'Your project'));

    const dialog = screen.getByRole('dialog', { name: 'Remove this section?' });
    expect(dialog.textContent).toContain('This removes Your project and its 2 questions');
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Keep section' }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Keep section' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sectionOrder()).toHaveLength(2);

    await user.click(button('Remove', 'Your project'));
    await user.click(screen.getByRole('button', { name: 'Remove section' }));

    expect(sectionOrder()).toEqual(['1. About your organisation3 questions']);
    expect(screen.getByText('Your project removed')).toBeTruthy();
    expect(sectionButton('About your organisation').getAttribute('aria-current')).toBe('true');
  });

  it('keep at least one', async () => {
    const user = userEvent.setup();
    await openDraft();
    await user.click(sectionButton('Your project'));
    await user.click(button('Remove', 'Your project'));
    await user.click(screen.getByRole('button', { name: 'Remove section' }));
    await user.click(sectionButton('About your organisation'));

    const last = button('Remove', 'About your organisation');

    expect(last.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(/A form keeps at least one section/)).toBeTruthy();
    await user.click(last);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
