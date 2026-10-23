// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for the Look page's own stylesheet in every state, at desktop
// width, at 320 px wide and at 200% zoom (ADR 0006), in the light and dark
// schemes, in the standard look and with a saved stylesheet, with the API's
// answers stubbed (settings-stylesheet-api.ts). In console-production they
// run under the production content security policy.

import { tokenStylesheet } from '@pixel-scientists/domain/platform/settings';

import { expect } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { problem } from './auth-api.ts';
import { checkSettingsStates } from './settings-axe.ts';
import type { SettingsState } from './settings-axe.ts';
import { greenTokens, stubStylesheet } from './settings-stylesheet-api.ts';
import { chooseStylesheet, summary } from './settings-stylesheet-steps.ts';

const sheet = () => tokenStylesheet(greenTokens, { tenantName: 'Northfield Foundation' });
const ready = (page: Page) => page.getByText(/^Ready to save/);

async function openLook(page: Page): Promise<void> {
  await page.goto('/northfield/settings/look');
  await expect(page.getByLabel('Upload stylesheet')).toBeVisible();
}

const states: SettingsState[] = [
  {
    name: 'the stylesheet section with no stylesheet saved',
    stub: (page, funder) => stubStylesheet(page, funder),
    open: openLook,
  },
  {
    name: 'a stylesheet read, with its preview in both schemes',
    stub: (page, funder) => stubStylesheet(page, funder),
    open: async (page) => {
      await openLook(page);
      await chooseStylesheet(page, sheet());
      await expect(ready(page)).toBeVisible();
      await expect(page.locator('[inert]')).toHaveCount(3);
    },
  },
  {
    name: 'a stylesheet with its problems listed by line',
    stub: (page, funder) => stubStylesheet(page, funder),
    open: async (page) => {
      await openLook(page);
      await chooseStylesheet(
        page,
        sheet()
          .replace('--color-ink: #17181b;', '--color-ink: #17181b !important;')
          .replace('--color-muted: #5b5e64;', '--color-muted: #eeeeee;'),
      );
      await expect(summary(page)).toBeFocused();
    },
  },
  {
    name: 'a stylesheet the API refuses',
    stub: (page, funder) =>
      stubStylesheet(page, funder, null, {
        'PUT /console/settings/theme/tokens': problem(400, 'Some fields are not valid.', [
          { field: 'body.tokens.light.colorInk', message: 'Make ink darker.' },
        ]),
      }),
    open: async (page) => {
      await openLook(page);
      await chooseStylesheet(page, sheet());
      await page.getByRole('button', { name: 'Save stylesheet' }).click();
      await expect(summary(page)).toBeFocused();
    },
  },
  {
    name: 'a saved stylesheet in use',
    stub: (page, funder) => stubStylesheet(page, funder, greenTokens),
    open: async (page) => {
      await openLook(page);
      await expect(page.getByText(/Your look comes from a stylesheet you saved/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Go back to a preset' })).toBeVisible();
    },
  },
  {
    name: 'a stylesheet after saving',
    stub: (page, funder) => stubStylesheet(page, funder),
    open: async (page) => {
      await openLook(page);
      await chooseStylesheet(page, sheet());
      await page.getByRole('button', { name: 'Save stylesheet' }).click();
      await expect(page.getByText('Stylesheet saved.')).toBeVisible();
    },
  },
  {
    name: 'the dialog before going back to a preset',
    stub: (page, funder) => stubStylesheet(page, funder, greenTokens),
    open: async (page) => {
      await openLook(page);
      await page.getByRole('button', { name: 'Go back to a preset' }).click();
      await expect(page.getByRole('dialog', { name: 'Go back to a preset?' })).toBeVisible();
    },
  },
  {
    name: 'the dialog before replacing the stylesheet with a preset',
    stub: (page, funder) => stubStylesheet(page, funder, greenTokens),
    open: async (page) => {
      await openLook(page);
      await page.getByRole('button', { name: 'Save look' }).click();
      await expect(page.getByRole('dialog', { name: 'Replace your stylesheet?' })).toBeVisible();
    },
  },
];

checkSettingsStates(states);
