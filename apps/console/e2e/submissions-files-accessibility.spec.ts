// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for a submission's files, at desktop width, at 320 px wide and
// at 200% zoom (ADR 0006), and at desktop width in the dark scheme, with the
// API's answers stubbed (submissions-files-api.ts). In console-production they
// run under the production content security policy.

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { expectNoHorizontalScroll, expectNoViolations, variants } from './auth-axe.ts';
import { attachments, stubFiles } from './submissions-files-api.ts';

/** Each page loads its code when it is first opened, which a busy machine or a development server's first compile can slow past five seconds. */
const expect = strictExpect.configure({ timeout: 15_000 });

const states: { name: string; files: typeof attachments; check: (page: Page) => Promise<void> }[] =
  [
    {
      name: 'a submission with files',
      files: attachments,
      check: async (page) => {
        await expect(
          page.getByRole('link', { name: /^Download accounts-2026\.pdf,/ }),
        ).toBeVisible();
      },
    },
    {
      name: 'a submission with no files',
      files: [],
      check: async (page) => {
        await expect(page.getByText('No files uploaded')).toHaveCount(3);
      },
    },
    {
      name: 'a submission with a file focused',
      files: attachments,
      check: async (page) => {
        const link = page.getByRole('link', { name: /^Download hall front\.png,/ });
        await link.focus();
        await expect(link).toBeFocused();
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
        const { id } = await stubFiles(page, state.files);
        await page.goto(`/northfield/submissions/${id}`);
        await expect(page.getByRole('tabpanel', { name: 'Application' })).toBeVisible();
        await state.check(page);
        await expect(page.locator('h1')).toHaveCount(1);

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}
