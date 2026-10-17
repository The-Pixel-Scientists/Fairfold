// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The form builder screens in a real browser, with the API's answers stubbed
// (form-builder-api.ts): a round that keeps its form versions. The same steps
// run against the real API in form-builder-journey.spec.ts. Every spec also
// fails on a Content Security Policy violation, so the screens are checked
// under the production policy in console-production.

import { productName } from '@pixel-scientists/domain/platform';

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { problem } from './auth-api.ts';
import { ids, organisationForm, stubForms, version, withDraft } from './form-builder-api.ts';
import {
  addSection,
  buildForm,
  checkVersions,
  editor,
  h1,
  previewForm,
  publishVersionOne,
  saveDraft,
  startDraft,
} from './form-builder-steps.ts';

/** Each page loads its code when it is first opened, which a busy machine or a development server's first compile can slow past five seconds. */
const expect = strictExpect.configure({ timeout: 15_000 });

const SUFFIX = `– ${productName} console`;
const form = `/northfield/rounds/${ids.round}/form`;

/** Playwright dismisses the browser's own confirm and alert dialogs without a word, so note each one. */
function watchNativeDialogs(page: Page): string[] {
  const opened: string[] = [];
  page.on('dialog', (dialog) => {
    opened.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss();
  });
  return opened;
}

test.describe('building the form for a round', () => {
  test('goes from no form to a draft with three sections, a preview, and published version 1', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const forms = await stubForms(page);
    await page.goto(form);
    await expect(h1(page, 'Application form')).toBeVisible();
    await expect(page).toHaveTitle(`Application form ${SUFFIX}`);

    await startDraft(page);
    await buildForm(page);
    await saveDraft(page);
    await previewForm(page);
    await publishVersionOne(page);
    await checkVersions(page);

    const [published] = forms.versions;
    expect(published?.status).toBe('published');
    expect(published?.definition?.sections.map((section) => section.title)).toEqual([
      'About your organisation',
      'Your project',
      'Your budget',
    ]);
    const [name, charity, number, email] = published?.definition?.sections[0]?.fields ?? [];
    expect(name).toMatchObject({
      label: 'Organisation name',
      identity: true,
      audiences: ['applicant', 'staff'],
    });
    expect(charity).toMatchObject({
      type: 'yes_no',
      eligibility: { stopWhen: false, explanation: 'We only fund registered charities.' },
    });
    expect(number).toMatchObject({ conditions: [{ field: charity?.id, equals: true }] });
    expect(email).toMatchObject({ type: 'email', audiences: ['applicant', 'staff'] });
    expect(published?.definition?.sections[1]?.fields[0]).toMatchObject({
      type: 'long_text',
      maxWords: 300,
    });
  });

  test('lists the versions, and opens the draft and the published version', async ({ page }) => {
    await stubForms(page, withDraft());
    await page.goto(form);

    const rows = page.getByRole('table', { name: 'Versions of the form' }).getByRole('row');
    await expect(rows.nth(1)).toContainText('Version 2');
    await expect(rows.nth(1)).toContainText('Draft');
    await expect(rows.nth(2)).toContainText('Published');
    await expect(rows.nth(2)).toContainText('13 October 2026 at 10am by Ada Reed');
    await page.getByRole('link', { name: /Edit draft version 2/ }).click();
    await expect(h1(page, 'Application form')).toBeFocused();
    await expect(page.getByText('Version 2, draft')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Question' })).toHaveValue('Organisation name');

    await page.goBack();
    await page.getByRole('link', { name: /View version 1/ }).click();
    await expect(page.getByText(/^Version 1, published 13 October 2026 at 10am/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save draft' })).toHaveCount(0);
  });

  test('moves sections and questions from the keyboard, then saves the new order', async ({
    page,
  }) => {
    const forms = await stubForms(page, withDraft());
    await page.goto(`${form}/${ids.versions[1]}`);
    await expect(page.getByRole('textbox', { name: 'Question' })).toHaveValue('Organisation name');

    await page.getByRole('button', { name: /^Move down\s*Organisation name$/ }).focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('button', { name: /^Move down\s*Organisation name$/ }),
    ).toBeFocused();
    await expect(page.getByText('Question moved to position 2 of 4')).toBeAttached();
    await page.getByRole('button', { name: /^2\. Your project/ }).click();
    await page.getByRole('button', { name: /^Move up\s*Your project$/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Your project moved to position 1 of 3')).toBeAttached();
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText(/^Saved \d+ October 2026 at /)).toBeVisible();

    const [, draft] = forms.versions;
    expect(draft?.definition?.sections.map((section) => section.title)).toEqual([
      'Your project',
      'About your organisation',
      'Your budget',
    ]);
    expect(draft?.definition?.sections[1]?.fields.map((field) => field.id)).toEqual([
      'f_charity',
      'f_name',
      'f_number',
      'f_email',
    ]);
  });

  test('says what is wrong beside each box and in a summary, and sends nothing until it is fixed', async ({
    page,
  }) => {
    const forms = await stubForms(page, withDraft());
    await page.goto(`${form}/${ids.versions[1]}`);
    await addSection(page, 'Money');
    await page.getByRole('button', { name: /Untitled question/ }).click();

    await page.getByRole('button', { name: 'Save draft' }).click();

    const summary = page.getByRole('alert', { name: 'There is a problem' });
    await expect(summary).toBeFocused();
    await expect(summary.getByRole('link')).toHaveText([
      'Section 4, question 1: Enter at least 1 character.',
    ]);
    await summary.getByRole('link').click();
    await expect(
      editor(page, 'Edit question').getByRole('textbox', { name: 'Question' }),
    ).toBeFocused();
    await expect(
      editor(page, 'Edit question').getByText('Enter at least 1 character.'),
    ).toBeVisible();
    expect(forms.sent.map(({ key }) => key)).not.toContain(
      `PUT /console/form-versions/${ids.versions[1]}/definition`,
    );

    await page.keyboard.type('Total cost');
    await expect(summary).toHaveCount(0);
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText(/^Saved \d+ October 2026 at /)).toBeVisible();
  });

  test('shows what the server refuses in its words, beside the box it names', async ({ page }) => {
    const words =
      'f_name was another type of question in an earlier version. Keep its type, or add a new question with a new id.';
    await stubForms(page, withDraft(), {
      [`PUT /console/form-versions/${ids.versions[1]}/definition`]: problem(
        400,
        'Some fields are not valid. Fix the fields listed and try again.',
        [{ field: 'body.definition.sections.0.fields.0.type', message: words }],
      ),
    });
    await page.goto(`${form}/${ids.versions[1]}`);
    await page.getByRole('combobox', { name: 'Type' }).selectOption('Date');

    await page.getByRole('button', { name: 'Save draft' }).click();

    const summary = page.getByRole('alert', { name: 'There is a problem' });
    await expect(summary).toBeFocused();
    await expect(summary).toContainText(`Section 1, question 1: ${words}`);
    await expect(page.getByRole('combobox', { name: 'Type' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(page.getByText('You have changes that are not saved.')).toBeVisible();
  });

  test('takes a form file into the draft, or says what is wrong with the file', async ({
    page,
  }) => {
    const forms = await stubForms(page, [version(1, 'draft', null)]);
    await page.goto(`${form}/${ids.versions[0]}`);
    await expect(page.getByRole('heading', { level: 2, name: 'No sections yet' })).toBeVisible();
    const file = (content: unknown) => ({
      name: 'form.json',
      mimeType: 'application/json',
      buffer: Buffer.from(typeof content === 'string' ? content : JSON.stringify(content)),
    });

    await page.locator('input[type=file]').setInputFiles(file('not a form'));
    const refused = page.getByRole('alert', { name: 'We could not import this file' });
    await expect(refused).toBeFocused();
    await expect(refused).toContainText('This file is not a form.');

    await page
      .locator('input[type=file]')
      .setInputFiles(
        file({ format: 'form-definition', formatVersion: 1, definition: organisationForm }),
      );
    await expect(refused).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^1\. About your organisation/ })).toBeVisible();
    await expect(page.getByText('You have changes that are not saved.')).toBeVisible();
    await saveDraft(page);
    expect(forms.versions[0]?.definition?.sections).toHaveLength(3);
  });

  test('discards a draft after asking, and goes back to the versions', async ({ page }) => {
    const forms = await stubForms(page, withDraft());
    await page.goto(`${form}/${ids.versions[1]}`);
    await page.getByRole('textbox', { name: 'Question' }).fill('Name of organisation');

    await page.getByRole('button', { name: 'Discard draft' }).click();
    const dialog = page.getByRole('dialog', { name: 'Discard this draft?' });
    await expect(dialog.getByRole('button', { name: 'Keep draft' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Discard draft' }).click();

    await expect(h1(page, 'Application form')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create draft' })).toBeVisible();
    expect(forms.versions.map((item) => item.version)).toEqual([1]);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('leaving a draft with changes that are not saved', () => {
  test('opens a dialog, not the browser confirm, and keeps the changes when the person stays', async ({
    page,
  }) => {
    await stubForms(page, withDraft());
    const native = watchNativeDialogs(page);
    await page.goto(`${form}/${ids.versions[1]}`);
    await page.getByRole('textbox', { name: 'Question' }).fill('Name of organisation');

    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('link', { name: 'Form' })
      .click();

    const dialog = page.getByRole('dialog', { name: 'Leave this page?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Stay on this page' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Question' })).toHaveValue(
      'Name of organisation',
    );
    expect(native).toEqual([]);
  });
});

test.describe('a person who cannot set up programmes', () => {
  test('is told so, without the form being asked for', async ({ page }) => {
    const forms = await stubForms(page, withDraft(), {}, ['grants.reviews.score']);
    await page.goto(form);

    await expect(
      page.getByRole('heading', { level: 2, name: 'You cannot set up programmes' }),
    ).toBeVisible();
    expect(new Set(forms.sent.map(({ key }) => key))).toEqual(new Set(['GET /auth/session']));
  });
});
