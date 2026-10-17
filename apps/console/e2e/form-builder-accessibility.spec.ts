// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for every form builder screen and state, and for the settings of
// each kind of question, at desktop width, at 320 px wide and at 200% zoom
// (ADR 0006), and at desktop width in the dark scheme, with the API's answers
// stubbed (form-builder-api.ts). In console-production they run under the
// production content security policy.

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { problem } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './auth-axe.ts';
import { ids, richForm, stubForms, version, withDraft } from './form-builder-api.ts';
import type { FormStub } from './form-builder-api.ts';

/** Each page loads its code when it is first opened, which a busy machine or a development server's first compile can slow past five seconds. */
const expect = strictExpect.configure({ timeout: 15_000 });

const form = `/northfield/rounds/${ids.round}/form`;
const draft = `${form}/${ids.versions[1]}`;
const summary = (page: Page) => page.getByRole('alert', { name: 'There is a problem' });
const busy = problem(503, 'The service is busy. Try again in a minute.');
const versionsAddress = `GET /console/rounds/${ids.round}/form-versions`;

/** A request that is never answered, so the page stays on its loading state. */
async function neverAnswer(page: Page, path: string): Promise<void> {
  await page.route(
    (url) => url.pathname === path,
    () => undefined,
  );
}

/** A question in the list of the section that is showing, not the buttons that move it. */
const questionButton = (page: Page, name: RegExp) =>
  page.getByRole('list', { name: 'Questions' }).getByRole('button', { name });

/** Opens the draft, and then a question of it, in its section. */
async function pick(page: Page, section: RegExp | null, question: RegExp): Promise<void> {
  await page.goto(draft);
  await expect(page.getByRole('heading', { level: 2, name: 'Sections' })).toBeVisible();
  if (section !== null) await page.getByRole('button', { name: section }).click();
  await questionButton(page, question).click();
  await expect(page.getByRole('region', { name: 'Edit question' })).toBeVisible();
}

/** Opens a draft of the form with questions of other kinds. */
async function openRich(page: Page, question: RegExp): Promise<void> {
  await page.goto(`${form}/${ids.versions[0]}`);
  await questionButton(page, question).click();
  await expect(page.getByRole('region', { name: 'Edit question' })).toBeVisible();
}

const rich = (page: Page) => stubForms(page, [version(1, 'draft', richForm)]);

interface State {
  name: string;
  /** Sets the API's answers for this state. Every state has a funder with a round. */
  stub?: (page: Page) => Promise<FormStub>;
  /** Opens the screen and gets it into the state, and waits until it is showing. */
  open: (page: Page) => Promise<void>;
}

const states: State[] = [
  {
    name: 'the versions of a form',
    stub: (page) => stubForms(page, withDraft()),
    open: async (page) => {
      await page.goto(form);
      await expect(page.getByRole('table', { name: 'Versions of the form' })).toBeVisible();
    },
  },
  {
    name: 'the versions of a round with no form',
    open: async (page) => {
      await page.goto(form);
      await expect(page.getByRole('heading', { level: 2, name: 'No form yet' })).toBeVisible();
    },
  },
  {
    name: 'the versions while loading',
    open: async (page) => {
      await neverAnswer(page, `/api/console/rounds/${ids.round}/form-versions`);
      await page.goto(form);
      await expect(page.getByRole('status').filter({ hasText: 'Loading the form' })).toBeVisible();
    },
  },
  {
    name: 'the versions that could not be loaded',
    stub: (page) => stubForms(page, withDraft(), { [versionsAddress]: busy }),
    open: async (page) => {
      await page.goto(form);
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    },
  },
  {
    name: 'the versions for someone without the permission',
    stub: (page) => stubForms(page, withDraft(), {}, ['grants.reviews.score']),
    open: async (page) => {
      await page.goto(form);
      await expect(
        page.getByRole('heading', { level: 2, name: 'You cannot set up programmes' }),
      ).toBeVisible();
    },
  },
  {
    name: 'a draft',
    stub: (page) => stubForms(page, withDraft()),
    open: async (page) => {
      await page.goto(draft);
      await expect(page.getByRole('textbox', { name: 'Question' })).toHaveValue(
        'Organisation name',
      );
    },
  },
  {
    name: 'a draft with no sections',
    stub: (page) => stubForms(page, [version(1, 'draft', null)]),
    open: async (page) => {
      await page.goto(`${form}/${ids.versions[0]}`);
      await expect(page.getByRole('heading', { level: 2, name: 'No sections yet' })).toBeVisible();
    },
  },
  {
    name: 'a section',
    stub: (page) => stubForms(page, withDraft()),
    open: async (page) => {
      await page.goto(draft);
      await page.getByRole('button', { name: /^2\. Your project/ }).click();
      await expect(page.getByRole('region', { name: 'Edit section' })).toBeVisible();
    },
  },
  {
    name: 'a short text question that is hidden from reviewers',
    stub: (page) => stubForms(page, withDraft()),
    open: (page) => pick(page, null, /Organisation name/),
  },
  {
    name: 'a long text question with a word limit',
    stub: (page) => stubForms(page, withDraft()),
    open: (page) => pick(page, /^2\. Your project/, /What will you do with the money/),
  },
  {
    name: 'a choice question',
    stub: (page) => stubForms(page, withDraft()),
    open: (page) => pick(page, /^2\. Your project/, /What will the money pay for/),
  },
  {
    name: 'a question that allows several choices',
    stub: (page) => stubForms(page, withDraft()),
    open: (page) => pick(page, /^2\. Your project/, /Who will take part/),
  },
  {
    name: 'a yes or no question that stops applicants',
    stub: (page) => stubForms(page, withDraft()),
    open: (page) => pick(page, null, /Is your organisation a registered charity/),
  },
  {
    name: 'a question that depends on an answer',
    stub: (page) => stubForms(page, withDraft()),
    open: (page) => pick(page, null, /Registered charity number/),
  },
  {
    name: 'a choice question that stops applicants',
    stub: rich,
    open: (page) => openRich(page, /What kind of organisation are you/),
  },
  {
    name: 'a text for applicants to read',
    stub: rich,
    open: async (page) => {
      await page.goto(`${form}/${ids.versions[0]}`);
      await questionButton(page, /Answer every question marked required/).click();
      await expect(page.getByRole('region', { name: 'Edit text' })).toBeVisible();
    },
  },
  {
    name: 'a question the builder cannot change yet',
    stub: rich,
    open: async (page) => {
      await openRich(page, /Costs/);
      await expect(page.getByText(/You cannot change the settings of this type/)).toBeVisible();
    },
  },
  {
    name: 'a draft with problems',
    stub: (page) => stubForms(page, withDraft()),
    open: async (page) => {
      await page.goto(draft);
      await page.getByRole('button', { name: 'Add section' }).click();
      await page.getByRole('button', { name: 'Save draft' }).click();
      await expect(summary(page)).toBeFocused();
    },
  },
  {
    name: 'a draft that the server refuses',
    stub: (page) =>
      stubForms(page, withDraft(), {
        [`PUT /console/form-versions/${ids.versions[1]}/definition`]: problem(
          400,
          'Some fields are not valid. Fix the fields listed and try again.',
          [
            {
              field: 'body.definition.sections.0.fields.0.type',
              message:
                'f_name was another type of question in an earlier version. Keep its type, or add a new question with a new id.',
            },
          ],
        ),
      }),
    open: async (page) => {
      await page.goto(draft);
      await page.getByRole('combobox', { name: 'Type' }).selectOption('Date');
      await page.getByRole('button', { name: 'Save draft' }).click();
      await expect(summary(page)).toBeFocused();
    },
  },
  {
    name: 'the preview',
    stub: (page) => stubForms(page, withDraft()),
    open: async (page) => {
      await page.goto(draft);
      await page.getByRole('tab', { name: 'Preview' }).click();
      await expect(page.getByText('Section 1 of 3')).toBeVisible();
    },
  },
  {
    name: 'the preview with an answer that stops applicants',
    stub: (page) => stubForms(page, withDraft()),
    open: async (page) => {
      await page.goto(draft);
      await page.getByRole('tab', { name: 'Preview' }).click();
      await page.getByRole('radio', { name: 'No', exact: true }).check();
      await expect(page.getByRole('alert')).toContainText('You cannot apply with this answer');
    },
  },
  {
    name: 'the preview of a draft with problems',
    stub: (page) => stubForms(page, withDraft()),
    open: async (page) => {
      await page.goto(draft);
      await page.getByRole('button', { name: 'Add section' }).click();
      await page.getByRole('tab', { name: 'Preview' }).click();
      await expect(
        page.getByRole('heading', { level: 2, name: 'Fix the problems to preview the form' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the dialog before publishing',
    stub: (page) => stubForms(page, withDraft()),
    open: async (page) => {
      await page.goto(draft);
      await page.getByRole('button', { name: 'Publish version 2' }).click();
      await expect(page.getByRole('dialog', { name: 'Publish version 2?' })).toBeVisible();
    },
  },
  {
    name: 'the dialog after publishing was refused',
    stub: (page) =>
      stubForms(page, withDraft(), {
        [`POST /console/form-versions/${ids.versions[1]}/publish`]: problem(
          409,
          'This version is already published.',
        ),
      }),
    open: async (page) => {
      await page.goto(draft);
      await page.getByRole('button', { name: 'Publish version 2' }).click();
      await page
        .getByRole('dialog', { name: 'Publish version 2?' })
        .getByRole('button', { name: 'Publish version 2' })
        .click();
      await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
    },
  },
  {
    name: 'the dialog before discarding',
    stub: (page) => stubForms(page, withDraft()),
    open: async (page) => {
      await page.goto(draft);
      await page.getByRole('button', { name: 'Discard draft' }).click();
      await expect(page.getByRole('dialog', { name: 'Discard this draft?' })).toBeVisible();
    },
  },
  {
    name: 'the dialog before removing a section',
    stub: (page) => stubForms(page, withDraft()),
    open: async (page) => {
      await page.goto(draft);
      await page.getByRole('button', { name: /^2\. Your project/ }).click();
      await page.getByRole('button', { name: /^Remove\s*Your project$/ }).click();
      await expect(page.getByRole('dialog', { name: 'Remove this section?' })).toBeVisible();
    },
  },
  {
    name: 'the dialog before leaving with changes that are not saved',
    stub: (page) => stubForms(page, withDraft()),
    open: async (page) => {
      await page.goto(draft);
      await page.getByRole('textbox', { name: 'Question' }).fill('Name of organisation');
      await page
        .getByRole('navigation', { name: 'Breadcrumb' })
        .getByRole('link', { name: 'Form' })
        .click();
      await expect(page.getByRole('dialog', { name: 'Leave this page?' })).toBeVisible();
    },
  },
  {
    name: 'a file that could not be imported',
    stub: (page) => stubForms(page, withDraft()),
    open: async (page) => {
      await page.goto(draft);
      await page.locator('input[type=file]').setInputFiles({
        name: 'form.json',
        mimeType: 'application/json',
        buffer: Buffer.from('nope'),
      });
      await expect(
        page.getByRole('alert', { name: 'We could not import this file' }),
      ).toBeFocused();
    },
  },
  {
    name: 'a published version',
    stub: (page) => stubForms(page, withDraft()),
    open: async (page) => {
      await page.goto(`${form}/${ids.versions[0]}`);
      await expect(page.getByText(/^Version 1, published /)).toBeVisible();
      await expect(page.getByText('Section 1 of 3')).toBeVisible();
    },
  },
  {
    name: 'a version that could not be loaded',
    stub: (page) =>
      stubForms(page, withDraft(), {
        [`GET /console/form-versions/${ids.versions[1]}`]: busy,
      }),
    open: async (page) => {
      await page.goto(draft);
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
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
        // A dialog hides the page behind it from the accessibility tree, but the page still has its one heading.
        await expect(page.locator('h1')).toHaveCount(1);

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}
