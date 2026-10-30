// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reads the stack's Mailpit as a person reads their inbox.

import type { Page } from '@playwright/test';

import { expect } from '../../scripts/e2e/fixtures.ts';
import { mailpitOrigin } from './env.ts';

interface Summary {
  ID: string;
  Subject: string;
}

async function search(query: string): Promise<Summary[]> {
  const found = await fetch(`${mailpitOrigin}/api/v1/search?query=${encodeURIComponent(query)}`);
  return ((await found.json()) as { messages: Summary[] }).messages;
}

/** The text of every message to an address, newest first. */
async function textsTo(address: string): Promise<string[]> {
  const texts: string[] = [];
  for (const { ID } of await search(`to:${address}`)) {
    const message = (await (await fetch(`${mailpitOrigin}/api/v1/message/${ID}`)).json()) as {
      Text: string;
    };
    texts.push(message.Text);
  }
  return texts;
}

/** The newest emailed link to this address whose path ends with `part`, or null while none has come. */
async function emailedLink(address: string, part: string): Promise<string | null> {
  for (const text of await textsTo(address)) {
    const link = text
      .match(/https?:\/\/[^\s"<>]*#token=[\w-]+/g)
      ?.find((url) => url.slice(0, url.indexOf('#')).endsWith(part));
    if (link) return link;
  }
  return null;
}

/** Waits for the email to `address` with a link ending in `part`, then gives the link. */
export async function waitForLink(address: string, part: string): Promise<string> {
  await expect
    .poll(() => emailedLink(address, part), {
      message: `The email to ${address} has not arrived.`,
      timeout: 30_000,
    })
    .not.toBeNull();
  return (await emailedLink(address, part)) ?? '';
}

export async function openEmailedLink(page: Page, address: string, part: string): Promise<void> {
  await page.goto(await waitForLink(address, part));
}

/** The token in a link, which only a POST spends. */
export const tokenOf = (link: string): string => new URL(link).hash.replace('#token=', '');

/** How many messages have a subject that contains `subject`. */
export async function countSubject(subject: string): Promise<number> {
  return (await search(`subject:"${subject}"`)).length;
}

/** The subjects of the messages to an address. */
export async function subjectsTo(address: string): Promise<string[]> {
  return (await search(`to:${address}`)).map(({ Subject }) => Subject);
}

/** The messages to an address, newest first, once at least `count` have come. */
export async function waitForMessages(
  address: string,
  count = 1,
): Promise<{ subject: string; text: string }[]> {
  await expect
    .poll(async () => (await search(`to:${address}`)).length, {
      message: `Fewer than ${String(count)} emails to ${address} have arrived.`,
      timeout: 30_000,
    })
    .toBeGreaterThanOrEqual(count);
  const found = await search(`to:${address}`);
  return Promise.all(
    found.map(async ({ ID, Subject }) => {
      const message = (await (await fetch(`${mailpitOrigin}/api/v1/message/${ID}`)).json()) as {
        Text: string;
      };
      return { subject: Subject, text: message.Text };
    }),
  );
}
