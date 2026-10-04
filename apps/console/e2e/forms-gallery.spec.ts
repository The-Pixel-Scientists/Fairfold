// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The form components in a real browser, through the component gallery:
// keyboard use, the live count, the error summary's links, and what each
// audience is shown. The console-gallery project runs them, under the
// production content security policy.

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { example, openGallery, summaryIn, TOO_LONG } from './forms-gallery-states.ts';

test.beforeEach(async ({ page }) => {
  await openGallery(page);
});

test('@gallery counts the words left as the person types, and says when they are over', async ({
  page,
}) => {
  const scope = example(page, 'Questions of every type');
  const story = scope.getByRole('textbox', { name: /What will you do with the money/ });

  await expect(scope.getByText('You have 20 words left').first()).toBeVisible();
  await story.pressSequentially('Weekly lunch club for older people');
  await expect(scope.getByText('You have 14 words left').first()).toBeVisible();
  await story.fill(TOO_LONG);
  await expect(scope.getByText('You have 5 words too many').first()).toBeVisible();
});

test('@gallery gives a screen reader the count once typing stops, in a polite live region', async ({
  page,
}) => {
  const scope = example(page, 'Questions of every type');
  const story = scope.getByRole('textbox', { name: /What will you do with the money/ });
  const status = scope.locator('[role="status"]', { hasText: /words (left|too many)/ });

  await story.fill('one two three');
  await expect(status).toHaveText('You have 17 words left', { timeout: 5000 });
});

test('@gallery takes an answer that stops an applicant with the keyboard alone, and goes back to the question', async ({
  page,
}) => {
  const scope = example(page, 'Answers that stop an applicant');
  const yes = scope.getByRole('radio', { name: 'Yes' });
  const no = scope.getByRole('radio', { name: 'No' });

  await yes.focus();
  await page.keyboard.press('ArrowDown');
  await expect(no).toBeChecked();
  const notice = scope.getByRole('alert', { name: 'You cannot apply with this answer' });
  await expect(notice).toContainText('This fund is open to registered charities only.');

  const change = notice.getByRole('button', { name: 'Change your answer' });
  for (let presses = 0; presses < 5; presses += 1) {
    await page.keyboard.press('Tab');
    if (await change.evaluate((element) => element === document.activeElement)) break;
  }
  await expect(change).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(yes).toBeFocused();
  await page.keyboard.press('Space');
  await expect(yes).toBeChecked();
  await expect(notice).toBeHidden();
});

test('@gallery moves focus to the field when a message in the error summary is chosen', async ({
  page,
}) => {
  const scope = example(page, 'Questions with problems');
  await scope.getByRole('button', { name: 'Check answers' }).click();
  await expect(summaryIn(scope)).toBeFocused();

  await summaryIn(scope)
    .getByRole('link', { name: /Enter the town or city/ })
    .click();
  await expect(scope.getByRole('textbox', { name: 'Town or city' })).toBeFocused();
  await summaryIn(scope)
    .getByRole('link', { name: /Choose no more than 2 options/ })
    .click();
  await expect(scope.getByRole('checkbox', { name: 'Young people' })).toBeFocused();
});

test('@gallery keeps what is typed in a date while it is not yet a date', async ({ page }) => {
  const scope = example(page, 'Questions of every type');

  await scope.getByRole('textbox', { name: 'Day' }).fill('31');
  await scope.getByRole('textbox', { name: 'Month' }).fill('2');
  await scope.getByRole('textbox', { name: 'Year' }).fill('2027');
  await scope.getByRole('button', { name: 'Check answers' }).click();

  await expect(scope.getByRole('textbox', { name: 'Day' })).toHaveValue('31');
  await expect(summaryIn(scope).getByRole('link', { name: /Enter a real date/ })).toBeVisible();
});

test('@gallery gives a blind reviewer no identity field, and staff no aggregate-only answer', async ({
  page,
}) => {
  const view = example(page, 'Answers to read');
  const staff = view.getByRole('heading', { name: 'Staff' }).locator('..');
  const blind = view.getByRole('heading', { name: 'Blind reviewer' }).locator('..');

  await expect(staff).toContainText('Northfield Community Trust');
  await expect(staff).toContainText('Not answered');
  await expect(staff).not.toContainText('Group two');
  await expect(blind).toContainText('What will you do with the money?');
  await expect(blind).not.toContainText('Northfield');
  await expect(blind).not.toContainText('Organisation name');
});

test('@gallery shows the three save messages', async ({ page }) => {
  const scope = example(page, 'Save status');

  await expect(scope.getByRole('status')).toHaveText([
    'Saving…',
    'Saved at 2:14pm',
    'Not saved. Check your connection and try again',
  ]);
});
