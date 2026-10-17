// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { fileHelpers, helpers, question, SectionHarness } from '../../test/forms.tsx';
import type { AttachedFile, FormFiles } from './types.ts';

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MB = 1024 * 1024;

function accounts(extra: Record<string, unknown> = {}) {
  return question({
    id: 'f_accounts',
    type: 'file',
    label: 'Accounts',
    hint: 'Your latest signed accounts.',
    required: true,
    allowedTypes: [PDF, DOCX],
    maxBytes: 10 * MB,
    maxFiles: 3,
    ...extra,
  });
}

/** A file already attached: 2,202,010 bytes, which is 2.1 MB. */
const stored = (name: string, extra: Partial<AttachedFile> = {}): AttachedFile => ({
  id: name,
  fieldId: 'f_accounts',
  name,
  type: PDF,
  bytes: 2_202_010,
  ...extra,
});

/** A file whose bytes start as a PDF's do, whatever its name says. */
const pdf = (name = 'accounts.pdf') => new File(['%PDF-1.7 accounts'], name, { type: PDF });

/** An upload the test is waiting on: it reports progress, then settles or fails when the test says. */
interface Upload {
  file: File;
  progress: (sent: number, total: number) => void;
  settle: () => Promise<void>;
  fail: (error: Error) => Promise<void>;
}

/** What the domain package's `ProblemError` looks like to the components. */
class Refused extends Error {
  readonly status = 400;
  readonly errors = [];
  readonly detail: string;
  constructor(detail: string) {
    super(detail);
    this.detail = detail;
  }
}

interface HostProps {
  field?: ReturnType<typeof accounts>;
  initial?: readonly AttachedFile[];
  readOnly?: boolean;
  uploads: Upload[];
  onRemove?: (fieldId: string, id: string) => void;
}

/** Keeps the files as the portal will: the file joins the list once the upload has settled. */
function Host({ field = accounts(), initial = [], readOnly, uploads, onRemove }: HostProps) {
  const [attached, setAttached] = useState(initial);
  const files: FormFiles = {
    files: attached,
    ...(readOnly === undefined ? {} : { readOnly }),
    hrefFor: (id) => `/files/${id}`,
    onUpload: (_fieldId, file, progress) =>
      new Promise((resolve, reject) => {
        uploads.push({
          file,
          progress: (sent, total) => {
            act(() => {
              progress(sent, total);
            });
          },
          settle: () =>
            act(async () => {
              setAttached((current) => [...current, stored(file.name)]);
              resolve(undefined);
              await Promise.resolve();
            }),
          fail: (error) =>
            act(async () => {
              reject(error);
              await Promise.resolve();
            }),
        });
      }),
    onRemove: (fieldId, id) => {
      onRemove?.(fieldId, id);
      setAttached((current) => current.filter((file) => file.id !== id));
    },
  };
  return <SectionHarness fields={[field]} files={files} helpers={{ ...helpers, ...fileHelpers }} />;
}

const input = (name = 'Choose files') => screen.getByLabelText<HTMLInputElement>(name);
const announced = () =>
  screen
    .getAllByRole('status')
    .map((region) => region.textContent)
    .join('');
const summary = () => screen.getByRole('alert', { name: 'There is a problem' });
const group = () => screen.getByRole('group', { name: 'Accounts (required)' });
const list = () => screen.getByRole('list', { name: 'Files for Accounts' });

/** The paragraphs of a group's hint or error, which is how it is described. */
function described(element: HTMLElement): string[] {
  return (element.getAttribute('aria-describedby') ?? '').split(' ').flatMap((id) => {
    const text = document.getElementById(id);
    return text === null ? [] : [...text.children].map((child) => child.textContent);
  });
}

/** The first upload the question has sent, once it has checked the file. */
async function firstUpload(uploads: Upload[]): Promise<Upload> {
  await waitFor(() => {
    expect(uploads.length).toBeGreaterThan(0);
  });
  return uploads[0] as Upload;
}

describe('FileQuestion', () => {
  describe('choosing a file', () => {
    it('is a group named by the question, with a native file input and the hint in words', () => {
      render(<Host uploads={[]} />);

      expect(input().type).toBe('file');
      expect(input().multiple).toBe(true);
      expect(input().accept).toBe(`${PDF},${DOCX}`);
      expect(screen.getByText('Choose files').tagName).toBe('LABEL');
      expect(described(group())).toEqual([
        'Your latest signed accounts.',
        'PDF or Word document, up to 10 MB. You can attach up to 3 files.',
      ]);
      expect(screen.queryByRole('list', { name: 'Files for Accounts' })).toBeNull();
    });

    it('says "Choose file" for a question that takes one, and leaves out the count', () => {
      render(
        <Host
          uploads={[]}
          field={accounts({
            hint: undefined,
            allowedTypes: [PDF],
            maxBytes: 5.58 * MB,
            maxFiles: 1,
          })}
        />,
      );

      expect(input('Choose file').multiple).toBe(false);
      // A limit is said rounded down, so the words never promise more than the server takes.
      expect(described(group())).toEqual(['PDF, up to 5.5 MB.']);
    });

    it('takes files dropped on the box, which are checked like any other', async () => {
      const uploads: Upload[] = [];
      render(<Host uploads={uploads} />);

      fireEvent.drop(input().parentElement as HTMLElement, {
        dataTransfer: { files: [pdf('dropped.pdf')] },
      });

      expect((await firstUpload(uploads)).file.name).toBe('dropped.pdf');
    });

    it('can be reached with the keyboard, which goes on to each file', async () => {
      const user = userEvent.setup({ applyAccept: false });
      render(<Host uploads={[]} initial={[stored('accounts.pdf')]} />);

      await user.tab();
      expect(document.activeElement).toBe(input());
      await user.tab();
      expect(document.activeElement).toBe(
        screen.getByRole('link', { name: 'Download accounts.pdf, PDF, 2.1 MB' }),
      );
      await user.tab();
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Remove accounts.pdf' }),
      );
    });

    it('sends a file by what its bytes are, not by its name or the type the browser declares', async () => {
      const user = userEvent.setup({ applyAccept: false });
      const uploads: Upload[] = [];
      render(<Host uploads={uploads} />);

      await user.upload(input(), new File(['%PDF-1.7'], 'accounts.txt', { type: 'text/plain' }));

      expect((await firstUpload(uploads)).file.name).toBe('accounts.txt');
    });

    it('does not send a file whose bytes are not an accepted type, whatever its name says', async () => {
      const user = userEvent.setup({ applyAccept: false });
      const uploads: Upload[] = [];
      render(<Host uploads={uploads} />);

      await user.upload(input(), new File(['MZ program'], 'accounts.pdf', { type: PDF }));

      expect(await screen.findByRole('alert', { name: 'There is a problem' })).toBeTruthy();
      expect(uploads).toHaveLength(0);
      expect(described(group())).toContain(
        'accounts.pdf: The file must be a PDF or Word document.',
      );
    });

    it('refuses a file over the limit without reading it', async () => {
      const user = userEvent.setup({ applyAccept: false });
      const uploads: Upload[] = [];
      render(<Host uploads={uploads} />);
      const big = pdf('big.pdf');
      Object.defineProperty(big, 'size', { value: 11 * MB });
      const read = vi.spyOn(big, 'arrayBuffer');

      await user.upload(input(), big);

      await screen.findByRole('alert', { name: 'There is a problem' });
      expect(described(group())).toContain('big.pdf: The file must be 10 MB or smaller.');
      expect(read).not.toHaveBeenCalled();
      expect(uploads).toHaveLength(0);
    });

    it('takes as many files as there is room for and says what to do about the rest', async () => {
      const user = userEvent.setup({ applyAccept: false });
      const uploads: Upload[] = [];
      render(<Host uploads={uploads} initial={[stored('one.pdf'), stored('two.pdf')]} />);

      await user.upload(input(), [pdf('three.pdf'), pdf('four.pdf')]);

      expect((await firstUpload(uploads)).file.name).toBe('three.pdf');
      await screen.findByRole('alert', { name: 'There is a problem' });
      expect(described(group())).toContain(
        'four.pdf: This question takes up to 3 files. Remove a file to attach another.',
      );
      expect(uploads).toHaveLength(1);
    });
  });

  describe('uploading', () => {
    it('shows a labelled progress bar, then the check for viruses, then the file in the list, announcing each step', async () => {
      const user = userEvent.setup({ applyAccept: false });
      const uploads: Upload[] = [];
      render(<Host uploads={uploads} />);
      expect(announced()).toBe('');

      await user.upload(input(), pdf());
      const upload = await firstUpload(uploads);
      expect(announced()).toBe('Uploading accounts.pdf');
      expect(screen.getByRole('progressbar', { name: 'Uploading accounts.pdf, 0%' })).toBeTruthy();

      upload.progress(450, 1000);
      const bar = screen.getByRole<HTMLProgressElement>('progressbar', {
        name: 'Uploading accounts.pdf, 45%',
      });
      expect(bar.value).toBe(45);
      // Progress alone is not announced.
      expect(announced()).toBe('Uploading accounts.pdf');

      upload.progress(1000, 1000);
      upload.progress(1000, 1000);
      expect(screen.queryByRole('progressbar')).toBeNull();
      expect(within(list()).getByText('Checking accounts.pdf for viruses')).toBeTruthy();
      expect(announced()).toBe('Checking accounts.pdf for viruses');

      await upload.settle();
      expect(within(list()).queryByText('Checking accounts.pdf for viruses')).toBeNull();
      const link = screen.getByRole('link', { name: 'Download accounts.pdf, PDF, 2.1 MB' });
      expect(link.getAttribute('href')).toBe('/files/accounts.pdf');
      expect(announced()).toBe('accounts.pdf added');
    });

    it('sends files chosen together one at a time, the others waiting their turn', async () => {
      const user = userEvent.setup({ applyAccept: false });
      const uploads: Upload[] = [];
      render(<Host uploads={uploads} />);

      await user.upload(input(), [pdf('one.pdf'), pdf('two.pdf')]);
      const first = await firstUpload(uploads);

      expect(screen.getByText('Waiting to upload two.pdf')).toBeTruthy();
      expect(uploads).toHaveLength(1);

      await first.settle();
      await waitFor(() => {
        expect(uploads).toHaveLength(2);
      });
      expect(screen.queryByText('Waiting to upload two.pdf')).toBeNull();
      expect(screen.getByRole('progressbar', { name: 'Uploading two.pdf, 0%' })).toBeTruthy();
    });
  });

  describe('a refused file', () => {
    const virus = new Refused(
      'This file has a virus in it, so it was not uploaded. Check the file and try again.',
    );

    it('shows the way it was refused beside the question and in the summary, and the person can choose another', async () => {
      const user = userEvent.setup({ applyAccept: false });
      const uploads: Upload[] = [];
      render(<Host uploads={uploads} />);
      await user.upload(input(), pdf());

      await (await firstUpload(uploads)).fail(virus);

      const message = `accounts.pdf: ${virus.detail}`;
      expect(described(group())).toContain(message);
      expect(within(summary()).getByRole('link', { name: message }).getAttribute('href')).toBe(
        '#f_accounts',
      );
      expect(document.activeElement).toBe(summary());
      expect(screen.queryByRole('progressbar')).toBeNull();
      expect(screen.queryByRole('list', { name: 'Files for Accounts' })).toBeNull();

      await user.click(within(summary()).getByRole('link', { name: message }));
      expect(document.activeElement).toBe(input());

      await user.upload(input(), pdf('other.pdf'));
      await waitFor(() => {
        expect(uploads).toHaveLength(2);
      });
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('says what to do when the upload fails for any other reason', async () => {
      const user = userEvent.setup({ applyAccept: false });
      const uploads: Upload[] = [];
      render(<Host uploads={uploads} />);
      await user.upload(input(), pdf());

      await (await firstUpload(uploads)).fail(new Error('socket closed'));

      expect(described(group())).toContain(
        'accounts.pdf: We could not upload this file. Try again.',
      );
    });

    it('keeps the files that were sent, and goes on to the next after one is refused', async () => {
      const user = userEvent.setup({ applyAccept: false });
      const uploads: Upload[] = [];
      render(<Host uploads={uploads} />);
      await user.upload(input(), [pdf('one.pdf'), pdf('two.pdf')]);

      await (await firstUpload(uploads)).fail(virus);
      await waitFor(() => {
        expect(uploads).toHaveLength(2);
      });
      await (uploads[1] as Upload).settle();

      expect(screen.getByRole('link', { name: /two\.pdf/ })).toBeTruthy();
      expect(described(group())).toContain(`one.pdf: ${virus.detail}`);
    });
  });

  describe('the list of files', () => {
    it('shows each file with its type and size, a link to download it and a button to remove it', () => {
      render(<Host uploads={[]} initial={[stored('accounts.pdf'), stored('plan.pdf')]} />);

      const items = within(list()).getAllByRole('listitem');
      expect(items).toHaveLength(2);
      const item = within(items[0] as HTMLElement);
      expect(item.getByRole('link', { name: 'Download accounts.pdf, PDF, 2.1 MB' })).toBeTruthy();
      expect(item.getByText('PDF, 2.1 MB')).toBeTruthy();
      expect(item.getByRole('button', { name: 'Remove accounts.pdf' })).toBeTruthy();
    });

    it('shows only the files that answer this question', () => {
      render(
        <Host
          uploads={[]}
          initial={[stored('accounts.pdf'), stored('plan.pdf', { fieldId: 'f_other' })]}
        />,
      );

      expect(screen.getByRole('link', { name: /accounts\.pdf/ })).toBeTruthy();
      expect(screen.queryByText('plan.pdf')).toBeNull();
    });

    it('shows a name as text only, and builds the link from the id, never the name', () => {
      const name = '<img src=x onerror=alert(1)>/../q?.pdf';
      render(<Host uploads={[]} initial={[stored(name, { id: 'f3b9' })]} />);

      const link = screen.getByRole('link', { name: `Download ${name}, PDF, 2.1 MB` });
      expect(link.getAttribute('href')).toBe('/files/f3b9');
      expect(document.querySelector('img')).toBeNull();
      expect(link.textContent).toContain(name);
    });

    it('removes a file, moves focus to the file input and says the file was removed', async () => {
      const user = userEvent.setup({ applyAccept: false });
      const onRemove = vi.fn();
      render(
        <Host
          uploads={[]}
          initial={[stored('accounts.pdf'), stored('plan.pdf')]}
          onRemove={onRemove}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Remove accounts.pdf' }));

      expect(onRemove).toHaveBeenCalledWith('f_accounts', 'accounts.pdf');
      expect(screen.queryByText('accounts.pdf')).toBeNull();
      expect(document.activeElement).toBe(input());
      expect(announced()).toBe('accounts.pdf removed');
    });

    it('leaves focus on the button while the file is still there', async () => {
      const user = userEvent.setup({ applyAccept: false });
      const files: FormFiles = {
        files: [stored('accounts.pdf')],
        hrefFor: (id) => `/files/${id}`,
        onUpload: () => Promise.resolve(),
        onRemove: () => undefined,
      };
      render(
        <SectionHarness
          fields={[accounts()]}
          files={files}
          helpers={{ ...helpers, ...fileHelpers }}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Remove accounts.pdf' }));

      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Remove accounts.pdf' }),
      );
      expect(announced()).toBe('');
    });
  });

  describe('at the limit', () => {
    const full = [stored('one.pdf'), stored('two.pdf'), stored('three.pdf')];

    it('gives the file input way to words saying the limit is reached', () => {
      render(<Host uploads={[]} initial={full} />);

      expect(screen.queryByLabelText('Choose files')).toBeNull();
      expect(screen.getByRole('group', { name: 'Accounts (required)' })).toBeTruthy();
      expect(
        screen.getByText('You have reached the limit of 3 files. Remove a file to attach another.'),
      ).toBeTruthy();
      expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(3);
    });

    it('brings the input back, with focus, when a file is removed', async () => {
      const user = userEvent.setup({ applyAccept: false });
      render(<Host uploads={[]} initial={full} />);

      await user.click(screen.getByRole('button', { name: 'Remove two.pdf' }));

      expect(document.activeElement).toBe(input());
      expect(screen.queryByText(/reached the limit/)).toBeNull();
    });

    it('keeps focus in the question when the last file joins and the input had it', async () => {
      const user = userEvent.setup({ applyAccept: false });
      const uploads: Upload[] = [];
      render(<Host uploads={uploads} initial={full.slice(0, 2)} />);
      await user.upload(input(), pdf('three.pdf'));
      const upload = await firstUpload(uploads);
      input().focus();

      await upload.settle();

      expect(screen.queryByLabelText('Choose files')).toBeNull();
      expect(document.activeElement?.textContent).toMatch(/^You have reached the limit of 3 files/);
    });

    it('leaves focus alone when it was somewhere else', async () => {
      const user = userEvent.setup({ applyAccept: false });
      const uploads: Upload[] = [];
      render(<Host uploads={uploads} initial={full.slice(0, 2)} />);
      await user.upload(input(), pdf('three.pdf'));
      const upload = await firstUpload(uploads);
      screen.getByRole('button', { name: 'Remove one.pdf' }).focus();

      await upload.settle();

      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove one.pdf' }));
    });
  });

  describe('read-only', () => {
    it('lists the files for download, with no input and no way to remove them', () => {
      render(<Host uploads={[]} readOnly initial={[stored('accounts.pdf')]} />);

      expect(screen.getByRole('group', { name: 'Accounts (required)' })).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Download accounts.pdf, PDF, 2.1 MB' })).toBeTruthy();
      expect(screen.queryByLabelText(/Choose file/)).toBeNull();
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.queryByText('No files attached.')).toBeNull();
    });

    it('says when there are no files', () => {
      render(<Host uploads={[]} readOnly />);

      expect(screen.getByText('No files attached.')).toBeTruthy();
      expect(screen.queryByLabelText(/Choose file/)).toBeNull();
    });

    it('is how a form with no way to attach files shows a file question', () => {
      render(<SectionHarness fields={[accounts()]} helpers={{ ...helpers, ...fileHelpers }} />);

      expect(screen.getByText('No files attached.')).toBeTruthy();
      expect(screen.queryByLabelText(/Choose file/)).toBeNull();
    });
  });

  it('sends every file for the server to decide when the form has no file checks', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const uploads: Upload[] = [];
    const files: FormFiles = {
      files: [],
      hrefFor: (id) => `/files/${id}`,
      onUpload: (_fieldId, file, progress) =>
        new Promise(() => {
          uploads.push({ file, progress } as Upload);
        }),
      onRemove: () => undefined,
    };
    render(<SectionHarness fields={[accounts()]} files={files} />);

    await user.upload(input(), new File(['MZ program'], 'accounts.pdf', { type: PDF }));

    await firstUpload(uploads);
  });
});
