// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A form anyone can answer, in a real browser, with the API stubbed from the
// contracts (forms-api.ts): the notice, answers kept on this device only, the
// browser check, the ways a send can go wrong, and what the page leaves in
// the browser.

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { problem } from './auth-api.ts';
import {
  FORM_ID,
  notFound,
  PUBLIC_ROUTES,
  receipt,
  stubPublicForm,
  SUBMITTED,
} from './forms-api.ts';

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const address = `/northfield/forms/${FORM_ID}`;
const stored = (page: Page) => page.evaluate(() => Object.keys(window.localStorage));

async function toReview(page: Page) {
  await page.getByRole('button', { name: /^(Start|Continue my answers)$/ }).click();
  await page.getByRole('textbox', { name: /Your name/ }).fill('Sam');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByRole('button', { name: 'Save and check your answers' }).click();
  await expect(h1(page, 'Check your answers')).toBeVisible();
}

test.describe('answering a form without an account', () => {
  test('says answers stay on this device before the first question', async ({ page }) => {
    await stubPublicForm(page);
    await page.goto(address);

    await expect(h1(page, 'Funder A feedback')).toBeVisible();
    await expect(page.getByText(/saved on this device until you send them/)).toBeVisible();
    await expect(page.getByRole('textbox', { name: /Your name/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Clear my answers' })).toBeVisible();
  });

  test('restores answers on reload with a notice, and clears them when asked', async ({ page }) => {
    await stubPublicForm(page);
    await page.goto(address);
    await page.getByRole('button', { name: 'Start' }).click();
    await page.getByRole('textbox', { name: /Your name/ }).fill('Sam');

    await page.reload();
    await expect(page.getByText('We found the answers you saved earlier.')).toBeVisible();
    await page.getByRole('button', { name: 'Continue my answers' }).click();
    await expect(page.getByRole('textbox', { name: /Your name/ })).toHaveValue('Sam');

    await page.getByRole('button', { name: 'Clear my answers' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Clear my answers' }).click();
    await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
    expect(await stored(page)).toEqual([]);
  });

  test('sends once on a double click, and shows the reference', async ({ page }) => {
    const sent = await stubPublicForm(page);
    await page.goto(address);
    await toReview(page);

    await page.getByRole('button', { name: 'Send my answers' }).dblclick();

    await expect(h1(page, SUBMITTED)).toBeVisible();
    await expect(page.getByText('Thanks from Funder A.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy reference' })).toBeVisible();
    const posts = sent.filter(({ key }) => key === PUBLIC_ROUTES.submit);
    expect(posts).toHaveLength(1);
    const body = posts[0]?.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      'answers',
      'formVersionId',
      'proof',
      'respondentToken',
    ]);
    await expect(page.getByText(String(body['respondentToken']))).toBeVisible();
  });

  test('asks for a new browser check once when the first is refused', async ({ page }) => {
    let attempts = 0;
    const sent = await stubPublicForm(page, {
      [PUBLIC_ROUTES.submit]: () => {
        attempts += 1;
        return attempts === 1 ? problem(400, 'Request failed.') : receipt;
      },
    });
    await page.goto(address);
    await toReview(page);

    await page.getByRole('button', { name: 'Send my answers' }).click();

    await expect(h1(page, SUBMITTED)).toBeVisible();
    const challenges = sent.filter(({ key }) => key === PUBLIC_ROUTES.challenge);
    expect(challenges.length).toBeGreaterThanOrEqual(3);
  });

  test('shows the wait on a 429, and keeps the answers', async ({ page }) => {
    await stubPublicForm(page, {
      [PUBLIC_ROUTES.submit]: { ...problem(429, 'Slow down.'), headers: { 'retry-after': '30' } },
    });
    await page.goto(address);
    await toReview(page);

    await page.getByRole('button', { name: 'Send my answers' }).click();

    await expect(
      page.getByText('Too many attempts. Wait 30 seconds, then try again.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(await stored(page)).toHaveLength(1);
  });

  test('shows the catalogue words on a key conflict, and keeps the answers', async ({ page }) => {
    await stubPublicForm(page, {
      [PUBLIC_ROUTES.submit]: {
        status: 409,
        body: {
          type: '/problems/idempotency-key-reused',
          title: 'Request already used',
          status: 409,
          detail: 'Whatever the API says.',
          requestId: 'req_e2e',
        },
      },
    });
    await page.goto(address);
    await toReview(page);

    await page.getByRole('button', { name: 'Send my answers' }).click();

    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByText('Whatever the API says.')).toHaveCount(0);
    expect(await stored(page)).toHaveLength(1);
  });

  test('shows one not-found page, whatever the reason', async ({ page }) => {
    await stubPublicForm(page, { [PUBLIC_ROUTES.form]: notFound });

    await page.goto(address);

    await expect(h1(page, 'We cannot find this form')).toBeVisible();
  });

  test('sets no cookie and keeps only the progress key, which is gone after sending', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await stubPublicForm(page);
    await page.goto(address);
    await page.getByRole('button', { name: 'Start' }).click();
    await page.getByRole('textbox', { name: /Your name/ }).fill('Sam');

    expect(await stored(page)).toEqual([
      `form-progress:${FORM_ID}:7c1d3e5f-9a2b-4c4d-8e6f-0a1b2c3d4e5f`,
    ]);

    await page.getByRole('button', { name: 'Save and continue' }).click();
    await page.getByRole('button', { name: 'Save and check your answers' }).click();
    await page.getByRole('button', { name: 'Send my answers' }).click();
    await expect(h1(page, SUBMITTED)).toBeVisible();

    expect(await context.cookies()).toEqual([]);
    expect(await stored(page)).toEqual([]);
    expect(page.url()).not.toMatch(/[?#]/);
    await context.close();
  });
});
