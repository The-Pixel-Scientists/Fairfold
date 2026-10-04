// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Signing up, signing in, MFA, password reset, staying signed in and
// switching funder, in a real browser, with the API's answers stubbed from
// the contracts (auth-api.ts). The same journeys run against the real API in
// auth-journey.spec.ts.

// The callbacks passed to page.evaluate run in the browser, so they use DOM types.
/// <reference lib="dom" />

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import {
  consoleSession,
  eastmere,
  northfield,
  problem,
  signedOut,
  stubApi,
  stubSignedIn,
} from './auth-api.ts';

const SUFFIX = '– Fairfold Grants console';
const TOKEN = 'tok_0123456789abcdefghijklmnopqrstuvwxyz';
const KEY = 'JBSWY3DPEHPK3PXP';
const URI = `otpauth://totp/Northfield:ada@example.org?secret=${KEY}&issuer=Northfield`;

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

test.describe('sign in', () => {
  test('signs in with a password, then a code, and opens the console', async ({ page }) => {
    let session: unknown = null;
    const sent = await stubApi(page, {
      'GET /auth/session': () => (session === null ? signedOut : { status: 200, body: session }),
      'POST /auth/tenants/northfield/sign-in': () => {
        session = consoleSession({ mfa: 'verify' });
        return { status: 200, body: session };
      },
      'POST /auth/totp/verify': () => {
        session = consoleSession();
        return { status: 200, body: session };
      },
    });

    await page.goto('/northfield/');
    await expect(h1(page, 'Sign in')).toBeFocused();
    await expect(page).toHaveTitle(`Sign in ${SUFFIX}`);
    await expect(page).toHaveURL(/\/northfield\/sign-in$/);

    await page.getByRole('textbox', { name: 'Email address' }).fill('Ada@Example.org');
    await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(h1(page, 'Enter your code')).toBeFocused();
    await expect(page).toHaveURL(/\/northfield\/enter-code$/);
    await page.getByLabel('Code from your app').fill('123456');
    await page.getByRole('button', { name: 'Confirm code' }).click();

    await expect(h1(page, 'Programmes')).toBeFocused();
    await expect(page).toHaveURL(/\/northfield\/$/);
    await expect(page).toHaveTitle(`Programmes ${SUFFIX}`);
    const banner = page.getByRole('banner');
    await expect(banner).toContainText('Northfield Foundation');
    await expect(banner).toContainText('ada@example.org');
    expect(sent.find(({ key }) => key.endsWith('/sign-in'))?.body).toEqual({
      email: 'ada@example.org',
      password: 'correct horse battery',
    });
  });

  test('works from the keyboard alone, with Enter to submit', async ({ page }) => {
    await stubApi(page, {
      'GET /auth/session': signedOut,
      'POST /auth/tenants/northfield/sign-in': { status: 200, body: consoleSession() },
    });
    await page.goto('/northfield/sign-in');
    await expect(h1(page, 'Sign in')).toBeVisible();

    // Skip link, then the fields in reading order.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('textbox', { name: 'Email address' })).toBeFocused();
    await page.keyboard.type('ada@example.org');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
    await page.keyboard.type('correct horse battery');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('checkbox', { name: 'Show password' })).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Enter');

    await expect(h1(page, 'Programmes')).toBeFocused();
  });

  test('sends a deep link to sign in, and back to the page afterwards', async ({ page }) => {
    await stubApi(page, {
      'GET /auth/session': signedOut,
      'POST /auth/tenants/northfield/sign-in': { status: 200, body: consoleSession() },
    });

    await page.goto('/northfield/somewhere/else');
    await expect(h1(page, 'Sign in')).toBeVisible();
    await expect(page).toHaveURL(/\/northfield\/sign-in\?next=%2Fsomewhere%2Felse$/);
    await page.getByRole('textbox', { name: 'Email address' }).fill('ada@example.org');
    await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(h1(page, 'Page not found')).toBeVisible();
    await expect(page).toHaveURL(/\/northfield\/somewhere\/else$/);
  });

  test('never leaves the console, whatever the link to sign in says', async ({ page }) => {
    await stubApi(page, {
      'GET /auth/session': signedOut,
      'POST /auth/tenants/northfield/sign-in': { status: 200, body: consoleSession() },
    });

    await page.goto('/northfield/sign-in?next=//evil.example/path');
    await page.getByRole('textbox', { name: 'Email address' }).fill('ada@example.org');
    await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(h1(page, 'Programmes')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/northfield/');
  });

  test('gives one message for a refused sign-in, and takes focus to the summary', async ({
    page,
  }) => {
    await stubApi(page, {
      'GET /auth/session': signedOut,
      'POST /auth/tenants/northfield/sign-in': problem(401, 'No account with that address.'),
    });
    await page.goto('/northfield/sign-in');
    await page.getByRole('textbox', { name: 'Email address' }).fill('nobody@example.org');
    await page.getByLabel('Password', { exact: true }).fill('wrong password here');

    await page.getByRole('button', { name: 'Sign in' }).click();

    const summary = page.getByRole('alert', { name: 'There is a problem' });
    await expect(summary).toBeFocused();
    await expect(summary.getByRole('link')).toHaveText(
      'The email address or password is not right. Check them and try again.',
    );
    await expect(page.getByText('No account')).toHaveCount(0);
  });

  test('says how long to wait after too many attempts', async ({ page }) => {
    await stubApi(page, {
      'GET /auth/session': signedOut,
      'POST /auth/tenants/northfield/sign-in': {
        ...problem(429, 'Slow down.'),
        headers: { 'retry-after': '30' },
      },
    });
    await page.goto('/northfield/sign-in');
    await page.getByRole('textbox', { name: 'Email address' }).fill('ada@example.org');
    await page.getByLabel('Password', { exact: true }).fill('correct horse battery');

    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('alert', { name: 'There is a problem' })).toContainText(
      'Too many attempts. Wait 30 seconds, then try again.',
    );
  });

  test('checks the fields before sending anything', async ({ page }) => {
    const sent = await stubApi(page, { 'GET /auth/session': signedOut });
    await page.goto('/northfield/sign-in');

    await page.getByRole('button', { name: 'Sign in' }).click();

    const summary = page.getByRole('alert', { name: 'There is a problem' });
    await expect(summary.getByRole('link')).toHaveCount(2);
    await expect(page.getByRole('textbox', { name: 'Email address' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    // Development runs effects twice, so the session may be read twice. Nothing else is sent.
    expect(new Set(sent.map(({ key }) => key))).toEqual(new Set(['GET /auth/session']));
  });

  test('says why, when the session ran out', async ({ page }) => {
    await stubApi(page, { 'GET /auth/session': signedOut });
    await page.goto('/northfield/sign-in?notice=timeout');

    await expect(
      page.getByText('You were signed out because your session ended. Sign in to carry on.'),
    ).toBeVisible();
  });
});

test.describe('create an account', () => {
  test('asks for an email address, then for a password from the emailed link', async ({ page }) => {
    const sent = await stubApi(page, {
      'GET /auth/session': signedOut,
      'POST /auth/tenants/northfield/sign-up': { status: 202 },
      'POST /auth/sign-up/complete': { status: 204 },
    });

    await page.goto('/northfield/sign-up');
    await page.getByRole('textbox', { name: 'Email address' }).fill('new@example.org');
    await page.getByRole('button', { name: 'Email me a link' }).click();
    await expect(h1(page, 'Check your email')).toBeFocused();
    await expect(page.getByText('The link works once, for 24 hours.')).toBeVisible();

    // The emailed link opens a page that has the token in its fragment.
    await page.goto(`/northfield/sign-up/complete#token=${TOKEN}`);
    await expect(h1(page, 'Set your password')).toBeVisible();
    await expect(page).toHaveURL(/\/northfield\/sign-up\/complete$/);
    expect(await page.evaluate(() => window.location.hash)).toBe('');
    expect(await page.evaluate(() => JSON.stringify(window.history.state))).not.toContain(TOKEN);
    expect(sent.filter(({ key }) => key === 'POST /auth/sign-up/complete')).toHaveLength(0);

    await page.getByLabel('Password', { exact: true }).fill('a long passphrase here');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(h1(page, 'Sign in')).toBeFocused();
    await expect(page).toHaveURL(/\/northfield\/sign-in\?notice=account-created$/);
    await expect(page.getByText('Your account is ready. Sign in to start.')).toBeVisible();
    expect(sent.find(({ key }) => key === 'POST /auth/sign-up/complete')?.body).toEqual({
      token: TOKEN,
      password: 'a long passphrase here',
    });
    // Nothing the page stored holds the token.
    const stored = await page.evaluate(() =>
      JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]),
    );
    expect(stored).not.toContain(TOKEN);
  });

  test('says the link does not work when the token is missing, as after a reload', async ({
    page,
  }) => {
    await stubApi(page, { 'GET /auth/session': signedOut });
    await page.goto(`/northfield/sign-up/complete#token=${TOKEN}`);
    await expect(h1(page, 'Set your password')).toBeVisible();

    await page.reload();

    await expect(h1(page, 'This link does not work')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ask for a new link' })).toHaveAttribute(
      'href',
      '/northfield/sign-up',
    );
  });
});

test.describe('reset a forgotten password', () => {
  test('asks for an address, says the same thing whatever it was, then sets a new password', async ({
    page,
  }) => {
    const sent = await stubApi(page, {
      'GET /auth/session': signedOut,
      'POST /auth/tenants/northfield/password-reset': { status: 202 },
      'POST /auth/password-reset/complete': { status: 204 },
    });

    await page.goto('/northfield/sign-in');
    await page.getByRole('link', { name: 'Forgot your password?' }).click();
    await expect(h1(page, 'Reset your password')).toBeFocused();
    await page.getByRole('textbox', { name: 'Email address' }).fill('anyone@example.org');
    await page.getByRole('button', { name: 'Email me a reset link' }).click();

    await expect(h1(page, 'Check your email')).toBeFocused();
    await expect(
      page.getByText('If that address has an account here, we have sent it a link'),
    ).toBeVisible();
    await expect(page.getByText('anyone@example.org')).toHaveCount(0);

    await page.goto(`/northfield/reset-password#token=${TOKEN}`);
    await expect(h1(page, 'Choose a new password')).toBeVisible();
    expect(await page.evaluate(() => window.location.hash)).toBe('');
    await page.getByLabel('Password', { exact: true }).fill('another long passphrase');
    await page.getByRole('button', { name: 'Save new password' }).click();

    await expect(h1(page, 'Sign in')).toBeFocused();
    await expect(
      page.getByText('Your password has changed. Sign in with your new password.'),
    ).toBeVisible();
    expect(sent.find(({ key }) => key === 'POST /auth/password-reset/complete')?.body).toEqual({
      token: TOKEN,
      password: 'another long passphrase',
    });
  });
});

test.describe('set up an authenticator app', () => {
  test('shows the key as text and finishes with the first code', async ({ page }) => {
    let session: unknown = consoleSession({ mfa: 'enrol' });
    const sent = await stubApi(page, {
      'GET /auth/session': () => ({ status: 200, body: session }),
      'POST /auth/totp/enrol': { status: 200, body: { key: KEY, uri: URI } },
      'POST /auth/totp/confirm': () => {
        session = consoleSession();
        return { status: 200, body: session };
      },
    });

    await page.goto('/northfield/set-up-authenticator');

    await expect(h1(page, 'Set up your authenticator app')).toBeVisible();
    await expect(page.getByText('JBSW Y3DP EHPK 3PXP')).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Open in your authenticator app' }),
    ).toHaveAttribute('href', URI);
    expect(sent.filter(({ key }) => key === 'POST /auth/totp/enrol')).toHaveLength(1);
    expect(page.url()).not.toContain(KEY);

    await page.getByLabel('Code from your app').fill('123456');
    await page.getByRole('button', { name: 'Finish set-up' }).click();

    await expect(h1(page, 'Programmes')).toBeFocused();
  });

  test('gives one message for a wrong code, and keeps the key on the page', async ({ page }) => {
    await stubApi(page, {
      'GET /auth/session': { status: 200, body: consoleSession({ mfa: 'enrol' }) },
      'POST /auth/totp/enrol': { status: 200, body: { key: KEY, uri: URI } },
      'POST /auth/totp/confirm': problem(401, 'Code already used.'),
    });
    await page.goto('/northfield/set-up-authenticator');
    await page.getByLabel('Code from your app').fill('123456');

    await page.getByRole('button', { name: 'Finish set-up' }).click();

    const summary = page.getByRole('alert', { name: 'There is a problem' });
    await expect(summary).toBeFocused();
    await expect(summary).toContainText('That code is not right.');
    await expect(page.getByText('JBSW Y3DP EHPK 3PXP')).toBeVisible();
  });
});

test.describe('the console shell', () => {
  test('shows the funder, the person and the pages their permissions open', async ({ page }) => {
    await stubSignedIn(page);
    await page.goto('/northfield/');

    await expect(h1(page, 'Programmes')).toBeVisible();
    await expect(page.getByRole('banner')).toContainText('Northfield Foundation');
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveText([
      'Programmes',
    ]);
    await expect(page.getByRole('button', { name: 'Switch funder' })).toHaveCount(0);
  });

  test('leaves out pages the person has no permission for', async ({ page }) => {
    await stubSignedIn(page, { permissions: ['grants.reviews.score'] });
    await page.goto('/northfield/');

    await expect(h1(page, 'Programmes')).toBeVisible();
    await expect(page.getByRole('navigation')).toHaveCount(0);
  });

  test('signs out, and lands on the signed-out page', async ({ page }) => {
    let signedIn = true;
    const sent = await stubApi(page, {
      'GET /auth/session': () => (signedIn ? { status: 200, body: consoleSession() } : signedOut),
      'POST /auth/sign-out': () => {
        signedIn = false;
        return { status: 204 };
      },
    });
    await page.goto('/northfield/');
    await expect(h1(page, 'Programmes')).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();

    await expect(h1(page, 'You have signed out')).toBeFocused();
    await expect(page).toHaveURL(/\/northfield\/signed-out$/);
    await expect(page.getByRole('link', { name: 'Sign in again' })).toBeVisible();
    expect(sent.map(({ key }) => key)).toContain('POST /auth/sign-out');
  });

  test('switches funder: asks the API, then opens the new funder address', async ({ page }) => {
    let active = northfield;
    const sent = await stubSignedIn(
      page,
      {},
      {
        'GET /auth/session': () => ({
          status: 200,
          body: consoleSession({ active, memberships: [northfield, eastmere] }),
        }),
        'POST /auth/switch-tenant': () => {
          active = eastmere;
          return {
            status: 200,
            body: consoleSession({ active, memberships: [northfield, eastmere] }),
          };
        },
      },
    );
    await page.goto('/northfield/');
    await expect(h1(page, 'Programmes')).toBeVisible();

    await page.getByRole('button', { name: 'Switch funder' }).click();
    const dialog = page.getByRole('dialog', { name: 'Switch funder' });
    await expect(page.getByRole('button', { name: 'Switch to Eastmere Trust' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Switch to Eastmere Trust' }).click();

    await expect(page).toHaveURL(/\/eastmere\/$/);
    // Switching reloads the page, which a dev server can take several seconds over.
    await expect(page.getByRole('banner')).toContainText('Eastmere Trust', { timeout: 15_000 });
    expect(sent.find(({ key }) => key === 'POST /auth/switch-tenant')?.body).toEqual({
      membershipId: eastmere.id,
    });
  });

  test('closes the switch dialog with Escape and gives focus back to its button', async ({
    page,
  }) => {
    await stubSignedIn(page, { memberships: [northfield, eastmere] });
    await page.goto('/northfield/');
    await expect(h1(page, 'Programmes')).toBeVisible();
    const opener = page.getByRole('button', { name: 'Switch funder' });

    await opener.click();
    await expect(page.getByRole('dialog', { name: 'Switch funder' })).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test('tells a signed-in person with no membership here that they have no access', async ({
    page,
  }) => {
    await stubSignedIn(page, { active: null, memberships: [eastmere] });
    await page.goto('/northfield/');

    await expect(h1(page, 'You do not have access to northfield')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Switch to Eastmere Trust' })).toBeVisible();
    await expect(page.getByRole('navigation')).toHaveCount(0);
  });
});

test.describe('staying signed in', () => {
  // The page's clock starts at START and then runs at the speed of the real one, so a
  // time "in N minutes" is worked out from how long the clock has been running.
  const START = new Date('2026-10-05T09:00:00Z');
  let installedAt = 0;
  const inMinutes = (minutes: number) =>
    new Date(START.getTime() + (Date.now() - installedAt) + minutes * 60_000).toISOString();

  test.beforeEach(async ({ page }) => {
    installedAt = Date.now();
    await page.clock.install({ time: START });
  });

  test('warns two minutes before the session ends, and "Stay signed in" reads the session again', async ({
    page,
  }) => {
    // The session ends in 5 minutes unless the person says they are still there.
    let staying = false;
    const sent = await stubApi(page, {
      'GET /auth/session': () => ({
        status: 200,
        body: consoleSession({ expiresAt: inMinutes(staying ? 35 : 5) }),
      }),
    });
    await page.goto('/northfield/');
    await expect(h1(page, 'Programmes')).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).focus();

    await page.clock.fastForward('03:00');

    const dialog = page.getByRole('dialog', { name: 'You will be signed out soon' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Stay signed in' })).toBeFocused();
    await expect(dialog.getByRole('status')).toHaveText('You will be signed out in 2 minutes.');
    await page.clock.runFor('00:35');
    await expect(dialog.getByRole('status')).toHaveText(
      'You will be signed out in 1 minute 30 seconds.',
    );

    const readsBefore = sent.length;
    staying = true;
    await dialog.getByRole('button', { name: 'Stay signed in' }).click();

    await expect(dialog).toHaveCount(0);
    expect(sent.length).toBe(readsBefore + 1);
    expect(sent.at(-1)?.key).toBe('GET /auth/session');
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeFocused();
  });

  test('signs the person out when time runs out, and the sign-in page says why', async ({
    page,
  }) => {
    await stubApi(page, {
      'GET /auth/session': () => ({
        status: 200,
        body: consoleSession({ expiresAt: inMinutes(5) }),
      }),
    });
    await page.goto('/northfield/');
    await expect(h1(page, 'Programmes')).toBeVisible();
    await page.clock.fastForward('03:00');
    await expect(page.getByRole('dialog', { name: 'You will be signed out soon' })).toBeVisible();

    await page.clock.runFor('02:05');

    await expect(h1(page, 'Sign in')).toBeVisible();
    await expect(page).toHaveURL(/\/northfield\/sign-in\?notice=timeout$/);
    await expect(
      page.getByText('You were signed out because your session ended. Sign in to carry on.'),
    ).toBeVisible();
  });
});

test.describe('outside a funder', () => {
  test('says to use the funder link at the root', async ({ page }) => {
    await page.goto('/');

    await expect(h1(page, "Use your funder's link")).toBeVisible();
    await expect(page).toHaveTitle(`Use your funder's link ${SUFFIX}`);
    await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0);
  });
});
