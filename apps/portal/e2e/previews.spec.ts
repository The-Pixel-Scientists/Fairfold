// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The applying design previews: axe at every width and in the dark scheme,
// with every disclosure open. They are development-only, so only the Vite dev
// project runs them; production builds leave them out.

import { expect, test } from '../../../scripts/e2e/fixtures.ts';

import { expectNoHorizontalScroll, expectNoViolations, variants } from './axe.ts';

const paths = [
  '',
  '/round',
  '/application',
  '/application/budget',
  '/application/documents',
  '/application/check',
  '/application/submitted',
  '/applications',
  '/outcome',
];

for (const variant of variants) {
  test.describe(`at ${variant.name}`, () => {
    test.use({
      viewport: variant.viewport,
      deviceScaleFactor: variant.deviceScaleFactor,
      colorScheme: variant.scheme,
    });

    for (const path of paths) {
      test(`@a11y @gallery the preview at /dev/preview${path} has no axe violations`, async ({
        page,
      }) => {
        await page.goto(`/dev/preview${path}`);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);

        // Open every closed disclosure, so what it holds is checked as well. Each
        // one that opens leaves the list, so take the first as many times as it began with.
        const closed = page.locator('details:not([open]) > summary');
        for (let remaining = await closed.count(); remaining > 0; remaining--) {
          await closed.first().click();
        }
        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}
