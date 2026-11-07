// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Signing in through the funder's own identity provider, in a real browser
// with the API's answers stubbed from the contracts. Sign-in through a real
// identity provider is the root auth suite's fake IdP (S11-104).

import { expect, test } from '../../../scripts/e2e/fixtures.ts';

import { problem, signedOut, stubApi } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './auth-axe.ts';

const START = 'POST /auth/tenants/northfield/sso/start';
const button = "Continue with your organisation's sign-in";

test.describe('single sign-on entry', () => {
  test('sends the email in the body and goes to the address the server gives', async ({ page }) => {
    const sent = await stubApi(page, {
      'GET /auth/session': signedOut,
      [START]: { status: 200, body: { url: 'https://idp.example.org/authorize' } },
    });
    await page.route('https://idp.example.org/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Identity provider</h1>' }),
    );
    await page.goto('/northfield/sign-in');
    await page.getByLabel('Work email address').fill('ada@example.org');
    await page.getByRole('button', { name: button }).click();
    await expect(page).toHaveURL('https://idp.example.org/authorize');
    expect(sent.find(({ key }) => key === START)?.body).toEqual({ email: 'ada@example.org' });
  });

  test('says the same when no domain matches', async ({ page }) => {
    await stubApi(page, {
      'GET /auth/session': signedOut,
      [START]: { status: 200, body: { url: null } },
    });
    await page.goto('/northfield/sign-in');
    await page.getByLabel('Work email address').fill('ada@nowhere.test');
    await page.getByRole('button', { name: button }).click();
    await expect(page.getByText(/could not start single sign-on/)).toBeVisible();
    expect(new URL(page.url()).search).toBe('');
  });

  test('shows the failure page with the way back', async ({ page }) => {
    await stubApi(page, { 'GET /auth/session': signedOut });
    await page.goto('/northfield/sign-in/sso/failed?reason=other');
    await expect(page.getByRole('alert')).toContainText('did not confirm your identity');
    await page.getByRole('link', { name: 'Back to sign in' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  });

  test('says how long to wait after too many attempts', async ({ page }) => {
    await stubApi(page, {
      'GET /auth/session': signedOut,
      [START]: { ...problem(429, 'Slow down.'), headers: { 'retry-after': '30' } },
    });
    await page.goto('/northfield/sign-in');
    await page.getByLabel('Work email address').fill('ada@example.org');
    await page.getByRole('button', { name: button }).click();
    await expect(
      page.getByText('Too many attempts. Wait 30 seconds, then try again.').first(),
    ).toBeVisible();
  });
});

for (const variant of variants) {
  test.describe(`at ${variant.name}`, () => {
    test.use({
      viewport: variant.viewport,
      deviceScaleFactor: variant.deviceScaleFactor,
      colorScheme: variant.scheme,
    });

    test('@a11y the sign-in page with single sign-on has no axe violations', async ({ page }) => {
      await stubApi(page, { 'GET /auth/session': signedOut });
      await page.goto('/northfield/sign-in');
      await expect(page.getByRole('button', { name: button })).toBeVisible();
      await expectNoViolations(page);
      await expectNoHorizontalScroll(page);
    });

    test('@a11y the failure page has no axe violations', async ({ page }) => {
      await stubApi(page, { 'GET /auth/session': signedOut });
      await page.goto('/northfield/sign-in/sso/failed');
      await expect(page.getByRole('alert')).toBeVisible();
      await expectNoViolations(page);
      await expectNoHorizontalScroll(page);
    });
  });
}
