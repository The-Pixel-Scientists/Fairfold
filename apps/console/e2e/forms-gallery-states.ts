// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The form examples in the component gallery, and each state the specs put
// them in. Shared by forms-gallery.spec.ts and
// forms-gallery-accessibility.spec.ts.

import type { Locator, Page } from '@playwright/test';

import { expect } from '../../../scripts/e2e/fixtures.ts';

/** One example in the gallery: everything under its h2. */
export function example(page: Page, title: string): Locator {
  return page.getByRole('heading', { level: 2, name: title }).locator('..');
}

export const summaryIn = (scope: Locator) =>
  scope.getByRole('alert', { name: 'There is a problem' });

export async function openGallery(page: Page): Promise<void> {
  await page.goto('/dev/components');
  await expect(page.getByRole('heading', { level: 1, name: 'Component gallery' })).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Questions of every type' }),
  ).toBeVisible();
}

/** A file the browser accepts by its first bytes, which are all it looks at. */
export const pdfFile = (name = 'Accounts 2025 to 2026.pdf') => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.7 a document that starts as every PDF does'),
});

/** A program that calls itself a PDF, which its bytes show it is not. */
export const programFile = (name = 'Accounts 2025 to 2026.pdf') => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.from('MZ this is a program, not a document'),
});

export interface GalleryState {
  name: string;
  /** Opens the gallery and puts the example in this state. */
  open: (page: Page) => Promise<void>;
}

/** Twenty-five words, five over the first example's limit of twenty. */
export const TOO_LONG = Array.from({ length: 25 }, (_, index) => `word${String(index + 1)}`).join(
  ' ',
);

export const galleryStates: GalleryState[] = [
  { name: 'every example before anyone answers', open: openGallery },
  {
    name: 'questions of every type with the required answers missing',
    open: async (page) => {
      await openGallery(page);
      const scope = example(page, 'Questions of every type');
      await scope.getByRole('button', { name: 'Check answers' }).click();
      await expect(summaryIn(scope)).toBeFocused();
    },
  },
  {
    name: 'an answer that is over its word limit',
    open: async (page) => {
      await openGallery(page);
      const scope = example(page, 'Questions of every type');
      await scope.getByRole('textbox', { name: /What will you do with the money/ }).fill(TOO_LONG);
      await expect(scope.getByText('You have 5 words too many').first()).toBeVisible();
    },
  },
  {
    name: 'questions with problems, beside each field and in the summary',
    open: async (page) => {
      await openGallery(page);
      const scope = example(page, 'Questions with problems');
      await scope.getByRole('button', { name: 'Check answers' }).click();
      await expect(summaryIn(scope)).toBeFocused();
      await expect(summaryIn(scope).getByRole('link')).toHaveCount(11);
    },
  },
  {
    name: 'questions and a section that have been revealed',
    open: async (page) => {
      await openGallery(page);
      const scope = example(page, 'Questions that come and go');
      await scope.getByRole('radio', { name: 'Yes' }).check();
      await scope.getByRole('checkbox', { name: 'Building work' }).check();
      await expect(scope.getByRole('heading', { name: 'Planning permission' })).toBeVisible();
    },
  },
  {
    name: 'revealed questions with their problems',
    open: async (page) => {
      await openGallery(page);
      const scope = example(page, 'Questions that come and go');
      await scope.getByRole('radio', { name: 'Yes' }).check();
      await scope.getByRole('checkbox', { name: 'Building work' }).check();
      await scope.getByRole('button', { name: 'Check answers' }).click();
      await expect(summaryIn(scope).first()).toBeVisible();
    },
  },
  {
    name: 'an answer that stops an applicant',
    open: async (page) => {
      await openGallery(page);
      const scope = example(page, 'Answers that stop an applicant');
      await scope.getByRole('radio', { name: 'No' }).check();
      await expect(
        scope.getByRole('alert', { name: 'You cannot apply with this answer' }),
      ).toBeVisible();
    },
  },
  {
    name: 'a table question with rows added',
    open: async (page) => {
      await openGallery(page);
      const scope = example(page, 'Table question with no rows');
      await scope.getByRole('button', { name: 'Add the first cost' }).click();
      await scope.getByRole('button', { name: 'Add another cost' }).click();
      await scope.getByRole('textbox', { name: 'Cost' }).first().fill('1250');
      await expect(scope.getByRole('group', { name: 'Cost 2' })).toBeVisible();
    },
  },
  {
    name: 'a table question with no rows, checked',
    open: async (page) => {
      await openGallery(page);
      const scope = example(page, 'Table question with no rows');
      await scope.getByRole('button', { name: 'Check answers' }).click();
      await expect(summaryIn(scope)).toBeFocused();
      await expect(summaryIn(scope).getByRole('link')).toHaveCount(1);
    },
  },
  {
    name: 'a table question with problems, beside each cell and in the summary',
    open: async (page) => {
      await openGallery(page);
      const scope = example(page, 'Table question with problems');
      await scope.getByRole('button', { name: 'Check answers' }).click();
      await expect(summaryIn(scope)).toBeFocused();
      await expect(summaryIn(scope).getByRole('link')).toHaveCount(5);
    },
  },
  {
    name: 'a file question with a file on its way up',
    open: async (page) => {
      await openGallery(page);
      const scope = example(page, 'File question uploading a file');
      await scope.getByLabel('Choose files').setInputFiles(pdfFile());
      await expect(
        scope.getByRole('progressbar', { name: 'Uploading Accounts 2025 to 2026.pdf, 45%' }),
      ).toBeVisible();
    },
  },
  {
    name: 'a file question with a file being checked for viruses',
    open: async (page) => {
      await openGallery(page);
      const scope = example(page, 'File question checking a file');
      await scope.getByLabel('Choose files').setInputFiles(pdfFile());
      await expect(
        scope.getByRole('listitem').getByText('Checking Accounts 2025 to 2026.pdf for viruses'),
      ).toBeVisible();
    },
  },
  {
    name: 'a file question with a refused file, beside the question and in the summary',
    open: async (page) => {
      await openGallery(page);
      const scope = example(page, 'File question with a refused file');
      await scope.getByLabel('Choose files').setInputFiles(pdfFile());
      await expect(summaryIn(scope)).toBeFocused();
      await expect(summaryIn(scope).getByRole('link')).toHaveCount(1);
    },
  },
  {
    name: 'a file question with a file the browser would not send',
    open: async (page) => {
      await openGallery(page);
      const scope = example(page, 'File question with no files');
      await scope.getByLabel('Choose files').setInputFiles(programFile());
      await expect(summaryIn(scope)).toBeFocused();
    },
  },
];
