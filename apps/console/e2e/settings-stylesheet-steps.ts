// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Look page's own stylesheet as a person uses it: download it, change the
// accent, upload it, see the console take it, be refused a failing pair with
// its line, and go back to a preset. The stubbed spec
// (settings-stylesheet.spec.ts) and the journey against the real API
// (settings-journey.spec.ts) both take these steps, so the screens are
// checked the same way against each.

// The callbacks passed to page.evaluate run in the browser, so they use DOM types.
/// <reference lib="dom" />

import { readFile } from 'node:fs/promises';

import { expect } from '../../../scripts/e2e/fixtures.ts';
import type { Download, Page } from '@playwright/test';

export const NEW_ACCENT = '#0b5d3b';

export const accent = (page: Page) =>
  page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim(),
  );

/** The first declaration of a token, which is the light scheme's, set to a value. */
export const withLight = (stylesheet: string, property: string, value: string) =>
  stylesheet.replace(new RegExp(`(${property}:\\s*)#[0-9a-f]{6}`), `$1${value}`);

export const summary = (page: Page) => page.getByRole('alert', { name: 'There is a problem' });

export async function textOf(download: Download): Promise<string> {
  return readFile(await download.path(), 'utf8');
}

/** Chooses a stylesheet as a file, as a person does with the file field. */
export function chooseStylesheet(page: Page, text: string, name = 'northfield-theme.css') {
  return page
    .getByLabel('Upload stylesheet')
    .setInputFiles({ name, mimeType: 'text/css', buffer: Buffer.from(text) });
}

/** Downloads the stylesheet of the current look, from the Look page. */
export async function downloadStylesheet(page: Page): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download stylesheet' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('northfield-theme.css');
  return textOf(download);
}

/**
 * From the Look page with a preset in use whose accent is `presetAccent`:
 * download, edit, preview, save, then a failing pair, then back to the preset.
 */
export async function stylesheetSteps(
  page: Page,
  presetAccent: string,
  /** Extra checks once the stylesheet is saved, such as what the API now serves. */
  whenSaved: () => Promise<void> = () => Promise.resolve(),
): Promise<void> {
  // The download holds the look as it is, with a comment on every token.
  const downloaded = await downloadStylesheet(page);
  expect(downloaded).toContain(`--color-accent: ${presetAccent};`);
  expect(downloaded).toMatch(/\/\* Links, main buttons and the current page\./);

  // The edited file is read and previewed in both schemes, and nothing is saved yet.
  const edited = withLight(downloaded, '--color-accent', NEW_ACCENT);
  await chooseStylesheet(page, edited);
  await expect(page.getByText(/^Ready to save: northfield-theme\.css/)).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Preview of the uploaded stylesheet' }),
  ).toBeVisible();
  await expect(page.locator('[inert]')).toHaveCount(3);
  expect(await accent(page)).toBe(presetAccent);

  // Saved, and the console takes the look, and keeps it after a reload.
  await page.getByRole('button', { name: 'Save stylesheet' }).click();
  await expect(page.getByText('Stylesheet saved.')).toBeVisible();
  await expect.poll(() => accent(page)).toBe(NEW_ACCENT);
  await expect(page.getByText(/Your look comes from a stylesheet you saved/)).toBeVisible();
  await whenSaved();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Go back to a preset' })).toBeVisible();
  await expect.poll(() => accent(page)).toBe(NEW_ACCENT);

  // A failing pair is refused with the line it is on, and nothing changes.
  const failing = withLight(edited, '--color-muted', '#eeeeee');
  const line = failing.split('\n').findIndex((row) => row.includes('--color-muted:')) + 1;
  await chooseStylesheet(page, failing);
  await expect(summary(page)).toBeFocused();
  await expect(summary(page).getByRole('link').first()).toHaveText(
    new RegExp(`^Line ${String(line)}: In the light scheme, muted on `),
  );
  await expect(page.getByText(/^Ready to save/)).toHaveCount(0);
  await expect.poll(() => accent(page)).toBe(NEW_ACCENT);

  // Back to the preset, after the dialog asks.
  await page.getByRole('button', { name: 'Go back to a preset' }).click();
  const dialog = page.getByRole('dialog', { name: 'Go back to a preset?' });
  await expect(dialog.getByRole('button', { name: 'Keep stylesheet' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Go back to preset' }).click();
  await expect(page.getByText('Your look is back to your preset.')).toBeVisible();
  await expect(page.getByLabel('Upload stylesheet')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Go back to a preset' })).toHaveCount(0);
  await expect.poll(() => accent(page)).toBe(presetAccent);
}
