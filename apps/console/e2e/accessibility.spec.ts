// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for the console in a real browser, because jsdom cannot judge
// colour contrast or target size (ADR 0006). Each page is checked at desktop
// width, at 320 px wide, and at 200% zoom. The sign-in screens and their
// states are in auth-accessibility.spec.ts.

import { expect, test } from '../../../scripts/e2e/fixtures.ts';

import { stubSignedIn } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, widths } from './auth-axe.ts';

const pages = [
  {
    name: 'programmes page',
    path: '/northfield/',
    heading: 'Programmes',
    signedIn: true,
    gallery: false,
  },
  {
    name: 'start page',
    path: '/',
    heading: "Use your funder's link",
    signedIn: false,
    gallery: false,
  },
  {
    name: 'not found page',
    path: '/Not-A-Funder',
    heading: 'Page not found',
    signedIn: false,
    gallery: false,
  },
  // Production builds leave the gallery out, so the console-gallery project runs this one.
  {
    name: 'component gallery',
    path: '/dev/components',
    heading: 'Component gallery',
    signedIn: false,
    gallery: true,
  },
];

for (const width of widths) {
  test.describe(`at ${width.name}`, () => {
    test.use({ viewport: width.viewport, deviceScaleFactor: width.deviceScaleFactor });

    for (const target of pages) {
      const tag = target.gallery ? '@gallery ' : '';
      test(`@a11y ${tag}${target.name} has no axe violations`, async ({ page }) => {
        if (target.signedIn) await stubSignedIn(page);
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

    test('@a11y @gallery the error summary and field errors have no axe violations', async ({
      page,
    }) => {
      await page.goto('/dev/components');
      await page.getByRole('button', { name: 'Check details' }).click();
      await expect(page.getByRole('alert', { name: 'There is a problem' })).toBeFocused();

      await expectNoViolations(page);
      await expectNoHorizontalScroll(page);
    });

    test('@a11y @gallery an open dialog has no axe violations', async ({ page }) => {
      await page.goto('/dev/components');
      await page.getByRole('button', { name: 'Open dialog' }).click();
      await expect(page.getByRole('dialog', { name: 'Switch funder' })).toBeVisible();

      await expectNoViolations(page);
      await expectNoHorizontalScroll(page);
    });

    test('@a11y @gallery the step-up dialog, with its error, has no axe violations', async ({
      page,
    }) => {
      await page.goto('/dev/components');
      await page.getByRole('button', { name: 'Open step-up dialog' }).click();
      const dialog = page.getByRole('dialog', { name: 'Confirm it is you' });
      await dialog.getByLabel('Password').fill('correct horse battery');
      await dialog.getByLabel('Code from your authenticator app').fill('123456');
      await dialog.getByRole('button', { name: 'Confirm it is you' }).click();
      await expect(dialog.getByRole('alert', { name: 'There is a problem' })).toBeFocused();

      await expectNoViolations(page);
      await expectNoHorizontalScroll(page);
    });
  });
}
