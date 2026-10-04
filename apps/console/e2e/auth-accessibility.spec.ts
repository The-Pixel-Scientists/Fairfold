// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for every sign-in screen and state, at desktop width, at 320 px
// wide and at 200% zoom (ADR 0006), with the API stubbed from the contracts.

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
import { expectNoHorizontalScroll, expectNoViolations, widths } from './auth-axe.ts';

const TOKEN = 'tok_0123456789abcdefghijklmnopqrstuvwxyz';
const KEY = 'JBSWY3DPEHPK3PXP';
const URI = `otpauth://totp/Northfield:ada@example.org?secret=${KEY}&issuer=Northfield`;

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const summary = (page: Page) => page.getByRole('alert', { name: 'There is a problem' });

/** The API as a signed-out visitor sees it, with the answers each screen needs. */
function visitor(page: Page, more = {}) {
  return stubApi(page, {
    'GET /auth/session': signedOut,
    'POST /auth/tenants/northfield/sign-in': problem(401, 'Not right.'),
    'POST /auth/totp/enrol': { status: 200, body: { key: KEY, uri: URI } },
    ...more,
  });
}

/** A signed-in person who has to finish MFA first. */
function pending(page: Page, mfa: 'enrol' | 'verify') {
  return stubApi(page, {
    'GET /auth/session': { status: 200, body: consoleSession({ mfa }) },
    'POST /auth/totp/enrol': { status: 200, body: { key: KEY, uri: URI } },
    'POST /auth/totp/confirm': problem(401, 'Not right.'),
    'POST /auth/totp/verify': problem(401, 'Not right.'),
  });
}

interface Screen {
  name: string;
  /** Sets the screen up and waits until it is showing. */
  open: (page: Page) => Promise<void>;
}

const screens: Screen[] = [
  {
    name: 'checking the session',
    open: async (page) => {
      await page.route(
        (url) => url.pathname === '/api/auth/session',
        () => undefined,
      );
      await page.goto('/northfield/sign-in');
      await expect(h1(page, 'Checking your session')).toBeVisible();
    },
  },
  {
    name: 'session could not be read',
    open: async (page) => {
      await stubApi(page, { 'GET /auth/session': problem(503, 'Try again later.') });
      await page.goto('/northfield/sign-in');
      await expect(h1(page, 'We could not check your session')).toBeVisible();
    },
  },
  {
    name: 'sign in',
    open: async (page) => {
      await visitor(page);
      await page.goto('/northfield/sign-in');
      await expect(h1(page, 'Sign in')).toBeVisible();
    },
  },
  {
    name: 'sign in after the session ran out',
    open: async (page) => {
      await visitor(page);
      await page.goto('/northfield/sign-in?notice=timeout');
      await expect(page.getByText('You were signed out because your session ended')).toBeVisible();
    },
  },
  {
    name: 'sign in with field errors',
    open: async (page) => {
      await visitor(page);
      await page.goto('/northfield/sign-in');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(summary(page).getByRole('link')).toHaveCount(2);
    },
  },
  {
    name: 'sign in refused',
    open: async (page) => {
      await visitor(page);
      await page.goto('/northfield/sign-in');
      await page.getByRole('textbox', { name: 'Email address' }).fill('ada@example.org');
      await page.getByLabel('Password', { exact: true }).fill('wrong password here');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(summary(page)).toContainText('The email address or password is not right.');
    },
  },
  {
    name: 'sign in with the password shown',
    open: async (page) => {
      await visitor(page);
      await page.goto('/northfield/sign-in');
      await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
      await page.getByRole('checkbox', { name: 'Show password' }).check();
      await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
    },
  },
  {
    name: 'create an account',
    open: async (page) => {
      await visitor(page);
      await page.goto('/northfield/sign-up');
      await expect(h1(page, 'Create your account')).toBeVisible();
    },
  },
  {
    name: 'create an account with an error',
    open: async (page) => {
      await visitor(page);
      await page.goto('/northfield/sign-up');
      await page.getByRole('button', { name: 'Email me a link' }).click();
      await expect(summary(page).getByRole('link')).toHaveCount(1);
    },
  },
  {
    name: 'check your email after signing up',
    open: async (page) => {
      await visitor(page);
      await page.goto('/northfield/sign-up/check-email');
      await expect(h1(page, 'Check your email')).toBeVisible();
    },
  },
  {
    name: 'set your password from the emailed link',
    open: async (page) => {
      await visitor(page);
      await page.goto(`/northfield/sign-up/complete#token=${TOKEN}`);
      await expect(h1(page, 'Set your password')).toBeVisible();
    },
  },
  {
    name: 'set your password with an error',
    open: async (page) => {
      await visitor(page);
      await page.goto(`/northfield/sign-up/complete#token=${TOKEN}`);
      await page.getByLabel('Password', { exact: true }).fill('short');
      await page.getByRole('button', { name: 'Create account' }).click();
      await expect(summary(page)).toContainText('Enter a password of at least 12 characters.');
    },
  },
  {
    name: 'sign-up link that does not work',
    open: async (page) => {
      await visitor(page);
      await page.goto('/northfield/sign-up/complete');
      await expect(h1(page, 'This link does not work')).toBeVisible();
    },
  },
  {
    name: 'reset your password',
    open: async (page) => {
      await visitor(page);
      await page.goto('/northfield/forgot-password');
      await expect(h1(page, 'Reset your password')).toBeVisible();
    },
  },
  {
    name: 'reset your password with an error',
    open: async (page) => {
      await visitor(page);
      await page.goto('/northfield/forgot-password');
      await page.getByRole('button', { name: 'Email me a reset link' }).click();
      await expect(summary(page).getByRole('link')).toHaveCount(1);
    },
  },
  {
    name: 'check your email after asking for a reset',
    open: async (page) => {
      await visitor(page);
      await page.goto('/northfield/forgot-password/sent');
      await expect(h1(page, 'Check your email')).toBeVisible();
    },
  },
  {
    name: 'choose a new password from the emailed link',
    open: async (page) => {
      await visitor(page);
      await page.goto(`/northfield/reset-password#token=${TOKEN}`);
      await expect(h1(page, 'Choose a new password')).toBeVisible();
    },
  },
  {
    name: 'choose a new password with an error',
    open: async (page) => {
      await visitor(page);
      await page.goto(`/northfield/reset-password#token=${TOKEN}`);
      await page.getByRole('button', { name: 'Save new password' }).click();
      await expect(summary(page)).toContainText('Enter a password of at least 12 characters.');
    },
  },
  {
    name: 'reset link that does not work',
    open: async (page) => {
      await visitor(page);
      await page.goto('/northfield/reset-password');
      await expect(h1(page, 'This link does not work')).toBeVisible();
    },
  },
  {
    name: 'signed out',
    open: async (page) => {
      await visitor(page);
      await page.goto('/northfield/signed-out');
      await expect(h1(page, 'You have signed out')).toBeVisible();
    },
  },
  {
    name: 'set up an authenticator app',
    open: async (page) => {
      await pending(page, 'enrol');
      await page.goto('/northfield/set-up-authenticator');
      await expect(page.getByText('JBSW Y3DP EHPK 3PXP')).toBeVisible();
    },
  },
  {
    name: 'set up an authenticator app with a wrong code',
    open: async (page) => {
      await pending(page, 'enrol');
      await page.goto('/northfield/set-up-authenticator');
      await page.getByLabel('Code from your app').fill('123456');
      await page.getByRole('button', { name: 'Finish set-up' }).click();
      await expect(summary(page)).toContainText('That code is not right.');
    },
  },
  {
    name: 'set up an authenticator app when no key can be made',
    open: async (page) => {
      await stubApi(page, {
        'GET /auth/session': { status: 200, body: consoleSession({ mfa: 'enrol' }) },
        'POST /auth/totp/enrol': problem(500, 'Something went wrong on our side.'),
      });
      await page.goto('/northfield/set-up-authenticator');
      await expect(page.getByRole('button', { name: 'Get a set-up key' })).toBeVisible();
    },
  },
  {
    name: 'enter a code',
    open: async (page) => {
      await pending(page, 'verify');
      await page.goto('/northfield/enter-code');
      await expect(h1(page, 'Enter your code')).toBeVisible();
    },
  },
  {
    name: 'enter a code with an error',
    open: async (page) => {
      await pending(page, 'verify');
      await page.goto('/northfield/enter-code');
      await page.getByRole('button', { name: 'Confirm code' }).click();
      await expect(summary(page).getByRole('link')).toHaveCount(1);
    },
  },
  {
    name: 'no access to this funder',
    open: async (page) => {
      await stubSignedIn(page, { active: null, memberships: [eastmere] });
      await page.goto('/northfield/');
      await expect(h1(page, 'You do not have access to northfield')).toBeVisible();
    },
  },
  {
    name: 'working for another funder',
    open: async (page) => {
      await stubSignedIn(page, { active: eastmere, memberships: [northfield, eastmere] });
      await page.goto('/northfield/');
      await expect(h1(page, 'Switch to Northfield Foundation')).toBeVisible();
    },
  },
  {
    name: 'signed in, with a page that does not exist',
    open: async (page) => {
      await stubSignedIn(page);
      await page.goto('/northfield/no-such-page');
      await expect(h1(page, 'Page not found')).toBeVisible();
    },
  },
  {
    name: 'signed in with more than one funder',
    open: async (page) => {
      await stubSignedIn(page, { memberships: [northfield, eastmere] });
      await page.goto('/northfield/');
      await expect(page.getByRole('button', { name: 'Switch funder' })).toBeVisible();
    },
  },
  {
    name: 'switch funder dialog',
    open: async (page) => {
      await stubSignedIn(page, { memberships: [northfield, eastmere] });
      await page.goto('/northfield/');
      await page.getByRole('button', { name: 'Switch funder' }).click();
      await expect(page.getByRole('dialog', { name: 'Switch funder' })).toBeVisible();
    },
  },
  {
    name: 'switch funder dialog with an error',
    open: async (page) => {
      await stubSignedIn(
        page,
        { memberships: [northfield, eastmere] },
        { 'POST /auth/switch-tenant': problem(403, 'You cannot switch to this funder.') },
      );
      await page.goto('/northfield/');
      await page.getByRole('button', { name: 'Switch funder' }).click();
      await page.getByRole('button', { name: 'Switch to Eastmere Trust' }).click();
      await expect(page.getByRole('alert')).toContainText('You cannot switch to this funder.');
    },
  },
  {
    name: 'warning before the session ends',
    open: async (page) => {
      const start = new Date('2026-10-05T09:00:00Z');
      const installedAt = Date.now();
      await page.clock.install({ time: start });
      await stubApi(page, {
        'GET /auth/session': () => ({
          status: 200,
          body: consoleSession({
            expiresAt: new Date(
              start.getTime() + (Date.now() - installedAt) + 5 * 60_000,
            ).toISOString(),
          }),
        }),
      });
      await page.goto('/northfield/');
      await expect(h1(page, 'Programmes')).toBeVisible();
      await page.clock.fastForward('03:00');
      await expect(page.getByRole('dialog', { name: 'You will be signed out soon' })).toBeVisible();
    },
  },
];

for (const width of widths) {
  test.describe(`at ${width.name}`, () => {
    test.use({ viewport: width.viewport, deviceScaleFactor: width.deviceScaleFactor });

    for (const screen of screens) {
      test(`@a11y ${screen.name} has no axe violations`, async ({ page }) => {
        await screen.open(page);

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}
