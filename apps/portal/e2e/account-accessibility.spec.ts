// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for "Your account" and the email change link, in every state, at
// desktop width, at 320 px wide and at 200% zoom (ADR 0006), and at desktop
// width in the dark scheme, in the funder's standard look and in a saved
// custom look, with the API stubbed from the contracts (auth-api.ts). In
// portal-production they run under the production Content Security Policy,
// which the test fixture holds every page to.

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { applicantSession, custom, problem, signedOut, standard, stubApi } from './auth-api.ts';
import type { Handler } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './axe.ts';

const TOKEN = 'tok_0123456789abcdefghijklmnopqrstuvwxyz';
/** An address long enough to test that nothing runs off a 320 px screen. */
const LONG_EMAIL =
  'a.very.long.name.for.an.applicant.at.a.charity@example-charity-organisation.org.uk';

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const signedIn = { status: 200, body: applicantSession() };

interface State {
  name: string;
  handlers: Record<string, Handler>;
  /** Opens the screen and gets it into the state, and waits until it is showing. */
  open: (page: Page) => Promise<void>;
}

const states: State[] = [
  {
    name: 'your account with nothing extra set up',
    handlers: {
      'GET /auth/session': signedIn,
      'GET /auth/passkeys': { status: 200, body: { passkeys: [] } },
    },
    open: async (page) => {
      await page.goto('/northfield/account');
      await expect(page.getByText('Not set up. You can use the account without it.')).toBeVisible();
    },
  },
  {
    name: 'your account with a long email address',
    handlers: {
      'GET /auth/session': { status: 200, body: applicantSession({ email: LONG_EMAIL }) },
      'GET /auth/passkeys': { status: 200, body: { passkeys: [] } },
    },
    open: async (page) => {
      await page.goto('/northfield/account');
      await expect(page.locator('#main-content').getByText(LONG_EMAIL)).toBeVisible();
    },
  },
  {
    name: 'your account while loading',
    handlers: { 'GET /auth/session': signedIn },
    open: async (page) => {
      await page.route(
        (url) => url.pathname === '/api/auth/passkeys',
        () => undefined,
      );
      await page.goto('/northfield/account');
      await expect(h1(page, 'Your account')).toBeVisible();
      await expect(page.getByRole('main').getByRole('status')).toHaveText('Loading…');
    },
  },
  {
    name: 'your account that could not be read',
    handlers: {
      'GET /auth/session': signedIn,
      'GET /auth/passkeys': problem(503, 'The service is busy. Try again in a minute.'),
    },
    open: async (page) => {
      await page.goto('/northfield/account');
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    },
  },
  {
    name: 'confirm your new email address',
    handlers: { 'GET /auth/session': signedOut },
    open: async (page) => {
      await page.goto(`/northfield/email-change#token=${TOKEN}`);
      await expect(page.getByRole('button', { name: 'Confirm new email address' })).toBeVisible();
    },
  },
  {
    name: 'confirm your new email address with a link the server refuses',
    handlers: {
      'GET /auth/session': signedOut,
      'POST /auth/email-change/complete': problem(400, 'This link has expired or been used.'),
    },
    open: async (page) => {
      await page.goto(`/northfield/email-change#token=${TOKEN}`);
      await page.getByRole('button', { name: 'Confirm new email address' }).click();
      const summary = page.getByRole('alert', { name: 'There is a problem' });
      await expect(summary).toBeVisible();
      await expect(summary).toBeFocused();
    },
  },
  {
    name: 'an email link that does not work',
    handlers: { 'GET /auth/session': signedOut },
    open: async (page) => {
      await page.goto('/northfield/email-change');
      await expect(h1(page, 'This link does not work')).toBeVisible();
    },
  },
  {
    name: 'your email address has changed',
    handlers: {
      'GET /auth/session': signedOut,
      'POST /auth/email-change/complete': { status: 204 },
    },
    open: async (page) => {
      await page.goto(`/northfield/email-change#token=${TOKEN}`);
      await page.getByRole('button', { name: 'Confirm new email address' }).click();
      await expect(h1(page, 'Your email address has changed')).toBeVisible();
    },
  },
];

const looks = [
  { name: 'the standard look', funder: standard },
  { name: 'a saved custom look', funder: custom },
] as const;

for (const look of looks) {
  for (const variant of variants) {
    test.describe(`in ${look.name} at ${variant.name}`, () => {
      test.use({
        viewport: variant.viewport,
        deviceScaleFactor: variant.deviceScaleFactor,
        colorScheme: variant.scheme,
      });
      // Axe reads a whole page, and a slow browser on a busy machine needs time to do it.
      test.describe.configure({ timeout: 90_000 });

      for (const state of states) {
        test(`@a11y ${state.name} has no axe violations`, async ({ page }) => {
          await stubApi(page, state.handlers, look.funder);
          await state.open(page);

          await expectNoViolations(page);
          await expectNoHorizontalScroll(page);
        });
      }
    });
  }
}

test.describe('with reduced motion and forced colours', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  for (const state of states) {
    test(`@a11y ${state.name} has no axe violations`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
      await stubApi(page, state.handlers);
      await state.open(page);

      await expectNoViolations(page);
      await expectNoHorizontalScroll(page);
    });
  }
});
