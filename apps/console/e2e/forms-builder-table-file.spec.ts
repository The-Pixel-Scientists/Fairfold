// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Table and file questions in the form builder, in a real browser with the
// API's answers stubbed (form-builder-api.ts): a programme manager adds a
// budget table and a file question to the demo form, sets their limits,
// previews them and publishes. The same steps run against the real API in
// forms-builder-table-file-journey.spec.ts. Every spec also fails on a Content
// Security Policy violation, so the screens are checked under the production
// policy in console-production.

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';

import { problem } from './auth-api.ts';
import { ids, stubForms, version } from './form-builder-api.ts';
import {
  buildForm,
  editor,
  publishVersionOne,
  saveDraft,
  startDraft,
} from './form-builder-steps.ts';
import {
  addAccountsFile,
  addBudgetTable,
  budgetForm,
  column,
  expectBudget,
  previewBudget,
} from './forms-builder-table-file-steps.ts';

/** Each page loads its code when it is first opened, which a busy machine or a development server's first compile can slow past five seconds. */
const expect = strictExpect.configure({ timeout: 15_000 });

const form = `/northfield/rounds/${ids.round}/form`;
const draft = `${form}/${ids.versions[0]}`;
const save = `PUT /console/form-versions/${ids.versions[0]}/definition`;

test.describe('a budget table and a file question', () => {
  test('are added to the form, set up, previewed with uploading switched off, and published', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const forms = await stubForms(page);
    await page.goto(form);

    await startDraft(page);
    await buildForm(page);
    await addBudgetTable(page);
    await addAccountsFile(page);
    await saveDraft(page);
    await previewBudget(page);
    await publishVersionOne(page);

    const [published] = forms.versions;
    expect(published?.status).toBe('published');
    expectBudget(published?.definition?.sections[2]?.fields);
  });

  test('keep what was set when the draft is saved and opened again', async ({ page }) => {
    await stubForms(page, [version(1, 'draft', budgetForm)]);
    await page.goto(draft);

    await expect(page.getByRole('region', { name: 'Edit question' })).toBeVisible();
    const question = editor(page, 'Edit question');
    await expect(question.getByRole('textbox', { name: 'Name for one row' })).toHaveValue('cost');
    await expect(question.getByRole('textbox', { name: 'Most rows' })).toHaveValue('8');
    await expect(column(question, 4).getByRole('textbox', { name: /^Heading/ })).toHaveValue(
      'Kind',
    );
    await expect(
      column(question, 4).getByRole('checkbox', {
        name: 'Applicants must fill this in on every row',
      }),
    ).not.toBeChecked();

    await page
      .getByRole('list', { name: 'Questions' })
      .getByRole('button', { name: /Latest accounts/ })
      .click();
    await expect(question.getByRole('checkbox', { name: 'PDF', exact: true })).toBeChecked();
    await expect(question.getByRole('checkbox', { name: 'Word document' })).toBeChecked();
    await expect(question.getByRole('checkbox', { name: 'PNG image' })).not.toBeChecked();
    await expect(question.getByRole('combobox', { name: 'Largest file' })).toHaveValue(
      String(5 * 1024 * 1024),
    );
    await expect(question.getByRole('textbox', { name: 'Most files' })).toHaveValue('2');
  });

  test('say what is wrong beside the box, in a summary that names the column, and send nothing until it is fixed', async ({
    page,
  }) => {
    const forms = await stubForms(page, [version(1, 'draft', budgetForm)]);
    await page.goto(draft);
    const question = editor(page, 'Edit question');
    await column(question, 2).getByRole('textbox', { name: 'Heading of column 2' }).fill('');

    await page.getByRole('button', { name: 'Save draft' }).click();

    const summary = page.getByRole('alert', { name: 'There is a problem' });
    await expect(summary).toBeFocused();
    await expect(summary.getByRole('link')).toHaveText([
      'Section 1, question 1, column 2: Enter at least 1 character.',
    ]);
    await summary.getByRole('link').click();
    await expect(
      column(question, 2).getByRole('textbox', { name: 'Heading of column 2' }),
    ).toBeFocused();
    await expect(column(question, 2).getByText('Enter at least 1 character.')).toBeVisible();
    expect(forms.sent.map(({ key }) => key)).not.toContain(save);

    await page.keyboard.type('Price');
    await expect(summary).toHaveCount(0);
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText(/^Saved \d+ October 2026 at /)).toBeVisible();
  });

  test('say when a file question takes no type, beside the types', async ({ page }) => {
    await stubForms(page, [version(1, 'draft', budgetForm)]);
    await page.goto(draft);
    await page
      .getByRole('list', { name: 'Questions' })
      .getByRole('button', { name: /Latest accounts/ })
      .click();
    const question = editor(page, 'Edit question');
    await question.getByRole('checkbox', { name: 'PDF', exact: true }).uncheck();
    await question.getByRole('checkbox', { name: 'Word document' }).uncheck();

    await page.getByRole('button', { name: 'Save draft' }).click();

    const summary = page.getByRole('alert', { name: 'There is a problem' });
    await expect(summary.getByRole('link')).toHaveText([
      'Section 1, question 2: Add at least 1 item.',
    ]);
    await summary.getByRole('link').click();
    await expect(question.getByRole('checkbox', { name: 'PDF', exact: true })).toBeFocused();
    await expect(question.getByRole('group', { name: 'File types' })).toContainText(
      'Add at least 1 item.',
    );
  });

  test('show what the server refuses beside the column it names, in its words', async ({
    page,
  }) => {
    const words =
      'c_cost was another type of column in an earlier version. Keep its type, or add a new column with a new id.';
    await stubForms(page, [version(1, 'draft', budgetForm)], {
      [save]: problem(400, 'Some fields are not valid. Fix the fields listed and try again.', [
        { field: 'body.definition.sections.0.fields.0.columns.1.type', message: words },
      ]),
    });
    await page.goto(draft);
    const question = editor(page, 'Edit question');
    await column(question, 2)
      .getByRole('combobox', { name: 'Type of column 2' })
      .selectOption('Number');

    await page.getByRole('button', { name: 'Save draft' }).click();

    const summary = page.getByRole('alert', { name: 'There is a problem' });
    await expect(summary).toBeFocused();
    await expect(summary).toContainText(`Section 1, question 1, column 2: ${words}`);
    await expect(
      column(question, 2).getByRole('combobox', { name: 'Type of column 2' }),
    ).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('You have changes that are not saved.')).toBeVisible();
  });
});
