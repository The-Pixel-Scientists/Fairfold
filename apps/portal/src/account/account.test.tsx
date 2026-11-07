// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { applicantSession, problem, signedOut, stubApi } from '../testing/api.ts';
import { openPortal, setUpPortalTests } from '../testing/render.tsx';

setUpPortalTests();

const heading = (name: string) => screen.findByRole('heading', { level: 1, name });
const token = 'a'.repeat(43);
const CHANGE = 'POST /auth/email-change/complete';
const isChange = ({ key }: { key: string }) => key === CHANGE;
const session = { status: 200, body: applicantSession() };

describe('your account', () => {
  it('lists the sign-in email, the password and extra security', async () => {
    stubApi({
      'GET /auth/session': session,
      'GET /auth/passkeys': { status: 200, body: { passkeys: [] } },
    });
    openPortal('/northfield/account');

    await heading('Your account');

    expect(await screen.findByText('ada@example.org', { selector: 'dd span' })).toBeTruthy();
    expect(screen.getByText('Extra security (optional)')).toBeTruthy();
    expect(screen.getByText('Not set up. You can use the account without it.')).toBeTruthy();
  });

  it('sends someone who is not signed in to sign in, and back afterwards', async () => {
    stubApi({ 'GET /auth/session': signedOut });
    openPortal('/northfield/account');

    await heading('Sign in');

    expect(window.location.pathname + window.location.search).toBe(
      '/northfield/sign-in?next=%2Faccount',
    );
  });

  it('offers to try again when the passkeys cannot be read', async () => {
    stubApi({
      'GET /auth/session': session,
      'GET /auth/passkeys': problem(500, 'Failed.'),
    });
    openPortal('/northfield/account');

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('the email change link', () => {
  it('changes nothing until the button is pressed, and takes the token out of the address', async () => {
    const sent = stubApi({
      'GET /auth/session': signedOut,
      'POST /auth/email-change/complete': { status: 204 },
    });
    openPortal(`/northfield/email-change#token=${token}`);

    await heading('Confirm your new email address');

    expect(window.location.hash).toBe('');
    expect(sent.filter(isChange)).toHaveLength(0);

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Confirm new email address' }));

    await heading('Your email address has changed');
    expect(screen.getByText('Anywhere else you were signed in has been signed out.')).toBeTruthy();
    expect(sent.filter(isChange)).toEqual([{ key: CHANGE, body: { token } }]);
  });

  it('says the link does not work when it has no token', async () => {
    const sent = stubApi({ 'GET /auth/session': signedOut });
    openPortal('/northfield/email-change');

    await heading('This link does not work');

    expect(sent.filter(isChange)).toHaveLength(0);
  });

  it('shows what the server says when the link was used or has expired', async () => {
    stubApi({
      'GET /auth/session': signedOut,
      'POST /auth/email-change/complete': problem(400, 'This link has expired or been used.'),
    });
    openPortal(`/northfield/email-change#token=${token}`);
    await heading('Confirm your new email address');

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Confirm new email address' }));

    await waitFor(() => {
      expect(screen.getAllByText('This link has expired or been used.').length).toBeGreaterThan(0);
    });
    expect(screen.getByRole('button', { name: 'Confirm new email address' })).toBeTruthy();
  });
});
