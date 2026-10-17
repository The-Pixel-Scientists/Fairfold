// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The form components in a real browser, through the component gallery:
// keyboard use, the live count, the error summary's links, and what each
// audience is shown. The console-gallery project runs them, under the
// production content security policy.

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import {
  example,
  openGallery,
  pdfFile,
  programFile,
  summaryIn,
  TOO_LONG,
} from './forms-gallery-states.ts';

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

test('@gallery adds a table row with the keyboard, moves focus into it, and adds up the total', async ({
  page,
}) => {
  const scope = example(page, 'Table question with no rows');
  const add = scope.getByRole('button', { name: 'Add the first cost' });

  await add.focus();
  await page.keyboard.press('Enter');
  const row = scope.getByRole('group', { name: 'Cost 1' });
  await expect(row.getByRole('textbox', { name: 'Item' })).toBeFocused();
  await page.keyboard.type('Hall hire');
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab');
  await page.keyboard.type('£1,250');

  await expect(row.getByRole('combobox', { name: 'Type of cost' })).not.toHaveValue('');
  await expect(scope.getByText('Total cost', { exact: true }).locator('..')).toHaveText(
    'Total cost£1,250',
  );
  await expect(scope.getByRole('button', { name: 'Add another cost' })).toBeVisible();
});

test('@gallery tells a screen reader the new total once typing stops, in a polite live region', async ({
  page,
}) => {
  const scope = example(page, 'Table question filled in');
  const status = scope.locator('[role="status"]', { hasText: 'Total cost' });

  await expect(status).toHaveText('Total cost: £12,500');
  await scope
    .getByRole('group', { name: 'Cost 3' })
    .getByRole('textbox', { name: 'Cost' })
    .fill('1000');
  await expect(status).toHaveText('Total cost: £11,080', { timeout: 5000 });
});

test('@gallery removes a table row and moves focus to the same place in the next row, then to the add button', async ({
  page,
}) => {
  const scope = example(page, 'Table question filled in');

  await scope.getByRole('button', { name: 'Remove cost 2' }).click();
  await expect(scope.getByRole('group', { name: 'Cost 3' })).toHaveCount(0);
  await expect(scope.getByRole('textbox', { name: 'Item' }).nth(1)).toHaveValue('Refreshments');
  await expect(scope.getByRole('button', { name: 'Remove cost 2' })).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(scope.getByRole('button', { name: 'Add another cost' })).toBeFocused();
});

test('@gallery moves focus to a table cell when its message in the error summary is chosen', async ({
  page,
}) => {
  const scope = example(page, 'Table question with problems');
  await scope.getByRole('button', { name: 'Check answers' }).click();
  await expect(summaryIn(scope)).toBeFocused();

  await summaryIn(scope)
    .getByRole('link', { name: /Enter the amount for cost 2 in pounds/ })
    .click();
  await expect(
    scope.getByRole('group', { name: 'Cost 2' }).getByRole('textbox', { name: 'Cost' }),
  ).toBeFocused();
  await summaryIn(scope)
    .getByRole('link', { name: /Fill in cost 3 or remove it/ })
    .click();
  await expect(scope.getByRole('group', { name: 'Budget (required)' })).toBeFocused();
});

test('@gallery shows a table question at its row limit in words, with no way to add another', async ({
  page,
}) => {
  const scope = example(page, 'Table question at its row limit');

  await expect(scope.getByText('You can add up to 3 costs.')).toBeVisible();
  await expect(scope.getByRole('button', { name: /^Add/ })).toHaveCount(0);
});

test('@gallery lays a row side by side on a wide screen and one field to a line on a phone', async ({
  page,
}) => {
  const scope = example(page, 'Table question filled in');
  const row = scope.getByRole('group', { name: 'Cost 1' });
  const item = row.getByRole('textbox', { name: 'Item' });
  const cost = row.getByRole('textbox', { name: 'Cost' });
  const top = async (field: typeof item) => (await field.boundingBox())?.y ?? 0;

  const legend = row.getByText('Cost 1', { exact: true });
  const height = async () => (await legend.boundingBox())?.height ?? 0;

  expect(await top(item)).toBe(await top(cost));
  expect(await height()).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 320, height: 640 });
  expect(await top(cost)).toBeGreaterThan(await top(item));
  expect(await height()).toBeGreaterThan(8);
});

test('@gallery reads a table answer as a table that scrolls in its own region on a phone, not the page', async ({
  page,
}) => {
  const scope = example(page, 'Table answer to read');
  const table = scope.getByRole('table', { name: 'Budget' });

  await expect(table.getByRole('columnheader')).toHaveText(['Item', 'Type of cost', 'Cost']);
  await expect(table.getByRole('rowheader', { name: 'Total' })).toBeVisible();
  await expect(scope.getByText('Not answered', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 320, height: 640 });
  const region = scope.getByRole('region', { name: 'Budget' });
  expect(await region.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  await region.focus();
  await expect(region).toBeFocused();
});

test('@gallery attaches a file with the keyboard alone, watching it upload, be checked and join the list', async ({
  page,
}) => {
  const scope = example(page, 'File question with no files');
  const picker = scope.getByLabel('Choose files');
  const status = scope.locator('[role="status"]', { hasText: /\S/ });

  await picker.focus();
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Space');
  await (await chooser).setFiles(pdfFile());

  const row = scope.getByRole('listitem');
  await expect(row.getByRole('progressbar')).toBeVisible();
  await expect(status).toHaveText('Uploading Accounts 2025 to 2026.pdf');
  await expect(row.getByText('Checking Accounts 2025 to 2026.pdf for viruses')).toBeVisible();
  await expect(status).toHaveText('Checking Accounts 2025 to 2026.pdf for viruses');
  await expect(
    row.getByRole('link', { name: /^Download Accounts 2025 to 2026\.pdf, PDF, / }),
  ).toBeVisible({
    timeout: 8000,
  });
  await expect(status).toHaveText('Accounts 2025 to 2026.pdf added');
  await expect(row.getByText(/Checking/)).toHaveCount(0);
});

test('@gallery refuses a file by what is in it, whatever it is called, and goes from the summary to the file input', async ({
  page,
}) => {
  const scope = example(page, 'File question with no files');

  await scope.getByLabel('Choose files').setInputFiles(programFile());

  await expect(summaryIn(scope)).toBeFocused();
  const message = 'Accounts 2025 to 2026.pdf: The file must be a PDF or Word document.';
  await expect(scope.getByText(message)).toHaveCount(2);
  await summaryIn(scope).getByRole('link', { name: message }).click();
  await expect(scope.getByLabel('Choose files')).toBeFocused();
  await expect(scope.getByRole('list', { name: 'Files for Latest accounts' })).toHaveCount(0);
});

test('@gallery shows the server words for a refused file beside the question and in the summary', async ({
  page,
}) => {
  const scope = example(page, 'File question with a refused file');

  await scope.getByLabel('Choose files').setInputFiles(pdfFile());

  await expect(summaryIn(scope)).toBeFocused();
  await expect(
    summaryIn(scope).getByText(/This file has a virus in it, so it was not uploaded/),
  ).toBeVisible();
  await expect(scope.getByText(/This file has a virus in it/)).toHaveCount(2);
  await expect(scope.getByLabel('Choose files')).toBeVisible();
});

test('@gallery gives the file input way to words at the limit, and brings it back with focus on removal', async ({
  page,
}) => {
  const scope = example(page, 'File question at its file limit');

  await expect(scope.getByLabel('Choose files')).toHaveCount(0);
  await expect(scope.getByText('You have reached the limit of 2 files.')).toBeVisible();

  await scope.getByRole('button', { name: 'Remove Constitution.pdf' }).click();
  await expect(scope.getByLabel('Choose files')).toBeFocused();
  await expect(scope.getByText(/reached the limit/)).toHaveCount(0);
  await expect(scope.locator('[role="status"]', { hasText: 'removed' })).toHaveText(
    'Constitution.pdf removed',
  );
});

test('@gallery lists a file to read with a link and no way to change it', async ({ page }) => {
  const scope = example(page, 'File question to read');

  await expect(
    scope.getByRole('link', { name: 'Download Accounts 2025 to 2026.pdf, PDF, 2.1 MB' }),
  ).toBeVisible();
  await expect(scope.getByText('No files attached.')).toBeVisible();
  await expect(scope.getByRole('button')).toHaveCount(0);
  await expect(scope.getByLabel(/Choose file/)).toHaveCount(0);
});

test('@gallery keeps a long file name inside the page, whatever the width', async ({ page }) => {
  const scope = example(page, 'File question at its file limit');
  const name = scope.getByRole('link', { name: /^Download Northfield_Community_Trust/ });

  await page.setViewportSize({ width: 320, height: 640 });

  await expect(name).toBeVisible();
  const box = await name.boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
});
