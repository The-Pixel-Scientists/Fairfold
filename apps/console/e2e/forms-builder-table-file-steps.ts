// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 6, the part S05-04 left out: a programme manager adds a budget
// table and a file question for the latest accounts to the form's last
// section, sets their limits, previews them as an applicant sees them (with
// uploading switched off), and publishes. The stubbed spec
// (forms-builder-table-file.spec.ts) and the journey against the real API
// (forms-builder-table-file-journey.spec.ts) both take these steps, after the
// ones in form-builder-steps.ts.

import { formDefinitionInputSchema } from '@pixel-scientists/grants/contracts';

import { expect as strictExpect } from '../../../scripts/e2e/fixtures.ts';
import type { Locator, Page } from '@playwright/test';

import { addQuestion } from './form-builder-steps.ts';

/** Each page loads its code when it is first opened, which a busy machine or a development server's first compile can slow past five seconds. */
const expect = strictExpect.configure({ timeout: 15_000 });

const MB = 1024 * 1024;
export const PDF = 'application/pdf';
export const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** The boxes of the nth column (from 1) of the table that is being edited. */
export const column = (question: Locator, number: number) =>
  question.getByRole('group', { name: `Column ${String(number)}`, exact: true });

const headings = (question: Locator) =>
  question.getByRole('textbox', { name: /^Heading of column/ });

/** Adds a column at the end, which takes the cursor in its heading, and gives it its heading and type. */
async function addColumn(
  page: Page,
  question: Locator,
  number: number,
  heading: string,
  type?: string,
): Promise<void> {
  await question.getByRole('button', { name: 'Add column' }).click();
  await expect(
    column(question, number).getByRole('textbox', { name: `Heading of column ${String(number)}` }),
  ).toBeFocused();
  await page.keyboard.type(heading);
  if (type !== undefined) {
    await column(question, number)
      .getByRole('combobox', { name: `Type of column ${String(number)}` })
      .selectOption(type);
  }
}

/** Adds the table of costs: a text, an amount that is added up, and a choice, with a column added, moved and removed along the way. */
export async function addBudgetTable(page: Page): Promise<void> {
  const question = await addQuestion(page, 'What will it cost?');
  await question.getByRole('combobox', { name: 'Type', exact: true }).selectOption('Table');
  await expect(question.getByRole('textbox', { name: 'Name for one row' })).toHaveValue('row');

  await question.getByRole('textbox', { name: 'Name for one row' }).fill('cost');
  await question.getByRole('textbox', { name: 'Fewest rows' }).fill('1');
  await question.getByRole('textbox', { name: 'Most rows' }).fill('8');

  await column(question, 1).getByRole('textbox', { name: 'Heading of column 1' }).fill('Item');
  await column(question, 1)
    .getByRole('textbox', { name: 'Character limit of column 1' })
    .fill('80');
  await addColumn(page, question, 2, 'Cost', 'Amount in pounds');
  await column(question, 2)
    .getByRole('checkbox', { name: 'Add up this column under the table' })
    .check();
  await addColumn(page, question, 3, 'Kind', 'Choose one from a list');
  await column(question, 3).getByRole('textbox', { name: 'Choice 1' }).fill('Staff');
  await column(question, 3).getByRole('textbox', { name: 'Choice 2' }).fill('Equipment');

  // A column that is added, moved up with the keyboard and then removed, so the table ends as it began.
  await addColumn(page, question, 4, 'Notes');
  await question.getByRole('button', { name: 'Move up column 4' }).focus();
  await page.keyboard.press('Enter');
  await expect(question.getByRole('button', { name: 'Move up column 3' })).toBeFocused();
  await expect(headings(question).nth(2)).toHaveValue('Notes');
  await expect(headings(question).nth(3)).toHaveValue('Kind');
  await question.getByRole('button', { name: 'Remove column 3' }).click();
  await expect(headings(question)).toHaveCount(3);
  await expect(headings(question).nth(2)).toHaveValue('Kind');
  await expect(headings(question).nth(2)).toBeFocused();
}

/** Adds the file question for the latest accounts: a PDF or a Word document, up to 5 MB, two files. */
export async function addAccountsFile(page: Page): Promise<void> {
  const question = await addQuestion(page, 'Latest accounts');
  await question.getByRole('combobox', { name: 'Type', exact: true }).selectOption('File upload');

  const types = question.getByRole('group', { name: 'File types' });
  await expect(types.getByRole('checkbox')).toHaveCount(7);
  for (const type of [
    'Excel spreadsheet',
    'OpenDocument text',
    'OpenDocument spreadsheet',
    'JPEG image',
    'PNG image',
  ]) {
    await types.getByRole('checkbox', { name: type, exact: true }).uncheck();
  }
  await question.getByRole('combobox', { name: 'Largest file' }).selectOption('5 MB');
  await question.getByRole('textbox', { name: 'Most files' }).fill('2');
}

/** Walks the preview to the budget as an applicant does: fills in a row of the table, and chooses a file, which is checked and not sent. */
export async function previewBudget(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Preview' }).click();
  const preview = page.getByRole('tabpanel', { name: 'Preview' });
  await preview.getByRole('radio', { name: 'Yes' }).check();
  await preview.getByRole('button', { name: 'Next section' }).click();
  await preview.getByRole('button', { name: 'Next section' }).click();
  await expect(preview.getByText('Section 3 of 3')).toBeVisible();

  const costs = preview.getByRole('group', { name: /^What will it cost/ });
  await expect(costs.getByRole('button', { name: 'Add another cost' })).toBeVisible();
  const row = costs.getByRole('group', { name: 'Cost 1' });
  await row.getByRole('textbox', { name: 'Item' }).fill('Hall hire');
  await row.getByRole('textbox', { name: 'Cost', exact: true }).fill('1200');
  await expect(costs).toContainText('£1,200');
  await row.getByRole('combobox', { name: /^Kind/ }).selectOption('Staff');

  await expect(preview.getByText(/Uploading is switched off in the preview/)).toBeVisible();
  await expect(
    preview.getByText('PDF or Word document, up to 5 MB. You can attach up to 2 files.'),
  ).toBeVisible();
  await preview.locator('input[type=file]').setInputFiles({
    name: 'accounts.pdf',
    mimeType: PDF,
    buffer: Buffer.from('%PDF-1.7 accounts'),
  });
  await expect(preview.getByRole('alert', { name: 'There is a problem' })).toContainText(
    'accounts.pdf: Uploading is switched off in the preview.',
  );
  await page.getByRole('tab', { name: 'Edit form' }).click();
}

/** What the budget questions are in a saved definition: the table's columns, in order, and the file question's limits. */
export function expectBudget(fields: readonly unknown[] | undefined): void {
  const [, table, file] = (fields ?? []).slice(-3);
  const columns = (table as { columns: { id: string }[] }).columns;
  expect(table).toMatchObject({
    type: 'table',
    label: 'What will it cost?',
    rowNoun: 'cost',
    minRows: 1,
    maxRows: 8,
    columns: [
      { type: 'short_text', label: 'Item', maxCharacters: 80 },
      { type: 'currency', label: 'Cost', total: true },
      {
        type: 'dropdown',
        label: 'Kind',
        options: [{ label: 'Staff' }, { label: 'Equipment' }],
      },
    ],
  });
  for (const { id } of columns) expect(id).toMatch(/^c_[a-z0-9]{12}$/);
  expect(new Set(columns.map(({ id }) => id)).size).toBe(3);
  expect(file).toMatchObject({
    type: 'file',
    label: 'Latest accounts',
    allowedTypes: [PDF, DOCX],
    maxBytes: 5 * MB,
    maxFiles: 2,
  });
}

const parsed = (input: unknown) => {
  const result = formDefinitionInputSchema.safeParse(input);
  if (!result.success) throw new Error('The form in the spec is not valid.');
  return result.data;
};

/** A form with a table of costs and the accounts as a file, for the screens that open a form that has them. */
export const budgetForm = parsed({
  sections: [
    {
      id: 's_budget',
      title: 'Your budget',
      fields: [
        {
          id: 'f_costs',
          type: 'table',
          label: 'What will it cost?',
          required: true,
          rowNoun: 'cost',
          minRows: 1,
          maxRows: 8,
          columns: [
            { id: 'c_item', type: 'short_text', label: 'Item', maxCharacters: 80 },
            { id: 'c_cost', type: 'currency', label: 'Cost', total: true },
            { id: 'c_people', type: 'number', label: 'People', wholeNumber: true },
            {
              id: 'c_kind',
              type: 'dropdown',
              label: 'Kind',
              required: false,
              options: [
                { value: 'staff', label: 'Staff' },
                { value: 'kit', label: 'Equipment' },
              ],
            },
          ],
        },
        {
          id: 'f_accounts',
          type: 'file',
          label: 'Latest accounts',
          hint: 'Your trustees do not need to sign them.',
          required: true,
          allowedTypes: [PDF, DOCX],
          maxBytes: 5 * MB,
          maxFiles: 2,
        },
      ],
    },
  ],
});
