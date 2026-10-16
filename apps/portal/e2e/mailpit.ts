// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the specs that run against the real API share: reading each emailed
// link from Mailpit as a person reads their inbox, and the first steps of an
// applicant's life, creating an account and signing in. They need the stack:
// `pnpm stack`, then `pnpm test:stack -- portal`.

import type { Page } from '@playwright/test';

import { expect } from '../../../scripts/e2e/fixtures.ts';

const MAILPIT = process.env['TPS_MAILPIT_URL'] ?? 'http://127.0.0.1:58025';

interface MailpitList {
  messages: { ID: string }[];
}

interface MailpitMessage {
  Text: string;
}

/** The newest emailed link to this address that contains `part`, or null while none has arrived. */
async function emailedLink(address: string, part: string): Promise<string | null> {
  const found = await fetch(
    `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
  );
  const { messages } = (await found.json()) as MailpitList;
  for (const { ID } of messages) {
    const message = (await (
      await fetch(`${MAILPIT}/api/v1/message/${ID}`)
    ).json()) as MailpitMessage;
    const link = message.Text.match(/https?:\/\/[^\s"<>]*#token=[\w-]+/g)?.find((url) =>
      url.slice(0, url.indexOf('#')).endsWith(part),
    );
    if (link) return link;
  }
  return null;
}

/** Waits for the email with a link ending in `part`, then opens the link. */
export async function openEmailedLink(page: Page, address: string, part: string): Promise<void> {
  await expect
    .poll(() => emailedLink(address, part), {
      message: 'The email has not arrived.',
      timeout: 30_000,
    })
    .not.toBeNull();
  const link = await emailedLink(address, part);
  await page.goto(link ?? '');
}

/** Creates an account with an email address, then sets its password from the emailed link. */
export async function createAccount(page: Page, address: string, password: string): Promise<void> {
  await page.goto('/northfield/');
  await page.getByRole('link', { name: 'Create an account' }).click();
  await page.getByRole('textbox', { name: 'Email address' }).fill(address);
  await page.getByRole('button', { name: 'Email me a link' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
  await openEmailedLink(page, address, '/sign-up/complete');
  await expect(page).toHaveURL(/\/northfield\/sign-up\/complete$/);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
}

export async function signIn(page: Page, address: string, password: string): Promise<void> {
  await page.goto('/northfield/sign-in');
  await page.getByRole('textbox', { name: 'Email address' }).fill(address);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
