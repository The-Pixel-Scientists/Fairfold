// SPDX-License-Identifier: AGPL-3.0-or-later
//
// "Your account" and the email change link, in a real browser, with the
// API's answers stubbed from the contracts (auth-api.ts). Changing the email
// address, the password and extra security wait on a step-up dialog for
// accounts without an authenticator app (see the S11-100 report).

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { applicantSession, problem, signedOut, stubApi } from './auth-api.ts';

const TOKEN = 'tok_0123456789abcdefghijklmnopqrstuvwxyz';
const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

test.describe('your account', () => {
  test('lists what is set up for a signed-in applicant', async ({ page }) => {
    await stubApi(page, {
      'GET /auth/session': { status: 200, body: applicantSession() },
      'GET /auth/passkeys': { status: 200, body: { passkeys: [] } },
    });

    await page.goto('/northfield/account');

    await expect(h1(page, 'Your account')).toBeVisible();
    await expect(page.getByText('Extra security (optional)')).toBeVisible();
    await expect(page.locator('#main-content').getByText('ada@example.org')).toBeVisible();
  });

  test('moves focus to the heading when the applicant is sent back after signing in', async ({
    page,
  }) => {
    let session: unknown = null;
    await stubApi(page, {
      'GET /auth/session': () => (session === null ? signedOut : { status: 200, body: session }),
      'GET /auth/passkeys': { status: 200, body: { passkeys: [] } },
      'POST /auth/tenants/northfield/sign-in': () => {
        session = applicantSession();
        return { status: 200, body: session };
      },
    });
    await page.goto('/northfield/account');
    await page.getByRole('textbox', { name: 'Email address' }).fill('ada@example.org');
    await page.getByLabel('Password', { exact: true }).fill('a long password to sign in');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(h1(page, 'Your account')).toBeFocused();
    await expect(page.getByText('Extra security (optional)')).toBeVisible();
  });

  test('sends a visitor to sign in first', async ({ page }) => {
    await stubApi(page, { 'GET /auth/session': signedOut });

    await page.goto('/northfield/account');

    await expect(h1(page, 'Sign in')).toBeVisible();
    await expect(page).toHaveURL(/\/northfield\/sign-in\?next=%2Faccount$/);
  });
});

test.describe('the email change link', () => {
  test('changes nothing until confirmed, and clears the token from the address', async ({
    page,
  }) => {
    const posts: string[] = [];
    await stubApi(page, {
      'GET /auth/session': signedOut,
      'POST /auth/email-change/complete': () => {
        posts.push('complete');
        return { status: 204 };
      },
    });

    await page.goto(`/northfield/email-change#token=${TOKEN}`);

    await expect(h1(page, 'Confirm your new email address')).toBeVisible();
    await expect(page).toHaveURL(/\/northfield\/email-change$/);
    expect(posts).toEqual([]);

    await page.getByRole('button', { name: 'Confirm new email address' }).click();

    await expect(h1(page, 'Your email address has changed')).toBeVisible();
    expect(posts).toEqual(['complete']);
  });

  test('shows what the server says for a used or expired link', async ({ page }) => {
    await stubApi(page, {
      'GET /auth/session': signedOut,
      'POST /auth/email-change/complete': problem(400, 'This link has expired or been used.'),
    });
    await page.goto(`/northfield/email-change#token=${TOKEN}`);

    await page.getByRole('button', { name: 'Confirm new email address' }).click();

    await expect(page.getByRole('alert', { name: 'There is a problem' })).toBeVisible();
  });
});
