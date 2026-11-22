// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A form for people who sign in, in a real browser, with the API stubbed from
// the contracts (forms-api.ts).

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { FORM_ID, RESPONSE_ID, stubSignedInForms } from './forms-api.ts';

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const form = `/northfield/your-forms/${FORM_ID}`;

test.describe('answering a form after signing in', () => {
  test('opens from the front door, and reads back the answers already sent', async ({ page }) => {
    await stubSignedInForms(page);
    await page.goto('/northfield/');

    await page.getByRole('link', { name: 'Your forms' }).click();
    await expect(h1(page, 'Your answers')).toBeVisible();
    await page.getByRole('link', { name: 'Funder A survey' }).click();

    await expect(h1(page, 'Funder A survey')).toBeVisible();
    await expect(page.getByText('Sam', { exact: true })).toBeVisible();
    await expect(page.getByText('Sent on 5 January 2027')).toBeVisible();
  });

  test('saves as the person answers, says so, and keeps the answers on return', async ({
    page,
  }) => {
    const sent = await stubSignedInForms(page);
    await page.goto(form);
    await page.getByRole('button', { name: 'Start' }).click();

    await page.getByRole('textbox', { name: /Your name/ }).fill('Sam');
    await expect(page.getByText(/Saved at/)).toBeVisible();
    expect(sent.some(({ key }) => key === `PUT /portal/forms/${FORM_ID}/draft`)).toBe(true);

    await page.reload();
    await page.getByRole('button', { name: 'Continue my answers' }).click();
    await expect(page.getByRole('textbox', { name: /Your name/ })).toHaveValue('Sam');
  });

  test('goes through the sections and the review, and sends once on a double click', async ({
    page,
  }) => {
    const sent = await stubSignedInForms(page);
    await page.goto(form);
    await page.getByRole('button', { name: 'Start' }).click();
    await page.getByRole('textbox', { name: /Your name/ }).fill('Sam');
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(h1(page, 'Anything else')).toBeFocused();
    await page.getByRole('button', { name: 'Save and check your answers' }).click();
    await expect(h1(page, 'Check your answers')).toBeFocused();

    await page.getByRole('button', { name: 'Send my answers' }).dblclick();

    await expect(h1(page, 'Your answers have been sent')).toBeVisible();
    const posts = sent.filter(({ key }) => key === `POST /portal/forms/${FORM_ID}/responses`);
    expect(posts).toHaveLength(1);
    expect(JSON.stringify(posts[0]?.body)).not.toMatch(/tenant|northfield|member|user/i);
  });

  test('lists an unanswered required question on the review, with a link to it', async ({
    page,
  }) => {
    await stubSignedInForms(page);
    await page.goto(form);
    await page.getByRole('button', { name: 'Start' }).click();
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await page.getByRole('button', { name: 'Save and check your answers' }).click();

    await page.getByRole('button', { name: 'Send my answers' }).click();
    await expect(page.getByText('One question needs your attention')).toBeVisible();
    await page.getByRole('button', { name: 'Go to this question' }).click();

    await expect(page.getByRole('textbox', { name: /Your name/ })).toBeFocused();
  });

  test('shows page not found when forms is off', async ({ page }) => {
    await stubSignedInForms(page, { modules: [] });

    await page.goto(form);
    await expect(h1(page, 'Page not found')).toBeVisible();
    await page.goto(`/northfield/form-responses/${RESPONSE_ID}`);
    await expect(h1(page, 'Page not found')).toBeVisible();
  });
});
