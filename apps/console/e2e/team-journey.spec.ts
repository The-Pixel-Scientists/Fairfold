// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The team journey against the real API: an administrator invites someone,
// the person signs up from the email, sets up MFA, accepts and sees the
// console, and when the administrator suspends them their next request signs
// them out. The steps are those of team.spec.ts, which runs them against a
// stand-in. It needs the stack (`pnpm stack`, then `pnpm test:stack`), the
// Northfield administrator from the seed's `base` scenario, and Mailpit:
//
//   TPS_E2E_ADMIN_EMAIL     the administrator's email address
//   TPS_E2E_ADMIN_PASSWORD  the seed password
//   TPS_E2E_ADMIN_TOTP_KEY  the authenticator key, once it has been set
//                           up. The first run sets it up and prints the
//                           key, which the next runs need.

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { nextCode } from './auth-totp.ts';
import { openEmailedLink } from './team-mail.ts';
import {
  confirmItsYou,
  h1,
  invitationsTable,
  memberRow,
  openTeam,
  sendInvitation,
  status,
  suspendMember,
} from './team-steps.ts';

const EMAIL = process.env['TPS_E2E_ADMIN_EMAIL'];
const PASSWORD = process.env['TPS_E2E_ADMIN_PASSWORD'];
const TOTP_KEY = process.env['TPS_E2E_ADMIN_TOTP_KEY'];
const NEW_PASSWORD = 'a first long passphrase';

async function signIn(page: Page, address: string, password: string): Promise<void> {
  await page.goto('/northfield/sign-in');
  await page.getByRole('textbox', { name: 'Email address' }).fill(address);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** The key on the set-up screen, which the person types into their authenticator app. */
async function setUpAuthenticator(page: Page): Promise<string> {
  await expect(h1(page, 'Set up your authenticator app')).toBeVisible();
  const key = ((await page.getByText(/^[A-Z2-7]{4}( [A-Z2-7]{4})+$/).textContent()) ?? '').replace(
    /\s/g,
    '',
  );
  await page.getByLabel('Code from your app').fill(await nextCode(key, null));
  await page.getByRole('button', { name: 'Finish set-up' }).click();
  return key;
}

/** Signs in as the administrator. Gives the last code used, as each code works once. */
async function signInAsAdministrator(page: Page): Promise<string> {
  await signIn(page, EMAIL ?? '', PASSWORD ?? '');
  const code = await nextCode(TOTP_KEY ?? '', null);
  await expect(h1(page, 'Enter your code')).toBeVisible();
  await page.getByLabel('Code from your app').fill(code);
  await page.getByRole('button', { name: 'Confirm code' }).click();
  await expect(
    page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Team' }),
  ).toBeVisible();
  return code;
}

/** Answers the step-up dialog if the change asked for it, with a code not used yet. */
async function confirmIfAsked(page: Page, spent: string): Promise<string> {
  const dialog = page.getByRole('dialog', { name: 'Confirm it is you' });
  const asked = await dialog
    .waitFor({ state: 'visible', timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  if (!asked) return spent;
  const code = await nextCode(TOTP_KEY ?? '', spent);
  await confirmItsYou(page, PASSWORD ?? '', code);
  return code;
}

test.describe('the team journey against the real API', () => {
  test.skip(
    process.env['TPS_E2E_STACK'] !== '1',
    'Runs against the stack: pnpm stack, then pnpm test:stack.',
  );
  test.skip(
    EMAIL === undefined || PASSWORD === undefined || TOTP_KEY === undefined,
    "Needs the seed's Northfield administrator: set TPS_E2E_ADMIN_EMAIL, TPS_E2E_ADMIN_PASSWORD and TPS_E2E_ADMIN_TOTP_KEY.",
  );
  test.setTimeout(360_000);

  test('@api invites someone, who joins from the email, and is signed out when suspended', async ({
    browser,
    page,
  }) => {
    const address = `team-journey-${String(Date.now())}@example.org`;

    // The administrator invites them.
    let spent = await signInAsAdministrator(page);
    await openTeam(page);
    await sendInvitation(page, address, 'reviewer');
    spent = await confirmIfAsked(page, spent);
    await expect(status(page)).toHaveText(`Invitation sent to ${address}. It works for 7 days.`);
    await expect(invitationsTable(page)).toContainText(address);

    // They open the link signed out, create an account, set up MFA, and open the link again.
    const context = await browser.newContext();
    const person = await context.newPage();
    const link = await openEmailedLink(person, address, '/invitation');
    await expect(h1(person, 'Join Northfield Foundation')).toBeVisible();
    await expect(person.getByText(/create an account or sign in/)).toBeVisible();
    await expect(person).toHaveURL(/\/northfield\/invitation$/);

    await person.getByRole('link', { name: 'Create an account' }).click();
    await person.getByRole('textbox', { name: 'Email address' }).fill(address);
    await person.getByRole('button', { name: 'Email me a link' }).click();
    await openEmailedLink(person, address, '/sign-up/complete');
    await person.getByLabel('Password', { exact: true }).fill(NEW_PASSWORD);
    await person.getByRole('button', { name: 'Create account' }).click();
    await signIn(person, address, NEW_PASSWORD);
    await setUpAuthenticator(person);

    await person.goto(link);
    await person.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(person.getByText(address)).toBeVisible();
    await expect(person.getByText('Northfield Foundation').first()).toBeVisible();
    await expect(h1(person, 'Accept your invitation')).toBeHidden();

    // They are on the team now. The administrator suspends them.
    await page.reload();
    await expect(h1(page, 'Team')).toBeVisible();
    await expect(memberRow(page, address)).toContainText('Active');
    await expect(memberRow(page, address)).toContainText('Reviewer');
    await suspendMember(page, address);
    await confirmIfAsked(page, spent);
    await expect(status(page)).toHaveText(`${address} is suspended and signed out.`);

    // Their next request finds them signed out.
    await person.reload();
    await expect(h1(person, 'Sign in')).toBeVisible();
    await context.close();
  });
});
