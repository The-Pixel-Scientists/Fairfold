// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The embed entry (ADR 0035), in a real browser, with the API stubbed from the
// contracts (forms-api.ts). It runs under the portal's own policy; framing
// from another origin and the embed origin's policy are checked by S12-75's
// own spec.

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { FORM_ID, stubPublicForm, SUBMITTED } from './forms-api.ts';

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

/** The embed origin serves the embed entry at every address; here the entry is opened at its own file. */
async function openEmbed(page: Page) {
  await page.goto('/embed.html');
  await page.evaluate((path) => {
    window.history.replaceState(null, '', path);
  }, `/northfield/forms/${FORM_ID}`);
  await page.reload();
}

test.describe('the embed entry', () => {
  test('shows an anonymous form with the funder name, and reads no session', async ({ page }) => {
    const sent = await stubPublicForm(page);

    await openEmbed(page);

    await expect(h1(page, 'Funder A feedback')).toBeVisible();
    await expect(page.getByText('Northfield Foundation')).toBeVisible();
    await expect(page.getByText(/saved on this device for this website only/)).toBeVisible();
    await expect(page.getByRole('link', { name: /sign in/i })).toHaveCount(0);
    expect(sent.some(({ key }) => key.includes('/auth/'))).toBe(false);
  });

  test('answers and sends with no cookie', async ({ page, context }) => {
    await stubPublicForm(page);
    await openEmbed(page);

    await page.getByRole('button', { name: 'Start' }).click();
    await page.getByRole('textbox', { name: /Your name/ }).fill('Sam');
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await page.getByRole('button', { name: 'Save and check your answers' }).click();
    await page.getByRole('button', { name: 'Send my answers' }).click();

    await expect(h1(page, SUBMITTED)).toBeVisible();
    expect(await context.cookies()).toEqual([]);
  });
});
