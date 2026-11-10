// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The people the account security specs sign in as. Each spec makes its own,
// by invitation as a team does, so the seeded demo accounts stay as the
// journey left them. They need the journey's colleague administrator, who is
// why these specs run after it.

import type { Locator, Page } from '@playwright/test';

import { Api, signInStaff, stepUp, type Answer } from '../support/api.ts';
import { addressFor, APPLICANT_PASSWORD, registerPerson } from '../support/applicants.ts';
import { consoleOrigin, mailpitOrigin } from '../support/env.ts';
import { tokenOf, waitForLink } from '../support/mail.ts';
import { person, readState } from '../support/state.ts';
import { nextCode } from '../support/totp.ts';
import { expect, test } from '../support/test.ts';

export const SKIP_WITHOUT_JOURNEY =
  'The journey has not run: pnpm test:stack --project journey --workers 1 runs it first.';

/** Skips the file until the journey's state is there. */
export function afterTheJourney(): void {
  test.skip(readState().people['colleague'] === undefined, SKIP_WITHOUT_JOURNEY);
}

const RETRY_CAP_SECONDS = 120;

/** Repeats a call once after `Retry-After`; a second 429 fails, so a refusal is never counted as a pass. */
export async function paced(label: string, send: () => Promise<Answer>): Promise<Answer> {
  let answer = await send();
  if (answer.status === 429) {
    const seconds = Number(answer.headers['retry-after']);
    const wait = Math.min(Number.isFinite(seconds) && seconds > 0 ? seconds : 1, RETRY_CAP_SECONDS);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    answer = await send();
    expect(answer.status, `${label} was rate limited twice`).not.toBe(429);
  }
  return answer;
}

/** Makes a Northfield staff member by invitation, with an authenticator app set up. Does nothing if they exist. */
export async function createStaff(name: string, role: 'programme_manager' | 'reviewer') {
  if (readState().people[name]?.key !== undefined) return;
  const email = addressFor(name);
  registerPerson(name, email);
  const admin = await signInStaff('northfield', 'colleague');
  await stepUp(admin, 'colleague');
  await admin.ok('POST', '/console/team/invitations', { json: { email, roles: [role] } });
  await admin.dispose();

  const joiner = await Api.open(consoleOrigin);
  await joiner.ok('POST', '/auth/tenants/northfield/sign-up', { json: { email } });
  await joiner.ok('POST', '/auth/sign-up/complete', {
    json: {
      token: tokenOf(await waitForLink(email, '/sign-up/complete')),
      password: APPLICANT_PASSWORD,
    },
  });
  await joiner.dispose();
  const member = await signInStaff('northfield', name);
  await member.ok('POST', '/auth/invitations/accept', {
    json: { token: tokenOf(await waitForLink(email, '/invitation')) },
  });
  await member.dispose();
}

/** The membership id of a Northfield staff member, as the colleague administrator reads the team. */
export async function membershipOf(name: string): Promise<string> {
  const admin = await signInStaff('northfield', 'colleague');
  const { members } = await admin.ok<{ members: { id: string; email: string }[] }>(
    'GET',
    '/console/team',
  );
  await admin.dispose();
  const found = members.find((member) => member.email === person(name).email);
  expect(found, `${name} is on the team`).toBeDefined();
  return found?.id ?? '';
}

/** Types the password and the next authenticator code into the step-up dialog, if the page asked. */
export async function confirmIfAsked(page: Page, name: string, done: Locator): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Confirm it is you' });
  await expect(dialog.or(done)).toBeVisible();
  if (!(await dialog.isVisible())) return;
  await dialog.getByLabel('Password', { exact: true }).fill(person(name).password);
  await dialog.getByLabel('Code from your authenticator app').fill(await nextCode(name));
  await dialog.getByRole('button', { name: 'Confirm it is you' }).click();
  await expect(done).toBeVisible();
}

/** Types an address and password into the console's sign-in page, as far as the second step. */
export async function startSignIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/northfield/sign-in');
  await page.getByRole('textbox', { name: 'Email address', exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Deletes the messages to an address from Mailpit, so a run leaves none of its own. */
export async function deleteMessagesTo(...addresses: string[]): Promise<void> {
  for (const address of addresses) {
    await fetch(`${mailpitOrigin}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`, {
      method: 'DELETE',
    });
  }
}
