// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 3: the administrator is refused a brand colour that fails
// contrast, with a passing one suggested, then saves a passing colour, a preset
// and a logo, and both the console and the portal show them. Then they download
// the look as a stylesheet, change a colour, upload it, and are refused a
// failing pair with its line before the passing one stays (D27).

// The callbacks passed to page.evaluate run in the browser, so they use DOM types.
/// <reference lib="dom" />

import type { Page } from '@playwright/test';

import { solidPng } from '../../apps/console/e2e/png.ts';
import {
  accent,
  NEW_ACCENT,
  stylesheetSteps,
} from '../../apps/console/e2e/settings-stylesheet-steps.ts';
import { axePages } from '../support/axe.ts';
import { updateState } from '../support/state.ts';
import { expect, h1, inOrder, test } from '../support/test.ts';

inOrder();

const colour = (page: Page) => page.getByRole('textbox', { name: 'Brand colour' });

test.describe('step 3: the administrator sets the funder look', () => {
  test('refuses a colour that fails contrast, saves a passing one with a preset and a logo, and takes a stylesheet', async ({
    pages,
  }) => {
    const page = await pages.staff('admin');
    await page.goto('/northfield/settings/look');
    await expect(h1(page, 'Look and logo')).toBeVisible();

    await colour(page).fill('#ffee00');
    await expect(page.getByText(/This colour is too light to read/).first()).toBeVisible();
    await expect(
      page.getByText(/^Contrast found: \d\.\d to 1\. The minimum is 4\.5 to 1\.$/),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Save look' }).click();
    await expect(page.getByRole('alert', { name: 'There is a problem' })).toBeVisible();
    await expect(page.getByText('Look saved.')).toHaveCount(0);

    await page.getByRole('button', { name: /^Use #[0-9a-f]{6}$/ }).click();
    const chosen = await colour(page).inputValue();
    expect(chosen).toMatch(/^#[0-9a-f]{6}$/);
    await page.getByRole('radio', { name: 'Rounded' }).check();
    await page.getByRole('button', { name: 'Save look' }).click();
    await expect(page.getByText('Look saved.')).toBeVisible();
    await expect.poll(() => accent(page)).toBe(chosen);
    await expect(page.locator('html')).toHaveAttribute('data-preset', 'rounded');

    await page.getByLabel('Logo file').setInputFiles({
      name: 'northfield.png',
      mimeType: 'image/png',
      buffer: solidPng(240, 80, [11, 93, 59]),
    });
    await page.getByRole('button', { name: 'Upload logo' }).click();
    await expect(page.getByText('Logo saved.')).toBeVisible();
    await expect(page.getByRole('banner').getByRole('img')).toBeVisible();

    // The portal takes the same look from the API's stylesheet and logo.
    const portal = await pages.visitor();
    await portal.goto('/northfield/sign-in');
    await expect(h1(portal, 'Sign in')).toBeVisible();
    await expect.poll(() => accent(portal)).toBe(chosen);
    await expect(portal.locator('html')).toHaveAttribute('data-preset', 'rounded');
    const logo = portal.getByRole('banner').getByRole('img');
    await expect(logo).toBeVisible();
    await expect
      .poll(() =>
        logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true);
    // The second funder keeps the look it was seeded with.
    await portal.goto('/eastmoor/sign-in');
    await expect(h1(portal, 'Sign in')).toBeVisible();
    await expect.poll(() => accent(portal)).not.toBe(chosen);

    await page.goto('/northfield/settings/look');
    await expect(h1(page, 'Look and logo')).toBeVisible();
    await stylesheetSteps(page, chosen, async () => {
      const stylesheet = await page.request.get('/api/public/tenants/northfield/theme.css');
      expect(await stylesheet.text()).toContain(`--color-accent: ${NEW_ACCENT};`);
    });
    updateState((state) => {
      state.ids['brandColour'] = chosen;
    });
  });

  test('@a11y the Look page has no axe violations', async ({ pages }) => {
    await axePages(await pages.staff('admin'), ['/northfield/settings/look']);
  });
});
