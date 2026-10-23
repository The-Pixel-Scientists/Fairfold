// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo steps 10 and 11 as people do them: a programme manager assigns two
// reviewers to each submission and later reads the spread of scores; a
// reviewer declares one conflict, scores a review by keyboard and submits it.
// The stubbed spec (assessment.spec.ts) and the journey against the real API
// (assessment-journey.spec.ts) both take these steps, so the screens are
// checked the same way against each.

import { expect } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { submissionRows, submissionsTable } from './submissions-steps.ts';

export const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

export const reviewsTable = (page: Page) =>
  page.getByRole('table', { name: 'Reviews assigned to you' });

/** The rows of the reviewer's table, the heading row left out. */
export const reviewRows = (page: Page) => reviewsTable(page).locator('tbody > tr');

export const spreadTable = (page: Page) =>
  page.getByRole('table', { name: 'Score spread for each submission' });

export const spreadRows = (page: Page) => spreadTable(page).locator('tbody > tr');

/** The submissions in a round's Review stage, from the list's own filters, which the address holds. */
export async function openSubmissionsInReview(page: Page, roundId: string, stageId: string) {
  await page.goto(`/northfield/submissions?roundId=${roundId}&stageId=${stageId}`);
  await expect(submissionsTable(page)).toBeVisible();
  await expect(submissionRows(page).first()).toBeVisible();
}

/**
 * Chooses the first `count` submissions and has two reviewers assigned to each
 * automatically, then reads what the dialog and the page say was done.
 */
export async function assignAutomatically(
  page: Page,
  count: number,
  perSubmission: number,
): Promise<{ result: string }> {
  const rows = submissionRows(page);
  for (let index = 0; index < count; index += 1) {
    await rows.nth(index).getByRole('checkbox').check();
  }
  const bar = page.getByRole('group', { name: 'Bulk actions' });
  await expect(bar).toContainText(
    `${String(count)} ${count === 1 ? 'submission' : 'submissions'} selected`,
  );

  await bar.getByRole('button', { name: 'Assign automatically' }).click();
  const dialog = page.getByRole('dialog', { name: 'Assign automatically' });
  await dialog
    .getByRole('combobox', { name: 'Reviewers for each submission' })
    .selectOption(String(perSubmission));
  await dialog
    .getByRole('button', {
      name: `Assign ${String(perSubmission)} reviewers to each`,
    })
    .click();

  const result = dialog.getByRole('status');
  await expect(result).toContainText(/\d+ reviews? assigned\./);
  await expect(result).toBeFocused();
  const text = (await result.textContent()) ?? '';
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  return { result: text };
}

/** Opens the spread of a round and reads that a submission's reviewers are far apart, in words and not only colour. */
export async function readTheSpread(page: Page, roundId: string): Promise<void> {
  await page.goto(`/northfield/rounds/${roundId}/score-spread`);
  await expect(h1(page, 'Score spread')).toBeVisible();
  await expect(spreadTable(page)).toBeVisible();
  const widest = spreadRows(page).first();
  await expect(widest).toContainText('Wide spread');

  await widest.getByRole('button', { name: /Show scores/ }).click();
  const dialog = page.getByRole('dialog', { name: /^Scores for / });
  await expect(dialog.getByRole('table')).toContainText('Gap between highest and lowest');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

/** Opens a review from My reviews by its row. */
export async function openReview(page: Page, index: number): Promise<string> {
  const row = reviewRows(page).nth(index);
  const name = (await row.getByRole('rowheader').getByRole('link').textContent()) ?? '';
  await row.getByRole('rowheader').getByRole('link').click();
  await expect(h1(page, name)).toBeFocused();
  return name;
}

/** Declares a conflict on the review that is open, and lands on My reviews saying so. */
export async function declareConflict(page: Page): Promise<void> {
  await page
    .getByRole('region', { name: 'Your review' })
    .getByRole('button', { name: 'Declare a conflict' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Declare a conflict of interest' });
  await expect(dialog).toContainText('you cannot open it again');
  await dialog.getByRole('button', { name: 'Declare a conflict' }).click();

  await expect(h1(page, 'My reviews')).toBeVisible();
  await expect(page).toHaveURL(/\/reviews\?conflict=declared$/);
  await expect(
    page.getByRole('status').filter({ hasText: 'You declared a conflict' }),
  ).toBeVisible();
}

/**
 * Confirms there is no conflict, then scores every criterion from the
 * keyboard: a number key on the first score, then Alt and the down arrow to
 * the next criterion.
 */
export async function scoreFromTheKeyboard(page: Page, scores: readonly number[]): Promise<void> {
  const panel = page.getByRole('region', { name: 'Your review' });
  await expect(panel).toBeVisible();
  const confirm = panel.getByRole('button', { name: 'I have no conflict, start scoring' });
  if (await confirm.isVisible()) await confirm.click();
  await expect(panel.getByRole('radiogroup').first()).toBeVisible();

  const groups = panel.getByRole('radiogroup');
  await groups.first().getByRole('radio').first().focus();
  for (const [index, score] of scores.entries()) {
    await page.keyboard.press(String(score));
    await expect(groups.nth(index).getByRole('radio', { name: String(score) })).toBeChecked();
    if (index < scores.length - 1) await page.keyboard.press('Alt+ArrowDown');
  }
  await expect(panel.getByText(/^Saved at /)).toBeVisible();
}

/** Submits the open review and reads that it is submitted and can no longer change. */
export async function submitReview(page: Page): Promise<void> {
  const panel = page.getByRole('region', { name: 'Your review' });
  await expect(panel).toContainText('Every criterion has a score');
  await panel.getByRole('button', { name: 'Submit review' }).click();
  await expect(
    panel.getByRole('status').filter({ hasText: 'Your review is submitted' }),
  ).toBeFocused();
  await expect(panel.getByRole('radiogroup')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Submit review' })).toHaveCount(0);
}
