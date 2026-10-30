// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe on the pages a step visits, in the signed-in session it used.

import type { Page } from '@playwright/test';

import { expectNoViolations } from '../../apps/portal/e2e/axe.ts';

/**
 * Opens each path in the page, waits for its heading, and checks it with axe
 * (WCAG 2.0 to 2.2 A and AA, and best practices).
 */
export async function axePages(page: Page, paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    await page.goto(path);
    await page.getByRole('heading', { level: 1 }).first().waitFor();
    await expectNoViolations(page);
  }
}
