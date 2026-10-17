// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { setUpConsoleTests } from '../testing/render.tsx';
import { actionButton, editor, openDraft, questionButton, sectionButton } from './builder.ts';
import { budgetDraft } from './fixtures.ts';

setUpConsoleTests();

const CHARITY = 'Is your organisation a registered charity?';
const NUMBER = 'Registered charity number';

const preview = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('tab', { name: 'Preview' }));

const answer = (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(screen.getByRole('radio', { name }));

describe('the preview of a draft', () => {
  it('shows the form as an applicant sees it, a section at a time, in the same words', async () => {
    const user = userEvent.setup();
    await openDraft();

    await preview(user);

    const panel = screen.getByRole('tabpanel', { name: 'Preview' });
    expect(within(panel).getByText(/Nothing you enter here is saved/)).toBeTruthy();
    expect(within(panel).getByText('Section 1 of 2')).toBeTruthy();
    expect(
      within(panel).getByRole('heading', { level: 2, name: 'About your organisation' }),
    ).toBeTruthy();
    expect(within(panel).getByText('Tell us who you are.')).toBeTruthy();
    expect(within(panel).getByRole('textbox', { name: /Organisation name/ })).toBeTruthy();
    expect(
      within(panel).getByRole('group', { name: new RegExp(CHARITY.replace('?', '\\?')) }),
    ).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: 'Previous section' })).toBeNull();
  });

  it('shows a question that depends on an answer only once it is given, and hides it again', async () => {
    const user = userEvent.setup();
    await openDraft();
    await preview(user);
    const panel = within(screen.getByRole('tabpanel', { name: 'Preview' }));
    expect(panel.queryByRole('textbox', { name: /Registered charity number/ })).toBeNull();

    await answer(user, 'Yes');
    expect(panel.getByRole('textbox', { name: /Registered charity number/ })).toBeTruthy();
    await user.type(panel.getByRole('textbox', { name: /Registered charity number/ }), '123456');
    await answer(user, 'No');

    expect(panel.queryByRole('textbox', { name: /Registered charity number/ })).toBeNull();
  });

  it('stops an applicant whose answer cannot go on, saying why, and keeps them from the next section', async () => {
    const user = userEvent.setup();
    await openDraft();
    await preview(user);
    const panel = within(screen.getByRole('tabpanel', { name: 'Preview' }));
    await answer(user, 'Yes');
    expect(panel.getByRole('button', { name: 'Next section' })).toBeTruthy();

    await answer(user, 'No');

    const stop = panel.getByRole('alert');
    expect(stop.textContent).toContain('You cannot apply with this answer');
    expect(stop.textContent).toContain('We only fund registered charities.');
    expect(panel.queryByRole('button', { name: 'Next section' })).toBeNull();
    await user.click(within(stop).getByRole('button', { name: 'Change your answer' }));
    await waitFor(() => {
      expect(document.activeElement?.id).toBe('f_charity');
    });
    await answer(user, 'Yes');
    expect(panel.queryByRole('alert')).toBeNull();
  });

  it('moves between sections, which keep their answers, with focus on the heading', async () => {
    const user = userEvent.setup();
    await openDraft();
    await preview(user);
    const panel = within(screen.getByRole('tabpanel', { name: 'Preview' }));
    await user.type(panel.getByRole('textbox', { name: /Organisation name/ }), 'Northfield Trust');
    await answer(user, 'Yes');

    await user.click(panel.getByRole('button', { name: 'Next section' }));

    expect(panel.getByText('Section 2 of 2')).toBeTruthy();
    const heading = panel.getByRole('heading', { level: 2, name: 'Your project' });
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
    expect(panel.queryByRole('button', { name: 'Next section' })).toBeNull();
    expect(panel.getByRole('textbox', { name: /What will you do with the money/ })).toBeTruthy();
    await user.click(panel.getByRole('button', { name: 'Previous section' }));
    expect(panel.getByRole('textbox', { name: /Organisation name/ })).toHaveProperty(
      'value',
      'Northfield Trust',
    );
  });

  it('shows the changes that are not saved, with the limits as applicants meet them', async () => {
    const user = userEvent.setup();
    await openDraft();
    await user.click(questionButton(NUMBER));
    await user.click(actionButton('Remove', NUMBER));
    await user.click(sectionButton('Your project'));
    await user.click(questionButton('What will you do with the money?'));
    await user.clear(within(editor()).getByRole('textbox', { name: /^Word limit/ }));
    await user.type(within(editor()).getByRole('textbox', { name: /^Word limit/ }), '2');

    await preview(user);
    const panel = within(screen.getByRole('tabpanel', { name: 'Preview' }));
    await answer(user, 'Yes');
    await user.click(panel.getByRole('button', { name: 'Next section' }));
    await user.type(panel.getByRole('textbox', { name: /What will you do/ }), 'one two three');

    expect(panel.queryByRole('textbox', { name: /Registered charity number/ })).toBeNull();
    expect(panel.getAllByText('You have 1 word too many').length).toBeGreaterThan(0);
  });

  it('says what to fix when the draft has problems, instead of showing a form that is not whole', async () => {
    const user = userEvent.setup();
    await openDraft();
    await user.click(screen.getByRole('button', { name: 'Add section' }));

    await preview(user);

    const panel = within(screen.getByRole('tabpanel', { name: 'Preview' }));
    expect(
      panel.getByRole('heading', { level: 2, name: 'Fix the problems to preview the form' }),
    ).toBeTruthy();
    expect(panel.getByText('Section 3: Enter at least 1 character.')).toBeTruthy();
    expect(panel.getByText('Section 3, question 1: Enter at least 1 character.')).toBeTruthy();
    expect(panel.queryByText('Section 1 of 3')).toBeNull();
  });
});

describe('the preview of a table and a file question', () => {
  const PDF = 'application/pdf';

  async function openBudgetPreview(user: ReturnType<typeof userEvent.setup>) {
    await openDraft({}, budgetDraft);
    await preview(user);
    return within(screen.getByRole('tabpanel', { name: 'Preview' }));
  }

  it('shows the table as applicants fill it in, with the fewest rows to start, its own name for a row and a total', async () => {
    const user = userEvent.setup();
    const panel = await openBudgetPreview(user);

    expect(panel.getByRole('button', { name: 'Add another cost' })).toBeTruthy();
    expect(panel.getByText('Cost 1')).toBeTruthy();
    await user.type(panel.getByRole('textbox', { name: /^Cost/ }), '1200');

    expect(panel.getByText('£1,200')).toBeTruthy();
  });

  it('shows the file question with its limits, and says that uploading is switched off', async () => {
    const user = userEvent.setup();
    const panel = await openBudgetPreview(user);

    expect(panel.getByText(/Uploading is switched off in the preview/)).toBeTruthy();
    expect(panel.getByText('Sign-off by your trustees is not needed.')).toBeTruthy();
    expect(
      panel.getByText('PDF or OpenDocument spreadsheet, up to 5 MB. You can attach up to 2 files.'),
    ).toBeTruthy();
  });

  it('checks a file that is chosen against the limits, and sends none, whatever its type', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const panel = await openBudgetPreview(user);
    const input = document.getElementById('f_accounts');
    if (!(input instanceof HTMLInputElement)) throw new Error('Expected the file input.');

    await user.upload(input, new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    expect(
      (await panel.findAllByText('notes.txt: The file must be a PDF or OpenDocument spreadsheet.'))
        .length,
    ).toBeGreaterThan(0);

    await user.upload(input, new File(['%PDF-1.7 accounts'], 'accounts.pdf', { type: PDF }));
    expect(
      (await panel.findAllByText('accounts.pdf: Uploading is switched off in the preview.')).length,
    ).toBeGreaterThan(0);
    expect(panel.queryByRole('list', { name: 'Files for Latest accounts' })).toBeNull();
  });
});
