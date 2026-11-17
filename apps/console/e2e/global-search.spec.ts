// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The console's search box. Most checks run with the API's answers stubbed
// (auth-api.ts), which is enough to see what the page sends and shows. The
// last describe runs against the real search API in the stack
// (`pnpm stack`, then `pnpm test:stack`):
//
//   TPS_E2E_ADMIN_EMAIL, TPS_E2E_ADMIN_PASSWORD, TPS_E2E_ADMIN_TOTP_KEY
//                           the Northfield administrator from the seed
//   TPS_E2E_SEARCH_TERM     the start of a seeded application's reference

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { consoleSession, stubApi } from './auth-api.ts';
import { nextCode } from './auth-totp.ts';
import { expectNoHorizontalScroll, expectNoViolations } from './auth-axe.ts';

const id = '3f6c1a52-8d0e-4b7a-9c21-5e4d3b2a1f00';
const TERM = 'garden';

const staff = {
  audience: 'staff',
  groups: [
    {
      module: 'grants',
      results: [{ kind: 'grants.application', id, label: 'NF-CG-0412 Community garden' }],
      more: true,
    },
  ],
};
const blind = {
  audience: 'blind_reviewer',
  groups: [
    {
      module: 'grants',
      results: [{ kind: 'grants.application', id, reference: 'NF-CG-0412' }],
      more: false,
    },
  ],
};

const searchBox = (page: Page) => page.getByRole('combobox', { name: 'Search' });
const status = (page: Page) => page.getByRole('status').filter({ hasText: /result/ });

async function open(page: Page, answer: unknown = staff, options = {}) {
  const search = { status: 200, body: answer };
  const sent = await stubApi(page, {
    'GET /auth/session': {
      status: 200,
      body: consoleSession({ permissions: ['platform.search.use'], ...options }),
    },
    'GET /console/programmes': { status: 200, body: { programmes: [] } },
    'POST /console/search': search,
  });
  await page.goto('/northfield/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  return sent;
}

/** Every search request, with its address, so a term in a URL fails the test. */
function watchSearches(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/console/search')) {
      seen.push(`${request.method()} ${new URL(request.url()).search}`);
    }
  });
  return seen;
}

test.describe('global search', () => {
  test('takes the shortcut from the page body and opens a result with the keyboard', async ({
    page,
  }) => {
    const searches = watchSearches(page);
    await open(page);
    const start = page.url();

    await page.keyboard.press('Control+k');
    await expect(searchBox(page)).toBeFocused();
    await page.keyboard.type(TERM);

    await expect(page.getByRole('group', { name: 'Grants' })).toBeVisible();
    await expect(status(page)).toHaveText('1 result in 1 tool');
    await expect(page.getByText('More results in Grants')).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(new RegExp(`/northfield/submissions/${id}$`));
    expect(page.url()).not.toContain(TERM);
    expect(await page.evaluate(() => JSON.stringify(history.state))).not.toContain(TERM);
    expect(searches.length).toBeGreaterThan(0);
    expect(searches.every((seen) => seen === 'POST ')).toBe(true);

    await page.goBack();
    await expect(page).toHaveURL(start);
  });

  test('shows no box to a member without the search permission', async ({ page }) => {
    await open(page, staff, { permissions: ['grants.programmes.manage'] });
    await expect(searchBox(page)).toHaveCount(0);
  });

  test('shows a blind reviewer only the references the server sends', async ({ page }) => {
    await open(page, blind);
    await searchBox(page).fill(TERM);
    const option = page.getByRole('option');
    await expect(option).toHaveText('NF-CG-0412');
  });

  test('says what to do for a term that is too short', async ({ page }) => {
    const searches = watchSearches(page);
    await open(page);
    await searchBox(page).fill('g');
    await expect(page.getByText('Enter at least 2 characters')).toBeVisible();
    expect(searches).toEqual([]);
  });

  test('fits a 320 px wide screen', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await open(page);
    await searchBox(page).fill(TERM);
    await expect(page.getByRole('option')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('@a11y has no axe violations with the results closed and open', async ({ page }) => {
    await open(page);
    await expectNoViolations(page);
    await searchBox(page).fill(TERM);
    await expect(page.getByRole('option')).toBeVisible();
    await expectNoViolations(page);
  });
});

test.describe('global search against the real API', () => {
  const { TPS_E2E_ADMIN_EMAIL: email, TPS_E2E_ADMIN_PASSWORD: password } = process.env;
  const { TPS_E2E_ADMIN_TOTP_KEY: totpKey, TPS_E2E_SEARCH_TERM: term } = process.env;
  test.skip(
    process.env['TPS_E2E_STACK'] !== '1',
    'Runs against the stack: pnpm stack, then pnpm test:stack.',
  );
  test.skip(
    !email || !password || !totpKey || !term,
    'Needs the seeded administrator, their authenticator key and a search term.',
  );

  test('finds a seeded application and opens it without the term in any address', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const searches = watchSearches(page);
    await page.goto('/northfield/sign-in');
    await page.getByRole('textbox', { name: 'Email address', exact: true }).fill(email ?? '');
    await page.getByLabel('Password', { exact: true }).fill(password ?? '');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByLabel('Code from your app').fill(await nextCode(totpKey ?? '', null));
    await page.getByRole('button', { name: 'Confirm code' }).click();
    await expect(searchBox(page)).toBeVisible();

    await searchBox(page).fill(term ?? '');
    await expect(page.getByRole('group', { name: 'Grants' })).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/northfield\/submissions\/[0-9a-f-]{36}$/);
    expect(page.url()).not.toContain(term ?? '');
    expect(searches.every((seen) => seen === 'POST ')).toBe(true);
  });
});
