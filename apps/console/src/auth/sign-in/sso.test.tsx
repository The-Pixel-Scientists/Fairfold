// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { consoleSession, signedOut, stubApi } from '../../testing/api.ts';
import { expectTitle, openConsole, setUpConsoleTests } from '../../testing/render.tsx';
import { leaveFor } from './leave.ts';
import { defaultReason, reasonText } from './SsoLandingPages.tsx';

setUpConsoleTests();

const START = 'POST /auth/tenants/northfield/sso/start';
const SESSION = 'GET /auth/session';

vi.mock('./leave.ts', () => ({ leaveFor: vi.fn() }));

async function startWith(reply: { status: number; body: unknown }) {
  const user = userEvent.setup();
  const sent = stubApi({ [SESSION]: signedOut, [START]: reply });
  const assign = vi.mocked(leaveFor);
  assign.mockClear();
  openConsole('/northfield/sign-in');
  await user.type(await screen.findByLabelText('Work email address'), 'ada@example.org');
  await user.click(
    screen.getByRole('button', { name: "Continue with your organisation's sign-in" }),
  );
  return { sent, assign };
}

describe('single sign-on on the sign-in page', () => {
  it('goes to the address the server gives, with the email only in the body', async () => {
    const { sent, assign } = await startWith({
      status: 200,
      body: { url: 'https://idp.example.org/authorize?x=1' },
    });
    await vi.waitFor(() => {
      expect(assign).toHaveBeenCalledWith('https://idp.example.org/authorize?x=1');
    });
    expect(sent.find(({ key }) => key === START)?.body).toEqual({ email: 'ada@example.org' });
  });

  it('stays on the page with the same words when no domain matches', async () => {
    const { assign } = await startWith({ status: 200, body: { url: null } });
    expect(await screen.findByText(/could not start single sign-on/)).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it('leaves the password form as it was', async () => {
    stubApi({ [SESSION]: signedOut });
    openConsole('/northfield/sign-in');
    expect(await screen.findByLabelText('Email address')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });
});

describe('the pages single sign-on lands on', () => {
  it('shows the failure words with a way back, and general words for an unknown reason', async () => {
    stubApi({ [SESSION]: signedOut });
    openConsole('/northfield/sign-in/sso/failed?reason=nonsense');
    expect(
      await screen.findByRole('heading', { name: 'Single sign-on did not work' }),
    ).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(defaultReason);
    expect(screen.getByRole('link', { name: 'Back to sign in' }).getAttribute('href')).toBe(
      '/northfield/sign-in',
    );
    expect(reasonText(null)).toBe(defaultReason);
    await expectTitle('Single sign-on did not work – Fairfold Grants console');
  });

  it('shows Signing you in, then goes on to the home page', async () => {
    stubApi({ [SESSION]: { status: 200, body: consoleSession() } });
    openConsole('/northfield/sign-in/sso');
    await vi.waitFor(() => {
      expect(window.location.pathname).not.toBe('/northfield/sign-in/sso');
    });
  });

  it('sends a person with no session to the failure page', async () => {
    stubApi({ [SESSION]: signedOut });
    openConsole('/northfield/sign-in/sso');
    expect(
      await screen.findByRole('heading', { name: 'Single sign-on did not work' }),
    ).toBeTruthy();
  });
});
