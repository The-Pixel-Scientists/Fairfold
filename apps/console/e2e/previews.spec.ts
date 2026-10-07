// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The setup, review and decide design previews, and the signed-out screen: axe
// at every width and in the dark scheme, with every disclosure open and every
// tab shown, and what Sign out and Preview form do. They are development-only,
// so the console-gallery project runs them. The Insight previews have their
// own spec.

// The callbacks passed to page.evaluate run in the browser, so they use DOM types.
/// <reference lib="dom" />

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';

import { expectNoHorizontalScroll, expectNoViolations, variants, widths } from './auth-axe.ts';

const formPath = '/programmes/community-grants/spring-2027/form';
const formPreviewPath = `${formPath}/preview`;
const formSections = 6;

const paths = [
  '',
  '/programmes',
  '/programmes/community-grants',
  '/programmes/community-grants/spring-2027',
  '/programmes/community-grants/spring-2027/rubric',
  formPath,
  formPreviewPath,
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
  '/signed-out',
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

    test('@a11y @gallery every section of the form preview has no axe violations', async ({
      page,
    }) => {
      await page.goto(`/dev/preview${formPreviewPath}`);

      for (let section = 1; section <= formSections; section++) {
        await expect(
          page.getByText(`Section ${String(section)} of ${String(formSections)}`),
        ).toBeVisible();
        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
        if (section < formSections) {
          await page.getByRole('button', { name: 'Next section' }).click();
        }
      }
    });
  });
}

test.describe('on the staff and reviewer shells', () => {
  for (const path of ['/programmes', '/reviews']) {
    test(`@gallery Sign out on ${path} opens the signed-out screen, and Sign in again goes back to the start`, async ({
      page,
    }) => {
      await page.goto(`/dev/preview${path}`);

      await page.getByRole('button', { name: 'Sign out' }).click();

      await expect(page).toHaveURL(/\/dev\/preview\/signed-out$/);
      await expect(
        page.getByRole('heading', { level: 1, name: 'You have signed out' }),
      ).toBeFocused();
      await expect(page.getByRole('navigation')).toHaveCount(0);

      await page.getByRole('link', { name: 'Sign in again' }).click();

      await expect(page).toHaveURL(/\/dev\/preview\/?$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Design previews' })).toBeVisible();
    });
  }
});

test.describe('on the form builder', () => {
  test('@gallery Preview form opens the whole form in a new tab, with a way back', async ({
    page,
    context,
  }) => {
    await page.goto(`/dev/preview${formPath}`);
    const link = page.getByRole('link', { name: 'Preview form' });
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('href', `/dev/preview${formPreviewPath}`);

    const [preview] = await Promise.all([context.waitForEvent('page'), link.click()]);

    await expect(
      preview.getByRole('heading', { level: 1, name: 'About your organisation' }),
    ).toBeVisible();
    await expect(preview.getByText('Nothing you enter here is saved.')).toBeVisible();

    await preview.getByRole('link', { name: 'Back to the form builder' }).first().click();

    await expect(preview).toHaveURL(new RegExp(`/dev/preview${formPath}$`));
    await expect(preview.getByRole('heading', { level: 1, name: 'Form builder' })).toBeVisible();
  });
});

test.describe('on the form preview', () => {
  test('@gallery walks the sections, keeps answers, and shows a question only when it applies', async ({
    page,
  }) => {
    await page.goto(`/dev/preview${formPreviewPath}`);
    const charityNumber = page.getByLabel('Registered charity number');
    await expect(page.getByRole('button', { name: 'Previous section' })).toHaveCount(0);
    await expect(charityNumber).toHaveCount(0);

    await page.getByRole('radio', { name: 'Yes' }).check();

    await expect(charityNumber).toBeVisible();
    await expect(page.getByRole('group', { name: 'Governing document' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Next section' }).click();

    await expect(page.getByText('Section 2 of 6')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Your project' })).toBeFocused();

    await page.getByRole('button', { name: 'Previous section' }).click();

    await expect(page.getByRole('radio', { name: 'Yes' })).toBeChecked();
  });

  test('@gallery the budget takes new rows and adds them up', async ({ page }) => {
    await page.goto(`/dev/preview${formPreviewPath}`);
    for (let section = 0; section < 2; section++) {
      await page.getByRole('button', { name: 'Next section' }).click();
    }
    await expect(page.getByRole('heading', { level: 1, name: 'Budget' })).toBeFocused();
    await expect(page.getByRole('cell', { name: '£13,500' })).toBeVisible();

    await page.getByRole('button', { name: 'Add a cost' }).click();

    await expect(page.getByRole('textbox', { name: 'Item, row 7' })).toBeFocused();
    await page.getByRole('textbox', { name: 'Cost, row 7' }).fill('500');
    await expect(page.getByRole('cell', { name: '£14,000' })).toBeVisible();

    await page.getByRole('button', { name: 'Remove row 7, Costs of the project' }).click();

    await expect(page.getByRole('cell', { name: '£13,500' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add a cost' })).toBeFocused();
  });

  test('@gallery the amount asked for is worked out from the budget, not typed in', async ({
    page,
  }) => {
    await page.goto(`/dev/preview${formPreviewPath}`);
    for (let section = 0; section < 2; section++) {
      await page.getByRole('button', { name: 'Next section' }).click();
    }
    const requested = page.getByRole('group', { name: 'Amount you are asking for' });
    await expect(requested).toContainText('We work this out for you');
    await expect(requested.getByText('£12,500', { exact: true })).toBeVisible();
    await expect(requested.getByRole('textbox')).toHaveCount(0);

    await page.getByRole('button', { name: 'Add a cost' }).click();
    await page.getByRole('textbox', { name: 'Cost, row 7' }).fill('500');

    await expect(requested.getByText('£13,000', { exact: true })).toBeVisible();

    await page.getByRole('textbox', { name: 'Amount, row 1' }).fill('2,000');

    await expect(requested.getByText('£12,000', { exact: true })).toBeVisible();
  });

  test('@gallery the text in a budget is in boxes that wrap, and a cost is not', async ({
    page,
  }) => {
    await page.goto(`/dev/preview${formPreviewPath}`);
    for (let section = 0; section < 2; section++) {
      await page.getByRole('button', { name: 'Next section' }).click();
    }

    await expect(page.getByRole('textbox', { name: 'Detail, row 3' })).toHaveValue(
      /There and back for 12 people: 48 Tuesdays at £50/,
    );
    for (const name of ['Item, row 3', 'Detail, row 3', 'Where the money comes from, row 1']) {
      await expect(page.getByRole('textbox', { name })).toHaveJSProperty('tagName', 'TEXTAREA');
    }
    await expect(page.getByRole('textbox', { name: 'Cost, row 3' })).toHaveJSProperty(
      'tagName',
      'INPUT',
    );
  });

  for (const width of widths) {
    test.describe(`at ${width.name}`, () => {
      test.use({ viewport: width.viewport, deviceScaleFactor: width.deviceScaleFactor });

      test('@gallery everything typed in the budget shows in full, and a long item grows its box', async ({
        page,
      }) => {
        await page.goto(`/dev/preview${formPreviewPath}`);
        for (let section = 0; section < 2; section++) {
          await page.getByRole('button', { name: 'Next section' }).click();
        }
        // 6 items and 6 details in the costs, and one funder.
        await expect(page.locator('table textarea')).toHaveCount(13);

        const cutOff = () =>
          page.evaluate(() =>
            [
              ...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
                'table input, table textarea',
              ),
            ]
              .filter((box) =>
                box instanceof HTMLTextAreaElement
                  ? box.scrollHeight > box.clientHeight
                  : box.scrollWidth > box.clientWidth,
              )
              .map((box) => box.getAttribute('aria-label')),
          );

        expect(await cutOff(), 'These boxes cut off what is in them').toEqual([]);

        const item = page.getByRole('textbox', { name: 'Item, row 1' });
        const before = (await item.boundingBox())?.height ?? 0;
        await item.fill(
          'Hall hire for the weekly lunch club, the kitchen, the car park and the garden room',
        );

        expect((await item.boundingBox())?.height ?? 0).toBeGreaterThan(before);
        expect(await cutOff(), 'These boxes cut off what is in them').toEqual([]);
      });
    });
  }

  test('@gallery a question that can be left blank says so, whatever kind it is', async ({
    page,
  }) => {
    await page.goto(`/dev/preview${formPreviewPath}`);
    await expect(
      page.getByRole('group', { name: 'Who leads your organisation? (optional)' }),
    ).toBeVisible();
    await expect(page.getByRole('group', { name: 'Registered charity' })).toBeVisible();

    await page.getByRole('button', { name: 'Next section' }).click();

    await expect(
      page.getByRole('group', { name: 'Who will benefit most from your project? (optional)' }),
    ).toBeVisible();
    await expect(page.getByRole('group', { name: 'Which areas will it serve?' })).toBeVisible();

    await page.getByRole('button', { name: 'Next section' }).click();

    await expect(
      page.getByRole('group', { name: 'Evidence of other funding (optional)' }),
    ).toBeVisible();
  });

  test('@gallery each budget table has its own name and description, and unique buttons', async ({
    page,
  }) => {
    await page.goto(`/dev/preview${formPreviewPath}`);
    for (let section = 0; section < 2; section++) {
      await page.getByRole('button', { name: 'Next section' }).click();
    }

    await expect(
      page.getByRole('table', { name: 'Costs of the project' }),
    ).toHaveAccessibleDescription(/Add a line for each cost/);
    await expect(
      page.getByRole('table', { name: 'Other funding (optional)' }),
    ).toHaveAccessibleDescription(/Is any other money going into this project/);
    await expect(
      page.getByRole('button', { name: 'Remove row 1, Costs of the project' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove row 1, Other funding' })).toBeVisible();
  });

  test('@gallery the budget says the new total and the row added or removed, once edits stop', async ({
    page,
  }) => {
    await page.goto(`/dev/preview${formPreviewPath}`);
    for (let section = 0; section < 2; section++) {
      await page.getByRole('button', { name: 'Next section' }).click();
    }
    const costs = page.getByRole('status').filter({ hasText: /Total cost of the project is/ });
    await expect(costs).toHaveText('Total cost of the project is £13,500');

    await page.getByRole('button', { name: 'Add a cost' }).click();
    await page.getByRole('textbox', { name: 'Cost, row 7' }).fill('500');

    await expect(costs).toHaveText('Total cost of the project is £14,000', { timeout: 5000 });

    await page.getByRole('button', { name: 'Remove row 7, Costs of the project' }).click();

    await expect(costs).toHaveText('Row 7 removed. Total cost of the project is £13,500', {
      timeout: 5000,
    });
  });

  test('@gallery the word count is tied to the answer and spoken once typing stops', async ({
    page,
  }) => {
    await page.goto(`/dev/preview${formPreviewPath}`);
    await page.getByRole('button', { name: 'Next section' }).click();
    const summary = page.getByRole('textbox', { name: 'Project summary' });
    await expect(summary).toHaveAccessibleDescription(/You have 50 words left/);

    await summary.fill('one two three');

    await expect(page.getByText('You have 47 words left')).toBeVisible();
    await expect(summary).toHaveAccessibleDescription(/You have 47 words left/);
    const status = page.getByRole('status').filter({ hasText: 'You have 47 words left' });
    await expect(status).toHaveText('You have 47 words left', { timeout: 5000 });
  });

  test('@gallery the email and number questions ask the browser for the right keyboard', async ({
    page,
  }) => {
    await page.goto(`/dev/preview${formPreviewPath}`);

    const email = page.getByRole('textbox', { name: 'Main contact email' });
    await expect(email).toHaveAttribute('type', 'email');
    await expect(email).toHaveAttribute('autocomplete', 'email');
    await expect(
      page.getByRole('textbox', { name: 'Paid staff and regular volunteers' }),
    ).toHaveAttribute('inputmode', 'numeric');
  });
});

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
