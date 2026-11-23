// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The unsubscribe page in a real browser with the API stubbed. Opening the
// link only reads; the person pressing the button is the only thing that changes.

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { problem, stubApi } from './auth-api.ts';
import type { Handler } from './auth-api.ts';
import { GET, PATH, POST, REFUSED, TOKEN, outcome, target } from './unsubscribe-api.ts';

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const button = (page: Page) => page.getByRole('button', { name: 'Unsubscribe from these emails' });
const CONFIRMED = 'You will not get emails about future funding from this funder.';

async function open(page: Page, handlers: Record<string, Handler>) {
  const sent = await stubApi(page, handlers);
  await page.goto(PATH);
  return sent;
}

test.describe('unsubscribe', () => {
  test('opening the link makes one GET and no POST, and pressing the button posts once', async ({
    page,
  }) => {
    const sent = await open(page, { [GET]: target, [POST]: outcome('unsubscribed') });

    await expect(h1(page, 'Stop emails about future funding')).toBeVisible();
    // The development server runs each effect twice, so the read may be sent twice there.
    expect(new Set(sent.map(({ key }) => key))).toEqual(new Set([GET]));

    await button(page).click();
    await expect(h1(page, 'You have unsubscribed')).toBeFocused();
    await expect(page.getByText(CONFIRMED)).toBeVisible();
    const posts = sent.filter(({ key }) => key === POST);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({ 'List-Unsubscribe': 'One-Click' });
    expect(new Set(sent.map(({ key }) => key))).toEqual(new Set([GET, POST]));
  });

  test('already withdrawn gets the same calm message', async ({ page }) => {
    await open(page, { [GET]: target, [POST]: outcome('already_unsubscribed') });

    await button(page).click();
    await expect(page.getByText(CONFIRMED)).toBeVisible();
  });

  test('a link that does not work gets the one refusal, without the token', async ({ page }) => {
    await open(page, { [GET]: problem(404, 'Not found.') });

    await expect(h1(page, REFUSED)).toBeVisible();
    await expect(
      page.getByText('Use the link in a newer email, or sign in to change how we contact you.'),
    ).toBeVisible();
    expect(await page.locator('body').innerText()).not.toContain(TOKEN);
  });

  test('a 429 shows the wait', async ({ page }) => {
    await open(page, {
      [GET]: { ...problem(429, 'Slow down.'), headers: { 'retry-after': '30' } },
    });

    await expect(
      page.getByText('Too many attempts. Wait 30 seconds, then try again.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('offers a link to sign in and change preferences, with no token', async ({ page }) => {
    await open(page, { [GET]: target });

    await expect(page.getByRole('link', { name: 'Change how we contact you' })).toHaveAttribute(
      'href',
      '/northfield/preferences',
    );
  });

  test('sets no cookie and keeps nothing in storage, before or after the POST', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await open(page, { [GET]: target, [POST]: outcome('unsubscribed') });
    await button(page).click();
    await expect(h1(page, 'You have unsubscribed')).toBeVisible();

    expect(await context.cookies()).toEqual([]);
    const stored = await page.evaluate(async () => ({
      local: localStorage.length,
      session: sessionStorage.length,
      databases: (await indexedDB.databases()).length,
    }));
    expect(stored).toEqual({ local: 0, session: 0, databases: 0 });
    await context.close();
  });
});
