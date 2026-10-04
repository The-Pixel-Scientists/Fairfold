// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The settings screens in a real browser, with the API's answers stubbed
// (settings-api.ts): a funder that keeps what is saved. The same journey
// runs against the real API in settings-journey.spec.ts. Every spec also
// fails on a Content Security Policy violation, so the stylesheet the
// console loads for the funder's look and the preview are checked under the
// production policy in console-production.

// The callbacks passed to page.evaluate run in the browser, so they use DOM types.
/// <reference lib="dom" />

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { problem } from './auth-api.ts';
import { standard, stubSettings } from './settings-api.ts';

const SUFFIX = '– Fairfold Grants console';
const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const colour = (page: Page) => page.getByRole('textbox', { name: 'Brand colour' });

/** The value the page's own stylesheets give a custom property, which is where a funder's look lands. */
const accent = (page: Page) =>
  page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim(),
  );

/**
 * Playwright dismisses the browser's own confirm and alert dialogs without a word, so
 * note each one, for the spec to check that none was opened.
 */
function watchNativeDialogs(page: Page): string[] {
  const opened: string[] = [];
  page.on('dialog', (dialog) => {
    opened.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss();
  });
  return opened;
}

test.describe('opening the settings', () => {
  test('goes from the navigation to the general settings, with focus on the heading', async ({
    page,
  }) => {
    await stubSettings(page);
    await page.goto('/northfield/');
    await expect(h1(page, 'Programmes')).toBeVisible();

    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Settings' })
      .click();

    await expect(h1(page, 'General settings')).toBeFocused();
    await expect(page).toHaveTitle(`General settings ${SUFFIX}`);
    await expect(page).toHaveURL(/\/northfield\/settings$/);
    await expect(page.getByRole('textbox', { name: 'Funder name' })).toHaveValue(
      'Northfield Foundation',
    );
    await expect(page.getByRole('combobox', { name: 'Time zone' })).toHaveValue('Europe/London');
    await expect(page.getByRole('combobox', { name: 'Financial year starts in' })).toHaveValue('4');
  });

  test('moves between the three pages from the keyboard', async ({ page }) => {
    await stubSettings(page);
    await page.goto('/northfield/settings');
    await expect(h1(page, 'General settings')).toBeVisible();

    await page
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('link', { name: 'Look' })
      .focus();
    await page.keyboard.press('Enter');
    await expect(h1(page, 'Look and logo')).toBeFocused();
    await expect(page).toHaveTitle(`Look and logo ${SUFFIX}`);

    await page
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('link', { name: 'Modules' })
      .focus();
    await page.keyboard.press('Enter');
    await expect(h1(page, 'Modules')).toBeFocused();
    await expect(page).toHaveTitle(`Modules ${SUFFIX}`);
  });

  test('tells someone without the permission what to do', async ({ page }) => {
    await stubSettings(page, standard, {}, ['grants.programmes.manage']);
    await page.goto('/northfield/settings');

    await expect(h1(page, 'Settings')).toBeVisible();
    await expect(page.getByText("You cannot change this funder's settings")).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);
  });

  test('says what went wrong, and loads again when the person tries again', async ({ page }) => {
    let busy = true;
    await stubSettings(page, standard, {
      'GET /console/settings': () =>
        busy
          ? problem(503, 'The service is busy. Try again in a minute.')
          : {
              status: 200,
              body: {
                name: 'Northfield Foundation',
                timeZone: 'Europe/London',
                fiscalYearStartMonth: 4,
              },
            },
    });
    await page.goto('/northfield/settings');
    await expect(page.getByText('The service is busy. Try again in a minute.')).toBeVisible();

    busy = false;
    await page.getByRole('button', { name: 'Try again' }).click();

    await expect(page.getByRole('textbox', { name: 'Funder name' })).toBeVisible();
  });
});

test.describe('general settings', () => {
  test('saves a new name, time zone and financial year, and the header shows the name', async ({
    page,
  }) => {
    const { sent } = await stubSettings(page);
    await page.goto('/northfield/settings');
    await page.getByRole('textbox', { name: 'Funder name' }).fill('Northfield Community Trust');
    await page.getByRole('combobox', { name: 'Time zone' }).selectOption('Europe/Paris');
    await page.getByRole('combobox', { name: 'Financial year starts in' }).selectOption('January');

    await page.getByRole('button', { name: 'Save settings' }).click();

    await expect(page.getByText('Settings saved.')).toBeVisible();
    await expect(page.getByRole('banner')).toContainText('Northfield Community Trust');
    expect(sent.find(({ key }) => key === 'PUT /console/settings')?.body).toEqual({
      name: 'Northfield Community Trust',
      timeZone: 'Europe/Paris',
      fiscalYearStartMonth: 1,
    });
  });

  test("shows the API's words beside the field and in the summary", async ({ page }) => {
    await stubSettings(page, standard, {
      'PUT /console/settings': problem(
        400,
        'Some fields are not valid. Fix the fields listed and try again.',
        [
          {
            field: 'body.name',
            message: 'Enter a name that includes at least one letter or number.',
          },
        ],
      ),
    });
    await page.goto('/northfield/settings');
    await page.getByRole('textbox', { name: 'Funder name' }).fill('!!!');

    await page.getByRole('button', { name: 'Save settings' }).click();

    const summary = page.getByRole('alert', { name: 'There is a problem' });
    await expect(summary).toBeFocused();
    await expect(summary).toContainText(
      'Enter a name that includes at least one letter or number.',
    );
    await expect(page.getByRole('textbox', { name: 'Funder name' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });
});

test.describe('brand colour and preset', () => {
  test('refuses a colour that is too light as it is typed, and offers one that passes', async ({
    page,
  }) => {
    await stubSettings(page);
    await page.goto('/northfield/settings/look');

    await colour(page).fill('#ffee00');

    await expect(page.getByText(/This colour is too light to read/).first()).toBeVisible();
    await expect(
      page.getByText(/^Contrast found: \d\.\d to 1\. The minimum is 4\.5 to 1\.$/),
    ).toBeVisible();
    const use = page.getByRole('button', { name: /^Use #[0-9a-f]{6}$/ });
    await expect(use).toBeVisible();
    // Nothing is saved: the preview stays on the saved colour.
    await expect(page.locator('[inert]').getByText('Save programme')).toBeVisible();

    await use.click();

    await expect(colour(page)).toBeFocused();
    await expect(colour(page)).not.toHaveValue('#ffee00');
    await expect(page.getByText('This colour passes the contrast check.')).toBeVisible();
    await expect(use).toHaveCount(0);
  });

  test('previews the typed colour and preset before anything is saved', async ({ page }) => {
    const { sent } = await stubSettings(page);
    await page.goto('/northfield/settings/look');

    await colour(page).fill('#0b5d3b');
    await page.getByRole('radio', { name: 'Square' }).check();

    const preview = page.locator('[inert]');
    await expect(preview).toHaveCSS('--color-accent', '#0b5d3b');
    await expect(preview.getByText('Save programme')).toHaveCSS(
      'background-color',
      'rgb(11, 93, 59)',
    );
    await expect(preview.getByText('Save programme')).toHaveCSS('border-top-left-radius', '0px');
    expect(sent.map(({ key }) => key)).not.toContain('PUT /console/settings/theme');
    // The page itself is unchanged until the look is saved.
    expect(await accent(page)).toBe('#1f4bb8');
  });

  test('saves a colour and preset, and the console shows them, now and after a reload', async ({
    page,
  }) => {
    const { sent } = await stubSettings(page);
    await page.goto('/northfield/settings/look');
    await colour(page).fill('#0B5D3B');
    await page.getByRole('radio', { name: 'Rounded' }).check();

    await page.getByRole('button', { name: 'Save look' }).click();

    await expect(page.getByText('Look saved.')).toBeVisible();
    expect(sent.find(({ key }) => key === 'PUT /console/settings/theme')?.body).toEqual({
      brandColour: '#0b5d3b',
      preset: 'rounded',
    });
    await expect.poll(() => accent(page)).toBe('#0b5d3b');
    await expect(page.locator('html')).toHaveAttribute('data-preset', 'rounded');
    // The link to the current page is in the brand colour. (The button under the pointer is in its hover shade.)
    await expect(
      page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Look' }),
    ).toHaveCSS('color', 'rgb(11, 93, 59)');

    await page.reload();
    await expect(h1(page, 'Look and logo')).toBeVisible();
    await expect.poll(() => accent(page)).toBe('#0b5d3b');
    await expect(colour(page)).toHaveValue('#0b5d3b');
  });

  test('shows the saved look on the sign-in page too', async ({ page }) => {
    await stubSettings(
      page,
      { ...standard, brandColour: '#0b5d3b', preset: 'square' },
      {
        'GET /auth/session': problem(401, 'You are not signed in.'),
      },
    );
    await page.goto('/northfield/sign-in');
    await expect(h1(page, 'Sign in')).toBeVisible();

    await expect.poll(() => accent(page)).toBe('#0b5d3b');
    await expect(page.locator('html')).toHaveAttribute('data-preset', 'square');
  });

  test('shows a refusal from the API the same way', async ({ page }) => {
    await stubSettings(page, standard, {
      'PUT /console/settings/theme': problem(
        400,
        'Some fields are not valid. Fix the fields listed and try again.',
        [
          {
            field: 'body.brandColour',
            message:
              'This colour is too light to read on the page or behind white text. Use #123456 or a darker colour.',
          },
        ],
      ),
    });
    await page.goto('/northfield/settings/look');
    await colour(page).fill('#2255aa');

    await page.getByRole('button', { name: 'Save look' }).click();

    await expect(page.getByRole('alert', { name: 'There is a problem' })).toBeFocused();
    await expect(page.getByText(/^Contrast found:/)).toBeVisible();
    await page.getByRole('button', { name: 'Use #123456' }).click();
    await expect(colour(page)).toHaveValue('#123456');
  });
});

test.describe('modules', () => {
  test('asks before switching Grants off, then says so and drops the pages it opens', async ({
    page,
  }) => {
    const { sent } = await stubSettings(page, { ...standard }, {}, [
      'platform.settings.manage',
      'grants.programmes.manage',
    ]);
    await page.goto('/northfield/settings/modules');
    await expect(page.getByRole('heading', { level: 3, name: 'Grants is on' })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Programmes' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Switch off Grants' }).click();

    const dialog = page.getByRole('dialog', { name: 'Switch off Grants?' });
    await expect(dialog).toContainText(
      'Nothing is deleted: its data stays and returns when you switch Grants on again.',
    );
    await expect(dialog.getByRole('button', { name: 'Keep Grants on' })).toBeFocused();
    expect(sent.map(({ key }) => key)).not.toContain('PATCH /console/settings/modules');
    await dialog.getByRole('button', { name: 'Switch off Grants' }).click();

    await expect(page.getByText('Grants is now off.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Grants is off' })).toBeVisible();
    expect(sent.find(({ key }) => key === 'PATCH /console/settings/modules')?.body).toEqual({
      module: 'grants',
      enabled: false,
    });
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Programmes' }),
    ).toHaveCount(0);

    await page.getByRole('button', { name: 'Switch on Grants' }).click();
    await expect(page.getByText('Grants is now on.')).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Programmes' }),
    ).toBeVisible();
  });

  test('keeps Grants on when the person presses Escape', async ({ page }) => {
    const { funder } = await stubSettings(page);
    await page.goto('/northfield/settings/modules');
    const opener = page.getByRole('button', { name: 'Switch off Grants' });
    await opener.click();
    await expect(page.getByRole('dialog', { name: 'Switch off Grants?' })).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(funder.grants).toBe(true);
  });
});

test.describe('leaving with changes that are not saved', () => {
  test('opens a designed dialog, not the browser confirm, and stays when asked', async ({
    page,
  }) => {
    const native = watchNativeDialogs(page);
    await stubSettings(page);
    await page.goto('/northfield/settings');
    await page.getByRole('textbox', { name: 'Funder name' }).fill('Northfield Trust');

    await page
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('link', { name: 'Look' })
      .click();

    const dialog = page.getByRole('dialog', { name: 'Leave this page?' });
    await expect(dialog).toContainText(
      'You have unsaved changes. If you leave this page, you will lose them.',
    );
    await expect(dialog.getByRole('button', { name: 'Stay on this page' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Stay on this page' }).click();

    await expect(page).toHaveURL(/\/northfield\/settings$/);
    await expect(page.getByRole('textbox', { name: 'Funder name' })).toHaveValue(
      'Northfield Trust',
    );
    await expect(
      page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Look' }),
    ).toBeFocused();
    expect(native).toEqual([]);
  });

  test('leaves, with focus on the new heading, when the person agrees', async ({ page }) => {
    const native = watchNativeDialogs(page);
    await stubSettings(page);
    await page.goto('/northfield/settings');
    await page.getByRole('textbox', { name: 'Funder name' }).fill('Northfield Trust');
    await page
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('link', { name: 'Modules' })
      .click();

    await page
      .getByRole('dialog', { name: 'Leave this page?' })
      .getByRole('button', { name: 'Leave and lose changes' })
      .click();

    await expect(h1(page, 'Modules')).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(native).toEqual([]);
  });

  test('asks for the back button too, and puts the person back where they were', async ({
    page,
  }) => {
    const native = watchNativeDialogs(page);
    await stubSettings(page);
    await page.goto('/northfield/');
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Settings' })
      .click();
    await page.getByRole('textbox', { name: 'Funder name' }).fill('Northfield Trust');

    await page.goBack();

    const dialog = page.getByRole('dialog', { name: 'Leave this page?' });
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/\/northfield\/settings$/);
    await dialog.getByRole('button', { name: 'Leave and lose changes' }).click();
    await expect(h1(page, 'Programmes')).toBeVisible();
    await expect(page).toHaveURL(/\/northfield\/$/);
    expect(native).toEqual([]);
  });

  test('does not ask once the changes are saved', async ({ page }) => {
    await stubSettings(page);
    await page.goto('/northfield/settings');
    await page.getByRole('textbox', { name: 'Funder name' }).fill('Northfield Trust');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Settings saved.')).toBeVisible();

    await page
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('link', { name: 'Look' })
      .click();

    await expect(h1(page, 'Look and logo')).toBeVisible();
  });
});
