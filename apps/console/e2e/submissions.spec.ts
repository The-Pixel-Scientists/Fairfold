// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The submission screens in a real browser, with the API's answers stubbed
// (submissions-api.ts): a funder with a round and 120 submissions that lists
// them with the contract's filters and pages and keeps stage moves. The same
// steps run against the real API in submissions-journey.spec.ts. Every spec
// also fails on a Content Security Policy violation, so the screens are
// checked under the production policy in console-production.

import { productName } from '@pixel-scientists/domain/platform';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { crowd, stubSubmissions } from './submissions-api.ts';
import {
  filterByRoundAndStatus,
  h1,
  moveFiveToReview,
  openOneAndReturn,
  openSubmissions,
  submissionRows,
  submissionsTable,
} from './submissions-steps.ts';

const SUFFIX = `– ${productName} console`;

const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

test.describe('working through submissions', () => {
  test('is reached from the navigation, with the page title and focus on the heading', async ({
    page,
  }) => {
    await stubSubmissions(page);
    await page.goto('/northfield/');
    await openSubmissions(page);

    await expect(page).toHaveTitle(`Submissions ${SUFFIX}`);
    await expect(submissionRows(page)).toHaveCount(50);
    await expect(page.getByText('Showing 50 on this page, 120 submissions in all')).toBeVisible();
  });

  test('filters by round and status, opens one, comes back to the same list and moves five to Review', async ({
    page,
  }) => {
    const { held } = await stubSubmissions(page);
    await page.goto('/northfield/submissions');
    await expect(submissionsTable(page)).toBeVisible();

    await filterByRoundAndStatus(page);
    await openOneAndReturn(page);
    await moveFiveToReview(page);

    expect(held.filter((item) => item.stage.name === 'Review')).toHaveLength(5);
    await expect(submissionRows(page).first()).toContainText('Review');
  });

  test('keeps the filters and the page in the address, and Back brings them back', async ({
    page,
  }) => {
    await stubSubmissions(page);
    await page.goto('/northfield/submissions');
    await expect(submissionRows(page)).toHaveCount(50);

    await page.getByRole('combobox', { name: 'Late' }).selectOption({ label: 'Late only' });
    await expect(page).toHaveURL(/\?late=true$/);
    await expect(submissionRows(page)).toHaveCount(24);
    await page
      .getByRole('combobox', { name: 'Eligibility' })
      .selectOption({ label: 'Not eligible' });
    await expect(page).toHaveURL(/\?eligibility=stopped&late=true$/);

    await page.goBack();
    await expect(page).toHaveURL(/\?late=true$/);
    await expect(page.getByRole('combobox', { name: 'Eligibility' })).toHaveValue('');
    await expect(submissionRows(page)).toHaveCount(24);
    await page.goBack();
    await expect(page.getByRole('combobox', { name: 'Late' })).toHaveValue('');
    await expect(submissionRows(page)).toHaveCount(50);

    await page.getByRole('link', { name: 'Next page' }).click();
    await expect(page).toHaveURL(/\?cursor=/);
    await expect(submissionRows(page)).toHaveCount(50);
    await page.getByRole('link', { name: 'Next page' }).click();
    await expect(submissionRows(page)).toHaveCount(20);
    await expect(page.getByRole('link', { name: 'Next page' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Back to the first page' }).click();
    await expect(page).not.toHaveURL(/cursor/);
    await expect(submissionRows(page)).toHaveCount(50);
  });

  test('returns to where the person was in a long list, with its filters', async ({ page }) => {
    await stubSubmissions(page);
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto('/northfield/submissions?status=submitted');
    await expect(submissionRows(page)).toHaveCount(50);

    const row = submissionRows(page).nth(40);
    await row.scrollIntoViewIfNeeded();
    const before = await scrollY(page);
    expect(before).toBeGreaterThan(600);
    await row.getByRole('link').first().click();
    await expect(page.getByRole('tabpanel', { name: 'Application' })).toBeVisible();
    expect(await scrollY(page)).toBe(0);

    await page.goBack();
    await expect(submissionRows(page)).toHaveCount(50);
    await expect.poll(() => scrollY(page)).toBe(before);
    await expect(page.getByRole('combobox', { name: 'Status' })).toHaveValue('submitted');
  });

  test('is operated from the keyboard: arrows move between rows, Space chooses, Enter opens and ? lists the keys', async ({
    page,
  }) => {
    await stubSubmissions(page);
    await page.goto('/northfield/submissions');
    const rows = submissionRows(page);
    await expect(rows).toHaveCount(50);

    // Tab reaches the table, its box for every row, and then the first row, which is the only row on the Tab path.
    await submissionsTable(page).getByRole('checkbox', { name: 'Select all on this page' }).focus();
    await page.keyboard.press('Tab');
    await expect(rows.nth(0)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(2)).toBeFocused();
    await page.keyboard.press(' ');
    await expect(rows.nth(2).getByRole('checkbox')).toBeChecked();
    await expect(page.getByRole('group', { name: 'Bulk actions' })).toContainText(
      '1 submission selected',
    );
    await page.keyboard.press('End');
    await expect(rows.nth(49)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(rows.nth(0)).toBeFocused();

    await page.keyboard.press('?');
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dialog).toContainText('Open the submission');
    await page.keyboard.press('Escape');
    await expect(rows.nth(0)).toBeFocused();

    const name = (await rows.nth(0).getByRole('link').textContent()) ?? '';
    await page.keyboard.press('Enter');
    await expect(h1(page, name)).toBeFocused();
  });

  test('moves through the list from a submission with Previous and Next', async ({ page }) => {
    await stubSubmissions(page);
    await page.goto('/northfield/submissions?status=submitted');
    await expect(submissionRows(page)).toHaveCount(50);
    const second = submissionRows(page).nth(1).getByRole('link');
    const secondName = (await second.textContent()) ?? '';
    const thirdName = (await submissionRows(page).nth(2).getByRole('link').textContent()) ?? '';
    await second.click();
    await expect(h1(page, secondName)).toBeFocused();

    await page.getByRole('link', { name: 'Next submission' }).click();
    await expect(h1(page, thirdName)).toBeFocused();
    await expect(page).toHaveURL(/\?status=submitted$/);
    await page.getByRole('link', { name: 'Previous submission' }).click();
    await expect(h1(page, secondName)).toBeFocused();
    await page.getByRole('link', { name: 'Previous submission' }).click();
    await expect(page.getByRole('button', { name: 'Previous submission' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  test('shows a submission by its answers, eligibility and history', async ({ page }) => {
    // The sixth is not eligible, so its stopping question shows.
    const held = crowd();
    await stubSubmissions(page, held);
    await page.goto(`/northfield/submissions/${held[5]?.id ?? ''}`);

    const answers = page.getByRole('tabpanel', { name: 'Application' });
    await expect(answers.getByRole('heading', { level: 2, name: 'Your project' })).toBeVisible();
    await expect(answers).toContainText('We run a weekly lunch.');
    await page.getByRole('tab', { name: 'Eligibility' }).click();
    await expect(
      page.getByRole('region', { name: 'Where the applicant was stopped' }),
    ).toContainText('We only fund registered charities.');
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.getByRole('list', { name: 'History, newest first' })).toContainText(
      'Entered Intake',
    );
  });

  test('says what to do when the filters match nothing, and clears them', async ({ page }) => {
    await stubSubmissions(page, crowd(3));
    await page.goto('/northfield/submissions?status=withdrawn&late=true');

    await expect(
      page.getByRole('heading', { level: 2, name: 'No submissions match these filters' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).last().click();
    await expect(submissionRows(page)).toHaveCount(3);
    await expect(page).toHaveURL(/\/submissions$/);
  });

  test('reports a move that the API refused, names each submission and removes it from the choice', async ({
    page,
  }) => {
    const held = crowd(10);
    await stubSubmissions(page, held);
    await page.goto('/northfield/submissions');
    const rows = submissionRows(page);
    await expect(rows).toHaveCount(10);

    // The seventh was withdrawn.
    await rows.nth(0).getByRole('checkbox').check();
    await rows.nth(6).getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Move to stage' }).click();
    const dialog = page.getByRole('dialog', { name: 'Move to stage' });
    await dialog.getByRole('combobox', { name: 'Stage' }).selectOption({ label: 'Review' });
    await dialog.getByRole('button', { name: 'Move 2 submissions to Review' }).click();

    const alert = dialog.getByRole('alert');
    await expect(alert).toContainText('No submissions were moved.');
    await expect(alert).toContainText(held[6]?.organisation.name ?? '');
    await expect(alert).toContainText('This submission was withdrawn, so it cannot move.');
    expect(held.filter((item) => item.stage.name === 'Review')).toHaveLength(0);

    await alert.getByRole('button', { name: 'Remove these from the selection' }).click();
    await expect(page.getByRole('group', { name: 'Bulk actions' })).toContainText(
      '1 submission selected',
    );
    await dialog.getByRole('button', { name: 'Move 1 submission to Review' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'moved to Review' })).toHaveText(
      '1 submission moved to Review.',
    );
  });
});
