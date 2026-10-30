// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Look page's own stylesheet in a real browser, with the API's answers
// stubbed (settings-stylesheet-api.ts). The same steps run against the real
// API in settings-journey.spec.ts. Every spec also fails on a Content
// Security Policy violation, so the preview, which sets custom properties
// from script, is checked under the production policy in console-production.

import { tokenStylesheet } from '@pixel-scientists/domain/platform/settings';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { problem } from './auth-api.ts';
import { standard } from './settings-api.ts';
import { greenTokens, stubStylesheet } from './settings-stylesheet-api.ts';
import {
  accent,
  chooseStylesheet,
  downloadStylesheet,
  stylesheetSteps,
  summary,
} from './settings-stylesheet-steps.ts';

const picker = (page: Page) => page.getByLabel('Upload stylesheet');
const sheet = () => tokenStylesheet(greenTokens, { tenantName: 'Northfield Foundation' });

test.describe('the look page’s own stylesheet', () => {
  test('downloads, edits, uploads, saves and goes back to a preset', async ({ page }) => {
    await stubStylesheet(page);
    await page.goto('/northfield/settings/look');

    await stylesheetSteps(page, standard.brandColour);
  });

  test('takes the saved stylesheet as the look, and downloads it rather than the preset', async ({
    page,
  }) => {
    await stubStylesheet(page, standard, greenTokens);
    await page.goto('/northfield/settings/look');

    await expect(page.getByText(/Your look comes from a stylesheet you saved/)).toBeVisible();
    await expect.poll(() => accent(page)).toBe('#0b5d3b');
    expect(await downloadStylesheet(page)).toContain('--color-accent: #0b5d3b;');
  });

  test('lists every problem with its line, and sends nothing', async ({ page }) => {
    const stub = await stubStylesheet(page);
    await page.goto('/northfield/settings/look');
    const broken = sheet()
      .replace('--color-ink: #17181b;', '--color-ink: #17181b !important;')
      .replace('--color-edge: #7c7f86;', '--color-edge: grey;');

    await chooseStylesheet(page, broken);

    await expect(summary(page)).toBeFocused();
    await expect(summary(page).getByRole('link')).toHaveText([
      /^Line \d+: Remove !important/,
      /^Line \d+: Enter the colour as a hex code/,
    ]);
    await expect(picker(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('[inert]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Save stylesheet' }).click();
    expect(stub.sent.map(({ key }) => key)).not.toContain('PUT /console/settings/theme/tokens');
  });

  test('moves from a problem in the summary to the file field with the keyboard', async ({
    page,
  }) => {
    await stubStylesheet(page);
    await page.goto('/northfield/settings/look');
    await chooseStylesheet(page, '/* nothing here */');
    await expect(summary(page)).toBeFocused();

    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');

    await expect(picker(page)).toBeFocused();
  });

  test('refuses a file over 32 KB and one that is not a .css file', async ({ page }) => {
    await stubStylesheet(page);
    await page.goto('/northfield/settings/look');

    await chooseStylesheet(page, 'a'.repeat(33 * 1024));
    await expect(summary(page).getByRole('link')).toHaveText('Upload a file of 32 KB or less.');

    await chooseStylesheet(page, sheet(), 'theme.txt');
    await expect(summary(page).getByRole('link')).toHaveText('Choose a file that ends in .css.');
  });

  test('shows the API’s problems the same way, and keeps the file', async ({ page }) => {
    await stubStylesheet(page, standard, null, {
      'PUT /console/settings/theme/tokens': problem(400, 'Some fields are not valid.', [
        { field: 'body.tokens.light.colorInk', message: 'Make ink darker.' },
      ]),
    });
    await page.goto('/northfield/settings/look');
    await chooseStylesheet(page, sheet());

    await page.getByRole('button', { name: 'Save stylesheet' }).click();

    await expect(summary(page)).toBeFocused();
    await expect(summary(page).getByRole('link')).toHaveText('Make ink darker.');
    await expect(page.getByText(/^Ready to save/)).toBeVisible();
    await expect(page.getByText('Stylesheet saved.')).toHaveCount(0);
  });

  test('asks before a preset or brand colour replaces the stylesheet, and keeps it if told to', async ({
    page,
  }) => {
    const stub = await stubStylesheet(page, standard, greenTokens);
    await page.goto('/northfield/settings/look');
    await page.getByRole('radio', { name: 'Square' }).check();

    await page.getByRole('button', { name: 'Save look' }).click();
    const dialog = page.getByRole('dialog', { name: 'Replace your stylesheet?' });
    await expect(dialog.getByRole('button', { name: 'Keep stylesheet' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Keep stylesheet' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save look' })).toBeFocused();
    expect(stub.tokens).not.toBeNull();

    await page.getByRole('button', { name: 'Save look' }).click();
    await dialog.getByRole('button', { name: 'Replace stylesheet' }).click();

    await expect(page.getByText('Look saved.')).toBeVisible();
    await expect(page.getByText(/Your look comes from a stylesheet you saved/)).toHaveCount(0);
    expect(stub.tokens).toBeNull();
    await expect.poll(() => accent(page)).toBe(standard.brandColour);
  });

  test('asks before leaving with a stylesheet that is chosen but not saved', async ({ page }) => {
    await stubStylesheet(page);
    await page.goto('/northfield/settings/look');
    await chooseStylesheet(page, sheet());
    await expect(page.getByText(/^Ready to save/)).toBeVisible();

    await page
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('link', { name: 'Modules' })
      .click();

    await expect(page.getByRole('dialog', { name: 'Leave this page?' })).toBeVisible();
  });
});
