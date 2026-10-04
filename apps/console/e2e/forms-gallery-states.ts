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
];
