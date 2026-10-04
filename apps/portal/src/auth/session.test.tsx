// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { applicantSession, eastmere, problem, signedOut, stubApi } from '../testing/api.ts';
import { expectTitle, openPortal, setUpPortalTests } from '../testing/render.tsx';

setUpPortalTests();

const heading = (name: string) => screen.findByRole('heading', { level: 1, name });
const session = (body: unknown) => ({ 'GET /auth/session': { status: 200, body } });

describe("a funder's start page for a visitor", () => {
  it('offers to create an account or sign in, and says what is needed', async () => {
    stubApi({ 'GET /auth/session': signedOut });
    openPortal('/northfield/');

    await heading('Apply for a grant');

    expect(screen.getByRole('link', { name: 'Create an account' }).getAttribute('href')).toBe(
      '/northfield/sign-up',
    );
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe(
      '/northfield/sign-in',
    );
    expect(
      screen.getByText('Setting up takes a few minutes. You only need your email address.'),
    ).toBeTruthy();
    expect(window.location.pathname).toBe('/northfield/');
    await expectTitle('Apply for a grant – Fairfold Grants');
  });

  it('links to how applying works, which is outside the funder, as a plain link', async () => {
    stubApi({ 'GET /auth/session': signedOut });
    openPortal('/northfield');

    await heading('Apply for a grant');

    expect(screen.getByRole('link', { name: 'Read how applying works' }).getAttribute('href')).toBe(
      '/how-applying-works',
    );
  });

  it('has no navigation landmark and no sign-out button for someone who is not signed in', async () => {
    stubApi({ 'GET /auth/session': signedOut });
    openPortal('/northfield/');

    await heading('Apply for a grant');

    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('moves to the sign-up page from the first button, with focus on its heading', async () => {
    const user = userEvent.setup();
    stubApi({ 'GET /auth/session': signedOut });
    openPortal('/northfield/');
    await heading('Apply for a grant');

    await user.click(screen.getByRole('link', { name: 'Create an account' }));

    const next = await heading('Create your account');
    await waitFor(() => {
      expect(document.activeElement).toBe(next);
    });
    expect(window.location.pathname).toBe('/northfield/sign-up');
  });
});

describe('checking the session', () => {
  it('says one moment while it checks', async () => {
    let finish: () => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      () =>
        new Promise<Response>((resolve) => {
          finish = () => {
            resolve(new Response(JSON.stringify(applicantSession()), { status: 200 }));
          };
        }),
    );
    openPortal('/northfield/');

    expect(await heading('One moment')).toBeTruthy();
    expect(within(screen.getByRole('main')).getByRole('status').textContent).toBe('Loading…');
    finish();
    expect(await heading('Apply for a grant')).toBeTruthy();
    expect(
      screen.getByText('You are signed in. You have not started an application yet.'),
    ).toBeTruthy();
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
    openPortal('/northfield/');

    expect(await heading('We could not connect')).toBeTruthy();
    expect(screen.getByRole('main').textContent).not.toMatch(/administrator|sorry|error/i);
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await heading('Apply for a grant')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create an account' })).toBeTruthy();
  });
});

describe('a signed-in applicant', () => {
  it('sees who is signed in, a sign-out button, and that no grants are open', async () => {
    stubApi(session(applicantSession()));
    openPortal('/northfield/');

    await heading('Apply for a grant');

    const banner = screen.getByRole('banner');
    expect(within(banner).getByText('ada@example.org')).toBeTruthy();
    expect(within(banner).getByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'No grants are open yet' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Create an account' })).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('is sent to sign in, with a reason, when the session runs out', async () => {
    stubApi(session(applicantSession({ minutes: 0.02 })));
    openPortal('/northfield/');

    // The warning dialog shows first, since under two minutes are left, and hides the page behind it.
    expect(await heading('Sign in')).toBeTruthy();

    expect(window.location.search).toBe('?notice=timeout');
    expect(screen.getByText(/Anything you saved is still there/)).toBeTruthy();
  });
});

describe('a signed-in person with no applicant membership here', () => {
  it.each([
    ['no membership anywhere', null],
    ['a membership with another funder', eastmere],
  ])('is told the account cannot apply, and can sign out (%s)', async (_name, active) => {
    const user = userEvent.setup();
    const sent = stubApi({
      ...session(applicantSession({ active })),
      'POST /auth/sign-out': { status: 204 },
    });
    openPortal('/northfield/');

    await heading('This account cannot apply to this funder');

    expect(screen.getByRole('main').textContent).toContain('ada@example.org');
    expect(screen.queryByRole('heading', { name: 'No grants are open yet' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Create an account' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await heading('You have signed out');
    expect(sent.map(({ key }) => key)).toContain('POST /auth/sign-out');
  });

  it('says the same on every page of the funder, not only the first', async () => {
    stubApi(session(applicantSession({ active: null })));
    openPortal('/northfield/no-such-page');

    expect(await heading('This account cannot apply to this funder')).toBeTruthy();
  });
});

describe('a page the funder does not have', () => {
  it('says so, and offers a way back to the funder start page', async () => {
    stubApi({ 'GET /auth/session': signedOut });
    openPortal('/northfield/no-such-page');

    expect(await heading('Page not found')).toBeTruthy();
    await expectTitle('Page not found – Fairfold Grants');
    expect(screen.getByRole('link', { name: 'Go to the home page' }).getAttribute('href')).toBe(
      '/northfield/',
    );
    expect(window.location.pathname).toBe('/northfield/no-such-page');
  });
});

describe('staying signed in', () => {
  it('warns two minutes before the session ends, with a way to stay signed in or sign out', async () => {
    stubApi(session(applicantSession({ minutes: 1.5 })));
    openPortal('/northfield/');

    const dialog = await screen.findByRole('dialog', { name: 'You will be signed out soon' });

    expect(within(dialog).getByRole('button', { name: 'Stay signed in' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(within(dialog).getByRole('status').textContent).toBe(
      'You will be signed out in 1 minute 30 seconds.',
    );
  });

  it('does not warn while there is more than two minutes left', async () => {
    stubApi(session(applicantSession({ minutes: 60 })));
    openPortal('/northfield/');

    await heading('Apply for a grant');

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
