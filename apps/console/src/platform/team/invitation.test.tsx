// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { consoleSession, problem, signedOut, stubApi } from '../../testing/api.ts';
import type { Reply } from '../../testing/api.ts';
import { expectTitle, openConsole, setUpConsoleTests } from '../../testing/render.tsx';
import { SESSION, administrator, ok } from '../settings/testing.ts';

setUpConsoleTests();

const ACCEPT = 'POST /auth/invitations/accept';
const TOKEN = 'tok_0123456789abcdefghijklmnopqrstuvwxyz';
const heading = (name: string) => screen.findByRole('heading', { level: 1, name });

function openInvitation(handlers: Record<string, Reply>, hash = `#token=${TOKEN}`) {
  const sent = stubApi(handlers);
  openConsole(`/northfield/invitation${hash}`);
  return sent;
}

describe('the invitation page, signed out', () => {
  it('says to create an account or sign in with the invited address first, then open the link again', async () => {
    const sent = openInvitation({ [SESSION]: signedOut });

    await heading('Join Northfield Foundation');

    expect(screen.getByText(/create an account or sign in/)).toBeTruthy();
    expect(screen.getByText(/open the link in your invitation email again/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create an account' }).getAttribute('href')).toBe(
      '/northfield/sign-up',
    );
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe(
      '/northfield/sign-in',
    );
    expect(sent.map(({ key }) => key)).toEqual([SESSION]);
    await expectTitle('Accept your invitation – Fairfold Grants console');
  });

  it('keeps the token in the page only: out of the address, the links and storage', async () => {
    openInvitation({ [SESSION]: signedOut });
    await heading('Join Northfield Foundation');

    expect(window.location.href).not.toContain(TOKEN);
    expect(window.location.hash).toBe('');
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href') ?? '').not.toContain(TOKEN);
    }
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('says the link is not valid when it has no token', async () => {
    openInvitation({ [SESSION]: signedOut }, '');
    expect(await heading('This invitation link is not valid')).toBe(document.activeElement);
    expect(screen.getByText(/Ask the person who invited you for a new invitation/)).toBeTruthy();
  });

  it('says the link is not valid for a token of the wrong shape, and sends nothing', async () => {
    const sent = openInvitation({ [SESSION]: ok(administrator()) }, '#token=short');

    expect(await heading('This invitation link is not valid')).toBeTruthy();
    expect(sent.map(({ key }) => key)).not.toContain(ACCEPT);
  });
});

describe('the invitation page, signed in', () => {
  it('names the address and accepts with the token, then opens the console', async () => {
    const user = userEvent.setup();
    const sent = openInvitation({
      [SESSION]: ok(consoleSession({ active: null })),
      [ACCEPT]: ok(administrator()),
    });

    await heading('Accept your invitation');
    expect(screen.getByText('ada@example.org')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));

    await waitFor(() => {
      expect(window.location.pathname).toBe('/northfield/');
    });
    expect(sent.find(({ key }) => key === ACCEPT)?.body).toEqual({ token: TOKEN });
  });

  it('says the link is not valid when the token is refused, and to ask for a new invitation', async () => {
    const user = userEvent.setup();
    openInvitation({
      [SESSION]: ok(consoleSession({ active: null })),
      [ACCEPT]: problem(404, 'Not found.'),
    });

    await heading('Accept your invitation');
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));

    expect(await heading('This invitation link is not valid')).toBe(document.activeElement);
    expect(screen.getByText(/Ask the person who invited you for a new invitation/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Accept invitation' })).toBeNull();
    expect(window.location.pathname).toBe('/northfield/invitation');
  });

  it('says what went wrong when the service fails, and lets them try again', async () => {
    const user = userEvent.setup();
    openInvitation({
      [SESSION]: ok(consoleSession({ active: null })),
      [ACCEPT]: problem(503, 'The service is busy. Try again in a minute.'),
    });

    await heading('Accept your invitation');
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));

    expect(await screen.findByText('The service is busy. Try again in a minute.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accept invitation' })).toBeTruthy();
  });

  it('offers to sign out, for someone signed in with the wrong address', async () => {
    const user = userEvent.setup();
    stubApi({
      [SESSION]: ok(consoleSession({ active: null })),
      'POST /auth/sign-out': { status: 204 },
    });
    openConsole(`/northfield/invitation#token=${TOKEN}`);

    await heading('Accept your invitation');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await heading('Join Northfield Foundation')).toBeTruthy();
    expect(
      within(screen.getByRole('main')).getByRole('link', { name: 'Create an account' }),
    ).toBeTruthy();
  });

  it('says to finish signing in first, when the authenticator app is still to set up', async () => {
    openInvitation({ [SESSION]: ok(consoleSession({ mfa: 'enrol' })) });

    await heading('Join Northfield Foundation');

    expect(screen.getByText(/finish signing in before you can accept/)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Set up your authenticator app' }).getAttribute('href'),
    ).toBe('/northfield/set-up-authenticator');
  });

  it('says it could not check the session, and offers to try again', async () => {
    openInvitation({ [SESSION]: problem(503, 'The service is busy.') });

    expect(await heading('We could not check your session')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
