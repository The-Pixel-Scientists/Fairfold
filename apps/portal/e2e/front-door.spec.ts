// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The signed-in home: a section for each tool the funder has switched on for
// the person, in a real browser, with the API's answers stubbed from the
// contracts (auth-api.ts).

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { applicantSession, custom, stubApi } from './auth-api.ts';
import type { Funder } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './axe.ts';

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

function open(page: Page, modules: string[], funder?: Funder) {
  return stubApi(
    page,
    {
      'GET /auth/session': { status: 200, body: applicantSession({ modules }) },
      'GET /portal/applications': { status: 200, body: { applications: [] } },
    },
    funder,
  );
}

test.describe('the front door', () => {
  test('lists party and grants when grants is on', async ({ page }) => {
    await open(page, ['grants']);
    await page.goto('/northfield/');

    await expect(h1(page, 'Apply for a grant')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Your details and organisations' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Grants', exact: true })).toBeVisible();
  });

  test('lists only party when grants is off, and its address is not found', async ({ page }) => {
    await open(page, []);
    await page.goto('/northfield/');

    await expect(page.getByRole('link', { name: 'Your details and organisations' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Grants', exact: true })).toHaveCount(0);

    await page.goto('/northfield/apply');
    await expect(h1(page, 'Page not found')).toBeVisible();
    await page.goto('/northfield/applications');
    await expect(h1(page, 'Page not found')).toBeVisible();
    await expect(page).toHaveTitle(/^Page not found/);
  });

  test('opens a tool only when its address is opened', async ({ page }) => {
    const chunks: string[] = [];
    page.on('request', (request) => {
      if (/grants.*portal|portal\/index/.test(request.url())) chunks.push(request.url());
    });
    await open(page, ['grants']);
    await page.goto('/northfield/');
    await expect(page.getByRole('link', { name: 'Grants', exact: true })).toBeVisible();
    expect(chunks).toEqual([]);

    await page.getByRole('link', { name: 'Grants', exact: true }).click();
    await expect(h1(page, 'Your applications')).toBeVisible();
  });

  test('reaches and opens every section with the keyboard', async ({ page }) => {
    await open(page, ['grants']);
    await page.goto('/northfield/');
    await expect(h1(page, 'Apply for a grant')).toBeVisible();

    await page.getByRole('link', { name: 'Your details and organisations' }).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Grants', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(h1(page, 'Your applications')).toBeVisible();
  });
});

for (const variant of variants) {
  test.describe(`at ${variant.name}`, () => {
    test.use({
      viewport: variant.viewport,
      deviceScaleFactor: variant.deviceScaleFactor,
      colorScheme: variant.scheme,
    });

    for (const [name, modules, funder] of [
      ['with grants on', ['grants'], undefined],
      ['with grants off', [], undefined],
      ['in a custom theme', ['grants'], custom],
    ] as const) {
      test(`@a11y the front door ${name} has no axe violations`, async ({ page }) => {
        await open(page, [...modules], funder);
        await page.goto('/northfield/');
        await expect(
          page.getByRole('link', { name: 'Your details and organisations' }),
        ).toBeVisible();

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }

    test('@a11y a tool that is off shows a page with no axe violations', async ({ page }) => {
      await open(page, []);
      await page.goto('/northfield/applications');
      await expect(h1(page, 'Page not found')).toBeVisible();

      await expectNoViolations(page);
      await expectNoHorizontalScroll(page);
    });
  });
}
