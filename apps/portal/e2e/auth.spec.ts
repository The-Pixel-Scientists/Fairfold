// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Creating an account, signing in and resetting a password, in a real
// browser, with the API's answers stubbed from the contracts (auth-api.ts).
// The same journey runs against the real API in auth-journey.spec.ts, and
// auth-session.spec.ts covers what follows sign-in.

// The callbacks passed to page.evaluate run in the browser, so they use DOM types.
/// <reference lib="dom" />

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { applicantSession, problem, signedOut, stubApi } from './auth-api.ts';

const SUFFIX = '– Fairfold Grants';
const TOKEN = 'tok_0123456789abcdefghijklmnopqrstuvwxyz';

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

async function signInWith(page: Page, email: string, password: string) {
  await page.getByRole('textbox', { name: 'Email address' }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.describe("a funder's start page", () => {
  test('offers to create an account or sign in, and says what is needed', async ({ page }) => {
    await stubApi(page, { 'GET /auth/session': signedOut });

    await page.goto('/northfield/');

    await expect(h1(page, 'Apply for a grant')).toBeVisible();
    await expect(page).toHaveTitle(`Apply for a grant ${SUFFIX}`);
    await expect(
      page.getByText('Setting up takes a few minutes. You only need your email address.'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/northfield/sign-up',
    );
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/northfield/sign-in',
    );
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
  });

  test('works from the keyboard alone: skip link, then the two ways in', async ({ page }) => {
    await stubApi(page, { 'GET /auth/session': signedOut });
    await page.goto('/northfield/');
    await expect(h1(page, 'Apply for a grant')).toBeVisible();

    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Fairfold Grants' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Create an account' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(h1(page, 'Sign in')).toBeFocused();
    await expect(page).toHaveURL(/\/northfield\/sign-in$/);
  });

  for (const path of [
    '/northfield/',
    '/northfield/sign-in',
    '/northfield/sign-up',
    '/northfield/sign-up/check-email',
    '/northfield/sign-up/complete',
    '/northfield/forgot-password',
    '/northfield/forgot-password/sent',
    '/northfield/signed-out',
  ]) {
    test(`makes every link and button on ${path} at least 44 pixels tall, for thumbs`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await stubApi(page, { 'GET /auth/session': signedOut });
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

      const { checked, small } = await page
        .locator('main a, main button')
        .evaluateAll((elements) => ({
          checked: elements.length,
          small: elements
            .map((element) => ({
              name: element.textContent,
              height: element.getBoundingClientRect().height,
            }))
            .filter(({ height }) => height < 44),
        }));
      expect(checked).toBeGreaterThan(0);
      expect(small).toEqual([]);
    });
  }
});

test.describe('create an account', () => {
  test('asks for an email address, then for a password from the emailed link, then signs in', async ({
    page,
  }) => {
    let session: unknown = null;
    const sent = await stubApi(page, {
      'GET /auth/session': () => (session === null ? signedOut : { status: 200, body: session }),
      'POST /auth/tenants/northfield/sign-up': { status: 202 },
      'POST /auth/sign-up/complete': { status: 204 },
      'POST /auth/tenants/northfield/sign-in': () => {
        session = applicantSession();
        return { status: 200, body: session };
      },
    });

    await page.goto('/northfield/');
    await page.getByRole('link', { name: 'Create an account' }).click();
    await expect(h1(page, 'Create your account')).toBeFocused();
    await page.getByRole('textbox', { name: 'Email address' }).fill('New@Example.org');
    await page.getByRole('button', { name: 'Email me a link' }).click();
    await expect(h1(page, 'Check your email')).toBeFocused();
    await expect(page.getByText('The link works once, and it lasts 24 hours.')).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'If the email does not arrive' }),
    ).toBeVisible();
    expect(sent.find(({ key }) => key.endsWith('/sign-up'))?.body).toEqual({
      email: 'new@example.org',
    });

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
    await expect(page.getByText('Your account is ready. Sign in to get started.')).toBeVisible();
    expect(sent.find(({ key }) => key === 'POST /auth/sign-up/complete')?.body).toEqual({
      token: TOKEN,
      password: 'a long passphrase here',
    });
    // Nothing the page stored holds the token.
    const stored = await page.evaluate(() =>
      JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]),
    );
    expect(stored).not.toContain(TOKEN);

    await signInWith(page, 'new@example.org', 'a long passphrase here');

    await expect(h1(page, 'Apply for a grant')).toBeFocused();
    await expect(page).toHaveURL(/\/northfield\/$/);
    await expect(
      page.getByText('You are signed in. You have not started an application yet.'),
    ).toBeVisible();
  });

  test('says the link does not work when the token is missing, as after a reload', async ({
    page,
  }) => {
    await stubApi(page, { 'GET /auth/session': signedOut });
    await page.goto(`/northfield/sign-up/complete#token=${TOKEN}`);
    await expect(h1(page, 'Set your password')).toBeVisible();

    await page.reload();

    await expect(h1(page, 'This link does not work')).toBeVisible();
    await expect(page.getByText('A link works once and lasts 24 hours.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ask for a new link' })).toHaveAttribute(
      'href',
      '/northfield/sign-up',
    );
  });

  test('puts a short password beside its field, with the error summary first', async ({ page }) => {
    const sent = await stubApi(page, { 'GET /auth/session': signedOut });
    await page.goto(`/northfield/sign-up/complete#token=${TOKEN}`);
    await page.getByLabel('Password', { exact: true }).fill('short');

    await page.getByRole('button', { name: 'Create account' }).click();

    const summary = page.getByRole('alert', { name: 'There is a problem' });
    await expect(summary).toBeFocused();
    await expect(summary.getByRole('link')).toHaveText(
      'Enter a password of at least 12 characters.',
    );
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(sent.some(({ key }) => key === 'POST /auth/sign-up/complete')).toBe(false);
  });

  test('says how long to wait after too many requests', async ({ page }) => {
    await stubApi(page, {
      'GET /auth/session': signedOut,
      'POST /auth/tenants/northfield/sign-up': {
        ...problem(429, 'Slow down.'),
        headers: { 'retry-after': '3600' },
      },
    });
    await page.goto('/northfield/sign-up');
    await page.getByRole('textbox', { name: 'Email address' }).fill('new@example.org');

    await page.getByRole('button', { name: 'Email me a link' }).click();

    await expect(page.getByRole('alert', { name: 'There is a problem' })).toContainText(
      'Too many attempts. Wait 60 minutes, then try again.',
    );
  });
});

test.describe('sign in', () => {
  test('signs in with a password and opens the applicant page', async ({ page }) => {
    let session: unknown = null;
    const sent = await stubApi(page, {
      'GET /auth/session': () => (session === null ? signedOut : { status: 200, body: session }),
      'POST /auth/tenants/northfield/sign-in': () => {
        session = applicantSession();
        return { status: 200, body: session };
      },
    });

    await page.goto('/northfield/sign-in');
    await expect(page).toHaveTitle(`Sign in ${SUFFIX}`);
    await signInWith(page, 'Ada@Example.org', 'correct horse battery');

    await expect(h1(page, 'Apply for a grant')).toBeFocused();
    await expect(page).toHaveURL(/\/northfield\/$/);
    const banner = page.getByRole('banner');
    await expect(banner).toContainText('ada@example.org');
    await expect(banner.getByRole('button', { name: 'Sign out' })).toBeVisible();
    expect(sent.find(({ key }) => key.endsWith('/sign-in'))?.body).toEqual({
      email: 'ada@example.org',
      password: 'correct horse battery',
    });
  });

  test('works from the keyboard alone, with Enter to submit', async ({ page }) => {
    await stubApi(page, {
      'GET /auth/session': signedOut,
      'POST /auth/tenants/northfield/sign-in': { status: 200, body: applicantSession() },
    });
    await page.goto('/northfield/sign-in');
    await expect(h1(page, 'Sign in')).toBeVisible();

    // Skip link, then the fields in reading order.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    await page.keyboard.press('Tab');
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

    await expect(h1(page, 'Apply for a grant')).toBeFocused();
  });

  test('says it is signing in while a slow answer is on its way, and keeps focus on the button', async ({
    page,
  }) => {
    await stubApi(page, { 'GET /auth/session': signedOut });
    await page.route('**/api/auth/tenants/northfield/sign-in', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(applicantSession()),
      });
    });
    await page.goto('/northfield/sign-in');

    await signInWith(page, 'ada@example.org', 'correct horse battery');

    const button = page.getByRole('button', { name: 'Signing in…' });
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(h1(page, 'Apply for a grant')).toBeVisible();
  });

  test('sends a deep link to sign in, and back to the page afterwards', async ({ page }) => {
    await stubApi(page, {
      'GET /auth/session': signedOut,
      'POST /auth/tenants/northfield/sign-in': { status: 200, body: applicantSession() },
    });
    await page.goto('/northfield/sign-in?next=%2Fsomewhere%2Felse');

    await signInWith(page, 'ada@example.org', 'correct horse battery');

    await expect(h1(page, 'Page not found')).toBeVisible();
    await expect(page).toHaveURL(/\/northfield\/somewhere\/else$/);
  });

  test('never leaves the portal, whatever the link to sign in says', async ({ page }) => {
    await stubApi(page, {
      'GET /auth/session': signedOut,
      'POST /auth/tenants/northfield/sign-in': { status: 200, body: applicantSession() },
    });
    await page.goto('/northfield/sign-in?next=//evil.example/path');

    await signInWith(page, 'ada@example.org', 'correct horse battery');

    await expect(h1(page, 'Apply for a grant')).toBeVisible();
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

    await signInWith(page, 'nobody@example.org', 'wrong password here');

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

    await signInWith(page, 'ada@example.org', 'correct horse battery');

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
      page.getByText(
        'You were signed out because you had not used the page for a while. Anything you saved is still there. Sign in to carry on.',
      ),
    ).toBeVisible();
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
    await expect(page.getByText('The link works once, and it lasts 30 minutes.')).toBeVisible();
    await expect(page.getByText('anyone@example.org')).toHaveCount(0);

    await page.goto(`/northfield/reset-password#token=${TOKEN}`);
    await expect(h1(page, 'Choose a new password')).toBeVisible();
    expect(await page.evaluate(() => window.location.hash)).toBe('');
    expect(sent.filter(({ key }) => key === 'POST /auth/password-reset/complete')).toHaveLength(0);
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

  test('says the link does not work when it has no token, and how long links last', async ({
    page,
  }) => {
    await stubApi(page, { 'GET /auth/session': signedOut });

    await page.goto('/northfield/reset-password');

    await expect(h1(page, 'This link does not work')).toBeVisible();
    await expect(page.getByText('A link works once and lasts 30 minutes.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ask for a new link' })).toHaveAttribute(
      'href',
      '/northfield/forgot-password',
    );
  });
});
