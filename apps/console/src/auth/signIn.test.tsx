// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { titleSuffix } from '../product.ts';
import { consoleSession, problem, signedOut, stubApi } from '../testing/api.ts';
import { expectTitle, openConsole, setUpConsoleTests } from '../testing/render.tsx';

setUpConsoleTests();

const SIGN_IN = 'POST /auth/tenants/northfield/sign-in';
const heading = (name: string) => screen.findByRole('heading', { level: 1, name });

async function fillIn(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByRole('textbox', { name: 'Email address' }), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('sending people to sign in', () => {
  it('sends a signed-out visitor from the console to the sign-in page, with focus on its heading', async () => {
    stubApi({ 'GET /auth/session': signedOut });
    openConsole('/northfield/');

    const heading = await screen.findByRole('heading', { level: 1, name: 'Sign in' });

    expect(window.location.pathname).toBe('/northfield/sign-in');
    expect(window.location.search).toBe('');
    await expectTitle(`Sign in – ${titleSuffix}`);
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
  });

  it('shows that it is checking the session first', async () => {
    let finish: () => void = () => undefined;
    vi.stubGlobal('fetch', (url: string) =>
      url === '/api/auth/session'
        ? new Promise<Response>((resolve) => {
            finish = () => {
              resolve(new Response(JSON.stringify(consoleSession()), { status: 200 }));
            };
          })
        : Promise.reject(new Error('Not needed here.')),
    );
    openConsole('/northfield/');

    expect(await heading('Checking your session')).toBeTruthy();
    expect(within(screen.getByRole('main')).getByRole('status').textContent).toBe('Loading…');
    finish();
    expect(await screen.findByRole('heading', { level: 1, name: 'Programmes' })).toBeTruthy();
  });

  it('says so, and offers to try again, when the session cannot be read', async () => {
    const user = userEvent.setup();
    let reads = 0;
    stubApi({
      'GET /auth/session': () => {
        reads += 1;
        return reads === 1 ? problem(503, 'Try again later.') : signedOut;
      },
    });
    openConsole('/northfield/');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'We could not check your session' }),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy();
  });

  it('keeps the page the visitor wanted, and goes there after sign in', async () => {
    stubApi({
      'GET /auth/session': signedOut,
      [SIGN_IN]: { status: 200, body: consoleSession() },
    });
    openConsole('/northfield/does-not-exist');
    await screen.findByRole('heading', { level: 1, name: 'Sign in' });
    expect(window.location.search).toBe('?next=%2Fdoes-not-exist');

    await fillIn('ada@example.org', 'correct horse battery');

    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
    expect(window.location.pathname).toBe('/northfield/does-not-exist');
  });

  it('never goes anywhere but a page inside the console, whatever `next` says', async () => {
    stubApi({
      'GET /auth/session': signedOut,
      [SIGN_IN]: { status: 200, body: consoleSession() },
    });
    openConsole('/northfield/sign-in?next=//evil.example/path');

    await fillIn('ada@example.org', 'correct horse battery');

    expect(await screen.findByRole('heading', { level: 1, name: 'Programmes' })).toBeTruthy();
    expect(window.location.origin).toBe('http://localhost:3000');
    expect(window.location.pathname).toBe('/northfield/');
  });

  it('sends someone who is already signed in from the sign-in page to the console', async () => {
    stubApi({ 'GET /auth/session': { status: 200, body: consoleSession() } });
    openConsole('/northfield/sign-in');

    expect(await screen.findByRole('heading', { level: 1, name: 'Programmes' })).toBeTruthy();
    expect(window.location.pathname).toBe('/northfield/');
  });
});

describe('the sign-in page', () => {
  it('asks for an email address and a password, and offers the other ways in', async () => {
    stubApi({ 'GET /auth/session': signedOut });
    openConsole('/northfield/sign-in');

    await screen.findByRole('heading', { level: 1, name: 'Sign in' });
    const email = screen.getByRole('textbox', { name: 'Email address' });
    expect(email.getAttribute('type')).toBe('email');
    expect(email.getAttribute('autocomplete')).toBe('username');
    const password = screen.getByLabelText('Password');
    expect(password.getAttribute('type')).toBe('password');
    expect(password.getAttribute('autocomplete')).toBe('current-password');
    expect(screen.getByRole('link', { name: 'Forgot your password?' }).getAttribute('href')).toBe(
      '/northfield/forgot-password',
    );
    expect(screen.getByRole('link', { name: 'Create an account' }).getAttribute('href')).toBe(
      '/northfield/sign-up',
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('shows the password when asked, and hides it again', async () => {
    const user = userEvent.setup();
    stubApi({ 'GET /auth/session': signedOut });
    openConsole('/northfield/sign-in');
    const password = await screen.findByLabelText('Password');

    await user.click(screen.getByRole('checkbox', { name: 'Show password' }));
    expect(password.getAttribute('type')).toBe('text');
    await user.click(screen.getByRole('checkbox', { name: 'Show password' }));
    expect(password.getAttribute('type')).toBe('password');
  });

  it('signs in with the address and password, in the funder the address names', async () => {
    const sent = stubApi({
      'GET /auth/session': signedOut,
      [SIGN_IN]: { status: 200, body: consoleSession() },
    });
    openConsole('/northfield/sign-in');

    await fillIn('Ada@Example.org ', 'correct horse battery');

    expect(await screen.findByRole('heading', { level: 1, name: 'Programmes' })).toBeTruthy();
    expect(sent.find(({ key }) => key === SIGN_IN)?.body).toEqual({
      email: 'ada@example.org',
      password: 'correct horse battery',
    });
    expect(window.location.pathname).toBe('/northfield/');
  });

  it('goes on to set up an authenticator app when the account has none', async () => {
    stubApi({
      'GET /auth/session': signedOut,
      [SIGN_IN]: { status: 200, body: consoleSession({ mfa: 'enrol' }) },
      'POST /auth/totp/enrol': {
        status: 200,
        body: {
          key: 'JBSWY3DPEHPK3PXP',
          uri: 'otpauth://totp/Northfield:ada?secret=JBSWY3DPEHPK3PXP',
        },
      },
    });
    openConsole('/northfield/sign-in');

    await fillIn('ada@example.org', 'correct horse battery');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Set up your authenticator app' }),
    ).toBeTruthy();
    expect(window.location.pathname).toBe('/northfield/set-up-authenticator');
  });

  it('goes on to ask for a code when the account has an authenticator app', async () => {
    stubApi({
      'GET /auth/session': signedOut,
      [SIGN_IN]: { status: 200, body: consoleSession({ mfa: 'verify' }) },
    });
    openConsole('/northfield/sign-in');

    await fillIn('ada@example.org', 'correct horse battery');

    expect(await screen.findByRole('heading', { level: 1, name: 'Enter your code' })).toBeTruthy();
    expect(window.location.pathname).toBe('/northfield/enter-code');
  });
});

describe('sign-in errors', () => {
  it('checks the fields before sending anything, and puts each message beside its field', async () => {
    const user = userEvent.setup();
    const sent = stubApi({ 'GET /auth/session': signedOut });
    openConsole('/northfield/sign-in');
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));

    const summary = await screen.findByRole('alert', { name: 'There is a problem' });
    await waitFor(() => {
      expect(document.activeElement).toBe(summary);
    });
    expect(within(summary).getAllByRole('link')).toHaveLength(2);
    expect(screen.getAllByText('Enter your password.').length).toBeGreaterThan(0);
    expect(
      screen.getByRole('textbox', { name: 'Email address' }).getAttribute('aria-invalid'),
    ).toBe('true');
    expect(sent.map(({ key }) => key)).toEqual(['GET /auth/session']);
  });

  it('gives one message for a refused sign-in, whatever the API says', async () => {
    stubApi({
      'GET /auth/session': signedOut,
      [SIGN_IN]: problem(401, 'No account with that email address.'),
    });
    openConsole('/northfield/sign-in');

    await fillIn('nobody@example.org', 'wrong password here');

    const message = 'The email address or password is not right. Check them and try again.';
    expect(await screen.findByRole('link', { name: message })).toBeTruthy();
    expect(screen.queryByText(/No account/)).toBeNull();
    expect(
      screen.getByRole('textbox', { name: 'Email address' }).hasAttribute('aria-invalid'),
    ).toBe(false);
  });

  it('says how long to wait after too many attempts', async () => {
    stubApi({
      'GET /auth/session': signedOut,
      [SIGN_IN]: { ...problem(429, 'Slow down.'), headers: { 'retry-after': '30' } },
    });
    openConsole('/northfield/sign-in');

    await fillIn('ada@example.org', 'correct horse battery');

    expect(
      await screen.findByRole('link', {
        name: 'Too many attempts. Wait 30 seconds, then try again.',
      }),
    ).toBeTruthy();
  });

  it('says when the service cannot be reached', async () => {
    stubApi({
      'GET /auth/session': signedOut,
      [SIGN_IN]: () => {
        throw new TypeError('Failed to fetch');
      },
    });
    openConsole('/northfield/sign-in');

    await fillIn('ada@example.org', 'correct horse battery');

    expect(
      await screen.findByRole('link', {
        name: 'We could not reach the service. Check your connection and try again.',
      }),
    ).toBeTruthy();
  });
});

describe('why someone is at the sign-in page', () => {
  it.each([
    ['timeout', 'You were signed out because your session ended. Sign in to carry on.'],
    ['account-created', 'Your account is ready. Sign in to start.'],
    ['password-reset', 'Your password has changed. Sign in with your new password.'],
  ])('says so for %s', async (notice, words) => {
    stubApi({ 'GET /auth/session': signedOut });
    openConsole(`/northfield/sign-in?notice=${notice}`);

    expect(await screen.findByText(words)).toBeTruthy();
  });

  it('says nothing for a notice it does not know', async () => {
    stubApi({ 'GET /auth/session': signedOut });
    openConsole('/northfield/sign-in?notice=%3Cb%3Ehello');

    await screen.findByRole('heading', { level: 1, name: 'Sign in' });
    expect(screen.queryByText(/hello/)).toBeNull();
  });
});
