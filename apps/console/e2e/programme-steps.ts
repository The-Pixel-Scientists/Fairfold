// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 5 as a person does it: a programme manager sets up Community
// Spaces Fund with a round, its stages, a rubric of three weighted criteria
// and the outcome emails, and sees each change in the configuration history.
// The stubbed spec (programme.spec.ts) and the journey against the real API
// (programme-journey.spec.ts) both take these steps, so the screens are
// checked the same way against each.

import { expect } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

export const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

/** The day, month and year boxes of a date, and the time beside it. */
export async function enterMoment(
  page: Page,
  word: 'Opening' | 'Closing',
  [day, month, year]: [string, string, string],
  time: string,
): Promise<void> {
  const date = page.getByRole('group', { name: `${word} date` });
  await date.getByRole('textbox', { name: 'Day' }).fill(day);
  await date.getByRole('textbox', { name: 'Month' }).fill(month);
  await date.getByRole('textbox', { name: 'Year' }).fill(year);
  await page.getByLabel(`${word} time`).fill(time);
}

/** Creates the programme from the empty list, and arrives on its page. */
export async function createProgramme(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Create a programme' }).click();
  await expect(h1(page, 'New programme')).toBeFocused();
  await page.getByRole('textbox', { name: 'Title' }).fill('Community Spaces Fund');
  await page
    .getByRole('textbox', { name: 'Summary' })
    .fill('Grants for places where neighbours meet.');
  await page.getByRole('radio', { name: 'Open' }).check();
  await page.getByRole('button', { name: 'Create programme' }).click();
  await expect(h1(page, 'Community Spaces Fund')).toBeFocused();
}

/** Adds the autumn round from the programme's page, and arrives on the round's. */
export async function addRound(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'New round' }).click();
  await expect(h1(page, 'New round')).toBeFocused();
  await page.getByRole('textbox', { name: 'Title' }).fill('Autumn 2026');
  await enterMoment(page, 'Opening', ['12', '10', '2026'], '09:00');
  await enterMoment(page, 'Closing', ['2', '11', '2026'], '17:00');
  await page.getByRole('textbox', { name: 'Budget' }).fill('150000');
  await page.getByRole('textbox', { name: 'Smallest award' }).fill('5000');
  await page.getByRole('textbox', { name: 'Largest award' }).fill('25000');
  await page.getByRole('button', { name: 'Add round' }).click();
  await expect(h1(page, 'Autumn 2026')).toBeFocused();

  const details = page.getByRole('tabpanel');
  await expect(details.getByText('£150,000')).toBeVisible();
  await expect(details.getByText('12 October 2026 at 9am')).toBeVisible();
  await expect(details.getByText('Europe/London')).toBeVisible();
}

/** Gives the Review stage three weighted criteria, scored 1 to 5, and goes back to the round. */
export async function addRubric(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Stages and rubrics' }).click();
  const stages = page.getByRole('table', { name: 'Stages in this round' });
  for (const stage of ['Intake', 'Review', 'Decision']) {
    await expect(stages.getByRole('rowheader', { name: stage })).toBeVisible();
  }
  await page.getByRole('link', { name: 'Add rubric for Review' }).click();
  await expect(h1(page, 'Rubric for Review')).toBeFocused();

  const criteria: [string, string][] = [
    ['Need', '5'],
    ['Approach', '3'],
    ['Value for money', '2'],
  ];
  for (const [index, [label, weight]] of criteria.entries()) {
    await page.getByRole('button', { name: 'Add criterion' }).click();
    await expect(
      page.getByRole('textbox', { name: `Criterion ${String(index + 1)}`, exact: true }),
    ).toBeFocused();
    await page.keyboard.type(label);
    await page
      .getByRole('textbox', { name: /^Weight/ })
      .nth(index)
      .fill(weight);
  }
  await expect(page.getByText('Total weight').locator('+ span')).toHaveText('10');
  await page.getByRole('button', { name: 'Save rubric' }).click();
  await expect(page.getByText('Rubric saved.')).toBeVisible();

  await page.getByRole('link', { name: 'Back to round' }).click();
  await expect(h1(page, 'Autumn 2026')).toBeFocused();
  await page.getByRole('tab', { name: 'Stages and rubrics' }).click();
  await expect(
    stages.getByRole('row', { name: /Review.*3 criteria, total weight 10/ }),
  ).toBeVisible();
}

/** Changes the accepted email by adding a merge field, and saves the emails. */
export async function changeEmail(page: Page, programmeName: string): Promise<void> {
  await page.getByRole('link', { name: programmeName }).click();
  await page.getByRole('link', { name: 'Edit emails' }).click();
  await expect(h1(page, 'Outcome emails')).toBeFocused();

  const accepted = page.getByRole('region', { name: 'Accepted email' });
  await accepted.getByRole('textbox', { name: 'Text of the email' }).click();
  await accepted.getByRole('button', { name: 'Organisation name' }).click();
  await expect(accepted.getByRole('textbox', { name: 'Text of the email' })).toHaveValue(
    /\{\{organisation_name\}\}/,
  );
  await page.getByRole('button', { name: 'Save emails' }).click();
  await expect(page.getByText('Emails saved.')).toBeVisible();
  await expect(accepted.getByText(/Version 2\./)).toBeVisible();
}

/** Checks that the programme's history shows its creation and the email, then that the round's shows its creation and the rubric. */
export async function checkHistory(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Back to programme' }).click();
  const programmeHistory = page.getByRole('region', { name: 'Configuration history' });
  await expect(programmeHistory.getByText('Created')).toBeVisible();
  await expect(programmeHistory.getByText('Changed accepted email')).toBeVisible();

  await page.getByRole('link', { name: 'Autumn 2026' }).click();
  await expect(h1(page, 'Autumn 2026')).toBeFocused();
  await page.getByRole('tab', { name: 'History' }).click();

  const history = page.getByRole('region', { name: 'Configuration history' });
  await expect(history.getByText('Created')).toBeVisible();
  const rubric = history.getByRole('listitem').filter({ hasText: 'Changed criterion' });
  await expect(rubric).toHaveCount(1);
  await expect(rubric.getByText(/criterion “Need”/)).toBeVisible();
  await rubric.getByText('See what changed').click();
  await expect(rubric.getByText('Criterion “Need” in stage “Review”: weight')).toBeVisible();
  await expect(rubric.getByText('Before: Not set').first()).toBeVisible();
  await expect(rubric.getByText('After: 5', { exact: true }).first()).toBeVisible();
}
