// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for the impact screens and dialogs, at desktop width, at 320 px
// wide and at 200% zoom (ADR 0006), and at desktop width in the dark scheme,
// with the API's answers stubbed (impact-api.ts). In console-production they
// run under the production content security policy.

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { expectNoHorizontalScroll, expectNoViolations, variants } from './auth-axe.ts';
import { frameworkId, stubImpact } from './impact-api.ts';

/** Each page loads its code when it is first opened, which a busy machine or a development server's first compile can slow past five seconds. */
const expect = strictExpect.configure({ timeout: 15_000 });

/** A framework with one indicator, made through the screens as a member would. */
async function withFramework(page: Page) {
  await stubImpact(page);
  await page.goto('/northfield/impact/new');
  await page.getByLabel('Name', { exact: true }).fill('Wellbeing');
  await page.getByLabel('Outcome 1 name').fill('Less isolation');
  await page.getByRole('button', { name: 'Add an indicator to outcome 1' }).click();
  await page.getByLabel('Indicator 1.1 name').fill('Walks led');
  await page.getByRole('button', { name: 'Create framework' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Wellbeing' })).toBeVisible();
}

const states = [
  {
    name: 'the empty frameworks list',
    open: async (page: Page) => {
      await stubImpact(page);
      await page.goto('/northfield/impact');
      await expect(page.getByText('No outcomes frameworks yet')).toBeVisible();
    },
  },
  {
    name: 'the new framework form with its problems',
    open: async (page: Page) => {
      await stubImpact(page);
      await page.goto('/northfield/impact/new');
      await page.getByRole('button', { name: 'Create framework' }).click();
      await expect(page.getByRole('alert', { name: 'There is a problem' })).toBeVisible();
    },
  },
  { name: 'a framework with no targets or results', open: withFramework },
  {
    name: 'the set a target dialog',
    open: async (page: Page) => {
      await withFramework(page);
      await page.getByRole('button', { name: 'Set a target' }).click();
      await expect(page.getByRole('dialog', { name: 'Set a target' })).toBeVisible();
    },
  },
  {
    name: 'the record a result dialog',
    open: async (page: Page) => {
      await withFramework(page);
      await page.getByRole('button', { name: 'Record a result' }).click();
      await expect(page.getByRole('dialog', { name: 'Record a result' })).toBeVisible();
    },
  },
  {
    name: 'the edit framework form',
    open: async (page: Page) => {
      await withFramework(page);
      await page.goto(`/northfield/impact/${frameworkId}/edit`);
      await expect(page.getByRole('heading', { level: 1, name: 'Edit framework' })).toBeVisible();
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
        await state.open(page);
        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}
