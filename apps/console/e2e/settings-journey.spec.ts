// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo steps 3 and 4 against the real API: the administrator is refused a
// colour that fails contrast and offered one that passes, saves it with a
// preset and a logo and sees the console take them, and checks that Grants is
// on. It needs the stack (`pnpm stack`, then `pnpm test:stack`) and the
// Northfield administrator from the seed's `base` scenario:
//
//   TPS_E2E_ADMIN_EMAIL     the administrator's email address
//   TPS_E2E_ADMIN_PASSWORD  the seed password
//   TPS_E2E_ADMIN_TOTP_KEY  the authenticator key, once it has been set
//                                  up. The first run sets it up and prints the
//                                  key, which the next runs need.

// The callbacks passed to page.evaluate run in the browser, so they use DOM types.
/// <reference lib="dom" />

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { nextCode } from './auth-totp.ts';
import { solidPng } from './png.ts';

const EMAIL = process.env['TPS_E2E_ADMIN_EMAIL'];
const PASSWORD = process.env['TPS_E2E_ADMIN_PASSWORD'];
const TOTP_KEY = process.env['TPS_E2E_ADMIN_TOTP_KEY'];

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const colour = (page: Page) => page.getByRole('textbox', { name: 'Brand colour' });
const accent = (page: Page) =>
  page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim(),
  );

/** Signs in as the administrator, setting up the authenticator app on the first run and using its key after. */
async function signInAsAdministrator(page: Page): Promise<void> {
  await page.goto('/northfield/sign-in');
  await page.getByRole('textbox', { name: 'Email address' }).fill(EMAIL ?? '');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();

  if (
    await h1(page, 'Set up your authenticator app')
      .isVisible({ timeout: 10_000 })
      .catch(() => false)
  ) {
    const key = (
      (await page.getByText(/^[A-Z2-7]{4}( [A-Z2-7]{4})+$/).textContent()) ?? ''
    ).replace(/\s/g, '');
    console.info(`Set TPS_E2E_ADMIN_TOTP_KEY=${key} for the next runs.`);
    await page.getByLabel('Code from your app').fill(await nextCode(key, null));
    await page.getByRole('button', { name: 'Finish set-up' }).click();
  } else {
    await expect(h1(page, 'Enter your code')).toBeVisible();
    await page.getByLabel('Code from your app').fill(await nextCode(TOTP_KEY ?? '', null));
    await page.getByRole('button', { name: 'Confirm code' }).click();
  }
  await expect(
    page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' }),
  ).toBeVisible();
}

test.describe('the journey against the real API', () => {
  test.skip(
    process.env['TPS_E2E_STACK'] !== '1',
    'Runs against the stack: pnpm stack, then pnpm test:stack.',
  );
  test.skip(
    EMAIL === undefined || PASSWORD === undefined,
    "Needs the seed's Northfield administrator: set TPS_E2E_ADMIN_EMAIL and TPS_E2E_ADMIN_PASSWORD.",
  );
  test.setTimeout(240_000);

  test('@api refuses a colour that fails, saves one that passes with a preset and logo, and checks Grants is on', async ({
    page,
    request,
  }) => {
    await signInAsAdministrator(page);
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Settings' })
      .click();
    await page
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('link', { name: 'Look' })
      .click();
    await expect(h1(page, 'Look and logo')).toBeVisible();

    // A colour that fails contrast is refused, with a passing one suggested.
    await colour(page).fill('#ffee00');
    await expect(page.getByText(/This colour is too light to read/).first()).toBeVisible();
    await expect(
      page.getByText(/^Contrast found: \d\.\d to 1\. The minimum is 4\.5 to 1\.$/),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Save look' }).click();
    await expect(page.getByRole('alert', { name: 'There is a problem' })).toBeVisible();
    await expect(page.getByText('Look saved.')).toHaveCount(0);

    // The suggestion passes, and is saved with a preset.
    await page.getByRole('button', { name: /^Use #[0-9a-f]{6}$/ }).click();
    const chosen = await colour(page).inputValue();
    expect(chosen).toMatch(/^#[0-9a-f]{6}$/);
    await page.getByRole('radio', { name: 'Rounded' }).check();
    await page.getByRole('button', { name: 'Save look' }).click();
    await expect(page.getByText('Look saved.')).toBeVisible();

    // The console shows the look now, and after a reload, from the API's own stylesheet.
    await expect.poll(() => accent(page)).toBe(chosen);
    await expect(page.locator('html')).toHaveAttribute('data-preset', 'rounded');
    const stylesheet = await request.get('/api/public/tenants/northfield/theme.css');
    expect(stylesheet.headers()['content-type']).toContain('text/css');
    expect(await stylesheet.text()).toContain(`--color-accent: ${chosen};`);
    await page.reload();
    await expect(h1(page, 'Look and logo')).toBeVisible();
    await expect.poll(() => accent(page)).toBe(chosen);

    // A logo is saved, served by the API, and shown in the header with the funder name as its alternative text.
    await page.getByLabel('Logo file').setInputFiles({
      name: 'northfield.png',
      mimeType: 'image/png',
      buffer: solidPng(240, 80, [11, 93, 59]),
    });
    await page.getByRole('button', { name: 'Upload logo' }).click();
    await expect(page.getByText('Logo saved.')).toBeVisible();
    const logo = page.getByRole('banner').getByRole('img');
    await expect(logo).toBeVisible();
    await expect(logo).toHaveAttribute('alt', /\S/);
    await expect
      .poll(() =>
        logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true);
    const served = await request.get('/api/public/tenants/northfield/logo');
    expect(served.headers()['content-type']).toBe('image/png');

    // Grants is on for the funder.
    await page
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('link', { name: 'Modules' })
      .click();
    if (await page.getByRole('button', { name: 'Switch on Grants' }).isVisible()) {
      await page.getByRole('button', { name: 'Switch on Grants' }).click();
    }
    await expect(page.getByRole('heading', { level: 3, name: 'Grants is on' })).toBeVisible();
  });
});
