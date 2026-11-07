// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { consoleSession, problem, stubApi } from '../testing/api.ts';
import { openConsole, setUpConsoleTests } from '../testing/render.tsx';
import { backupCodeNotRight } from './EnterCodePage.tsx';

setUpConsoleTests();

const VERIFY = 'POST /auth/backup-codes/verify';
const verifying = { 'GET /auth/session': { status: 200, body: consoleSession({ mfa: 'verify' }) } };

async function openBackupEntry(user: ReturnType<typeof userEvent.setup>) {
  openConsole('/northfield/enter-code');
  await user.click(await screen.findByRole('button', { name: 'Use a backup code' }));
  return screen.findByLabelText('Backup code');
}

describe('a backup code at sign-in', () => {
  it('takes capitals, spaces and hyphens, and sends the code in its one format', async () => {
    const user = userEvent.setup();
    const sent = stubApi({ ...verifying, [VERIFY]: { status: 200, body: consoleSession() } });

    await user.type(await openBackupEntry(user), 'ABCDE FGHJK');
    await user.click(screen.getByRole('button', { name: 'Confirm backup code' }));

    await waitFor(() => {
      expect(sent.find(({ key }) => key === VERIFY)?.body).toEqual({ code: 'abcde-fghjk' });
    });
  });

  it('gives one message for a wrong or used code', async () => {
    const user = userEvent.setup();
    stubApi({ ...verifying, [VERIFY]: problem(401, 'Already used.') });

    await user.type(await openBackupEntry(user), 'abcde-fghjk');
    await user.click(screen.getByRole('button', { name: 'Confirm backup code' }));

    expect(await screen.findByRole('link', { name: backupCodeNotRight })).toBeTruthy();
  });

  it('moves focus to the heading of the backup code view', async () => {
    const user = userEvent.setup();
    stubApi(verifying);
    await openBackupEntry(user);

    expect(document.activeElement).toBe(
      screen.getByRole('heading', { level: 1, name: 'Use a backup code' }),
    );
  });

  it('goes back to the authenticator app code', async () => {
    const user = userEvent.setup();
    stubApi(verifying);
    await openBackupEntry(user);

    await user.click(screen.getByRole('button', { name: 'Use your authenticator app' }));

    expect(await screen.findByLabelText('Code from your app')).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { level: 1, name: 'Enter your code' }),
    );
  });
});
