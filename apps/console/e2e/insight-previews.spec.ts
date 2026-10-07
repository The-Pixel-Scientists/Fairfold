// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Insight design previews: axe at every width and in the dark scheme,
// with the numbers behind each chart shown, and the few things a person can
// do on them. They are development-only, so the console-gallery project runs
// them.

import { expect, test } from '../../../scripts/e2e/fixtures.ts';

import { expectNoHorizontalScroll, expectNoViolations, variants } from './auth-axe.ts';

const pages = [
  { name: 'round dashboard', path: '/dev/preview/insight', heading: 'Round dashboard' },
  {
    name: 'equality monitoring',
    path: '/dev/preview/insight/equality',
    heading: 'Equality monitoring',
  },
  {
    name: 'where the money goes',
    path: '/dev/preview/insight/geography',
    heading: 'Where the money goes',
  },
  {
    name: 'reviewer calibration',
    path: '/dev/preview/insight/reviewers',
    heading: 'Reviewer calibration',
  },
  {
    name: 'data warehouse',
    path: '/dev/preview/insight/warehouse',
    heading: 'Your data warehouse',
  },
];

for (const variant of variants) {
  test.describe(`at ${variant.name}`, () => {
    test.use({
      viewport: variant.viewport,
      deviceScaleFactor: variant.deviceScaleFactor,
      colorScheme: variant.scheme,
    });

    for (const target of pages) {
      test(`@a11y @gallery the ${target.name} preview has no axe violations`, async ({ page }) => {
        await page.goto(target.path);
        await expect(page.getByRole('heading', { level: 1, name: target.heading })).toBeVisible();

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);

        // Open every "Show the numbers", so the tables are checked as well.
        for (const summary of await page.getByText('Show the numbers').all()) {
          await summary.click();
        }
        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}

test.describe('on the round dashboard', () => {
  test('@gallery choosing a theme recounts the figures and clearing it brings them back', async ({
    page,
  }) => {
    await page.goto('/dev/preview/insight');
    const stats = page.getByRole('group', { name: 'Round summary' });
    await expect(stats).toContainText('48');
    await expect(stats).toContainText('£612,400');

    await page.getByRole('combobox', { name: 'Theme' }).selectOption({ label: 'Arts' });
    await expect(stats).toContainText('£108,250');
    await expect(stats).not.toContainText('£612,400');

    await page.getByRole('button', { name: 'Clear theme' }).click();
    await expect(stats).toContainText('£612,400');
  });

  test('@gallery the numbers behind a chart open from the keyboard', async ({ page }) => {
    await page.goto('/dev/preview/insight');
    const disclosure = page.getByText('Show the numbers').first();
    await disclosure.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('table', { name: 'Applications at each step' })).toBeVisible();
  });

  test('@gallery a round with no applications says what to expect', async ({ page }) => {
    await page.goto('/dev/preview/insight');
    await page.getByRole('combobox', { name: 'Round' }).selectOption({ label: 'Summer 2027' });
    await expect(page.getByRole('heading', { name: 'No applications yet' })).toBeVisible();
  });
});

test.describe('on equality monitoring', () => {
  test('@gallery a count under 5 is never shown as a number', async ({ page }) => {
    await page.goto('/dev/preview/insight/equality');
    const table = page.getByRole('table', {
      name: 'Applications and awards by answer to "Who leads the organisation"',
    });
    await page.getByText('Show the numbers').first().click();
    const row = table.getByRole('row', { name: /LGBTQ\+/ });
    await expect(row).toContainText('Fewer than 5');
    await expect(row).toContainText('Not shown');
  });
});
