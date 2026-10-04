// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { applicantSession, problem, signedOut, stubApi } from '../testing/api.ts';
import type { Reply } from '../testing/api.ts';
import { expectTitle, openPortal, setUpPortalTests } from '../testing/render.tsx';

setUpPortalTests();

const SIGN_IN = 'POST /auth/tenants/northfield/sign-in';
const heading = (name: string) => screen.findByRole('heading', { level: 1, name });

async function fillIn(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByRole('textbox', { name: 'Email address' }), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('the sign-in page', () => {
  it('asks for an email address and a password, and offers the other ways in', async () => {
    stubApi({ 'GET /auth/session': signedOut });
    openPortal('/northfield/sign-in');

    await heading('Sign in');
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
    await expectTitle('Sign in – Fairfold Grants');
  });

  it('shows the password when asked, and hides it again', async () => {
    const user = userEvent.setup();
    stubApi({ 'GET /auth/session': signedOut });
    openPortal('/northfield/sign-in');
    const password = await screen.findByLabelText('Password');

    await user.click(screen.getByRole('checkbox', { name: 'Show password' }));
    expect(password.getAttribute('type')).toBe('text');
    await user.click(screen.getByRole('checkbox', { name: 'Show password' }));
    expect(password.getAttribute('type')).toBe('password');
  });

  it('signs in with the address and password, for the funder the address names', async () => {
    const sent = stubApi({
      'GET /auth/session': signedOut,
      [SIGN_IN]: { status: 200, body: applicantSession() },
    });
    openPortal('/northfield/sign-in');

    await fillIn('Ada@Example.org ', 'correct horse battery');

    expect(await heading('Apply for a grant')).toBeTruthy();
    expect(sent.find(({ key }) => key === SIGN_IN)?.body).toEqual({
      email: 'ada@example.org',
      password: 'correct horse battery',
    });
    expect(window.location.pathname).toBe('/northfield/');
    expect(
      screen.getByText('You are signed in. You have not started an application yet.'),
    ).toBeTruthy();
  });

  it('says it is signing in while the request is on its way, and keeps focus on the button', async () => {
    const user = userEvent.setup();
    let answer: (reply: Reply) => void = () => undefined;
    stubApi({
      'GET /auth/session': signedOut,
      [SIGN_IN]: () =>
        new Promise<Reply>((resolve) => {
          answer = resolve;
        }),
    });
    openPortal('/northfield/sign-in');
    await user.type(
      await screen.findByRole('textbox', { name: 'Email address' }),
      'ada@example.org',
    );
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const button = await screen.findByRole('button', { name: 'Signing in…' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(button);
    answer({ status: 200, body: applicantSession() });
    expect(await heading('Apply for a grant')).toBeTruthy();
  });
});

describe('sending people to sign in, and back', () => {
  it('sends someone who is already signed in from the sign-in page to the funder page', async () => {
    stubApi({ 'GET /auth/session': { status: 200, body: applicantSession() } });
    openPortal('/northfield/sign-in');

    expect(await heading('Apply for a grant')).toBeTruthy();
    expect(window.location.pathname).toBe('/northfield/');
  });

  it('goes to the page named in `next` after sign in', async () => {
    stubApi({
      'GET /auth/session': signedOut,
      [SIGN_IN]: { status: 200, body: applicantSession() },
    });
    openPortal('/northfield/sign-in?next=%2Fdoes-not-exist');

    await fillIn('ada@example.org', 'correct horse battery');

    expect(await heading('Page not found')).toBeTruthy();
    expect(window.location.pathname).toBe('/northfield/does-not-exist');
  });

  it('never goes anywhere but a page inside the portal, whatever `next` says', async () => {
    stubApi({
      'GET /auth/session': signedOut,
      [SIGN_IN]: { status: 200, body: applicantSession() },
    });
    openPortal('/northfield/sign-in?next=//evil.example/path');

    await fillIn('ada@example.org', 'correct horse battery');

    expect(await heading('Apply for a grant')).toBeTruthy();
    expect(window.location.origin).toBe('http://localhost:3000');
    expect(window.location.pathname).toBe('/northfield/');
  });
});

describe('sign-in errors', () => {
  it('checks the fields before sending anything, and puts each message beside its field', async () => {
    const user = userEvent.setup();
    const sent = stubApi({ 'GET /auth/session': signedOut });
    openPortal('/northfield/sign-in');
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
    openPortal('/northfield/sign-in');

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
    openPortal('/northfield/sign-in');

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
    openPortal('/northfield/sign-in');

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
    [
      'timeout',
      'You were signed out because you had not used the page for a while. Anything you saved is still there. Sign in to carry on.',
    ],
    ['account-created', 'Your account is ready. Sign in to get started.'],
    ['password-reset', 'Your password has changed. Sign in with your new password.'],
  ])('says so for %s', async (notice, words) => {
    stubApi({ 'GET /auth/session': signedOut });
    openPortal(`/northfield/sign-in?notice=${notice}`);

    expect(await screen.findByText(words)).toBeTruthy();
  });

  it('says nothing for a notice it does not know', async () => {
    stubApi({ 'GET /auth/session': signedOut });
    openPortal('/northfield/sign-in?notice=%3Cb%3Ehello');

    await heading('Sign in');
    expect(screen.queryByText(/hello/)).toBeNull();
  });
});
