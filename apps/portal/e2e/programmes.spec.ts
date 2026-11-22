// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Browsing a funder's open rounds before signing in, in a real browser, with
// the API's answers stubbed. The round fixtures are synthetic.

// The callbacks passed to page.evaluate run in the browser, so they use DOM types.
/// <reference lib="dom" />

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { problem, signedOut, stubApi } from './auth-api.ts';
import { LIST, ONE, OTHER_ID, ROUND_ID, round } from './programmes-api.ts';

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

test.describe('open grants before sign-in', () => {
  test('browses the list, opens a round and follows Sign in to apply', async ({ page }) => {
    await stubApi(page, {
      'GET /auth/session': signedOut,
      [LIST]: {
        status: 200,
        body: { rounds: [round, { ...round, id: OTHER_ID, title: 'Round 2' }] },
      },
      [ONE]: { status: 200, body: round },
    });
    await page.goto('/northfield/');
    await page.getByRole('link', { name: 'See open grants' }).click();

    await expect(h1(page, 'Open grants')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(2);
    await expect(page.getByText('5pm on 14 January 2027 (UK time)').first()).toBeVisible();
    await expect(page.getByText('£5,000 to £25,000').first()).toBeVisible();

    await page.getByRole('link', { name: 'Read more about Programme A' }).first().click();
    await expect(h1(page, 'Programme A')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Who can apply' })).toBeVisible();
    await expect(
      page.getByText('This programme is open to registered charities only.'),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Sign in to apply' }).click();
    await expect(h1(page, 'Sign in')).toBeVisible();
    await expect(page).toHaveURL(
      `/northfield/sign-in?next=${encodeURIComponent(`/programmes/${ROUND_ID}`)}`,
    );
  });

  test('shows a calm message when no grant is open', async ({ page }) => {
    await stubApi(page, {
      'GET /auth/session': signedOut,
      [LIST]: { status: 200, body: { rounds: [] } },
    });
    await page.goto('/northfield/open-grants');

    await expect(
      page.getByRole('heading', { level: 2, name: 'There are no open grants at the moment' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to the start page' })).toBeVisible();
  });

  test('shows the not found page for a 404 and says nothing of the round', async ({ page }) => {
    await stubApi(page, { 'GET /auth/session': signedOut, [ONE]: problem(404, 'Not found.') });
    await page.goto(`/northfield/open-grants/${ROUND_ID}`);

    await expect(h1(page, 'Page not found')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(ROUND_ID);
  });

  test('says how long to wait after a 429', async ({ page }) => {
    await stubApi(page, {
      'GET /auth/session': signedOut,
      [LIST]: { ...problem(429, 'Slow down.'), headers: { 'retry-after': '30' } },
    });
    await page.goto('/northfield/open-grants');

    await expect(
      page.getByText('Too many attempts. Wait 30 seconds, then try again.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('sets no cookie, stores nothing and calls only its own origin', async ({
    page,
    context,
  }) => {
    const foreign: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (!['http:', 'https:'].includes(url.protocol)) return;
      if (url.origin !== new URL(page.url()).origin) foreign.push(request.url());
    });
    await stubApi(page, {
      'GET /auth/session': signedOut,
      [LIST]: { status: 200, body: { rounds: [round] } },
      [ONE]: { status: 200, body: round },
    });

    await page.goto('/northfield/open-grants');
    await expect(h1(page, 'Open grants')).toBeVisible();
    await page.getByRole('link', { name: 'Read more about Programme A' }).click();
    await expect(h1(page, 'Programme A')).toBeVisible();

    expect(await context.cookies()).toEqual([]);
    const stored = await page.evaluate(async () => ({
      local: localStorage.length,
      session: sessionStorage.length,
      databases: (await indexedDB.databases()).length,
    }));
    expect(stored).toEqual({ local: 0, session: 0, databases: 0 });
    expect(page.url()).not.toContain('?');
    expect(foreign).toEqual([]);
  });
});
