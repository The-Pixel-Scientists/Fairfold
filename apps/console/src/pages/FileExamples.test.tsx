// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The file question with the real form engine and file checks behind it, as
// the portal will use it.

import { fileRefusalMessages } from '@pixel-scientists/domain/files';
import { formMessages } from '@pixel-scientists/domain/forms';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  CheckingFileExample,
  EmptyFileExample,
  FileAnswerExample,
  LimitFileExample,
  OneFileExample,
  ReadOnlyFileExample,
  RefusedFileExample,
  UploadingFileExample,
} from './FileExamples.tsx';

const input = () => screen.getByLabelText<HTMLInputElement>('Choose files');
const user = () => userEvent.setup({ applyAccept: false });
const pdf = (name = 'Accounts.pdf') => new File(['%PDF-1.7 accounts'], name);

describe('the file question examples', () => {
  it('accepts what the engine says the question takes, shown in the hint', () => {
    render(<EmptyFileExample />);

    expect(screen.getByRole('group', { name: 'Latest accounts (required)' })).toBeTruthy();
    expect(screen.getByText('Signed by the trustees.')).toBeTruthy();
    expect(
      screen.getByText('PDF or Word document, up to 10 MB. You can attach up to 3 files.'),
    ).toBeTruthy();
  });

  it('refuses a file by what is in it, in the engine words, before anything is sent', async () => {
    render(<UploadingFileExample />);

    await user().upload(input(), new File(['MZ program'], 'Accounts.pdf'));

    const summary = await screen.findByRole('alert', { name: 'There is a problem' });
    expect(within(summary).getByRole('link').textContent).toBe(
      `Accounts.pdf: ${formMessages.fileType(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])}`,
    );
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows the progress bar while a file is on its way up', async () => {
    render(<UploadingFileExample />);

    await user().upload(input(), pdf());

    expect(
      await screen.findByRole('progressbar', { name: 'Uploading Accounts.pdf, 45%' }),
    ).toBeTruthy();
  });

  it('says a file is being checked for viruses once every byte is sent', async () => {
    render(<CheckingFileExample />);

    await user().upload(input(), pdf());

    const list = await screen.findByRole('list', { name: 'Files for Latest accounts' });
    expect(within(list).getByText('Checking Accounts.pdf for viruses')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows the words of the server beside the question and in the summary', async () => {
    render(<RefusedFileExample />);

    await user().upload(input(), pdf());

    const summary = await screen.findByRole('alert', { name: 'There is a problem' });
    expect(within(summary).getByRole('link').textContent).toBe(
      `Accounts.pdf: ${fileRefusalMessages.infected}`,
    );
    expect(document.activeElement).toBe(summary);
    expect(input()).toBeTruthy();
  });

  it('lists a file with its type and size, and takes the input away at the limit', () => {
    const { unmount } = render(<OneFileExample />);
    expect(
      screen.getByRole('link', { name: 'Download Accounts 2025 to 2026.pdf, PDF, 2.1 MB' }),
    ).toBeTruthy();
    unmount();

    render(<LimitFileExample />);
    expect(screen.queryByLabelText('Choose files')).toBeNull();
    expect(screen.getByText(/You have reached the limit of 2 files/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(2);
  });

  it('shows files to read with no way to change them, and a question with none', () => {
    render(<ReadOnlyFileExample />);

    expect(screen.getByRole('link', { name: /Accounts 2025 to 2026\.pdf/ })).toBeTruthy();
    expect(screen.getByText('No files attached.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByLabelText(/Choose file/)).toBeNull();
  });

  it('reads a file answer as links, and an empty one as not answered', () => {
    render(<FileAnswerExample />);

    expect(
      screen
        .getByRole('link', { name: 'Download Accounts 2025 to 2026.pdf, PDF, 2.1 MB' })
        .getAttribute('href'),
    ).toBe('#download-accounts');
    expect(screen.getByText('Not answered')).toBeTruthy();
  });
});
