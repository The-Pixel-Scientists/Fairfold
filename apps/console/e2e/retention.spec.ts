// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The retention settings page in a real browser, with the API's answers
// stubbed (governance-api.ts), and its axe checks at every width. Every spec
// also fails on a Content Security Policy violation, so the page is checked
// under the production policy in console-production.

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { problem } from './auth-api.ts';
import { SUFFIX, audit, checkStates, confirmItsYou, h1, stubGovernance } from './governance-api.ts';

/** The page loads its code when first opened, which a busy machine can slow past five seconds. */
const expect = strictExpect.configure({ timeout: 15_000 });

const table = (page: Page) =>
  page.getByRole('table', { name: 'How long each kind of data is kept' });
const PUT = 'PUT /console/retention-policies';

test.describe('the retention page', () => {
  test('lists the periods in plain units and says what a change means', async ({ page }) => {
    await stubGovernance(page);
    await page.goto('/northfield/settings/retention');

    await expect(h1(page, 'Data retention')).toBeVisible();
    await expect(page).toHaveTitle(`Data retention ${SUFFIX}`);
    await expect(table(page).getByRole('row', { name: /Audit log/ })).toContainText('7 years');
    await expect(page.getByText(/only to events recorded after the change/)).toBeVisible();
    await expect(
      page
        .getByRole('navigation', { name: 'Settings' })
        .getByRole('link', { name: 'Data retention' }),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('saves a period after confirming it is them, keeping what was typed', async ({ page }) => {
    const stub = await stubGovernance(page);
    await page.goto('/northfield/settings/retention');

    await page.getByRole('button', { name: 'Change period for Audit log' }).click();
    await page.getByLabel(/Days to keep audit log/).fill('3650');
    await page.getByRole('button', { name: 'Save period' }).click();
    await confirmItsYou(page);

    await expect(page.getByRole('status').filter({ hasText: /\S/ })).toHaveText(
      'Audit log period saved.',
    );
    await expect(table(page).getByRole('row', { name: /Audit log/ })).toContainText('10 years');
    await expect(page.getByRole('button', { name: 'Change period for Audit log' })).toBeFocused();
    expect(stub.sent.filter(({ key }) => key === PUT).map(({ body }) => body)).toEqual([
      { days: 3650 },
      { days: 3650 },
    ]);
  });

  test('shows the refusal below the minimum at the field, without the value', async ({ page }) => {
    const words = 'This is shorter than the platform allows for this data. Enter 365 days or more.';
    await stubGovernance(page, {
      [PUT]: problem(400, words, [{ field: 'body.days', message: words }]),
    });
    await page.goto('/northfield/settings/retention');

    await page.getByRole('button', { name: 'Change period for Audit log' }).click();
    await page.getByLabel(/Days to keep audit log/).fill('100');
    await page.getByRole('button', { name: 'Save period' }).click();

    await expect(page.getByRole('alert').getByText(words)).toBeVisible();
    await expect(page.getByText(/\b100 days\b/)).toHaveCount(0);
  });
});

checkStates([
  {
    name: 'the retention page',
    open: async (page) => {
      await page.goto('/northfield/settings/retention');
      await expect(table(page)).toBeVisible();
    },
  },
  {
    name: 'the retention page with a changed period',
    stub: (page) =>
      stubGovernance(page, {
        'GET /console/retention-policies': {
          status: 200,
          body: { policies: [{ ...audit, days: 3650, changed: true }] },
        },
      }),
    open: async (page) => {
      await page.goto('/northfield/settings/retention');
      await expect(table(page).getByText('Your funder')).toBeVisible();
    },
  },
  {
    name: 'the change period form',
    open: async (page) => {
      await page.goto('/northfield/settings/retention');
      await page.getByRole('button', { name: 'Change period for Audit log' }).click();
      await expect(page.getByRole('form', { name: 'Change period for Audit log' })).toBeVisible();
    },
  },
  {
    name: 'the change period form with a problem to fix',
    open: async (page) => {
      await page.goto('/northfield/settings/retention');
      await page.getByRole('button', { name: 'Change period for Audit log' }).click();
      await page.getByLabel(/Days to keep audit log/).fill('0');
      await page.getByRole('button', { name: 'Save period' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
    },
  },
  {
    name: 'the retention page when the periods could not be read',
    stub: (page) =>
      stubGovernance(page, {
        'GET /console/retention-policies': problem(
          503,
          'The service is busy. Try again in a minute.',
        ),
      }),
    open: async (page) => {
      await page.goto('/northfield/settings/retention');
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    },
  },
]);
