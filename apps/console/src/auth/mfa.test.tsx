// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';

import { App } from '../App.tsx';
import { consoleSession, problem, signedOut, stubApi } from '../testing/api.ts';
import { expectTitle, openConsole, setUpConsoleTests } from '../testing/render.tsx';

setUpConsoleTests();

const ENROL = 'POST /auth/totp/enrol';
const CONFIRM = 'POST /auth/totp/confirm';
const VERIFY = 'POST /auth/totp/verify';
const KEY = 'JBSWY3DPEHPK3PXP';
const URI = `otpauth://totp/Northfield:ada@example.org?secret=${KEY}&issuer=Northfield`;

const heading = (name: string) => screen.findByRole('heading', { level: 1, name });
const enrolling = { 'GET /auth/session': { status: 200, body: consoleSession({ mfa: 'enrol' }) } };

describe('set up an authenticator app', () => {
  it('shows the set-up key as text, a link that opens the app, and the steps to follow', async () => {
    stubApi({ ...enrolling, [ENROL]: { status: 200, body: { key: KEY, uri: URI } } });
    openConsole('/northfield/set-up-authenticator');

    await heading('Set up your authenticator app');

    expect(await screen.findByText('JBSW Y3DP EHPK 3PXP')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Open in your authenticator app' }).getAttribute('href'),
    ).toBe(URI);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByLabelText('Code from your app').getAttribute('autocomplete')).toBe(
      'one-time-code',
    );
    await expectTitle('Set up your authenticator app – Fairfold Grants console');
  });

  it('never puts the key in the address, nor stores it', async () => {
    stubApi({ ...enrolling, [ENROL]: { status: 200, body: { key: KEY, uri: URI } } });
    openConsole('/northfield/set-up-authenticator');
    await screen.findByText('JBSW Y3DP EHPK 3PXP');

    expect(window.location.href).not.toContain(KEY);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('asks the API for a key once, even when development runs effects twice', async () => {
    const sent = stubApi({ ...enrolling, [ENROL]: { status: 200, body: { key: KEY, uri: URI } } });
    window.history.replaceState(null, '', '/northfield/set-up-authenticator');
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    await screen.findByText('JBSW Y3DP EHPK 3PXP');

    expect(sent.filter(({ key }) => key === ENROL)).toHaveLength(1);
  });

  it('finishes with the first code, then opens the console', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      ...enrolling,
      [ENROL]: { status: 200, body: { key: KEY, uri: URI } },
      [CONFIRM]: { status: 200, body: consoleSession() },
    });
    openConsole('/northfield/set-up-authenticator');

    await user.type(await screen.findByLabelText('Code from your app'), '123456');
    await user.click(screen.getByRole('button', { name: 'Finish set-up' }));

    await heading('Programmes');
    expect(sent.find(({ key }) => key === CONFIRM)?.body).toEqual({ code: '123456' });
    expect(window.location.pathname).toBe('/northfield/');
  });

  it('asks for six digits before sending anything', async () => {
    const user = userEvent.setup();
    const sent = stubApi({ ...enrolling, [ENROL]: { status: 200, body: { key: KEY, uri: URI } } });
    openConsole('/northfield/set-up-authenticator');

    await user.type(await screen.findByLabelText('Code from your app'), '12ab');
    await user.click(screen.getByRole('button', { name: 'Finish set-up' }));

    expect(
      await screen.findByRole('link', {
        name: 'Enter the 6-digit code from your authenticator app.',
      }),
    ).toBeTruthy();
    expect(sent.map(({ key }) => key)).not.toContain(CONFIRM);
  });

  it('gives one message for a wrong code, and stays so the person can try the next one', async () => {
    const user = userEvent.setup();
    stubApi({
      ...enrolling,
      [ENROL]: { status: 200, body: { key: KEY, uri: URI } },
      [CONFIRM]: problem(401, 'That code was already used.'),
    });
    openConsole('/northfield/set-up-authenticator');

    await user.type(await screen.findByLabelText('Code from your app'), '123456');
    await user.click(screen.getByRole('button', { name: 'Finish set-up' }));

    expect(
      await screen.findByRole('link', {
        name: 'That code is not right. Check the 6 digits in your app, or wait for the next code, then try again.',
      }),
    ).toBeTruthy();
    expect(screen.queryByText(/already used/)).toBeNull();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Set up your authenticator app' }),
    ).toBeTruthy();
  });

  it('goes back to sign in, saying why, when the session has ended meanwhile', async () => {
    const user = userEvent.setup();
    let reads = 0;
    stubApi({
      'GET /auth/session': () => {
        reads += 1;
        return reads === 1 ? { status: 200, body: consoleSession({ mfa: 'enrol' }) } : signedOut;
      },
      [ENROL]: { status: 200, body: { key: KEY, uri: URI } },
      [CONFIRM]: problem(401, 'Not signed in.'),
    });
    openConsole('/northfield/set-up-authenticator');

    await user.type(await screen.findByLabelText('Code from your app'), '123456');
    await user.click(screen.getByRole('button', { name: 'Finish set-up' }));

    await heading('Sign in');
    expect(window.location.pathname).toBe('/northfield/sign-in');
    expect(
      screen.getByText('You were signed out because your session ended. Sign in to carry on.'),
    ).toBeTruthy();
  });

  it('says what went wrong, and offers to try again, when no key can be made', async () => {
    const user = userEvent.setup();
    let asked = 0;
    stubApi({
      ...enrolling,
      [ENROL]: () => {
        asked += 1;
        return asked === 1
          ? problem(500, 'Something went wrong on our side. Try again in a few minutes.')
          : { status: 200, body: { key: KEY, uri: URI } };
      },
    });
    openConsole('/northfield/set-up-authenticator');

    expect(
      await screen.findByText('Something went wrong on our side. Try again in a few minutes.'),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Code from your app')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Get a set-up key' }));

    expect(await screen.findByText('JBSW Y3DP EHPK 3PXP')).toBeTruthy();
  });

  it('sends a signed-in person who has finished set-up to the console', async () => {
    stubApi({ 'GET /auth/session': { status: 200, body: consoleSession() } });
    openConsole('/northfield/set-up-authenticator');

    await heading('Programmes');
  });
});

describe('enter a code', () => {
  const verifying = {
    'GET /auth/session': { status: 200, body: consoleSession({ mfa: 'verify' }) },
  };

  it('asks for the six digits from the app', async () => {
    stubApi(verifying);
    openConsole('/northfield/enter-code');

    await heading('Enter your code');

    const code = screen.getByLabelText('Code from your app');
    expect(code.getAttribute('inputmode')).toBe('numeric');
    expect(code.getAttribute('autocomplete')).toBe('one-time-code');
    expect(screen.getByRole('button', { name: 'Confirm code' })).toBeTruthy();
  });

  it('opens the console after a right code, at the page the person was going to', async () => {
    const user = userEvent.setup();
    const sent = stubApi({ ...verifying, [VERIFY]: { status: 200, body: consoleSession() } });
    openConsole('/northfield/enter-code?next=%2Fdoes-not-exist');

    await user.type(await screen.findByLabelText('Code from your app'), '654321');
    await user.click(screen.getByRole('button', { name: 'Confirm code' }));

    await heading('Page not found');
    expect(sent.find(({ key }) => key === VERIFY)?.body).toEqual({ code: '654321' });
    expect(window.location.pathname).toBe('/northfield/does-not-exist');
  });

  it('gives one message for a wrong code', async () => {
    const user = userEvent.setup();
    stubApi({ ...verifying, [VERIFY]: problem(401, 'Code expired.') });
    openConsole('/northfield/enter-code');

    await user.type(await screen.findByLabelText('Code from your app'), '654321');
    await user.click(screen.getByRole('button', { name: 'Confirm code' }));

    expect(
      await screen.findByRole('link', {
        name: 'That code is not right. Check the 6 digits in your app, or wait for the next code, then try again.',
      }),
    ).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('alert', { name: 'There is a problem' }),
      );
    });
  });

  it('says how long to wait after too many wrong codes', async () => {
    const user = userEvent.setup();
    stubApi({
      ...verifying,
      [VERIFY]: { ...problem(429, 'Slow down.'), headers: { 'retry-after': '60' } },
    });
    openConsole('/northfield/enter-code');

    await user.type(await screen.findByLabelText('Code from your app'), '654321');
    await user.click(screen.getByRole('button', { name: 'Confirm code' }));

    expect(
      await screen.findByRole('link', {
        name: 'Too many attempts. Wait 60 seconds, then try again.',
      }),
    ).toBeTruthy();
  });

  it('sends a signed-out visitor to sign in', async () => {
    stubApi({ 'GET /auth/session': signedOut });
    openConsole('/northfield/enter-code');

    await heading('Sign in');
  });
});
