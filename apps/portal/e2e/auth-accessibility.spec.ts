// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for every sign-in screen and state, at desktop width, at 320 px
// wide and at 200% zoom (ADR 0006), with the API stubbed from the contracts.
// In the production project they also run under the production Content
// Security Policy, which the test fixture holds every page to.

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { applicantSession, eastmere, problem, signedOut, stubApi } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, widths } from './axe.ts';

const TOKEN = 'tok_0123456789abcdefghijklmnopqrstuvwxyz';
/** An address long enough to test that nothing runs off a 320 px screen. */
const LONG_EMAIL =
  'a.very.long.name.for.an.applicant.at.a.charity@example-charity-organisation.org.uk';

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const summary = (page: Page) => page.getByRole('alert', { name: 'There is a problem' });

/** The API as a signed-out visitor sees it. */
function visitor(page: Page, more = {}) {
  return stubApi(page, {
    'GET /auth/session': signedOut,
    'POST /auth/tenants/northfield/sign-in': problem(401, 'Not right.'),
    ...more,
  });
}

interface Screen {
  name: string;
  /** Sets the screen up and waits until it is showing. */
  open: (page: Page) => Promise<void>;
}

const screens: Screen[] = [
  {
    name: 'outside a funder',
    open: async (page) => {
      await page.goto('/');
      await expect(h1(page, "Use your funder's link")).toBeVisible();
    },
  },
  {
    name: 'checking the session',
    open: async (page) => {
      await page.route(
        (url) => url.pathname === '/api/auth/session',
        () => undefined,
      );
      await page.goto('/northfield/');
      await expect(h1(page, 'One moment')).toBeVisible();
    },
  },
  {
    name: 'session could not be read',
    open: async (page) => {
      await stubApi(page, { 'GET /auth/session': problem(503, 'Try again later.') });
      await page.goto('/northfield/');
      await expect(h1(page, 'We could not connect')).toBeVisible();
    },
  },
  {
    name: 'start page',
    open: async (page) => {
      await visitor(page);
      await page.goto('/northfield/');
      await expect(h1(page, 'Apply for a grant')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Create an account' })).toBeVisible();
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
      await page.getByRole('textbox', { name: 'Email address' }).fill('not an address');
      await page.getByRole('button', { name: 'Email me a link' }).click();
      await expect(summary(page).getByRole('link')).toHaveCount(1);
    },
  },
  {
    name: 'create an account after too many requests',
    open: async (page) => {
      await visitor(page, {
        'POST /auth/tenants/northfield/sign-up': {
          ...problem(429, 'Slow down.'),
          headers: { 'retry-after': '3600' },
        },
      });
      await page.goto('/northfield/sign-up');
      await page.getByRole('textbox', { name: 'Email address' }).fill('new@example.org');
      await page.getByRole('button', { name: 'Email me a link' }).click();
      await expect(summary(page)).toContainText('Wait 60 minutes');
    },
  },
  {
    name: 'check your email after sign-up',
    open: async (page) => {
      await visitor(page);
      await page.goto('/northfield/sign-up/check-email');
      await expect(h1(page, 'Check your email')).toBeVisible();
    },
  },
  {
    name: 'set your password',
    open: async (page) => {
      await visitor(page);
      await page.goto(`/northfield/sign-up/complete#token=${TOKEN}`);
      await expect(h1(page, 'Set your password')).toBeVisible();
    },
  },
  {
    name: 'set your password with the password shown',
    open: async (page) => {
      await visitor(page);
      await page.goto(`/northfield/sign-up/complete#token=${TOKEN}`);
      await page.getByLabel('Password', { exact: true }).fill('a long passphrase here');
      await page.getByRole('checkbox', { name: 'Show password' }).check();
      await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
    },
  },
  {
    name: 'set your password with an error',
    open: async (page) => {
      await visitor(page);
      await page.goto(`/northfield/sign-up/complete#token=${TOKEN}`);
      await page.getByLabel('Password', { exact: true }).fill('short');
      await page.getByRole('button', { name: 'Create account' }).click();
      await expect(summary(page).getByRole('link')).toHaveCount(1);
    },
  },
  {
    name: 'set your password with a link that was refused',
    open: async (page) => {
      await visitor(page, {
        'POST /auth/sign-up/complete': problem(400, 'Some fields are not valid.', [
          { field: 'body.token', message: 'This link is not valid.' },
        ]),
      });
      await page.goto(`/northfield/sign-up/complete#token=${TOKEN}`);
      await page.getByLabel('Password', { exact: true }).fill('a long passphrase here');
      await page.getByRole('button', { name: 'Create account' }).click();
      await expect(summary(page)).toContainText('This link is not valid.');
    },
  },
  {
    name: 'a sign-up link that does not work',
    open: async (page) => {
      await visitor(page);
      await page.goto('/northfield/sign-up/complete');
      await expect(h1(page, 'This link does not work')).toBeVisible();
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
      await expect(page.getByText('You were signed out because you had not used')).toBeVisible();
    },
  },
  {
    name: 'sign in after an account was created',
    open: async (page) => {
      await visitor(page);
      await page.goto('/northfield/sign-in?notice=account-created');
      await expect(page.getByText('Your account is ready.')).toBeVisible();
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
    name: 'sign in after too many attempts',
    open: async (page) => {
      await visitor(page, {
        'POST /auth/tenants/northfield/sign-in': {
          ...problem(429, 'Slow down.'),
          headers: { 'retry-after': '30' },
        },
      });
      await page.goto('/northfield/sign-in');
      await page.getByRole('textbox', { name: 'Email address' }).fill('ada@example.org');
      await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(summary(page)).toContainText('Wait 30 seconds');
    },
  },
  {
    name: 'forgot your password',
    open: async (page) => {
      await visitor(page);
      await page.goto('/northfield/forgot-password');
      await expect(h1(page, 'Reset your password')).toBeVisible();
    },
  },
  {
    name: 'forgot your password with an error',
    open: async (page) => {
      await visitor(page);
      await page.goto('/northfield/forgot-password');
      await page.getByRole('button', { name: 'Email me a reset link' }).click();
      await expect(summary(page).getByRole('link')).toHaveCount(1);
    },
  },
  {
    name: 'the reset email has been sent',
    open: async (page) => {
      await visitor(page);
      await page.goto('/northfield/forgot-password/sent');
      await expect(h1(page, 'Check your email')).toBeVisible();
    },
  },
  {
    name: 'choose a new password',
    open: async (page) => {
      await visitor(page);
      await page.goto(`/northfield/reset-password#token=${TOKEN}`);
      await expect(h1(page, 'Choose a new password')).toBeVisible();
    },
  },
  {
    name: 'a reset link that does not work',
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
    name: 'a page the funder does not have',
    open: async (page) => {
      await visitor(page);
      await page.goto('/northfield/no-such-page');
      await expect(h1(page, 'Page not found')).toBeVisible();
    },
  },
  {
    name: 'signed in',
    open: async (page) => {
      await stubApi(page, { 'GET /auth/session': { status: 200, body: applicantSession() } });
      await page.goto('/northfield/');
      await expect(
        page.getByRole('heading', { level: 2, name: 'No grants are open yet' }),
      ).toBeVisible();
    },
  },
  {
    name: 'signed in with a long email address',
    open: async (page) => {
      await stubApi(page, {
        'GET /auth/session': { status: 200, body: applicantSession({ email: LONG_EMAIL }) },
      });
      await page.goto('/northfield/');
      await expect(page.getByRole('banner')).toContainText(LONG_EMAIL);
    },
  },
  {
    name: 'an account that cannot apply to this funder',
    open: async (page) => {
      await stubApi(page, {
        'GET /auth/session': { status: 200, body: applicantSession({ active: null }) },
      });
      await page.goto('/northfield/');
      await expect(h1(page, 'This account cannot apply to this funder')).toBeVisible();
    },
  },
  {
    name: 'an account with another funder',
    open: async (page) => {
      await stubApi(page, {
        'GET /auth/session': {
          status: 200,
          body: applicantSession({ active: eastmere, email: LONG_EMAIL }),
        },
      });
      await page.goto('/northfield/');
      await expect(h1(page, 'This account cannot apply to this funder')).toBeVisible();
    },
  },
  {
    name: 'signing out failed',
    open: async (page) => {
      await stubApi(page, {
        'GET /auth/session': { status: 200, body: applicantSession() },
        'POST /auth/sign-out': problem(500, 'Failed.'),
      });
      await page.goto('/northfield/');
      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
    },
  },
  {
    name: 'the warning before the session ends',
    open: async (page) => {
      const start = new Date('2026-10-05T09:00:00Z');
      const installedAt = Date.now();
      await page.clock.install({ time: start });
      await stubApi(page, {
        'GET /auth/session': () => ({
          status: 200,
          body: applicantSession({
            expiresAt: new Date(
              start.getTime() + (Date.now() - installedAt) + 60 * 60_000,
            ).toISOString(),
          }),
        }),
      });
      await page.goto('/northfield/');
      await expect(h1(page, 'Apply for a grant')).toBeVisible();
      await page.clock.fastForward('58:00');
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

    test('@a11y the sign-in fields and buttons have no axe violations while they have focus', async ({
      page,
    }) => {
      await visitor(page);
      await page.goto('/northfield/sign-in');
      await expect(h1(page, 'Sign in')).toBeVisible();

      for (const control of [
        page.getByRole('textbox', { name: 'Email address' }),
        page.getByLabel('Password', { exact: true }),
        page.getByRole('checkbox', { name: 'Show password' }),
        page.getByRole('button', { name: 'Sign in' }),
        page.getByRole('link', { name: 'Forgot your password?' }),
      ]) {
        await control.focus();
        await expect(control).toBeFocused();
        await expectNoViolations(page);
      }
    });
  });
}

test.describe('with reduced motion and forced colours', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('@a11y the sign-in page has no axe violations', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
    await visitor(page);
    await page.goto('/northfield/sign-in');
    await expect(h1(page, 'Sign in')).toBeVisible();

    await expectNoViolations(page);
    await expectNoHorizontalScroll(page);
  });
});
