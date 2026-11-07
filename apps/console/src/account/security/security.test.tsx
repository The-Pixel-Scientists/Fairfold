// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { consoleSession, problem, stubApi } from '../../testing/api.ts';
import type { Reply } from '../../testing/api.ts';
import { openConsole, setUpConsoleTests } from '../../testing/render.tsx';
import { SESSION, heading, ok } from '../../platform/settings/testing.ts';
import { STEP_UP_NEEDED } from '../../platform/team/change.ts';

setUpConsoleTests();

const PASSKEYS = 'GET /auth/passkeys';
const COUNT = 'GET /auth/backup-codes';
const GENERATE = 'POST /auth/backup-codes';
const STEP_UP = 'POST /auth/step-up';
const LAST_FACTOR =
  'You need another authenticator to sign in to the staff console. Add one first.';
const CODES = [
  'abcde-fghjk',
  'mnpqr-stvwx',
  'yz012-34567',
  '89abc-defgh',
  'jkmnp-qrstv',
  'wxyz0-12345',
  '6789a-bcdef',
  'ghjkm-npqrs',
  'tvwxy-z0123',
  '45678-9abcd',
];
const key = {
  id: '4a1b2c3d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  name: 'Work laptop',
  createdAt: '2026-10-01T09:00:00.000Z',
  lastUsedAt: null,
};

type Handlers = Record<string, Reply | ((body: unknown) => Reply)>;

const base = (more: Handlers = {}): Handlers => ({
  [SESSION]: ok(consoleSession()),
  [PASSKEYS]: ok({ passkeys: [key] }),
  [COUNT]: ok({ remaining: 4 }),
  ...more,
});

async function openSecurity(more: Handlers = {}) {
  const sent = stubApi(base(more));
  openConsole('/northfield/account/security');
  await heading('Account security');
  await screen.findByText(/backup codes? left/);
  await waitFor(() => {
    expect(screen.queryByText('Loading your passkeys')).toBeNull();
  });
  return sent;
}

const region = (name: string) => screen.getByRole('region', { name });

/** Replies with a step-up refusal until the person has confirmed it is them. */
function gated(reply: Reply): Handlers[string] {
  let confirmed = false;
  return () => {
    if (confirmed) return reply;
    confirmed = true;
    return problem(403, STEP_UP_NEEDED);
  };
}

async function confirm(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
  await user.type(within(dialog).getByLabelText('Password'), 'correct horse battery');
  await user.type(within(dialog).getByLabelText('Code from your authenticator app'), '123456');
  await user.click(within(dialog).getByRole('button', { name: 'Confirm it is you' }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: 'Confirm it is you' })).toBeNull();
  });
}

describe('the account security page', () => {
  it('has the five sections', async () => {
    await openSecurity();
    for (const name of [
      'Passkeys',
      'Authenticator app',
      'Backup codes',
      'Email address',
      'Password',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy();
    }
    expect(screen.getByText('Added 1 October 2026. Not used yet.')).toBeTruthy();
    expect(screen.getByText('You have 4 backup codes left.')).toBeTruthy();
  });

  it('hides Add a passkey and says why in a browser with no WebAuthn', async () => {
    await openSecurity();
    expect(screen.queryByRole('button', { name: 'Add a passkey' })).toBeNull();
    expect(screen.getByText(/This browser cannot make passkeys/)).toBeTruthy();
  });

  it('says what to do when there are no passkeys', async () => {
    await openSecurity({ [PASSKEYS]: ok({ passkeys: [] }) });
    expect(screen.getByText(/You have no passkeys/)).toBeTruthy();
  });

  it('removes a passkey, naming it, after step-up, and repeats the action once', async () => {
    const user = userEvent.setup();
    const sent = await openSecurity({
      [`DELETE /auth/passkeys/${key.id}`]: gated({ status: 204 }),
      [STEP_UP]: ok(consoleSession()),
    });

    await user.click(screen.getByRole('button', { name: 'Remove passkey Work laptop' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove this passkey?' });
    expect(dialog.textContent).toContain('Work laptop');
    await user.click(within(dialog).getByRole('button', { name: 'Remove passkey' }));
    await confirm(user);

    expect(await screen.findByText('Passkey Work laptop removed.')).toBeTruthy();
    expect(sent.filter(({ key: k }) => k.startsWith('DELETE'))).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Remove passkey Work laptop' })).toBeNull();
  });

  it('shows the last-factor refusal in the server words and keeps the remove button', async () => {
    const user = userEvent.setup();
    await openSecurity({ [`DELETE /auth/passkeys/${key.id}`]: problem(409, LAST_FACTOR) });

    await user.click(screen.getByRole('button', { name: 'Remove passkey Work laptop' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove passkey' }),
    );

    expect(await screen.findByRole('link', { name: LAST_FACTOR })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove passkey Work laptop' })).toBeTruthy();
  });

  it('shows backup codes once, keeps them out of the address, storage and title, and drops them on leaving', async () => {
    const user = userEvent.setup();
    await openSecurity({ [GENERATE]: ok({ codes: CODES }), [STEP_UP]: ok(consoleSession()) });

    await user.click(screen.getByRole('button', { name: 'Generate new backup codes' }));
    const list = await screen.findByRole('group', { name: 'Your backup codes' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    expect(window.location.href).not.toContain(CODES[0]);
    expect(document.title).not.toContain(CODES[0]);
    expect(
      JSON.stringify([
        Object.entries(localStorage),
        Object.entries(sessionStorage),
        window.history.state,
      ]),
    ).not.toContain(CODES[0]);

    await user.click(screen.getByRole('button', { name: 'I have saved my codes' }));

    expect(screen.queryByText(CODES[0] ?? '')).toBeNull();
    expect(screen.getByText('You have 10 backup codes left.')).toBeTruthy();
  });

  it('offers Generate backup codes when none are left', async () => {
    await openSecurity({ [COUNT]: ok({ remaining: 0 }) });
    expect(screen.getByText('You have no backup codes left.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Generate backup codes' })).toBeTruthy();
  });

  it('says how long to wait after too many attempts', async () => {
    const user = userEvent.setup();
    await openSecurity({
      [GENERATE]: { ...problem(429, 'Slow down.'), headers: { 'retry-after': '30' } },
    });

    await user.click(screen.getByRole('button', { name: 'Generate new backup codes' }));

    expect(
      await screen.findByRole('link', {
        name: 'Too many attempts. Wait 30 seconds, then try again.',
      }),
    ).toBeTruthy();
  });

  it('replaces the authenticator app, says the old one still works on a wrong code, then signs out', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    await openSecurity({
      'POST /auth/account/totp/start': ok({
        key: 'JBSWY3DPEHPK3PXP',
        uri: 'otpauth://totp/N:a?secret=JBSWY3DPEHPK3PXP',
      }),
      'POST /auth/account/totp/confirm': () => {
        attempts += 1;
        return attempts === 1 ? problem(401, 'Code used.') : { status: 204 };
      },
    });

    await user.click(screen.getByRole('button', { name: 'Replace authenticator app' }));
    expect(await screen.findByText('JBSW Y3DP EHPK 3PXP')).toBeTruthy();
    await user.type(screen.getByLabelText('Code from the new app'), '111111');
    await user.click(screen.getByRole('button', { name: 'Confirm new app' }));
    expect(
      await screen.findByRole('link', { name: /Your old authenticator app still works/ }),
    ).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Confirm new app' }));

    await heading('You have been signed out');
    expect(screen.getByRole('link', { name: 'Sign in again' }).getAttribute('href')).toBe(
      '/northfield/sign-in?notice=security-changed',
    );
  });

  it('says check your email, with the same words, whatever the address', async () => {
    const user = userEvent.setup();
    const sent = await openSecurity({ 'POST /auth/account/email': { status: 202 } });

    await user.type(screen.getByLabelText('New email address'), 'taken@example.org');
    await user.click(screen.getByRole('button', { name: 'Change email address' }));

    expect(await screen.findByText(/^Check your email\./)).toBeTruthy();
    expect(sent.find(({ key: k }) => k === 'POST /auth/account/email')?.body).toEqual({
      email: 'taken@example.org',
    });
    expect(screen.getByLabelText<HTMLInputElement>('New email address').value).toBe('');
  });

  it('changes the password, shows a refused one in the error summary, and clears the form', async () => {
    const user = userEvent.setup();
    const sent = await openSecurity({ 'POST /auth/account/password': { status: 204 } });
    const field = () =>
      within(region('Password')).getByLabelText('Password', { selector: 'input' });

    await user.type(field(), 'short');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert', { name: 'There is a problem' })).toBeTruthy();
    expect(sent.filter(({ key: k }) => k.includes('password'))).toEqual([]);

    await user.clear(field());
    await user.type(field(), 'a much longer passphrase');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText(/Anywhere else you were signed in is signed out/)).toBeTruthy();
    expect((field() as HTMLInputElement).value).toBe('');
  });
});

describe('the email change link page', () => {
  const TOKEN = 'tok_0123456789abcdefghijklmnopqrstuvwxyz';

  it('removes the token from the address, calls nothing until the button, then posts it', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      [SESSION]: problem(401, 'You are not signed in.'),
      'POST /auth/email-change/complete': { status: 204 },
    });
    openConsole(`/northfield/email-change#token=${TOKEN}`);

    await heading('Confirm your new email address');
    expect(window.location.href).not.toContain(TOKEN);
    expect(sent.filter(({ key: k }) => k.includes('email-change'))).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Confirm new email address' }));

    expect(document.activeElement).toBe(await heading('Your email address has changed'));
    expect(sent.find(({ key: k }) => k.includes('email-change'))?.body).toEqual({ token: TOKEN });
  });

  it('says the link does not work with no token', async () => {
    stubApi({ [SESSION]: problem(401, 'You are not signed in.') });
    openConsole('/northfield/email-change');
    await heading('This link does not work');
  });

  it('moves focus to the heading that says the link does not work', async () => {
    const user = userEvent.setup();
    stubApi({
      [SESSION]: problem(401, 'You are not signed in.'),
      'POST /auth/email-change/complete': problem(404, 'No such link.'),
    });
    openConsole(`/northfield/email-change#token=${TOKEN}`);
    await heading('Confirm your new email address');

    await user.click(screen.getByRole('button', { name: 'Confirm new email address' }));

    expect(document.activeElement).toBe(await heading('This link does not work'));
  });
});
