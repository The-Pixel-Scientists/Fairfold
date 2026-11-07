// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Where focus goes after a change: a button that is replaced or a form that
// is remounted must not leave it at the start of the page (WCAG 2.4.3).

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as Ui from '@pixel-scientists/ui';
import { describe, expect, it, vi } from 'vitest';

import { consoleSession, stubApi } from '../../testing/api.ts';
import type { Reply } from '../../testing/api.ts';
import { openConsole, setUpConsoleTests } from '../../testing/render.tsx';
import { SESSION, heading, ok } from '../../platform/settings/testing.ts';

// The browser prompt is stubbed; the rest of the page is real.
vi.mock('@pixel-scientists/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof Ui>()),
  passkeysSupported: () => true,
  createPasskey: () =>
    Promise.resolve({
      status: 'ok',
      credential: {
        id: 'abc',
        rawId: 'abc',
        type: 'public-key',
        response: { clientDataJSON: 'abc', attestationObject: 'abc' },
        clientExtensionResults: {},
      },
    }),
}));

setUpConsoleTests();

const added = {
  id: '4a1b2c3d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  name: 'Work laptop',
  createdAt: '2026-10-01T09:00:00.000Z',
  lastUsedAt: null,
};
const options = {
  rp: { id: 'localhost', name: 'Test' },
  user: { id: 'dXNlcg', name: 'ada@example.org', displayName: 'Ada' },
  challenge: 'Y2hhbGxlbmdl',
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
  authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  attestation: 'none',
};
const totpStart = ok({
  key: 'JBSWY3DPEHPK3PXP',
  uri: 'otpauth://totp/N:a?secret=JBSWY3DPEHPK3PXP',
});

async function openSecurity(more: Record<string, Reply> = {}) {
  stubApi({
    [SESSION]: ok(consoleSession()),
    'GET /auth/passkeys': ok({ passkeys: [] }),
    'GET /auth/backup-codes': ok({ remaining: 4 }),
    ...more,
  });
  openConsole('/northfield/account/security');
  await heading('Account security');
  await screen.findByText(/backup codes? left/);
  await waitFor(() => {
    expect(screen.queryByText('Loading your passkeys')).toBeNull();
  });
}

/** Focus is moved a moment after the change, once any dialog has closed. */
const focused = (element: () => HTMLElement) =>
  waitFor(() => {
    expect(document.activeElement).toBe(element());
  });

const h2 = (name: string) => screen.getByRole('heading', { level: 2, name });

describe('focus after a change on the account security page', () => {
  it('moves to the Passkeys heading after a passkey is added', async () => {
    const user = userEvent.setup();
    await openSecurity({
      'POST /auth/passkeys/registration-options': ok(options),
      'POST /auth/passkeys': { status: 201, body: added },
    });

    await user.type(screen.getByLabelText('Name for the passkey'), 'Work laptop');
    await user.click(screen.getByRole('button', { name: 'Add a passkey' }));

    expect(await screen.findByText('Passkey Work laptop added.')).toBeTruthy();
    await focused(() => h2('Passkeys'));
  });

  it('moves to the Email address heading after the email change is requested', async () => {
    const user = userEvent.setup();
    await openSecurity({ 'POST /auth/account/email': { status: 202 } });

    await user.type(screen.getByLabelText('New email address'), 'new@example.org');
    await user.click(screen.getByRole('button', { name: 'Change email address' }));

    expect(await screen.findByText(/^Check your email\./)).toBeTruthy();
    await focused(() => h2('Email address'));
  });

  it('moves to the Password heading after the password changes', async () => {
    const user = userEvent.setup();
    await openSecurity({ 'POST /auth/account/password': { status: 204 } });

    await user.type(
      within(screen.getByRole('region', { name: 'Password' })).getByLabelText('Password', {
        selector: 'input',
      }),
      'a much longer passphrase',
    );
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText(/Anywhere else you were signed in/)).toBeTruthy();
    await focused(() => h2('Password'));
  });

  it('follows the authenticator app button to the set-up heading and back on Cancel', async () => {
    const user = userEvent.setup();
    await openSecurity({ 'POST /auth/account/totp/start': totpStart });

    await user.click(screen.getByRole('button', { name: 'Replace authenticator app' }));
    const intro = await screen.findByRole('heading', { level: 3, name: 'Set up your new app' });
    await focused(() => intro);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await focused(() => screen.getByRole('button', { name: 'Replace authenticator app' }));
  });

  it('moves to the new heading when every session is signed out', async () => {
    const user = userEvent.setup();
    await openSecurity({
      'POST /auth/account/totp/start': totpStart,
      'POST /auth/account/totp/confirm': { status: 204 },
    });

    await user.click(screen.getByRole('button', { name: 'Replace authenticator app' }));
    await user.type(await screen.findByLabelText('Code from the new app'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm new app' }));

    expect(document.activeElement).toBe(await heading('You have been signed out'));
  });
});
