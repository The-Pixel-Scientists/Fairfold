// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Messages with the funder in a real browser, with the API's answers stubbed
// (apply-api.ts, messages-api.ts): new messages marked in words, a reply that
// joins the thread, the badge that clears once they are read, and a refused
// blank reply.

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { APPLICATION_ID, sent, stubApply } from './apply-api.ts';
import { message, stubMessages } from './messages-api.ts';

const home = `/northfield/applications/${APPLICATION_ID}`;
const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

const twoNew = () =>
  stubMessages(
    APPLICATION_ID,
    message({ side: 'applicant', body: 'Can we change the start date?' }),
    message({ body: 'Yes, that is fine.', unread: true }),
    message({ body: 'Please send a bank letter.', unread: true }),
  );

test('shows new messages in words, marks them read, and takes a reply', async ({ page }) => {
  const thread = twoNew();
  await stubApply(page, { applications: [sent({ id: APPLICATION_ID })], more: thread.handlers });

  await page.goto(home);
  await page.getByRole('link', { name: /^Messages/ }).click();

  await expect(h1(page, 'Messages')).toBeFocused();
  await expect(page.getByText('You have 2 new messages.')).toBeVisible();
  await expect(page.getByText('New', { exact: true })).toHaveCount(2);
  await expect(page.getByRole('heading', { level: 3, name: 'The funder' })).toHaveCount(2);
  await expect.poll(() => thread.marked()).toBe(1);

  await page.getByRole('textbox', { name: /Send a message to the funder/ }).fill('Thank you.');
  await page.getByRole('button', { name: 'Send message' }).click();

  await expect(page.getByText('Message sent')).toBeFocused();
  await expect(page.getByText('Thank you.')).toBeVisible();
  expect(thread.sends).toEqual(['Thank you.']);

  await page.getByRole('link', { name: 'Back to your application' }).click();
  await expect(page.getByRole('link', { name: /^Messages/ })).not.toContainText('new');
});

test('shows the unread count on the application page', async ({ page }) => {
  await stubApply(page, {
    applications: [sent({ id: APPLICATION_ID })],
    more: twoNew().handlers,
  });
  await page.goto(home);

  await expect(page.getByRole('link', { name: /^Messages,\s*2 new$/ })).toBeVisible();
});

test('shows a message body as plain text', async ({ page }) => {
  const body = 'See <b>this</b> https://example.org/x';
  await stubApply(page, {
    applications: [sent({ id: APPLICATION_ID })],
    more: stubMessages(APPLICATION_ID, message({ body })).handlers,
  });
  await page.goto(`${home}/messages`);

  await expect(page.getByText(body)).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: /example\.org/ })).toHaveCount(0);
});

test('refuses a blank reply with the error summary', async ({ page }) => {
  const thread = stubMessages(APPLICATION_ID);
  await stubApply(page, { applications: [sent({ id: APPLICATION_ID })], more: thread.handlers });
  await page.goto(`${home}/messages`);
  await expect(page.getByText(/There are no messages yet/)).toBeVisible();

  await page.getByRole('button', { name: 'Send message' }).click();

  await expect(page.getByRole('alert', { name: 'There is a problem' })).toBeFocused();
  expect(thread.sends).toEqual([]);
});
