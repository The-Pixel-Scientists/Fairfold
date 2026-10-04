// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A signed-in applicant, signing out, staying signed in through the idle
// warning, and the pages that are not there, in a real browser, with the API's
// answers stubbed from the contracts (auth-api.ts).

// The callbacks passed to page.evaluate run in the browser, so they use DOM types.
/// <reference lib="dom" />

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import {
  applicantSession,
  eastmere,
  problem,
  signedOut,
  stubApi,
  stubSignedIn,
} from './auth-api.ts';

const SUFFIX = '– Fairfold Grants';

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

test.describe('signed in', () => {
  test('signs out, and lands on the signed-out page', async ({ page }) => {
    let signedIn = true;
    const sent = await stubApi(page, {
      'GET /auth/session': () => (signedIn ? { status: 200, body: applicantSession() } : signedOut),
      'POST /auth/sign-out': () => {
        signedIn = false;
        return { status: 204 };
      },
    });
    await page.goto('/northfield/');
    await expect(h1(page, 'Apply for a grant')).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'No grants are open yet' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();

    await expect(h1(page, 'You have signed out')).toBeFocused();
    await expect(page).toHaveURL(/\/northfield\/signed-out$/);
    await expect(page.getByRole('link', { name: 'Sign in again' })).toBeVisible();
    expect(sent.map(({ key }) => key)).toContain('POST /auth/sign-out');

    // The link to the start page works afterwards, and does not send the person back.
    await page.getByRole('banner').getByRole('link', { name: 'Fairfold Grants' }).click();
    await expect(h1(page, 'Apply for a grant')).toBeFocused();
    await expect(page.getByRole('link', { name: 'Create an account' })).toBeVisible();
    await expect(page).toHaveURL(/\/northfield\/$/);
  });

  test('keeps the person signed in, and says so, when signing out fails', async ({ page }) => {
    await stubSignedIn(page, {}, { 'POST /auth/sign-out': problem(500, 'Failed.') });
    await page.goto('/northfield/');

    await page.getByRole('button', { name: 'Sign out' }).click();

    await expect(page.getByRole('alert')).toHaveText(
      'We could not sign you out. Check your connection and try again.',
    );
    await expect(h1(page, 'Apply for a grant')).toBeVisible();
  });

  test('sends someone who is signed in away from the sign-in page', async ({ page }) => {
    await stubSignedIn(page);

    await page.goto('/northfield/sign-in');

    await expect(h1(page, 'Apply for a grant')).toBeVisible();
    await expect(page).toHaveURL(/\/northfield\/$/);
  });

  test.describe('with no applicant membership here', () => {
    for (const [name, active] of [
      ['no membership anywhere', null],
      ['a membership with another funder', eastmere],
    ] as const) {
      test(`says the account cannot apply to this funder, and can sign out (${name})`, async ({
        page,
      }) => {
        let signedIn = true;
        await stubApi(page, {
          'GET /auth/session': () =>
            signedIn ? { status: 200, body: applicantSession({ active }) } : signedOut,
          'POST /auth/sign-out': () => {
            signedIn = false;
            return { status: 204 };
          },
        });

        await page.goto('/northfield/');

        await expect(h1(page, 'This account cannot apply to this funder')).toBeVisible();
        await expect(page.getByRole('main')).toContainText('ada@example.org');
        await expect(page.getByRole('link', { name: 'Create an account' })).toHaveCount(0);

        await page.getByRole('button', { name: 'Sign out' }).click();
        await expect(h1(page, 'You have signed out')).toBeVisible();
      });
    }
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

  test('warns two minutes before an hour of no use is up, and "Stay signed in" reads the session again', async ({
    page,
  }) => {
    // The session ends in an hour unless the person says they are still there.
    let staying = false;
    const sent = await stubApi(page, {
      'GET /auth/session': () => ({
        status: 200,
        body: applicantSession({ expiresAt: inMinutes(staying ? 120 : 60) }),
      }),
    });
    await page.goto('/northfield/');
    await expect(h1(page, 'Apply for a grant')).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).focus();

    await page.clock.fastForward('57:00');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.clock.fastForward('01:00');

    const dialog = page.getByRole('dialog', { name: 'You will be signed out soon' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Stay signed in' })).toBeFocused();
    await expect(dialog.getByRole('status')).toHaveText('You will be signed out in 2 minutes.');

    const readsBefore = sent.length;
    staying = true;
    await dialog.getByRole('button', { name: 'Stay signed in' }).click();

    await expect(dialog).toHaveCount(0);
    expect(sent.length).toBe(readsBefore + 1);
    expect(sent.at(-1)?.key).toBe('GET /auth/session');
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeFocused();
  });

  test('signs the person out when the hour is up, and the sign-in page says why', async ({
    page,
  }) => {
    await stubApi(page, {
      'GET /auth/session': () => ({
        status: 200,
        body: applicantSession({ expiresAt: inMinutes(60) }),
      }),
    });
    await page.goto('/northfield/');
    await expect(h1(page, 'Apply for a grant')).toBeVisible();
    await page.clock.fastForward('58:00');
    await expect(page.getByRole('dialog', { name: 'You will be signed out soon' })).toBeVisible();

    await page.clock.runFor('02:05');

    await expect(h1(page, 'Sign in')).toBeVisible();
    await expect(page).toHaveURL(/\/northfield\/sign-in\?notice=timeout$/);
    await expect(page.getByText('Anything you saved is still there.')).toBeVisible();
  });
});

test.describe('a page the funder does not have', () => {
  test('says so, and offers a way back to the funder start page', async ({ page }) => {
    await stubApi(page, { 'GET /auth/session': signedOut });

    await page.goto('/northfield/no-such-page');

    await expect(h1(page, 'Page not found')).toBeVisible();
    await expect(page).toHaveTitle(`Page not found ${SUFFIX}`);
    await page.getByRole('link', { name: 'Go to the home page' }).click();
    await expect(h1(page, 'Apply for a grant')).toBeFocused();
    await expect(page).toHaveURL(/\/northfield\/$/);
  });
});
