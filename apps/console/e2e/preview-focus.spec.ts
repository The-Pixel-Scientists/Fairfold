// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Where keyboard focus goes on the setup, review and decide design previews
// when a control removes itself, a form fails or a step finishes. They are
// development-only, so the console-gallery project runs them.

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';

const pressEnterOn = async (page: Page, name: string) => {
  await page.getByRole('button', { name }).first().focus();
  await page.keyboard.press('Enter');
};

test.describe('on Release decisions', () => {
  test('@gallery focus moves to the confirmation once the decisions are released', async ({
    page,
  }) => {
    await page.goto('/dev/preview/decisions/release');
    await page.getByRole('checkbox', { name: /I have checked the summary/ }).check();
    await page.getByRole('button', { name: 'Release decisions' }).click();
    await page.getByLabel('Password').fill('correct horse battery');
    await page.getByLabel('Code from your authenticator app').fill('123456');
    await page.getByRole('button', { name: 'Confirm it is you' }).click();

    const done = page.getByRole('status').filter({ hasText: 'Decisions released' });
    await expect(done).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Back to decisions' })).toBeFocused();
  });
});

test.describe('on Decisions', () => {
  test('@gallery focus moves to Release decisions once the changes are recorded', async ({
    page,
  }) => {
    await page.goto('/dev/preview/decisions');
    await page
      .getByRole('group', { name: /^Decision for/ })
      .first()
      .getByText('Waitlist')
      .click();
    await expect(page.getByRole('status').filter({ hasText: 'not recorded' })).toHaveText(
      '1 decision is not recorded.',
    );

    await pressEnterOn(page, 'Record the change');

    await expect(page.getByRole('link', { name: 'Release decisions' })).toBeFocused();
  });

  test('@gallery an amount that is too high says how to fix it', async ({ page }) => {
    await page.goto('/dev/preview/decisions');

    await page
      .getByRole('textbox', { name: /Recommended amount for/ })
      .first()
      .fill('999999');

    await expect(page.getByText(/Enter £[\d,]+ or less, the amount requested\./)).toBeVisible();
  });
});

test.describe('on Submissions', () => {
  test('@gallery a bare slash does nothing', async ({ page }) => {
    await page.goto('/dev/preview/submissions');
    await expect(page.getByRole('heading', { level: 1, name: 'Submissions' })).toBeVisible();

    await page.keyboard.press('/');

    await expect(page.getByRole('searchbox', { name: 'Search' })).not.toBeFocused();
  });

  test('@gallery Clear filters returns focus to Search', async ({ page }) => {
    await page.goto('/dev/preview/submissions');
    const search = page.getByRole('searchbox', { name: 'Search' });
    await search.fill('no such submission');
    await expect(page.getByText('No submissions match these filters')).toBeVisible();

    await pressEnterOn(page, 'Clear filters');

    await expect(search).toBeFocused();
    await expect(search).toHaveValue('');
  });

  test('@gallery Clear selection returns focus to the select all box', async ({ page }) => {
    await page.goto('/dev/preview/submissions');

    await pressEnterOn(page, 'Clear selection');

    await expect(
      page.getByRole('checkbox', { name: 'Select every submission on this page' }),
    ).toBeFocused();
  });

  test('@gallery the last page keeps focus on Next page, which is disabled', async ({ page }) => {
    await page.goto('/dev/preview/submissions');
    const next = page.getByRole('button', { name: 'Next page' });
    await next.focus();

    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Page 3 of 3')).toBeVisible();
    await page.keyboard.press('Enter');

    await expect(next).toBeFocused();
    await expect(next).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText('Page 3 of 3')).toBeVisible();
  });
});

test.describe('in the scoring workspace', () => {
  test('@gallery a conflict without a reason puts focus on the reason', async ({ page }) => {
    await page.goto('/dev/preview/reviews/NF-CG-0398');
    await page.getByRole('button', { name: 'Declare a conflict' }).click();
    const dialog = page.getByRole('dialog', { name: 'Declare a conflict of interest' });

    await dialog.getByRole('button', { name: 'Declare a conflict' }).click();

    await expect(
      dialog.getByRole('textbox', { name: 'Why do you have a conflict?' }),
    ).toBeFocused();
    await expect(dialog.getByText('Tell staff why you are declaring a conflict')).toBeVisible();
  });

  test('@gallery changing a submitted review puts focus on the form heading', async ({ page }) => {
    await page.goto('/dev/preview/reviews/NF-CG-0398');
    await expect(page.getByRole('radiogroup').first()).toBeVisible();
    for (const group of await page.getByRole('radiogroup').all()) {
      await group.locator('label').nth(2).click();
    }
    await pressEnterOn(page, 'Submit review');
    await expect(
      page.getByRole('status').filter({ hasText: 'Your review is submitted' }),
    ).toBeFocused();

    await pressEnterOn(page, 'Change my review');

    await expect(page.getByRole('heading', { level: 2, name: 'Your review' })).toBeFocused();
  });
});

test.describe('on Team', () => {
  test('@gallery saving no roles puts focus on the roles', async ({ page }) => {
    await page.goto('/dev/preview/team');
    await page
      .getByRole('button', { name: /Change roles for/ })
      .first()
      .click();
    const dialog = page.getByRole('dialog', { name: /Change roles for/ });
    await expect(dialog).toBeVisible();
    for (const role of await dialog.getByRole('checkbox').all()) await role.uncheck();

    await dialog.getByRole('button', { name: 'Save roles' }).click();

    await expect(dialog.getByRole('checkbox').first()).toBeFocused();
    await expect(dialog.getByText('Choose at least one role.')).toBeVisible();
  });
});
