// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reads emailed links from Mailpit, as a person reads them in their inbox, for
// the journeys against the real API.

import { expect } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

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

/** Waits for the email, then opens its link in the page. Gives the link, to open again later. */
export async function openEmailedLink(page: Page, address: string, part: string): Promise<string> {
  await expect
    .poll(() => emailedLink(address, part), {
      message: 'The email has not arrived.',
      timeout: 30_000,
    })
    .not.toBeNull();
  const link = (await emailedLink(address, part)) ?? '';
  await page.goto(link);
  return link;
}
