// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What someone has typed and not saved is not lost when they leave the page or
// their session ends, and is not shown to anyone else.

import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { applicantSession, stubApi } from '../testing/api.ts';
import { ok, organisationList, profile, signedIn } from '../testing/party.ts';
import { openPortal, setUpPortalTests } from '../testing/render.tsx';

setUpPortalTests();

const SIGN_IN = 'POST /auth/tenants/northfield/sign-in';
const restored = 'We kept what you typed last time. Check it, then save.';
const heading = (name: string) => screen.findByRole('heading', { level: 1, name });
const firstName = () => screen.findByRole<HTMLInputElement>('textbox', { name: 'First name' });

const reads = {
  'GET /portal/profile': ok(profile()),
  'GET /portal/organisations': organisationList(),
};

describe('leaving a form without saving', () => {
  it('keeps what was typed, says so when the form opens again, and says it keeps it', async () => {
    const user = userEvent.setup();
    stubApi({ ...signedIn, ...reads });
    openPortal('/northfield/profile');
    const box = await firstName();
    expect(
      screen.getByText(
        'If you leave this page before you save, we keep what you typed until you close this window.',
      ),
    ).toBeTruthy();

    await user.type(box, ' Augusta');
    await user.click(screen.getByRole('link', { name: 'Apply for a grant' }));
    await heading('Apply for a grant');
    await user.click(await screen.findByRole('link', { name: /^Your details/ }));

    expect((await firstName()).value).toBe('Ada Augusta');
    expect(screen.getByText(restored)).toBeTruthy();
  });

  it('shows what is saved, with no notice, when nothing was typed', async () => {
    stubApi({ ...signedIn, ...reads });
    openPortal('/northfield/profile');

    expect((await firstName()).value).toBe('Ada');
    expect(screen.queryByText(restored)).toBeNull();
  });
});

describe('a session that ends while someone is typing', () => {
  async function typeUntilTheSessionEnds(email = 'ada@example.org') {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    stubApi({
      'GET /auth/session': { status: 200, body: applicantSession({ minutes: 10 }) },
      [SIGN_IN]: { status: 200, body: applicantSession({ email }) },
      ...reads,
    });
    openPortal('/northfield/profile');
    await user.type(await firstName(), ' Augusta');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    await heading('Sign in');
    expect(window.location.search).toBe('?next=%2Fprofile&notice=timeout');

    await user.type(screen.getByRole('textbox', { name: 'Email address' }), email);
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await heading('Your details');
  }

  it('is there again, with a notice, when the same person signs in', async () => {
    await typeUntilTheSessionEnds();

    expect((await firstName()).value).toBe('Ada Augusta');
    expect(screen.getByText(restored)).toBeTruthy();
    expect(window.location.pathname).toBe('/northfield/profile');
  });

  it('is not shown to someone else who signs in on the same device', async () => {
    await typeUntilTheSessionEnds('grace@example.org');

    expect((await firstName()).value).toBe('Ada');
    expect(screen.queryByText(restored)).toBeNull();
  });
});

describe('signing out', () => {
  it('forgets what was typed and not saved', async () => {
    const user = userEvent.setup();
    stubApi({
      ...signedIn,
      'POST /auth/sign-out': { status: 204 },
      [SIGN_IN]: { status: 200, body: applicantSession() },
      ...reads,
    });
    openPortal('/northfield/profile');
    await user.type(await firstName(), ' Augusta');

    await user.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Sign out' }));
    await heading('You have signed out');
    await user.click(screen.getByRole('link', { name: 'Sign in again' }));
    await user.type(
      await screen.findByRole('textbox', { name: 'Email address' }),
      'ada@example.org',
    );
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await heading('Apply for a grant');
    await user.click(await screen.findByRole('link', { name: /^Your details/ }));

    expect((await firstName()).value).toBe('Ada');
    expect(screen.queryByText(restored)).toBeNull();
  });
});
