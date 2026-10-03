// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for the portal in a real browser, because jsdom cannot judge
// colour contrast or target size (ADR 0006). Each page is checked at desktop
// width, at 320 px wide, and at 200% zoom, which a browser lays out as a
// 640 px wide window at twice the pixel density.

// The callbacks passed to page.evaluate run in the browser, so they use DOM types.
/// <reference lib="dom" />

import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const widths = [
  { name: 'desktop width', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  { name: '320 px width', viewport: { width: 320, height: 640 }, deviceScaleFactor: 1 },
  { name: '200% zoom', viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 },
];

const pages = [
  { name: 'home page', path: '/', heading: 'Apply for a grant' },
  { name: 'how applying works page', path: '/how-applying-works', heading: 'How applying works' },
  { name: 'not found page', path: '/no-such-page', heading: 'Page not found' },
];

/** WCAG 2.0 to 2.2 level A and AA, plus axe's own best practices. */
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(tags).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'The page scrolls sideways').toBeLessThanOrEqual(0);
}

for (const width of widths) {
  test.describe(`at ${width.name}`, () => {
    test.use({ viewport: width.viewport, deviceScaleFactor: width.deviceScaleFactor });

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
        page.getByRole('heading', { level: 1, name: 'Apply for a grant' }),
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
      await page.route('**/HowApplyingWorksPage.tsx*', (route) => route.abort());
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
    await expect(page.getByRole('heading', { level: 1, name: 'Apply for a grant' })).toBeVisible();

    await expectNoViolations(page);
    await expectNoHorizontalScroll(page);
  });
});
