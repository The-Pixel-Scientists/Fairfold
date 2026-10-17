// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 6 as a person does it: a programme manager builds the round's
// form with three sections, a question that stops applicants who are not
// eligible, a question that depends on an answer, a word limit, and contact
// answers hidden from reviewers; previews it as an applicant sees it; and
// publishes version 1. The stubbed spec (form-builder.spec.ts) and the journey
// against the real API (form-builder-journey.spec.ts) both take these steps.
// The budget table and the accounts file come with S05-11.

import { expect as strictExpect } from '../../../scripts/e2e/fixtures.ts';
import type { Locator, Page } from '@playwright/test';

/** Each page loads its code when it is first opened, which a busy machine or a development server's first compile can slow past five seconds. */
const expect = strictExpect.configure({ timeout: 15_000 });

export const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

export const editor = (page: Page, name: 'Edit question' | 'Edit section') =>
  page.getByRole('region', { name });

/** Starts the first draft from a round's form page, which has no form yet, and arrives on its editor. */
export async function startDraft(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 2, name: 'No form yet' })).toBeVisible();
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(h1(page, 'Application form')).toBeFocused();
  await expect(page.getByRole('heading', { level: 2, name: 'No sections yet' })).toBeVisible();
}

/** Adds a section, which starts with one blank question, and gives it its title. */
export async function addSection(page: Page, title: string, introduction?: string): Promise<void> {
  await page.getByRole('button', { name: 'Add section' }).click();
  const section = editor(page, 'Edit section');
  await expect(section.getByRole('textbox', { name: 'Title' })).toBeFocused();
  await page.keyboard.type(title);
  if (introduction !== undefined) {
    await section.getByRole('textbox', { name: /^Introduction/ }).fill(introduction);
  }
  await expect(
    page.getByRole('button', { name: /^\d+\. / }).filter({ hasText: `. ${title}` }),
  ).toBeVisible();
}

/** Opens the blank question a new section starts with, and gives it its words. */
export async function firstQuestion(page: Page, label: string): Promise<Locator> {
  await page.getByRole('button', { name: /Untitled question/ }).click();
  const question = editor(page, 'Edit question');
  await question.getByRole('textbox', { name: 'Question' }).fill(label);
  return question;
}

/** Adds a question after the others in the section, with the cursor in its words, and gives it its words. */
export async function addQuestion(page: Page, label: string): Promise<Locator> {
  await page.getByRole('button', { name: 'Add question' }).click();
  const question = editor(page, 'Edit question');
  await expect(question.getByRole('textbox', { name: 'Question' })).toBeFocused();
  await page.keyboard.type(label);
  return question;
}

/** Builds the three sections of the demo form on an empty draft. */
export async function buildForm(page: Page): Promise<void> {
  await addSection(page, 'About your organisation', 'Tell us who you are.');
  let question = await firstQuestion(page, 'Organisation name');
  await question
    .getByRole('combobox', { name: 'Who sees the answer' })
    .selectOption('Staff only, not reviewers');
  await question
    .getByRole('checkbox', { name: 'Identity field: hide from blind reviewers' })
    .check();

  question = await addQuestion(page, 'Is your organisation a registered charity?');
  await question.getByRole('combobox', { name: 'Type' }).selectOption('Yes or no');
  await question.getByRole('radio', { name: 'No', exact: true }).check();
  await question
    .getByRole('textbox', { name: 'What applicants are told' })
    .fill('We only fund registered charities.');

  question = await addQuestion(page, 'Registered charity number');
  await question.getByRole('button', { name: 'Add condition' }).click();
  await expect(question.getByRole('combobox', { name: 'Earlier question' })).toHaveValue(/^f_/);
  await expect(question.getByRole('combobox', { name: 'Answer is' })).toHaveValue('0');

  question = await addQuestion(page, 'Contact email');
  await question.getByRole('combobox', { name: 'Type' }).selectOption('Email address');
  await question
    .getByRole('combobox', { name: 'Who sees the answer' })
    .selectOption('Staff only, not reviewers');

  await addSection(page, 'Your project');
  question = await firstQuestion(page, 'What will you do with the money?');
  await question.getByRole('combobox', { name: 'Type' }).selectOption('Long text');
  await question.getByRole('textbox', { name: /^Word limit/ }).fill('300');

  await addSection(page, 'Your budget');
  question = await firstQuestion(page, 'How much are you asking for?');
  await question.getByRole('combobox', { name: 'Type' }).selectOption('Amount in pounds');
}

/** Saves the draft and waits for the page to say so. */
export async function saveDraft(page: Page): Promise<void> {
  await expect(page.getByText('You have changes that are not saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/^Saved \d+ \w+ \d{4} at /)).toBeVisible();
}

/** Walks the preview as an applicant: an answer that stops them, then the one that lets them on to a question that depends on it. */
export async function previewForm(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Preview' }).click();
  const preview = page.getByRole('tabpanel', { name: 'Preview' });
  await expect(preview.getByText('Section 1 of 3')).toBeVisible();
  await expect(preview.getByRole('textbox', { name: /Registered charity number/ })).toHaveCount(0);

  await preview.getByRole('radio', { name: 'No', exact: true }).check();
  const stop = preview.getByRole('alert');
  await expect(stop).toContainText('You cannot apply with this answer');
  await expect(stop).toContainText('We only fund registered charities.');
  await expect(preview.getByRole('button', { name: 'Next section' })).toHaveCount(0);

  await preview.getByRole('radio', { name: 'Yes' }).check();
  await expect(stop).toHaveCount(0);
  await preview.getByRole('textbox', { name: /Registered charity number/ }).fill('1234567');
  await preview.getByRole('button', { name: 'Next section' }).click();
  await expect(preview.getByText('Section 2 of 3')).toBeVisible();
  await expect(
    preview.getByRole('textbox', { name: /What will you do with the money/ }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Edit form' }).click();
}

/** Publishes the draft as version 1, after the dialog says what that means, and arrives on the published version. */
export async function publishVersionOne(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Publish version 1' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish version 1?' });
  await expect(dialog).toContainText('A published version cannot be changed.');
  await expect(dialog).toContainText('New applications use version 1 from now on');
  await expect(dialog.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Publish version 1' }).click();

  await expect(page.getByText(/^Version 1, published /)).toBeVisible();
  await expect(h1(page, 'Application form')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Save draft' })).toHaveCount(0);
  await expect(page.getByText('Section 1 of 3')).toBeVisible();
}

/** The versions page lists version 1 as published. */
export async function checkVersions(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Back to versions' }).click();
  await expect(h1(page, 'Application form')).toBeFocused();
  const row = page.getByRole('row', { name: /Version 1/ });
  await expect(row).toContainText('Published');
  await expect(row.getByRole('link', { name: /View/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create draft' })).toBeVisible();
}
