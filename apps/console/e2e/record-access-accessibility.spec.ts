// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for the Emergency access page and its states, at desktop width,
// at 320 px wide and at 200% zoom (ADR 0006), and at desktop width in the
// dark scheme, with the API's answers stubbed. In console-production they run
// under the production content security policy. The panel and the dialog have
// no page to open them on until a module adopts them.

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { problem, stubSignedIn } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './auth-axe.ts';

/** Each page loads its code when first opened, which a busy machine or a development server's first compile can slow past five seconds. */
const expect = strictExpect.configure({ timeout: 15_000 });

const LIST = 'GET /console/break-glass';
const allowed = ['platform.break_glass.use'];

interface State {
  name: string;
  stub: (page: Page) => Promise<unknown>;
  open: (page: Page) => Promise<void>;
}

const states: State[] = [
  {
    name: 'the emergency access page with nothing open',
    stub: (page) =>
      stubSignedIn(
        page,
        { permissions: allowed },
        { [LIST]: { status: 200, body: { grants: [] } } },
      ),
    open: async (page) => {
      await page.goto('/northfield/emergency-access');
      await expect(
        page.getByRole('heading', { level: 2, name: 'No emergency access is open' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the emergency access page that could not be loaded',
    stub: (page) =>
      stubSignedIn(
        page,
        { permissions: allowed },
        { [LIST]: problem(503, 'The service is busy. Try again in a minute.') },
      ),
    open: async (page) => {
      await page.goto('/northfield/emergency-access');
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    },
  },
  {
    name: 'the emergency access page for someone without the permission',
    stub: (page) => stubSignedIn(page, { permissions: [] }),
    open: async (page) => {
      await page.goto('/northfield/emergency-access');
      await expect(
        page.getByRole('heading', { level: 2, name: 'You cannot open records in an emergency' }),
      ).toBeVisible();
    },
  },
];

for (const variant of variants) {
  test.describe(`at ${variant.name}`, () => {
    test.use({
      viewport: variant.viewport,
      deviceScaleFactor: variant.deviceScaleFactor,
      colorScheme: variant.scheme,
    });

    for (const state of states) {
      test(`@a11y ${state.name} has no axe violations`, async ({ page }) => {
        await state.stub(page);
        await state.open(page);
        await expect(page.locator('h1')).toHaveCount(1);

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}
