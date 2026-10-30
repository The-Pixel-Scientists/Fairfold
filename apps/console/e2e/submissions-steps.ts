// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 9 as a person does it: a programme manager filters submissions by
// round and status, opens one, comes back to the same list, and moves five of
// them to Review. The stubbed spec (submissions.spec.ts) and the journey
// against the real API (submissions-journey.spec.ts) both take these steps, so
// the screens are checked the same way against each.

import { expect } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

export const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

export const submissionsTable = (page: Page) => page.getByRole('table', { name: 'Submissions' });

/** The rows of the table, the heading row left out. */
export const submissionRows = (page: Page) => submissionsTable(page).locator('tbody > tr');

/** Opens Submissions from the navigation. */
export async function openSubmissions(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Submissions' })
    .click();
  await expect(h1(page, 'Submissions')).toBeFocused();
  await expect(submissionsTable(page)).toBeVisible();
}

/** Shows only the submitted ones in the round, and checks the address says so. */
export async function filterByRoundAndStatus(page: Page): Promise<void> {
  await page.getByRole('combobox', { name: 'Round' }).selectOption({ label: 'Autumn 2026' });
  await expect(page).toHaveURL(/\?roundId=[0-9a-f-]+$/);
  await page.getByRole('combobox', { name: 'Status' }).selectOption({ label: 'Submitted' });
  await expect(page).toHaveURL(/\?roundId=[0-9a-f-]+&status=submitted$/);
  await expect(page.getByRole('combobox', { name: 'Round' })).toHaveValue(/.+/);
  await expect(submissionRows(page).first()).toBeVisible();
}

/** Opens the first submission, reads its answers, and goes back to the list as it was. */
export async function openOneAndReturn(page: Page): Promise<string> {
  const first = submissionRows(page).first().getByRole('rowheader').getByRole('link');
  const name = (await first.textContent()) ?? '';
  const listAddress = page.url();
  await first.click();
  await expect(h1(page, name)).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'Application' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Organisation' })).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: 'Submissions' })
    .click();
  await expect(h1(page, 'Submissions')).toBeFocused();
  expect(page.url()).toBe(listAddress);
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveValue('submitted');
  return name;
}

/** Chooses the first five submissions and moves them to Review, then reads what the page says moved. */
export async function moveFiveToReview(page: Page): Promise<void> {
  const rows = submissionRows(page);
  for (let index = 0; index < 5; index += 1) {
    await rows.nth(index).getByRole('checkbox').check();
  }
  const bar = page.getByRole('group', { name: 'Bulk actions' });
  await expect(bar).toContainText('5 submissions selected');

  await bar.getByRole('button', { name: 'Move to stage' }).click();
  const dialog = page.getByRole('dialog', { name: 'Move to stage' });
  await dialog.getByRole('combobox', { name: 'Stage' }).selectOption({ label: 'Review' });
  await dialog.getByRole('button', { name: 'Move 5 submissions to Review' }).click();

  await expect(dialog).toBeHidden();
  const notice = page.getByRole('status').filter({ hasText: 'moved to Review' });
  await expect(notice).toHaveText(/^\d submissions? moved to Review\./);
  await expect(notice).toBeFocused();
  await expect(bar).toContainText('Select submissions to act on several at once.');
}
