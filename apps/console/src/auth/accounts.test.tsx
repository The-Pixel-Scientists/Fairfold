// SPDX-License-Identifier: AGPL-3.0-or-later

import { messages } from '@pixel-scientists/domain/platform';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { consoleSession, problem, signedOut, stubApi } from '../testing/api.ts';
import { openConsole, setUpConsoleTests } from '../testing/render.tsx';

setUpConsoleTests();

const TOKEN = 'tok_0123456789abcdefghijklmnopqrstuvwxyz';
const SIGN_UP = 'POST /auth/tenants/northfield/sign-up';
const COMPLETE_SIGN_UP = 'POST /auth/sign-up/complete';
const RESET_REQUEST = 'POST /auth/tenants/northfield/password-reset';
const RESET_COMPLETE = 'POST /auth/password-reset/complete';

const heading = (name: string) => screen.findByRole('heading', { level: 1, name });

describe('create an account', () => {
  it('asks for an email address only, and says what happens next', async () => {
    stubApi({ 'GET /auth/session': signedOut });
    openConsole('/northfield/sign-up');

    await heading('Create your account');

    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(
      screen.getByRole('textbox', { name: 'Email address' }).getAttribute('autocomplete'),
    ).toBe('email');
    expect(screen.getByText(/We will email you a link to set your password/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Email me a link' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe(
      '/northfield/sign-in',
    );
  });

  it('sends the address for the funder in the web address, then asks the person to check their email', async () => {
    const user = userEvent.setup();
    const sent = stubApi({ 'GET /auth/session': signedOut, [SIGN_UP]: { status: 202 } });
    openConsole('/northfield/sign-up');

    await user.type(
      await screen.findByRole('textbox', { name: 'Email address' }),
      'New@Example.org',
    );
    await user.click(screen.getByRole('button', { name: 'Email me a link' }));

    await heading('Check your email');
    expect(sent.find(({ key }) => key === SIGN_UP)?.body).toEqual({ email: 'new@example.org' });
    expect(window.location.pathname).toBe('/northfield/sign-up/check-email');
    expect(screen.getByText(/The link works once, for 24 hours/)).toBeTruthy();
    // The page never repeats the address, so it reads the same whoever asked.
    expect(document.body.textContent).not.toContain('example.org');
  });

  it('asks for a proper address before sending anything', async () => {
    const user = userEvent.setup();
    const sent = stubApi({ 'GET /auth/session': signedOut });
    openConsole('/northfield/sign-up');

    await user.type(
      await screen.findByRole('textbox', { name: 'Email address' }),
      'not an address',
    );
    await user.click(screen.getByRole('button', { name: 'Email me a link' }));

    expect(
      await screen.findByRole('link', {
        name: 'Enter an email address in the correct format, like name@example.com.',
      }),
    ).toBeTruthy();
    expect(sent).toHaveLength(1);
  });

  it('says how long to wait after too many requests', async () => {
    const user = userEvent.setup();
    stubApi({
      'GET /auth/session': signedOut,
      [SIGN_UP]: { ...problem(429, 'Slow down.'), headers: { 'retry-after': '3600' } },
    });
    openConsole('/northfield/sign-up');

    await user.type(
      await screen.findByRole('textbox', { name: 'Email address' }),
      'new@example.org',
    );
    await user.click(screen.getByRole('button', { name: 'Email me a link' }));

    expect(
      await screen.findByRole('link', {
        name: 'Too many attempts. Wait 60 minutes, then try again.',
      }),
    ).toBeTruthy();
  });
});

describe.each([
  {
    name: 'set your password from an emailed sign-up link',
    path: '/northfield/sign-up/complete',
    title: 'Set your password',
    button: 'Create account',
    route: COMPLETE_SIGN_UP,
    askAgain: '/northfield/sign-up',
    after: 'account-created',
  },
  {
    name: 'choose a new password from an emailed reset link',
    path: '/northfield/reset-password',
    title: 'Choose a new password',
    button: 'Save new password',
    route: RESET_COMPLETE,
    askAgain: '/northfield/forgot-password',
    after: 'password-reset',
  },
])('$name', ({ path, title, button, route, askAgain, after }) => {
  it('reads the token from the address fragment and removes it from the address bar and the history', async () => {
    const sent = stubApi({ 'GET /auth/session': signedOut });
    openConsole(`${path}#token=${TOKEN}`);

    await heading(title);

    await waitFor(() => {
      expect(window.location.hash).toBe('');
    });
    expect(window.location.href).not.toContain(TOKEN);
    expect(JSON.stringify(window.history.state)).not.toContain(TOKEN);
    expect(window.location.pathname).toBe(path);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    // Opening the page changes nothing: the only call is the one that looks for a session.
    expect(sent.map(({ key }) => key)).toEqual(['GET /auth/session']);
  });

  it('sends the token only when the button is pressed, then goes to sign in and says why', async () => {
    const user = userEvent.setup();
    const sent = stubApi({ 'GET /auth/session': signedOut, [route]: { status: 204 } });
    openConsole(`${path}#token=${TOKEN}`);
    await heading(title);

    await user.type(screen.getByLabelText('Password'), 'a long passphrase here');
    await user.click(screen.getByRole('button', { name: button }));

    await heading('Sign in');
    expect(sent.find(({ key }) => key === route)?.body).toEqual({
      token: TOKEN,
      password: 'a long passphrase here',
    });
    expect(window.location.pathname).toBe('/northfield/sign-in');
    expect(window.location.search).toBe(`?notice=${after}`);
    expect(window.location.href).not.toContain(TOKEN);
  });

  it('asks for a long enough password before sending anything', async () => {
    const user = userEvent.setup();
    const sent = stubApi({ 'GET /auth/session': signedOut });
    openConsole(`${path}#token=${TOKEN}`);
    await heading(title);
    const password = screen.getByLabelText('Password');
    expect(password.getAttribute('autocomplete')).toBe('new-password');

    await user.type(password, 'short');
    await user.click(screen.getByRole('button', { name: button }));

    expect(
      await screen.findByRole('link', { name: 'Enter a password of at least 12 characters.' }),
    ).toBeTruthy();
    expect(sent).toHaveLength(1);
  });

  it('shows what the API says when it refuses the link, in the error summary', async () => {
    const user = userEvent.setup();
    stubApi({
      'GET /auth/session': signedOut,
      [route]: problem(400, 'Some fields are not valid.', [
        { field: 'body.token', message: messages.linkNotValid },
      ]),
    });
    openConsole(`${path}#token=${TOKEN}`);
    await heading(title);

    await user.type(screen.getByLabelText('Password'), 'a long passphrase here');
    await user.click(screen.getByRole('button', { name: button }));

    expect(await screen.findByRole('link', { name: messages.linkNotValid })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ask for a new one' }).getAttribute('href')).toBe(
      askAgain,
    );
  });

  it.each([
    ['has no token', path],
    ['has a token that is too short', `${path}#token=abc`],
    ['has other characters in the token', `${path}#token=${'a'.repeat(30)}%20%3Cb%3E`],
    ['asks for something else', `${path}#other=${TOKEN}`],
  ])(
    'says the link does not work when the address %s, and sends nothing',
    async (_name, address) => {
      const sent = stubApi({ 'GET /auth/session': signedOut });
      openConsole(address);

      await heading('This link does not work');

      expect(screen.queryByRole('textbox')).toBeNull();
      expect(screen.queryByLabelText('Password')).toBeNull();
      expect(screen.getByRole('link', { name: 'Ask for a new link' }).getAttribute('href')).toBe(
        askAgain,
      );
      expect(sent).toHaveLength(1);
    },
  );

  it('does not bring the token back when the page is reloaded', async () => {
    stubApi({ 'GET /auth/session': signedOut });
    const first = openConsole(`${path}#token=${TOKEN}`);
    await heading(title);
    await waitFor(() => {
      expect(window.location.hash).toBe('');
    });
    first.unmount();

    // A reload opens the address as it now is.
    openConsole(`${window.location.pathname}${window.location.search}${window.location.hash}`);

    await heading('This link does not work');
  });
});

describe('forgot your password', () => {
  it('asks for an email address, and sends the request for the funder in the address', async () => {
    const user = userEvent.setup();
    const sent = stubApi({ 'GET /auth/session': signedOut, [RESET_REQUEST]: { status: 202 } });
    openConsole('/northfield/forgot-password');

    await user.type(
      await screen.findByRole('textbox', { name: 'Email address' }),
      'Ada@example.org',
    );
    await user.click(screen.getByRole('button', { name: 'Email me a reset link' }));

    await heading('Check your email');
    expect(sent.find(({ key }) => key === RESET_REQUEST)?.body).toEqual({
      email: 'ada@example.org',
    });
    expect(window.location.pathname).toBe('/northfield/forgot-password/sent');
  });

  it('says the same words whichever address was asked about', async () => {
    const texts: string[] = [];
    for (const address of ['has-account@example.org', 'unknown@example.org']) {
      const user = userEvent.setup();
      stubApi({ 'GET /auth/session': signedOut, [RESET_REQUEST]: { status: 202 } });
      const { unmount } = openConsole('/northfield/forgot-password');
      await user.type(await screen.findByRole('textbox', { name: 'Email address' }), address);
      await user.click(screen.getByRole('button', { name: 'Email me a reset link' }));
      await heading('Check your email');
      texts.push(screen.getByRole('main').textContent);
      unmount();
    }

    expect(texts[0]).toBe(texts[1]);
    expect(texts[0]).toContain('If that address has an account here');
    expect(texts[0]).toContain('The link works once, for 30 minutes');
    expect(texts[0]).not.toContain('example.org');
  });
});

describe('signed out', () => {
  it('says the session has ended, and offers to sign in again', async () => {
    stubApi({ 'GET /auth/session': signedOut });
    openConsole('/northfield/signed-out');

    await heading('You have signed out');

    expect(screen.getByRole('link', { name: 'Sign in again' }).getAttribute('href')).toBe(
      '/northfield/sign-in',
    );
  });

  it('is where "Sign out" leads, after the API ends the session', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      'GET /auth/session': { status: 200, body: consoleSession() },
      'POST /auth/sign-out': { status: 204 },
    });
    openConsole('/northfield/');
    await heading('Programmes');

    await user.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Sign out' }));

    await heading('You have signed out');
    expect(sent.map(({ key }) => key)).toContain('POST /auth/sign-out');
    expect(window.location.pathname).toBe('/northfield/signed-out');
  });

  it('stays signed in, and says so, when the API cannot be reached to sign out', async () => {
    const user = userEvent.setup();
    stubApi({
      'GET /auth/session': { status: 200, body: consoleSession() },
      'POST /auth/sign-out': problem(500, 'Failed.'),
    });
    openConsole('/northfield/');
    await heading('Programmes');

    await user.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(
      'We could not sign you out. Check your connection and try again.',
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Programmes' })).toBeTruthy();
  });
});
