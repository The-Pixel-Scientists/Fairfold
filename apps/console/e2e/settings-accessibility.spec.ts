// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for every settings screen and state, at desktop width, at
// 320 px wide and at 200% zoom (ADR 0006), in the standard look and in a
// saved custom look, with the API's answers stubbed (settings-api.ts). In
// console-production they run under the production content security policy.
// The logo's states are in settings-logo.spec.ts.

import type { Page } from '@playwright/test';

import { problem } from './auth-api.ts';
import { stubSettings } from './settings-api.ts';
import { checkSettingsStates } from './settings-axe.ts';
import type { SettingsState } from './settings-axe.ts';
import { expect } from '../../../scripts/e2e/fixtures.ts';

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const summary = (page: Page) => page.getByRole('alert', { name: 'There is a problem' });
const refused = 'Some fields are not valid. Fix the fields listed and try again.';

/** A request that is never answered, so the page stays on its loading state. */
async function neverAnswer(page: Page, path: string): Promise<void> {
  await page.route(
    (url) => url.pathname === path,
    () => undefined,
  );
}

const states: SettingsState[] = [
  {
    name: 'general settings',
    open: async (page) => {
      await page.goto('/northfield/settings');
      await expect(page.getByRole('textbox', { name: 'Funder name' })).toBeVisible();
    },
  },
  {
    name: 'general settings while loading',
    open: async (page) => {
      await neverAnswer(page, '/api/console/settings');
      await page.goto('/northfield/settings');
      await expect(page.getByRole('status').filter({ hasText: 'Loading settings' })).toBeVisible();
    },
  },
  {
    name: 'general settings that could not be loaded',
    stub: (page, funder) =>
      stubSettings(page, funder, {
        'GET /console/settings': problem(503, 'The service is busy. Try again in a minute.'),
      }),
    open: async (page) => {
      await page.goto('/northfield/settings');
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    },
  },
  {
    name: 'general settings with the API refusing the name',
    stub: (page, funder) =>
      stubSettings(page, funder, {
        'PUT /console/settings': problem(400, refused, [
          {
            field: 'body.name',
            message: 'Enter a name that includes at least one letter or number.',
          },
        ]),
      }),
    open: async (page) => {
      await page.goto('/northfield/settings');
      await page.getByRole('textbox', { name: 'Funder name' }).fill('!!!');
      await page.getByRole('button', { name: 'Save settings' }).click();
      await expect(summary(page)).toBeFocused();
    },
  },
  {
    name: 'general settings after saving',
    open: async (page) => {
      await page.goto('/northfield/settings');
      await page.getByRole('textbox', { name: 'Funder name' }).fill('Northfield Community Trust');
      await page.getByRole('button', { name: 'Save settings' }).click();
      await expect(page.getByText('Settings saved.')).toBeVisible();
    },
  },
  {
    name: 'the dialog before leaving with unsaved changes',
    open: async (page) => {
      await page.goto('/northfield/settings');
      await page.getByRole('textbox', { name: 'Funder name' }).fill('Northfield Trust');
      await page
        .getByRole('navigation', { name: 'Settings' })
        .getByRole('link', { name: 'Look' })
        .click();
      await expect(page.getByRole('dialog', { name: 'Leave this page?' })).toBeVisible();
    },
  },
  {
    name: 'look and logo',
    open: async (page) => {
      await page.goto('/northfield/settings/look');
      await expect(page.getByRole('textbox', { name: 'Brand colour' })).toBeVisible();
    },
  },
  {
    name: 'look and logo that could not be loaded',
    stub: (page, funder) =>
      stubSettings(page, funder, {
        'GET /console/settings/theme': problem(503, 'The service is busy. Try again in a minute.'),
      }),
    open: async (page) => {
      await page.goto('/northfield/settings/look');
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    },
  },
  {
    name: 'a colour that is too light, with the colour to use',
    open: async (page) => {
      await page.goto('/northfield/settings/look');
      await page.getByRole('textbox', { name: 'Brand colour' }).fill('#ffee00');
      await expect(page.getByRole('button', { name: /^Use #[0-9a-f]{6}$/ })).toBeVisible();
    },
  },
  {
    name: 'a colour that passes, in the square preset',
    open: async (page) => {
      await page.goto('/northfield/settings/look');
      await page.getByRole('textbox', { name: 'Brand colour' }).fill('#0b5d3b');
      await page.getByRole('radio', { name: 'Square' }).check();
      await expect(page.getByText('This colour passes the contrast check.')).toBeVisible();
    },
  },
  {
    name: 'a colour that passes, in the rounded preset',
    open: async (page) => {
      await page.goto('/northfield/settings/look');
      await page.getByRole('textbox', { name: 'Brand colour' }).fill('#7a1f5c');
      await page.getByRole('radio', { name: 'Rounded' }).check();
      await expect(page.getByText('This colour passes the contrast check.')).toBeVisible();
    },
  },
  {
    name: 'a colour the API refuses',
    stub: (page, funder) =>
      stubSettings(page, funder, {
        'PUT /console/settings/theme': problem(400, refused, [
          {
            field: 'body.brandColour',
            message:
              'This colour is too light to read on the page or behind white text. Use #123456 or a darker colour.',
          },
        ]),
      }),
    open: async (page) => {
      await page.goto('/northfield/settings/look');
      await page.getByRole('textbox', { name: 'Brand colour' }).fill('#2255aa');
      await page.getByRole('button', { name: 'Save look' }).click();
      await expect(summary(page)).toBeFocused();
    },
  },
  {
    name: 'a look after saving',
    open: async (page) => {
      await page.goto('/northfield/settings/look');
      await page.getByRole('textbox', { name: 'Brand colour' }).fill('#7a1f5c');
      await page.getByRole('radio', { name: 'Rounded' }).check();
      await page.getByRole('button', { name: 'Save look' }).click();
      await expect(page.getByText('Look saved.')).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.dataset['preset']))
        .toBe('rounded');
    },
  },
  {
    name: 'modules with Grants on',
    open: async (page) => {
      await page.goto('/northfield/settings/modules');
      await expect(page.getByRole('heading', { level: 3, name: 'Grants is on' })).toBeVisible();
    },
  },
  {
    name: 'modules with Grants off',
    stub: (page, funder) => stubSettings(page, { ...funder, grants: false }),
    open: async (page) => {
      await page.goto('/northfield/settings/modules');
      await expect(page.getByRole('heading', { level: 3, name: 'Grants is off' })).toBeVisible();
    },
  },
  {
    name: 'the dialog before switching Grants off',
    open: async (page) => {
      await page.goto('/northfield/settings/modules');
      await page.getByRole('button', { name: 'Switch off Grants' }).click();
      await expect(page.getByRole('dialog', { name: 'Switch off Grants?' })).toBeVisible();
    },
  },
  {
    name: 'a switch the API refuses',
    stub: (page, funder) =>
      stubSettings(page, funder, {
        'PATCH /console/settings/modules': problem(403, 'You cannot change modules.'),
      }),
    open: async (page) => {
      await page.goto('/northfield/settings/modules');
      await page.getByRole('button', { name: 'Switch off Grants' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Switch off Grants' }).click();
      await expect(page.getByRole('alert')).toContainText('You cannot change modules.');
    },
  },
  {
    name: 'settings for someone without the permission',
    stub: (page, funder) => stubSettings(page, funder, {}, ['grants.programmes.manage']),
    open: async (page) => {
      await page.goto('/northfield/settings');
      await expect(h1(page, 'Settings')).toBeVisible();
      await expect(page.getByText("You cannot change this funder's settings")).toBeVisible();
    },
  },
];

checkSettingsStates(states);
