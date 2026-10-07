// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The component gallery and the design previews are for development only.
// A built app shows its not-found page at their addresses.

import { expect, test } from './fixtures.ts';

for (const path of ['/dev/components', '/dev/preview']) {
  test(`shows the not-found page at ${path}`, async ({ page }) => {
    await page.goto(path);

    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  });
}
