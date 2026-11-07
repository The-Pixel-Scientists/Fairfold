// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BackupCodeList } from './BackupCodeList.tsx';
import { PasskeyList } from './PasskeyList.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const codes = ['abcde-fghjk', 'mnpqr-stvwx'];

describe('BackupCodeList', () => {
  it('shows the codes with a warning, takes focus, and writes the clipboard only on a press', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<BackupCodeList codes={codes} onDone={vi.fn()} />);

    const group = screen.getByRole('group', { name: 'Your backup codes' });
    await waitFor(() => {
      expect(document.activeElement).toBe(group);
    });
    expect(screen.getByText('These codes are shown once')).toBeTruthy();
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(codes);
    expect(writeText).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Copy codes' }));

    expect(writeText).toHaveBeenCalledWith('abcde-fghjk\nmnpqr-stvwx');
    expect((await screen.findByRole('status')).textContent).toBe('Codes copied.');
  });

  it('downloads a text file from a blob address that it revokes at once', async () => {
    const user = userEvent.setup();
    const create = vi.fn(() => 'blob:codes');
    const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    render(<BackupCodeList codes={codes} onDone={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Download codes' }));

    expect(click).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('blob:codes');
    const blob = (create.mock.calls[0] as unknown as [Blob])[0];
    expect(await blob.text()).toContain('abcde-fghjk');
  });

  it('says so when the codes cannot be copied, and calls onDone', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: { writeText: () => Promise.reject(new Error('No.')) },
    });
    render(<BackupCodeList codes={codes} onDone={onDone} />);

    await user.click(screen.getByRole('button', { name: 'Copy codes' }));
    expect((await screen.findByRole('status')).textContent).toMatch(/could not be copied/);
    await user.click(screen.getByRole('button', { name: 'I have saved my codes' }));
    expect(onDone).toHaveBeenCalledOnce();
  });
});

describe('PasskeyList', () => {
  const passkey = {
    id: 'p1',
    name: 'Work laptop',
    createdAt: '2026-10-01T09:00:00.000Z',
    lastUsedAt: null,
  };

  it('lists each passkey with its dates and a remove button that names it', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(
      <PasskeyList
        passkeys={[
          passkey,
          { ...passkey, id: 'p2', name: 'Phone', lastUsedAt: '2026-10-05T10:00:00.000Z' },
        ]}
        label="Your passkeys"
        empty={<p>None.</p>}
        onRemove={onRemove}
      />,
    );

    expect(screen.getByText('Added 1 October 2026. Not used yet.')).toBeTruthy();
    expect(screen.getByText('Added 1 October 2026. Last used 5 October 2026.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove passkey Work laptop' }));
    expect(onRemove).toHaveBeenCalledWith(passkey);
  });

  it('shows what to do when there are none', () => {
    render(
      <PasskeyList
        passkeys={[]}
        label="Your passkeys"
        empty={<p>None yet.</p>}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('None yet.')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });
});
