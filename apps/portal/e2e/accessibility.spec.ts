// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for the portal in a real browser, because jsdom cannot judge
// colour contrast or target size (ADR 0006). Each page is checked at desktop
// width, at 320 px wide, and at 200% zoom, which a browser lays out as a
// 640 px wide window at twice the pixel density.

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './axe.ts';

const pages = [
  { name: 'home page', path: '/', heading: "Use your funder's link" },
  { name: 'how applying works page', path: '/how-applying-works', heading: 'How applying works' },
  { name: 'not found page', path: '/Not-Found', heading: 'Page not found' },
];

for (const variant of variants) {
  test.describe(`at ${variant.name}`, () => {
    test.use({
      viewport: variant.viewport,
      deviceScaleFactor: variant.deviceScaleFactor,
      colorScheme: variant.scheme,
    });

    for (const target of pages) {
      test(`@a11y ${target.name} has no axe violations`, async ({ page }) => {
        await page.goto(target.path);
        await expect(page.getByRole('heading', { level: 1, name: target.heading })).toBeVisible();

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }

    test('@a11y the skip link has no axe violations while it has focus', async ({ page }) => {
      await page.goto('/');
      await expect(
        page.getByRole('heading', { level: 1, name: "Use your funder's link" }),
      ).toBeVisible();

      await page.keyboard.press('Tab');
      await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();

      await expectNoViolations(page);
    });

    test('@a11y a link with focus has no axe violations', async ({ page }) => {
      await page.goto('/how-applying-works');
      await expect(
        page.getByRole('heading', { level: 1, name: 'How applying works' }),
      ).toBeVisible();

      await page.getByRole('link', { name: 'Back to the home page' }).focus();

      await expectNoViolations(page);
    });

    test('@a11y the page that failed to load has no axe violations', async ({ page }) => {
      await page.route('**/HowApplyingWorksPage*', (route) => route.abort());
      await page.goto('/');
      await page.getByRole('link', { name: 'Read how applying works' }).click();
      await expect(
        page.getByRole('heading', { level: 1, name: 'We could not load this page' }),
      ).toBeVisible();

      await expectNoViolations(page);
      await expectNoHorizontalScroll(page);
    });
  });
}

test.describe('with reduced motion and forced colours', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('@a11y the home page has no axe violations', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: "Use your funder's link" }),
    ).toBeVisible();

    await expectNoViolations(page);
    await expectNoHorizontalScroll(page);
  });
});
