// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Uploading, showing and removing the funder's logo, and every state of the
// logo section checked with axe, with the API's answers stubbed
// (settings-api.ts). Kept apart from the other settings specs so the logo can
// be left out in one piece.

// The callbacks passed to page.evaluate run in the browser, so they use DOM types.
/// <reference lib="dom" />

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { problem } from './auth-api.ts';
import { standard, stubSettings } from './settings-api.ts';
import { checkSettingsStates } from './settings-axe.ts';
import type { SettingsState } from './settings-axe.ts';
import { solidPng } from './png.ts';

const logoFile = (page: Page) => page.getByLabel('Logo file');
const picture = (width = 240, height = 80) => ({
  name: 'northfield.png',
  mimeType: 'image/png',
  buffer: solidPng(width, height, [11, 93, 59]),
});

/** Whether the first image with this name has been drawn, which a broken or missing one has not. */
const drawn = (page: Page, name: string) =>
  page
    .getByRole('banner')
    .getByRole('img', { name })
    .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0);

test.describe('the logo', () => {
  test('uploads a file that passes, and the header shows it with the funder name as its alternative text', async ({
    page,
  }) => {
    const { sent } = await stubSettings(page);
    await page.goto('/northfield/settings/look');
    await expect(
      page.getByText('You have no logo yet, so your name shows in the header.'),
    ).toBeVisible();
    await expect(page.getByRole('banner').getByRole('img')).toHaveCount(0);

    await logoFile(page).setInputFiles(picture());
    await expect(
      page.getByText('Ready to upload: northfield.png, 240 by 80 pixels.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Upload logo' }).click();

    await expect(page.getByText('Logo saved.')).toBeVisible();
    const upload = sent.find(({ key }) => key === 'PUT /console/settings/theme/logo');
    expect(
      Buffer.from((upload?.body as { data: string }).data, 'base64')
        .subarray(1, 4)
        .toString(),
    ).toBe('PNG');
    await expect(
      page.getByRole('banner').getByRole('img', { name: 'Northfield Foundation' }),
    ).toBeVisible();
    await expect.poll(() => drawn(page, 'Northfield Foundation')).toBe(true);
    await expect(page.getByRole('button', { name: 'Remove logo' })).toBeVisible();
  });

  test('refuses a file before sending it, in the words the server uses', async ({ page }) => {
    const { sent } = await stubSettings(page);
    await page.goto('/northfield/settings/look');

    await logoFile(page).setInputFiles({
      name: 'logo.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg></svg>'),
    });
    await expect(page.getByText('Upload a PNG or WebP image.').first()).toBeVisible();

    await logoFile(page).setInputFiles(picture(1300, 100));
    await expect(
      page.getByText('Upload an image no larger than 1200 by 400 pixels.').first(),
    ).toBeVisible();

    await logoFile(page).setInputFiles({
      name: 'big.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(200 * 1024 + 1),
    });
    await expect(page.getByText('Upload an image of 200 KB or less.').first()).toBeVisible();

    await page.getByRole('button', { name: 'Upload logo' }).click();
    expect(sent.map(({ key }) => key)).not.toContain('PUT /console/settings/theme/logo');
  });

  test('moves focus to the file field when Upload logo is pressed with no file', async ({
    page,
  }) => {
    await stubSettings(page);
    await page.goto('/northfield/settings/look');

    await page.getByRole('button', { name: 'Upload logo' }).click();

    await expect(page.getByText('Upload a PNG or WebP image.').first()).toBeVisible();
    await expect(logoFile(page)).toBeFocused();
  });

  test('removes the logo, and puts focus where a new one is chosen', async ({ page }) => {
    await stubSettings(page, { ...standard, hasLogo: true });
    await page.goto('/northfield/settings/look');
    await expect(
      page.getByRole('banner').getByRole('img', { name: 'Northfield Foundation' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Remove logo' }).click();

    await expect(page.getByText('Logo removed.')).toBeVisible();
    await expect(logoFile(page)).toBeFocused();
    await expect(page.getByRole('banner').getByRole('img')).toHaveCount(0);
    await expect(page.getByRole('banner')).toContainText('Northfield Foundation');
  });

  test('asks before leaving with a logo chosen but not uploaded', async ({ page }) => {
    await stubSettings(page);
    await page.goto('/northfield/settings/look');
    await logoFile(page).setInputFiles(picture());
    await expect(page.getByText(/Ready to upload/)).toBeVisible();

    await page
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('link', { name: 'Modules' })
      .click();

    const dialog = page.getByRole('dialog', { name: 'Leave this page?' });
    await expect(dialog).toContainText('You chose a logo but have not uploaded it.');
    await dialog.getByRole('button', { name: 'Stay on this page' }).click();
    await expect(page).toHaveURL(/\/settings\/look$/);
  });
});

const states: SettingsState[] = [
  {
    name: 'a logo chosen and ready to upload',
    open: async (page) => {
      await page.goto('/northfield/settings/look');
      await logoFile(page).setInputFiles(picture());
      await expect(page.getByText(/Ready to upload/)).toBeVisible();
    },
  },
  {
    name: 'a logo file that is refused',
    open: async (page) => {
      await page.goto('/northfield/settings/look');
      await logoFile(page).setInputFiles(picture(1300, 100));
      await expect(
        page.getByText('Upload an image no larger than 1200 by 400 pixels.').first(),
      ).toBeVisible();
    },
  },
  {
    name: 'a logo the API refuses',
    stub: (page, funder) =>
      stubSettings(page, funder, {
        'PUT /console/settings/theme/logo': problem(
          400,
          'Some fields are not valid. Fix the fields listed and try again.',
          [
            {
              field: 'body.data',
              message:
                'We could not read this image. Save it again as a PNG or WebP file and upload it.',
            },
          ],
        ),
      }),
    open: async (page) => {
      await page.goto('/northfield/settings/look');
      await logoFile(page).setInputFiles(picture());
      await page.getByRole('button', { name: 'Upload logo' }).click();
      await expect(page.getByText(/We could not read this image/).first()).toBeVisible();
    },
  },
  {
    name: 'a logo after uploading',
    open: async (page) => {
      await page.goto('/northfield/settings/look');
      await logoFile(page).setInputFiles(picture());
      await page.getByRole('button', { name: 'Upload logo' }).click();
      await expect(page.getByText('Logo saved.')).toBeVisible();
      await expect.poll(() => drawn(page, 'Northfield Foundation')).toBe(true);
    },
  },
  {
    name: 'a logo after removing it',
    stub: (page, funder) => stubSettings(page, { ...funder, hasLogo: true }),
    open: async (page) => {
      await page.goto('/northfield/settings/look');
      await page.getByRole('button', { name: 'Remove logo' }).click();
      await expect(page.getByText('Logo removed.')).toBeVisible();
    },
  },
];

checkSettingsStates(states);
