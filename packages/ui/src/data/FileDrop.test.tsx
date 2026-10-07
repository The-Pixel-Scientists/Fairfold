// SPDX-License-Identifier: AGPL-3.0-or-later

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FileDrop } from './FileDrop.tsx';
import type { FileDropItem, FileDropProps } from './FileDrop.tsx';

const files: readonly FileDropItem[] = [
  { id: 'accounts', name: 'Accounts 2025-26.pdf', size: 1_258_291, status: 'ready' },
  { id: 'constitution', name: 'Constitution.pdf', size: 856_064, status: 'scanning' },
  {
    id: 'safeguarding',
    name: 'Safeguarding policy.docx',
    size: 3_355_443,
    status: 'uploading',
    progress: 40,
  },
];

function Example(props: Partial<FileDropProps>) {
  return <FileDrop label="Supporting documents" files={files} multiple {...props} />;
}

const picker = () => screen.getByLabelText<HTMLInputElement>('Choose files');
const pdf = (name = 'Budget.pdf') => new File(['%PDF'], name, { type: 'application/pdf' });

describe('FileDrop', () => {
  it('is a group named by its label, described by its hint and error', () => {
    render(<Example hint="PDF or Word files." error="Add at least one file." />);

    const group = screen.getByRole('group', { name: 'Supporting documents' });
    const described = (group.getAttribute('aria-describedby') ?? '').split(' ');
    expect(described.map((id) => document.getElementById(id)?.textContent)).toEqual([
      'PDF or Word files.',
      'Error: Add at least one file.',
    ]);
    expect(picker().getAttribute('aria-invalid')).toBe('true');
  });

  it('labels a native file input with the "Choose files" button, so the keyboard and screen readers work', () => {
    render(<Example accept=".pdf" />);

    expect(picker().type).toBe('file');
    expect(picker().multiple).toBe(true);
    expect(picker().accept).toBe('.pdf');
    expect(screen.getByText('Choose files').tagName).toBe('LABEL');
  });

  it('says "Choose file" and takes one file when it is not for several', () => {
    render(<Example multiple={false} files={[]} />);

    const input = screen.getByLabelText<HTMLInputElement>('Choose file');
    expect(input.multiple).toBe(false);
    expect(screen.getByText('or drop a file here')).toBeTruthy();
  });

  it('says "Replace file" and leaves out the drop prompt when its one file is attached', () => {
    render(<Example multiple={false} files={files.slice(0, 1)} />);

    const input = screen.getByLabelText<HTMLInputElement>('Replace file');
    expect(input.multiple).toBe(false);
    expect(screen.getByText('Replace file').tagName).toBe('LABEL');
    expect(screen.queryByText(/drop/i)).toBeNull();
  });

  it('keeps "Choose files" and the drop prompt for several files, even with files attached', () => {
    render(<Example />);

    expect(picker()).toBeTruthy();
    expect(screen.getByText('or drop files here')).toBeTruthy();
    expect(screen.queryByText('Replace file')).toBeNull();
  });

  it('hides the drop prompt on touch screens, where nothing can be dragged', () => {
    render(<Example files={[]} />);

    expect(screen.getByText('or drop files here').className).toContain('pointer-coarse:hidden');
  });

  it('can be reached with Tab, which moves on to the first file to remove', async () => {
    const user = userEvent.setup();
    render(<Example />);

    await user.tab();
    expect(document.activeElement).toBe(picker());
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Remove Accounts 2025-26.pdf' }),
    );
  });

  it('calls back with the files chosen', async () => {
    const user = userEvent.setup();
    const onFilesChosen = vi.fn();
    render(<Example files={[]} onFilesChosen={onFilesChosen} />);

    const [first, second] = [pdf('Budget.pdf'), pdf('Accounts.pdf')];
    await user.upload(picker(), [first, second]);

    expect(onFilesChosen).toHaveBeenCalledWith([first, second]);
  });

  it('calls back with the first file only when it is not for several', () => {
    const onFilesChosen = vi.fn();
    render(<Example multiple={false} files={[]} onFilesChosen={onFilesChosen} />);

    const [first, second] = [pdf('Budget.pdf'), pdf('Accounts.pdf')];
    fireEvent.drop(screen.getByLabelText('Choose file').parentElement as HTMLElement, {
      dataTransfer: { files: [first, second] },
    });

    expect(onFilesChosen).toHaveBeenCalledWith([first]);
  });

  it('accepts files dropped on the box, and says so while they are over it', () => {
    const onFilesChosen = vi.fn();
    render(<Example files={[]} onFilesChosen={onFilesChosen} />);
    const zone = picker().parentElement as HTMLElement;

    expect(screen.getByText('or drop files here')).toBeTruthy();
    fireEvent.dragOver(zone, { dataTransfer: { files: [] } });
    expect(screen.getByText('Drop to add')).toBeTruthy();

    const dropped = pdf();
    fireEvent.drop(zone, { dataTransfer: { files: [dropped] } });
    expect(onFilesChosen).toHaveBeenCalledWith([dropped]);
    expect(screen.getByText('or drop files here')).toBeTruthy();
  });

  it('still accepts a file dropped on the box when it says "Replace file"', () => {
    const onFilesChosen = vi.fn();
    render(<Example multiple={false} files={files.slice(0, 1)} onFilesChosen={onFilesChosen} />);

    const dropped = pdf();
    fireEvent.drop(screen.getByLabelText('Replace file').parentElement as HTMLElement, {
      dataTransfer: { files: [dropped] },
    });

    expect(onFilesChosen).toHaveBeenCalledWith([dropped]);
  });

  it('does not call back when nothing is dropped', () => {
    const onFilesChosen = vi.fn();
    render(<Example files={[]} onFilesChosen={onFilesChosen} />);

    fireEvent.drop(picker().parentElement as HTMLElement, { dataTransfer: { files: [] } });

    expect(onFilesChosen).not.toHaveBeenCalled();
  });

  it('shows each file with its name, size and status in words', () => {
    render(<Example />);

    const items = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(items).toEqual([
      'Accounts 2025-26.pdf1.2 MB·ReadyRemove Accounts 2025-26.pdf',
      'Constitution.pdf836 KB·Checking for virusesRemove Constitution.pdf',
      'Safeguarding policy.docx3.2 MB·Uploading 40%Remove Safeguarding policy.docx',
    ]);
  });

  it('says why an upload failed, and shows no list when there are no files', () => {
    const failed: FileDropItem = {
      id: 'big',
      name: 'Photos.zip',
      size: 52_428_800,
      status: 'failed',
      error: 'The file is larger than 10 MB',
    };
    const { rerender } = render(<Example files={[failed]} />);

    expect(screen.getByText('Upload failed: The file is larger than 10 MB')).toBeTruthy();
    expect(screen.getByText('50 MB')).toBeTruthy();

    rerender(<Example files={[]} />);
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('calls back with the id of the file to remove', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<Example onRemove={onRemove} />);

    await user.click(screen.getByRole('button', { name: 'Remove Constitution.pdf' }));

    expect(onRemove).toHaveBeenCalledWith('constitution');
  });

  it('keeps one polite live region on the page from the start, and announces nothing for the files it starts with', () => {
    render(<Example />);

    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('announces a change of status, a new file and a removal, but not progress alone', () => {
    const { rerender } = render(<Example />);
    const announced = () => screen.getByRole('status').textContent;

    const uploaded = files.map((file) =>
      file.id === 'safeguarding' ? { ...file, progress: 70 } : file,
    );
    rerender(<Example files={uploaded} />);
    expect(announced()).toBe('');

    const checked = uploaded.map((file) =>
      file.id === 'constitution' ? { ...file, status: 'ready' as const } : file,
    );
    rerender(<Example files={checked} />);
    expect(announced()).toBe('Constitution.pdf: Ready');

    const added: FileDropItem = {
      id: 'budget',
      name: 'Budget.pdf',
      size: 900,
      status: 'uploading',
    };
    const withAdded = [...checked, added];
    rerender(<Example files={withAdded} />);
    expect(announced()).toBe('Budget.pdf: Uploading');

    rerender(<Example files={withAdded.slice(1)} />);
    expect(announced()).toBe('Accounts 2025-26.pdf removed');
  });

  describe('after a file is removed', () => {
    function Removing() {
      const [current, setCurrent] = useState(files);
      return (
        <FileDrop
          label="Supporting documents"
          files={current}
          onRemove={(id) => {
            setCurrent((all) => all.filter((file) => file.id !== id));
          }}
        />
      );
    }

    const remove = (name: string) => screen.getByRole('button', { name: `Remove ${name}` });

    it('moves focus to the next file, or the one before when it was the last', async () => {
      const user = userEvent.setup();
      render(<Removing />);

      await user.click(remove('Constitution.pdf'));
      expect(document.activeElement).toBe(remove('Safeguarding policy.docx'));

      await user.click(remove('Safeguarding policy.docx'));
      expect(document.activeElement).toBe(remove('Accounts 2025-26.pdf'));
    });

    it('moves focus to the file input when none are left', async () => {
      const user = userEvent.setup();
      render(<Removing />);

      await user.click(remove('Accounts 2025-26.pdf'));
      await user.click(remove('Constitution.pdf'));
      await user.click(remove('Safeguarding policy.docx'));

      expect(document.activeElement).toBe(screen.getByLabelText('Choose file'));
    });
  });
});
