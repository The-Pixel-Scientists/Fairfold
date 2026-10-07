// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The colour scheme in the portal, in a real browser: the switch in the
// footer, the choice kept across a reload, and the scheme in place before the
// app has run (ADR 0045). The console's colour-scheme spec covers the rest.

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const html = (page: Page) => page.locator('html');
const appearance = (page: Page) =>
  page.getByRole('contentinfo').getByRole('group', { name: 'Appearance' });
/** Clicks the label, as a person does: the radio itself is visually hidden. */
const choose = (page: Page, name: 'Light' | 'Dark') =>
  appearance(page).locator('label').filter({ hasText: name }).click();

test('applies Dark from the footer switch at once and keeps it after a reload', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(h1(page, "Use your funder's link")).toBeVisible();
  await expect(html(page)).toHaveAttribute('data-scheme', 'light');
  await expect(appearance(page).getByRole('radio', { name: 'Device' })).toBeChecked();

  await choose(page, 'Dark');

  await expect(html(page)).toHaveAttribute('data-scheme', 'dark');
  await expect(html(page)).toHaveCSS('color-scheme', 'dark');

  await page.reload();

  await expect(h1(page, "Use your funder's link")).toBeVisible();
  await expect(html(page)).toHaveAttribute('data-scheme', 'dark');
  await expect(appearance(page).getByRole('radio', { name: 'Dark' })).toBeChecked();
});

test('follows a dark device until a scheme is chosen', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/how-applying-works');
  await expect(h1(page, 'How applying works')).toBeVisible();
  await expect(html(page)).toHaveAttribute('data-scheme', 'dark');
  await expect(appearance(page).getByRole('radio', { name: 'Device' })).toBeChecked();

  await choose(page, 'Light');

  await expect(html(page)).toHaveAttribute('data-scheme', 'light');
  await page.reload();
  await expect(html(page)).toHaveAttribute('data-scheme', 'light');
});

test("sets a kept choice before the app has run, with the app's own scripts blocked", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => {
    window.localStorage.setItem('colour-scheme', 'dark');
  });
  await page.route(
    (url) => url.pathname !== '/scheme.js',
    (route) => (route.request().resourceType() === 'script' ? route.abort() : route.continue()),
  );

  await page.goto('/');

  await expect(page.locator('#root')).toBeEmpty();
  await expect(html(page)).toHaveAttribute('data-scheme', 'dark');
});
