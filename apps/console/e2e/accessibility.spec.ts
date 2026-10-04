// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for the console in a real browser, because jsdom cannot judge
// colour contrast or target size (ADR 0006). Each page is checked at desktop
// width, at 320 px wide, and at 200% zoom, which a browser lays out as a
// 640 px wide window at twice the pixel density.

import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';

const widths = [
  { name: 'desktop width', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  { name: '320 px width', viewport: { width: 320, height: 640 }, deviceScaleFactor: 1 },
  { name: '200% zoom', viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 },
];

const pages = [
  { name: 'programmes page', path: '/', heading: 'Programmes', gallery: false },
  { name: 'not found page', path: '/no-such-page', heading: 'Page not found', gallery: false },
  // Production builds leave the gallery out, so the console-gallery project runs this one.
  {
    name: 'component gallery',
    path: '/dev/components',
    heading: 'Component gallery',
    gallery: true,
  },
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
      const tag = target.gallery ? '@gallery ' : '';
      test(`@a11y ${tag}${target.name} has no axe violations`, async ({ page }) => {
        await page.goto(target.path);
        await expect(page.getByRole('heading', { level: 1, name: target.heading })).toBeVisible();

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }

    test('@a11y the skip link has no axe violations while it has focus', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1, name: 'Programmes' })).toBeVisible();

      await page.keyboard.press('Tab');
      await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();

      await expectNoViolations(page);
    });

    test('@a11y @gallery the error summary and field errors have no axe violations', async ({
      page,
    }) => {
      await page.goto('/dev/components');
      await page.getByRole('button', { name: 'Check details' }).click();
      await expect(page.getByRole('alert', { name: 'There is a problem' })).toBeFocused();

      await expectNoViolations(page);
      await expectNoHorizontalScroll(page);
    });
  });
}
