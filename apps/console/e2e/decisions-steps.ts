// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo steps 12 and 13 as a person takes them: a programme manager records
// a decision on a submission's page, records the rest in bulk on the round's
// decisions page, checks what they come to, and releases them after
// confirming it is them. The stubbed spec (decisions.spec.ts) and the journey
// against the real API (decisions-journey.spec.ts) both take these steps.

import { expect } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { submissionRows } from './submissions-steps.ts';

export const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

export const decisionsTable = (page: Page) =>
  page.getByRole('table', { name: 'Submissions and their decisions' });

/** The rows of the table, the heading row left out. */
export const decisionRows = (page: Page) => decisionsTable(page).locator('tbody > tr');

/** Opens the first submission from the list that has not been withdrawn, and gives its name. */
export async function openFirstSubmission(page: Page): Promise<string> {
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Submissions' })
    .click();
  const first = submissionRows(page)
    .filter({ hasNotText: 'Withdrawn' })
    .first()
    .getByRole('rowheader')
    .getByRole('link');
  const name = (await first.textContent()) ?? '';
  await first.click();
  await expect(h1(page, name)).toBeFocused();
  return name;
}

/** Records an award for the submission on show, from its Decision panel. */
export async function recordAwardFromTheDetail(page: Page, pounds: string): Promise<void> {
  const panel = page.getByRole('region', { name: 'Decision' });
  await expect(panel).toContainText('No decision yet');
  await panel.getByRole('button', { name: 'Record decision' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record decision' });
  await dialog.getByRole('radio', { name: /^Accepted/ }).check();
  await dialog.getByLabel('Amount to award').fill(pounds);
  await dialog.getByRole('button', { name: 'Record decision' }).click();

  await expect(dialog).toBeHidden();
  await expect(panel).toContainText(`Award of £${pounds}`);
  await expect(panel).toContainText(
    'Private: the applicant sees nothing until decisions are released.',
  );
  await expect(panel.getByRole('button', { name: 'Change decision' })).toBeFocused();
}

/** Goes from the submission on show to its round's decisions. */
export async function openDecisions(page: Page): Promise<void> {
  await page
    .getByRole('region', { name: 'Decision' })
    .getByRole('link', { name: 'All decisions in this round' })
    .click();
  await expect(h1(page, 'Decisions')).toBeFocused();
  await expect(decisionsTable(page)).toBeVisible();
  await expect(page.getByText('Applicants see nothing until you release decisions')).toBeVisible();
}

/** Chooses the first rows with no decision and records one outcome for them. Gives their names. */
export async function recordSeveral(
  page: Page,
  count: number,
  outcome: 'Waitlisted' | 'Declined',
): Promise<string[]> {
  const undecided = decisionRows(page).filter({ hasText: 'No decision yet' });
  const names: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = undecided.nth(index);
    names.push(((await row.getByRole('rowheader').getByRole('link').textContent()) ?? '').trim());
    await row.getByRole('checkbox').check();
  }
  const bar = page.getByRole('group', { name: 'Bulk actions' });
  const plural = count === 1 ? '' : 's';
  await expect(bar).toContainText(`${String(count)} submission${plural} selected`);
  await bar.getByRole('button', { name: 'Record decisions' }).click();

  const dialog = page.getByRole('dialog', { name: 'Record decisions' });
  await dialog.getByRole('radio', { name: outcome }).check();
  await dialog.getByRole('button', { name: `Record ${String(count)} decision${plural}` }).click();

  await expect(dialog).toBeHidden();
  const notice = page.getByRole('status').filter({ hasText: /recorded\. Only staff can see/ });
  await expect(notice).toHaveText(
    `${String(count)} decision${plural} recorded. Only staff can see ${count === 1 ? 'it' : 'them'}.`,
  );
  await expect(notice).toBeFocused();
  for (const name of names) {
    const row = decisionRows(page).filter({ hasText: name });
    await expect(row).toContainText(outcome);
    await expect(row).toContainText('Not released');
  }
  return names;
}

/** Shows what the awards come to against the budget, in words. */
export async function expectBudgetWords(page: Page, words: RegExp | string): Promise<void> {
  await expect(page.getByRole('meter', { name: 'Awarded against budget' })).toHaveAttribute(
    'aria-valuetext',
    words,
  );
}

/** Reads the summary and the email, ticks the box and presses the button, which opens the check that it is them. */
export async function startRelease(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Release decisions' }).click();
  await expect(h1(page, 'Release decisions')).toBeFocused();
  await expect(page.getByRole('group', { name: 'Decisions to release' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Email preview' })).toBeVisible();
  await expect(page.getByText('Straight after you confirm')).toBeVisible();

  await page.getByRole('button', { name: 'Release decisions' }).click();
  await expect(page.getByRole('dialog', { name: 'Confirm it is you' })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /I have checked the summary/ })).toBeFocused();
  await page.getByRole('checkbox', { name: /I have checked the summary/ }).check();
  await page.getByRole('button', { name: 'Release decisions' }).click();
  await expect(page.getByRole('dialog', { name: 'Confirm it is you' })).toBeVisible();
}

/** What the page says once the decisions are out. */
export async function expectReleased(page: Page): Promise<void> {
  const done = page.getByRole('status').filter({ hasText: 'Decisions released' });
  await expect(done).toContainText(
    /decisions? released\. \d+ emails? sent\. \d+ waiting to send\./,
  );
  await expect(done).toBeFocused();
  await expect(page.getByRole('button', { name: 'Release decisions' })).toHaveCount(0);
}
