// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The colour scheme in a real browser: the switch in the footer, the choice
// kept across a reload, the scheme in place before the app has run, and a
// funder's own brand colour in each scheme (ADR 0045). The API is stubbed.

// The callbacks passed to page.evaluate run in the browser, so they use DOM types.
/// <reference lib="dom" />

import { deriveDarkShades } from '@pixel-scientists/domain/platform';
import { presetTokens } from '@pixel-scientists/domain/platform/settings';
import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { stubSignedIn } from './auth-api.ts';
import { custom, stubSettings } from './settings-api.ts';

const KEY = 'colour-scheme';
const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const html = (page: Page) => page.locator('html');
const appearance = (page: Page) =>
  page.getByRole('contentinfo').getByRole('group', { name: 'Appearance' });
/** Clicks the label, as a person does: the radio itself is visually hidden. */
const choose = (page: Page, name: 'Device' | 'Light' | 'Dark') =>
  appearance(page).locator('label').filter({ hasText: name }).click();
const stored = (page: Page) => page.evaluate((key) => window.localStorage.getItem(key), KEY);

/** The value the page's own stylesheets give a custom property, which is where a funder's look lands. */
const property = (page: Page, name: string) =>
  page.evaluate(
    (property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(),
    name,
  );

test.describe('the switch in the footer', () => {
  test.use({ colorScheme: 'light' });

  test('applies Dark at once and keeps it after a reload', async ({ page }) => {
    await stubSignedIn(page);
    await page.goto('/northfield/');
    await expect(h1(page, 'Programmes')).toBeVisible();
    await expect(html(page)).toHaveAttribute('data-scheme', 'light');
    await expect(html(page)).toHaveCSS('color-scheme', 'light');
    await expect(appearance(page).getByRole('radio', { name: 'Device' })).toBeChecked();

    await choose(page, 'Dark');

    await expect(html(page)).toHaveAttribute('data-scheme', 'dark');
    await expect(html(page)).toHaveCSS('color-scheme', 'dark');
    await expect(appearance(page).getByRole('radio', { name: 'Dark' })).toBeChecked();
    await expect
      .poll(() => property(page, '--color-canvas'))
      .toBe(presetTokens.standard.darkCanvas);
    expect(await stored(page)).toBe('dark');

    await page.reload();

    await expect(h1(page, 'Programmes')).toBeVisible();
    await expect(html(page)).toHaveAttribute('data-scheme', 'dark');
    await expect(appearance(page).getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect(await stored(page)).toBe('dark');
  });

  test('keeps Light on a dark device, and Device follows the device again', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await stubSignedIn(page);
    await page.goto('/northfield/');
    await expect(h1(page, 'Programmes')).toBeVisible();
    await expect(html(page)).toHaveAttribute('data-scheme', 'dark');
    await expect(appearance(page).getByRole('radio', { name: 'Device' })).toBeChecked();

    await choose(page, 'Light');
    await expect(html(page)).toHaveAttribute('data-scheme', 'light');
    expect(await stored(page)).toBe('light');
    await page.reload();
    await expect(h1(page, 'Programmes')).toBeVisible();
    await expect(html(page)).toHaveAttribute('data-scheme', 'light');
    await expect(appearance(page).getByRole('radio', { name: 'Light' })).toBeChecked();

    await choose(page, 'Device');
    await expect(html(page)).toHaveAttribute('data-scheme', 'dark');
    expect(await stored(page)).toBeNull();
    await page.reload();
    await expect(html(page)).toHaveAttribute('data-scheme', 'dark');
    await expect(appearance(page).getByRole('radio', { name: 'Device' })).toBeChecked();
  });

  test('follows a change of the device while Device is chosen, and not once a scheme is', async ({
    page,
  }) => {
    await stubSignedIn(page);
    await page.goto('/northfield/');
    await expect(h1(page, 'Programmes')).toBeVisible();
    await expect(html(page)).toHaveAttribute('data-scheme', 'light');

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(html(page)).toHaveAttribute('data-scheme', 'dark');

    await choose(page, 'Light');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(html(page)).toHaveAttribute('data-scheme', 'light');
  });

  test('can be used with the keyboard: Tab reaches the group and the arrow keys choose', async ({
    page,
  }) => {
    await stubSignedIn(page);
    await page.goto('/northfield/');
    await expect(h1(page, 'Programmes')).toBeVisible();
    await appearance(page).getByRole('radio', { name: 'Device' }).focus();

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');

    await expect(appearance(page).getByRole('radio', { name: 'Dark' })).toBeFocused();
    await expect(html(page)).toHaveAttribute('data-scheme', 'dark');
    expect(await stored(page)).toBe('dark');
  });

  test('is on the start page too', async ({ page }) => {
    await page.goto('/');
    await expect(h1(page, "Use your funder's link")).toBeVisible();

    await choose(page, 'Dark');

    await expect(html(page)).toHaveAttribute('data-scheme', 'dark');
  });
});

test.describe('the switch in forced colours', () => {
  test.use({ colorScheme: 'light', forcedColors: 'active' });

  test('shows the chosen option in bold and underlined, which forced colours keep', async ({
    page,
  }) => {
    await stubSignedIn(page);
    await page.goto('/northfield/');
    await expect(h1(page, 'Programmes')).toBeVisible();

    await choose(page, 'Dark');

    const label = (name: string) => appearance(page).locator('label').filter({ hasText: name });
    await expect(label('Dark')).toHaveCSS('font-weight', '600');
    await expect(label('Dark')).toHaveCSS('text-decoration-line', 'underline');
    await expect(label('Light')).toHaveCSS('font-weight', '400');
    await expect(label('Light')).toHaveCSS('text-decoration-line', 'none');
  });
});

test.describe('before the app has run', () => {
  const cases = [
    { name: 'a kept Dark choice on a light device', kept: 'dark', device: 'light' },
    { name: 'a kept Light choice on a dark device', kept: 'light', device: 'dark' },
    { name: 'no choice on a dark device', kept: null, device: 'dark' },
    { name: 'no choice on a light device', kept: null, device: 'light' },
  ] as const;

  for (const { name, kept, device } of cases) {
    test(`sets the scheme from ${name}, with the app's own scripts blocked`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: device });
      await page.addInitScript(
        ([key, value]) => {
          if (value !== null) window.localStorage.setItem(key, value);
        },
        [KEY, kept] as const,
      );
      // Only the start-up script may run: nothing else on the page can have set the attribute.
      await page.route(
        (url) => url.pathname !== '/scheme.js',
        (route) => (route.request().resourceType() === 'script' ? route.abort() : route.continue()),
      );

      await page.goto('/');

      await expect(page.locator('#root')).toBeEmpty();
      await expect(html(page)).toHaveAttribute('data-scheme', kept ?? device);
    });
  }

  test('never shows the other scheme while the app starts after a reload', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await stubSignedIn(page);
    await page.goto('/northfield/');
    await expect(h1(page, 'Programmes')).toBeVisible();
    await choose(page, 'Dark');
    // Notes every value the attribute had, from before it was first set.
    await page.addInitScript(() => {
      const before: (string | null)[] = [];
      Object.assign(window, { schemeBefore: before });
      new MutationObserver((records) => {
        for (const record of records) before.push(record.oldValue);
      }).observe(document, {
        subtree: true,
        attributes: true,
        attributeFilter: ['data-scheme'],
        attributeOldValue: true,
      });
    });

    await page.reload();
    await expect(h1(page, 'Programmes')).toBeVisible();

    const before = await page.evaluate(
      () => (window as unknown as { schemeBefore: (string | null)[] }).schemeBefore,
    );
    expect(before.length).toBeGreaterThan(0);
    expect(before[0]).toBeNull();
    expect(before.filter((value) => value !== null && value !== 'dark')).toEqual([]);
    await expect(html(page)).toHaveAttribute('data-scheme', 'dark');
  });
});

test.describe('a funder with its own brand colour', () => {
  const light = custom.brandColour;
  const dark = deriveDarkShades(light);
  const rounded = presetTokens.rounded;

  test('gets its dark accent and surfaces in the dark scheme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await stubSettings(page, custom);
    await page.goto('/northfield/');
    await expect(h1(page, 'Programmes')).toBeVisible();

    expect(dark.brand).not.toBe(light);
    await expect.poll(() => property(page, '--color-accent')).toBe(dark.brand);
    expect(await property(page, '--color-accent-hover')).toBe(dark.hover);
    expect(await property(page, '--color-accent-soft')).toBe(dark.tint);
    expect(await property(page, '--color-canvas')).toBe(rounded.darkCanvas);
    expect(await property(page, '--color-sunken')).toBe(rounded.darkSunken);
    // The preset's corners are the same in both schemes.
    expect(await property(page, '--radius-md')).toBe(rounded.radiusMd);
  });

  test('gets its light accent in the light scheme, and each one live from the switch', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await stubSettings(page, custom);
    await page.goto('/northfield/');
    await expect(h1(page, 'Programmes')).toBeVisible();
    await expect.poll(() => property(page, '--color-accent')).toBe(light);
    expect(await property(page, '--color-canvas')).toBe(rounded.canvas);

    await choose(page, 'Dark');
    await expect.poll(() => property(page, '--color-accent')).toBe(dark.brand);
    expect(await property(page, '--color-canvas')).toBe(rounded.darkCanvas);

    await choose(page, 'Light');
    await expect.poll(() => property(page, '--color-accent')).toBe(light);
    expect(await property(page, '--color-canvas')).toBe(rounded.canvas);
  });

  test('keeps its dark accent after a reload on a light device', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await stubSettings(page, custom);
    await page.goto('/northfield/');
    await expect(h1(page, 'Programmes')).toBeVisible();
    await choose(page, 'Dark');

    await page.reload();

    await expect(h1(page, 'Programmes')).toBeVisible();
    await expect.poll(() => property(page, '--color-accent')).toBe(dark.brand);
  });

  test('shows the preview of its look in the scheme the page is in', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await stubSettings(page, custom);
    await page.goto('/northfield/settings/look');
    await expect(h1(page, 'Look and logo')).toBeVisible();
    const preview = page.locator('[inert]');

    await expect(preview).toHaveCSS('--color-accent', dark.brand);

    await choose(page, 'Light');
    await expect(preview).toHaveCSS('--color-accent', light);
    await expect(preview.getByText('Save programme')).toHaveCSS(
      'background-color',
      'rgb(11, 93, 59)',
    );

    await choose(page, 'Dark');
    await expect(preview).toHaveCSS('--color-accent', dark.brand);
  });

  test('shows the corners of the chosen preset in the preview in the dark scheme', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await stubSettings(page, custom);
    await page.goto('/northfield/settings/look');
    await expect(h1(page, 'Look and logo')).toBeVisible();
    const preview = page.locator('[inert]');
    const button = preview.getByText('Save programme');
    await expect(button).toHaveCSS('border-top-left-radius', '12px');

    await page.getByRole('radio', { name: 'Square' }).check();

    await expect(preview).toHaveCSS('--color-accent', dark.brand);
    await expect(button).toHaveCSS('border-top-left-radius', '0px');
  });
});
