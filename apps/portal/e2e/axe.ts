// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the axe specs share: the three widths every page is checked at, the
// dark scheme at desktop width, and the checks themselves.

// The callbacks passed to page.evaluate run in the browser, so they use DOM types.
/// <reference lib="dom" />

import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { expect } from '../../../scripts/e2e/fixtures.ts';

/** Desktop, a small phone, and 200% zoom, which a browser lays out as a 640 px window at twice the pixel density. */
const desktop = {
  name: 'desktop width',
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
};

export const widths = [
  desktop,
  { name: '320 px width', viewport: { width: 320, height: 640 }, deviceScaleFactor: 1 },
  { name: '200% zoom', viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 },
];

/**
 * What each axe spec loops over: every width in the light scheme, and desktop
 * width in the dark one. The scheme changes colours, not layout, so one width
 * is enough. Each variant says which scheme the browser emulates before the
 * page loads, so the start-up script (packages/ui/src/public/scheme.js) takes
 * it from the device.
 */
export const variants = [
  ...widths.map((width) => ({ ...width, scheme: 'light' as const })),
  { ...desktop, name: 'desktop width in the dark scheme', scheme: 'dark' as const },
];

/** WCAG 2.0 to 2.2 level A and AA, plus axe's own best practices. */
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

export async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(tags).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'The page scrolls sideways').toBeLessThanOrEqual(0);
}
