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
  '/application/organisation',
  '/application/project',
  '/application/budget',
  '/application/outcomes',
  '/application/documents',
  '/application/check',
  '/application/submitted',
  '/applications',
  '/outcome',
  '/outcome/letter',
  '/signed-out',
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

test.describe('the demo journeys', () => {
  test('@gallery a "Change" link opens its section with focus in the question', async ({
    page,
  }) => {
    await page.goto('/dev/preview/application/check');
    await page.getByRole('link', { name: 'Change main contact email' }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: 'About your organisation' }),
    ).toBeVisible();
    await expect(page.getByLabel(/^Main contact email/)).toBeFocused();
  });

  test('@gallery a section opened at a fragment puts focus in that question', async ({ page }) => {
    await page.goto('/dev/preview/application/project#end-date');

    await expect(page.getByRole('group', { name: /^End date/ }).getByLabel('Day')).toBeFocused();
  });

  test('@gallery "Sign out" leads to a page that says your work is safe', async ({ page }) => {
    await page.goto('/dev/preview/application');
    await page.getByRole('button', { name: 'Sign out' }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: 'You have signed out' }),
    ).toBeFocused();
    await expect(page.getByText(/Your work is safe/)).toBeVisible();
    await expect(page.getByText('Riverside Pocket Garden')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Sign in again' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Design previews' })).toBeVisible();
  });

  test('@gallery a fresh load of the signed-out page with a trailing slash shows no email and no "Sign out"', async ({
    page,
  }) => {
    await page.goto('/dev/preview/signed-out/');

    await expect(
      page.getByRole('heading', { level: 1, name: 'You have signed out' }),
    ).toBeVisible();
    await expect(page.getByText('sam@example.org')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);

    await page.reload();

    await expect(
      page.getByRole('heading', { level: 1, name: 'You have signed out' }),
    ).toBeVisible();
    await expect(page.getByText('sam@example.org')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
  });

  test('@gallery the draft on the list says the demo walks through one application, and links to its start', async ({
    page,
  }) => {
    await page.goto('/dev/preview/applications');
    await page
      .getByRole('button', { name: 'Continue application for Riverside Pocket Garden' })
      .click();

    await expect(
      page.getByText(
        'This demo walks through one application, Riverside Lunch Club, from the start.',
      ),
    ).toBeVisible();
    await page
      .getByRole('link', { name: 'See the Riverside Lunch Club application from the start' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Community Grants' })).toBeVisible();
  });

  test('@gallery the decision letter prints on its own, without the shell', async ({ page }) => {
    await page.goto('/dev/preview/outcome');
    await page.getByRole('link', { name: 'Read or print your decision letter' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Your decision letter' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print or save as PDF' })).toBeVisible();

    await page.emulateMedia({ media: 'print' });

    await expect(page.getByRole('banner')).toHaveCount(0);
    await expect(page.getByRole('contentinfo')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Print or save as PDF' })).toBeHidden();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Your decision letter' }),
    ).toBeHidden();
    await expect(page.getByRole('article')).toBeVisible();
    await expect(page.getByText('Northfield Foundation').first()).toBeVisible();
  });
});
