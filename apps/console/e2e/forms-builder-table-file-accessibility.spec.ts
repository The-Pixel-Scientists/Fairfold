// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for the settings of a table question and a file question, and
// for their preview, in each state they can be in, at desktop width, at 320 px
// wide and at 200% zoom (ADR 0006), and at desktop width in the dark scheme,
// with the API's answers stubbed (form-builder-api.ts). In console-production
// they run under the production content security policy.

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { problem } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './auth-axe.ts';
import { ids, organisationForm, stubForms, version } from './form-builder-api.ts';
import type { FormStub } from './form-builder-api.ts';
import { budgetForm, column } from './forms-builder-table-file-steps.ts';
import { editor } from './form-builder-steps.ts';

/** Each page loads its code when it is first opened, which a busy machine or a development server's first compile can slow past five seconds. */
const expect = strictExpect.configure({ timeout: 15_000 });

const draft = `/northfield/rounds/${ids.round}/form/${ids.versions[0]}`;
const summary = (page: Page) => page.getByRole('alert', { name: 'There is a problem' });
const stub = (page: Page) => stubForms(page, [version(1, 'draft', budgetForm)]);
const demo = (page: Page) => stubForms(page, [version(1, 'draft', organisationForm)]);

/** Opens a draft that has a table and a file question, with the table selected. */
async function open(page: Page): Promise<void> {
  await page.goto(draft);
  await expect(editor(page, 'Edit question')).toBeVisible();
  await expect(column(editor(page, 'Edit question'), 4)).toBeVisible();
}

/** Selects the file question of the draft. */
async function openFile(page: Page): Promise<void> {
  await page.goto(draft);
  await page
    .getByRole('list', { name: 'Questions' })
    .getByRole('button', { name: /Latest accounts/ })
    .click();
  await expect(page.getByRole('group', { name: 'File types' })).toBeVisible();
}

/** Adds a question to the first draft of the demo form, and gives it a type. */
async function addNew(page: Page, type: 'Table' | 'File upload'): Promise<void> {
  await page.goto(draft);
  await page.getByRole('button', { name: 'Add question' }).click();
  await editor(page, 'Edit question')
    .getByRole('combobox', { name: 'Type', exact: true })
    .selectOption(type);
}

interface State {
  name: string;
  /** Sets the API's answers for this state. Every state has a funder with a round. */
  stub?: (page: Page) => Promise<FormStub>;
  /** Opens the screen and gets it into the state, and waits until it is showing. */
  open: (page: Page) => Promise<void>;
}

const states: State[] = [
  { name: 'a table question', stub, open },
  {
    name: 'a table question that has the most columns',
    stub,
    open: async (page) => {
      await open(page);
      const add = page.getByRole('button', { name: 'Add column' });
      await add.click();
      await add.click();
      await expect(add).toHaveAttribute('aria-disabled', 'true');
    },
  },
  {
    name: 'a new table question',
    stub: demo,
    open: async (page) => {
      await addNew(page, 'Table');
      await expect(column(editor(page, 'Edit question'), 1)).toBeVisible();
    },
  },
  { name: 'a file question', stub, open: openFile },
  {
    name: 'a new file question',
    stub: demo,
    open: async (page) => {
      await addNew(page, 'File upload');
      await expect(page.getByRole('group', { name: 'File types' })).toBeVisible();
    },
  },
  {
    name: 'a table question with problems',
    stub,
    open: async (page) => {
      await open(page);
      const question = editor(page, 'Edit question');
      await question.getByRole('textbox', { name: 'Name for one row' }).fill('');
      await question.getByRole('textbox', { name: 'Most rows' }).fill('');
      await column(question, 2).getByRole('textbox', { name: 'Heading of column 2' }).fill('');
      await column(question, 4).getByRole('textbox', { name: 'Choice 1' }).fill('');
      await page.getByRole('button', { name: 'Save draft' }).click();
      await expect(summary(page)).toBeFocused();
    },
  },
  {
    name: 'a file question with problems',
    stub,
    open: async (page) => {
      await openFile(page);
      const question = editor(page, 'Edit question');
      await question.getByRole('checkbox', { name: 'PDF', exact: true }).uncheck();
      await question.getByRole('checkbox', { name: 'Word document' }).uncheck();
      await question.getByRole('textbox', { name: 'Most files' }).fill('');
      await page.getByRole('button', { name: 'Save draft' }).click();
      await expect(summary(page)).toBeFocused();
    },
  },
  {
    name: 'a table question that the server refuses',
    stub: (page) =>
      stubForms(page, [version(1, 'draft', budgetForm)], {
        [`PUT /console/form-versions/${ids.versions[0]}/definition`]: problem(
          400,
          'Some fields are not valid. Fix the fields listed and try again.',
          [
            {
              field: 'body.definition.sections.0.fields.0.columns.1.type',
              message:
                'c_cost was another type of column in an earlier version. Keep its type, or add a new column with a new id.',
            },
          ],
        ),
      }),
    open: async (page) => {
      await open(page);
      await column(editor(page, 'Edit question'), 2)
        .getByRole('combobox', { name: 'Type of column 2' })
        .selectOption('Number');
      await page.getByRole('button', { name: 'Save draft' }).click();
      await expect(summary(page)).toBeFocused();
    },
  },
  {
    name: 'the preview of a table and a file question',
    stub,
    open: async (page) => {
      await page.goto(draft);
      await page.getByRole('tab', { name: 'Preview' }).click();
      await expect(page.getByRole('button', { name: 'Add another cost' })).toBeVisible();
      await expect(page.getByText(/Uploading is switched off in the preview/)).toBeVisible();
    },
  },
  {
    name: 'the preview with a file that cannot be sent',
    stub,
    open: async (page) => {
      await page.goto(draft);
      await page.getByRole('tab', { name: 'Preview' }).click();
      await page
        .getByRole('tabpanel', { name: 'Preview' })
        .locator('input[type=file]')
        .setInputFiles({
          name: 'notes.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('Notes'),
        });
      await expect(summary(page)).toContainText(
        'notes.txt: The file must be a PDF or Word document.',
      );
    },
  },
];

for (const variant of variants) {
  test.describe(`at ${variant.name}`, () => {
    test.use({
      viewport: variant.viewport,
      deviceScaleFactor: variant.deviceScaleFactor,
      colorScheme: variant.scheme,
    });

    for (const state of states) {
      test(`@a11y ${state.name} has no axe violations`, async ({ page }) => {
        await (state.stub ?? ((target) => stubForms(target)))(page);
        await state.open(page);
        await expect(page.locator('h1')).toHaveCount(1);

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}
