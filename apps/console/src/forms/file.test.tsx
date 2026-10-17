// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { setUpConsoleTests } from '../testing/render.tsx';
import {
  editor,
  openDraft,
  questionButton,
  saves,
  savedDefinition,
  sectionButton,
} from './builder.ts';
import { budgetDraft } from './fixtures.ts';

setUpConsoleTests();

type User = ReturnType<typeof userEvent.setup>;

const ACCOUNTS = 'Latest accounts';
const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MB = 1024 * 1024;

const panel = () => within(editor());

/** Opens the file question of the budget draft, which is the second of its section. */
async function openAccounts(user: User, draft = budgetDraft) {
  const sent = await openDraft(saves, draft);
  await user.click(questionButton(ACCOUNTS));
  return sent;
}

async function savedAccounts(user: User, sent: Awaited<ReturnType<typeof openDraft>>) {
  await user.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText(/^Saved /);
  return savedDefinition(sent).sections[0]?.fields[1];
}

describe('adding a file question', () => {
  it('is chosen from the types, and starts by taking every type the platform allows, at its largest, one file', async () => {
    const user = userEvent.setup();
    await openDraft(saves);
    await user.click(screen.getByRole('button', { name: 'Add question' }));

    await user.selectOptions(panel().getByRole('combobox', { name: 'Type' }), 'File upload');

    expect(panel().getByText(/^Applicants attach files/)).toBeTruthy();
    const types = within(panel().getByRole('group', { name: 'File types' }));
    expect(types.getAllByRole('checkbox').map((box) => box.parentElement?.textContent)).toEqual([
      'PDF',
      'Word document',
      'Excel spreadsheet',
      'OpenDocument text',
      'OpenDocument spreadsheet',
      'JPEG image',
      'PNG image',
    ]);
    expect(types.getAllByRole<HTMLInputElement>('checkbox').every((box) => box.checked)).toBe(true);
    expect(panel().getByRole('combobox', { name: 'Largest file' })).toHaveProperty(
      'value',
      String(10 * MB),
    );
    expect(panel().getByRole('textbox', { name: 'Most files' })).toHaveProperty('value', '1');
    expect(questionButton('Untitled question').textContent).toContain('File upload');
  });

  it('is not offered "only in totals", which would keep files from staff and reviewers', async () => {
    const user = userEvent.setup();
    await openDraft(saves);
    await user.click(screen.getByRole('button', { name: 'Add question' }));
    await user.selectOptions(
      panel().getByRole('combobox', { name: 'Who sees the answer' }),
      'Only in totals',
    );
    expect(panel().getByRole('combobox', { name: 'Who sees the answer' })).toHaveProperty(
      'value',
      'totals',
    );

    await user.selectOptions(panel().getByRole('combobox', { name: 'Type' }), 'File upload');

    const sees = panel().getByRole('combobox', { name: 'Who sees the answer' });
    expect(within(sees).queryByRole('option', { name: 'Only in totals' })).toBeNull();
    expect(sees).toHaveProperty('value', 'everyone');
  });
});

describe('the settings of a file question', () => {
  it('are the types as labelled checkboxes, the largest file in megabytes and the most files, as saved', async () => {
    const user = userEvent.setup();
    await openAccounts(user);

    const types = within(panel().getByRole('group', { name: 'File types' }));
    expect(types.getByRole<HTMLInputElement>('checkbox', { name: 'PDF' }).checked).toBe(true);
    expect(
      types.getByRole<HTMLInputElement>('checkbox', { name: 'OpenDocument spreadsheet' }).checked,
    ).toBe(true);
    expect(types.getByRole<HTMLInputElement>('checkbox', { name: 'Word document' }).checked).toBe(
      false,
    );
    const size = panel().getByRole('combobox', { name: 'Largest file' });
    expect(size).toHaveProperty('value', String(5 * MB));
    expect(
      within(size)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(Array.from({ length: 10 }, (_, index) => `${String(index + 1)} MB`));
    expect(panel().getByRole('textbox', { name: 'Most files' })).toHaveProperty('value', '2');
  });

  it('are changed, and sent as the form engine keeps them', async () => {
    const user = userEvent.setup();
    const sent = await openAccounts(user);
    await user.click(panel().getByRole('checkbox', { name: 'Word document' }));
    await user.click(panel().getByRole('checkbox', { name: 'OpenDocument spreadsheet' }));
    await user.selectOptions(panel().getByRole('combobox', { name: 'Largest file' }), '2 MB');
    await user.clear(panel().getByRole('textbox', { name: 'Most files' }));
    await user.type(panel().getByRole('textbox', { name: 'Most files' }), '4');

    expect(await savedAccounts(user, sent)).toMatchObject({
      id: 'f_accounts',
      type: 'file',
      allowedTypes: [PDF, DOCX],
      maxBytes: 2 * MB,
      maxFiles: 4,
    });
  });

  it('keep the most files to what the platform allows', async () => {
    const user = userEvent.setup();
    await openAccounts(user);
    const most = panel().getByRole<HTMLInputElement>('textbox', { name: 'Most files' });

    await user.clear(most);
    await user.type(most, '25');

    expect(most.value).toBe('10');
  });

  it('show a size from a form made elsewhere as it is, so the box never says more than is set', async () => {
    const user = userEvent.setup();
    const odd = structuredClone(budgetDraft);
    const accounts = odd.definition?.sections[0]?.fields[1];
    if (accounts?.type !== 'file') throw new Error('Expected the file question.');
    accounts.maxBytes = Math.round(2.5 * MB);
    await openAccounts(user, odd);

    const size = panel().getByRole('combobox', { name: 'Largest file' });

    expect(size).toHaveProperty('value', String(Math.round(2.5 * MB)));
    expect(within(size).getByRole('option', { name: '2.5 MB' })).toBeTruthy();
    expect(within(size).getAllByRole('option')).toHaveLength(11);
  });
});

describe('the problems of a file question', () => {
  it('show beside the types when none is ticked, and in the summary', async () => {
    const user = userEvent.setup();
    const sent = await openAccounts(user);
    await user.click(panel().getByRole('checkbox', { name: 'PDF' }));
    await user.click(panel().getByRole('checkbox', { name: 'OpenDocument spreadsheet' }));
    await user.clear(panel().getByRole('textbox', { name: 'Most files' }));

    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    const errors = await screen.findByRole('alert', { name: 'There is a problem' });
    expect(
      within(errors)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      'Section 1, question 2: Add at least 1 item.',
      'Section 1, question 2: Enter 1 or more.',
    ]);
    const types = panel().getByRole('group', { name: 'File types' });
    expect(types.getAttribute('aria-describedby')).toContain('field-allowedTypes-error');
    expect(within(types).getByText('Add at least 1 item.')).toBeTruthy();
    expect(panel().getByRole('textbox', { name: 'Most files' }).getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(questionButton(ACCOUNTS).textContent).toContain('Has a problem');
    expect(sectionButton('Your budget').textContent).toContain('Has a problem');
    expect(sent.some(({ key }) => key.startsWith('PUT'))).toBe(false);

    await user.click(within(errors).getByRole('link', { name: /Add at least 1 item/ }));
    expect(document.activeElement).toBe(within(types).getByRole('checkbox', { name: 'PDF' }));
  });
});
