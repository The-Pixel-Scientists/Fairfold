// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How sensitive an answer is, as a programme manager sets it in the shared
// form builder: the control, the explanation for special category, and axe
// checks of those states at desktop width, 320 px wide and 200% zoom, with the
// API's answers stubbed (form-builder-api.ts). In console-production they run
// under the production content security policy.

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { expectNoHorizontalScroll, expectNoViolations, variants } from './auth-axe.ts';
import { ids, organisationForm, stubForms, version } from './form-builder-api.ts';
import { editor } from './form-builder-steps.ts';

const expect = strictExpect.configure({ timeout: 15_000 });

const draft = `/northfield/rounds/${ids.round}/form/${ids.versions[0]}`;
const level = (page: Page) =>
  editor(page, 'Edit question').getByRole('combobox', { name: 'How sensitive is this answer?' });

async function open(page: Page): Promise<void> {
  await stubForms(page, [version(1, 'draft', organisationForm)]);
  await page.goto(draft);
  await expect(level(page)).toBeVisible();
}

test('a question shows its level with a hint, and has no level written until it is changed', async ({
  page,
}) => {
  await open(page);

  await expect(level(page)).toHaveValue('personal');
  await expect(editor(page, 'Edit question')).toContainText('Personal: about a named person.');
});

test('choosing special category explains it and leaves who sees the answer alone', async ({
  page,
}) => {
  await open(page);
  const audiences = editor(page, 'Edit question').getByRole('combobox', {
    name: 'Who sees the answer',
  });
  const before = await audiences.inputValue();

  await level(page).selectOption('Special category');

  await expect(editor(page, 'Edit question')).toContainText('see these only in totals');
  await expect(audiences).toHaveValue(before);
  await expect(
    editor(page, 'Edit question').getByText(
      'Show answers to special category questions only in totals.',
    ),
  ).toBeVisible();
});

for (const variant of variants) {
  test.describe(`at ${variant.name}`, () => {
    test.use({
      viewport: variant.viewport,
      deviceScaleFactor: variant.deviceScaleFactor,
      colorScheme: variant.scheme,
    });

    test('@a11y the classification control has no axe violations', async ({ page }) => {
      await open(page);
      await expect(page.locator('h1')).toHaveCount(1);

      await expectNoViolations(page);
      await expectNoHorizontalScroll(page);
    });

    test('@a11y special category with its problem has no axe violations', async ({ page }) => {
      await open(page);
      await level(page).selectOption('Special category');
      await expect(editor(page, 'Edit question')).toContainText('only in totals');

      await expectNoViolations(page);
      await expectNoHorizontalScroll(page);
    });
  });
}
