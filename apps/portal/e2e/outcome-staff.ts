// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The staff steps of demo steps 12 and 13 that the outcome journey needs, taken
// through the console's API from a page signed in as the Northfield programme
// manager, since the decision screens are built apart from this app. The page
// is on the console's origin, so its requests carry the manager's session and
// the origin the API checks. They need the stack (`pnpm stack`) with the
// decision routes, and the manager's details that programme-journey.spec.ts
// uses (TPS_E2E_MANAGER_EMAIL, TPS_E2E_MANAGER_PASSWORD and, once the
// authenticator is set up, TPS_E2E_MANAGER_TOTP_KEY).

// The callback passed to evaluate runs in the browser, so it uses DOM types.
/// <reference lib="dom" />

import { createHmac } from 'node:crypto';

import type { Browser, Page } from '@playwright/test';

import { currentDevNames } from '../../../scripts/dev-names.ts';

const EMAIL = process.env['TPS_E2E_MANAGER_EMAIL'];
const PASSWORD = process.env['TPS_E2E_MANAGER_PASSWORD'];
const TOTP_KEY = process.env['TPS_E2E_MANAGER_TOTP_KEY'];

export const managerIsSet = EMAIL !== undefined && PASSWORD !== undefined && TOTP_KEY !== undefined;

const CONSOLE = `http://console.localhost:${String(currentDevNames().ports.stackConsole)}`;

/** The six-digit code an authenticator app shows now for its base32 key (RFC 6238). */
function totp(key: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = Array.from(key.replace(/[\s=]/g, '').toUpperCase(), (letter) =>
    alphabet.indexOf(letter).toString(2).padStart(5, '0'),
  ).join('');
  const secret = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const hash = createHmac('sha1', secret).update(counter).digest();
  const offset = (hash.at(-1) ?? 0) & 0x0f;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** The last code used. Each works once, so the next use waits for a fresh one. */
let spent: string | null = null;

async function code(): Promise<string> {
  while (totp(TOTP_KEY ?? '') === spent) await new Promise((resolve) => setTimeout(resolve, 1000));
  spent = totp(TOTP_KEY ?? '');
  return spent;
}

/** One call to the API from the page, answering its JSON, and failing with what the API said. */
async function api(page: Page, method: string, path: string, body?: unknown): Promise<unknown> {
  return page.evaluate(
    async (call) => {
      const response = await fetch(`/api${call.path}`, {
        method: call.method,
        ...(call.body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(call.body) }),
      });
      if (!response.ok) {
        throw new Error(
          `${call.method} ${call.path}: ${String(response.status)} ${await response.text()}`,
        );
      }
      return (await response.json()) as unknown;
    },
    { method, path, body },
  );
}

/** The manager, signed in to the console with a password and a code. */
export async function signInManager(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${CONSOLE}/northfield/sign-in`);
  await api(page, 'POST', '/auth/tenants/northfield/sign-in', { email: EMAIL, password: PASSWORD });
  await api(page, 'POST', '/auth/totp/verify', { code: await code() });
  return page;
}

async function roundOf(page: Page, submissionId: string): Promise<string> {
  const submission = (await api(page, 'GET', `/console/submissions/${submissionId}`)) as {
    round: { id: string };
  };
  return submission.round.id;
}

/** Moves a submission to its round's Review stage, as the manager does in bulk in step 9. */
export async function moveToReview(page: Page, submissionId: string): Promise<void> {
  const roundId = await roundOf(page, submissionId);
  const { stages } = (await api(page, 'GET', `/console/rounds/${roundId}/stages`)) as {
    stages: { id: string; name: string }[];
  };
  const review = stages.find(({ name }) => name === 'Review');
  if (review === undefined) throw new Error('The round has no Review stage.');
  await api(page, 'POST', `/console/stages/${review.id}/submissions`, {
    submissionIds: [submissionId],
  });
}

/** Records an award without telling the applicant. */
export async function recordAward(
  page: Page,
  submissionId: string,
  amountMinor: number,
): Promise<void> {
  await api(page, 'PUT', `/console/submissions/${submissionId}/decision`, {
    outcome: 'accepted',
    amount: { amountMinor, currency: 'GBP' },
  });
}

/** Signs in again, as release asks, then releases the submission's recorded decision. */
export async function release(page: Page, submissionId: string): Promise<void> {
  const roundId = await roundOf(page, submissionId);
  await api(page, 'POST', '/auth/step-up', { password: PASSWORD, code: await code() });
  await api(page, 'POST', `/console/rounds/${roundId}/decisions/release`, {
    release: 'chosen',
    submissionIds: [submissionId],
  });
}
