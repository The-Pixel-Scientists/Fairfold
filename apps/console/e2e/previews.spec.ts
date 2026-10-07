// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The setup, review and decide design previews: axe at every width and in the
// dark scheme, with every disclosure open and every tab shown. They are
// development-only, so the console-gallery project runs them. The Insight
// previews have their own spec.

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';

import { expectNoHorizontalScroll, expectNoViolations, variants } from './auth-axe.ts';

const paths = [
  '',
  '/programmes',
  '/programmes/community-grants',
  '/programmes/community-grants/spring-2027',
  '/programmes/community-grants/spring-2027/rubric',
  '/programmes/community-grants/spring-2027/form',
  '/submissions',
  '/submissions/NF-CG-0412',
  '/submissions/NF-CG-0412/due-diligence',
  '/submissions/NF-CG-0402',
  '/reviews',
  '/reviews/NF-CG-0398',
  '/reviews/NF-CG-0402',
  '/reviews/spread',
  '/decisions',
  '/decisions/release',
  '/reports',
  '/organisations',
  '/organisations/northfield-community-trust',
  '/team',
  '/audit',
  '/settings',
];

/** The tabs on a preview after the first, which the page shows only once they are opened. */
const otherTabs: Record<string, string[]> = {
  '/settings': ['Look and logo', 'Modules'],
};

/** Axe and sideways scrolling, before and after opening every closed disclosure on the page. */
async function expectNoProblems(page: Page) {
  await expectNoViolations(page);
  await expectNoHorizontalScroll(page);

  // Each disclosure that opens leaves the list, so take the first as many times as it began with.
  const closed = page.locator('details:not([open]) > summary');
  for (let remaining = await closed.count(); remaining > 0; remaining--) {
    await closed.first().click();
  }
  await expectNoViolations(page);
  await expectNoHorizontalScroll(page);
}

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
        await expectNoProblems(page);

        for (const tab of otherTabs[path] ?? []) {
          await page.getByRole('tab', { name: tab }).click();
          await expectNoProblems(page);
        }
      });
    }
  });
}

test.describe('on Organisations', () => {
  test('@gallery the list links to the record of Northfield Community Trust', async ({ page }) => {
    await page.goto('/dev/preview/organisations');
    const link = page.getByRole('link', { name: 'Northfield Community Trust' });
    await expect(link).toHaveAttribute(
      'href',
      '/dev/preview/organisations/northfield-community-trust',
    );

    await link.click();

    await expect(page).toHaveURL(/\/dev\/preview\/organisations\/northfield-community-trust$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Northfield Community Trust' }),
    ).toBeVisible();
  });
});

test.describe('on Settings', () => {
  test('@gallery each tab opens and shows its own section', async ({ page }) => {
    await page.goto('/dev/preview/settings');
    const sections = [
      { tab: 'General', heading: 'Funder details' },
      { tab: 'Look and logo', heading: 'Brand colour and preset' },
      { tab: 'Modules', heading: 'Available modules' },
    ];

    for (const { tab, heading } of sections) {
      await page.getByRole('tab', { name: tab }).click();

      await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('tabpanel')).toBeVisible();
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    }
  });
});
