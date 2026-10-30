// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo steps 12 and 13 against the real API: a programme manager records one
// decision on a submission's page and the rest in bulk, sees that they are
// private, then releases them after confirming it is them, and the applicants'
// emails reach Mailpit. The steps are those of decisions.spec.ts, which runs
// them against a stand-in. It needs the stack (`pnpm stack`, then
// `pnpm test:stack -- decisions`) and the seed's `applications` scenario, which
// holds six submitted applications to the Autumn 2026 round, one of them
// withdrawn, with Northfield's reviewers assigned to those in Review:
//
//   TPS_E2E_MANAGER_EMAIL     the programme manager's email address
//   TPS_E2E_MANAGER_PASSWORD  the seed password
//   TPS_E2E_MANAGER_TOTP_KEY  the authenticator key, once it has been set
//                             up. The first run sets it up and prints the
//                             key, which the next runs need.
//
// That the applicant still sees "Under review" until release, and the award
// after it, is checked from their side in the portal's outcome journey
// (apps/portal/e2e/outcome-journey.spec.ts).

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { nextCode } from './auth-totp.ts';
import {
  decisionRows,
  decisionsTable,
  expectBudgetWords,
  expectReleased,
  h1,
  openDecisions,
  openFirstSubmission,
  recordAwardFromTheDetail,
  recordSeveral,
  startRelease,
} from './decisions-steps.ts';
import { confirmItsYou } from './team-steps.ts';

const EMAIL = process.env['TPS_E2E_MANAGER_EMAIL'];
const PASSWORD = process.env['TPS_E2E_MANAGER_PASSWORD'];
const TOTP_KEY = process.env['TPS_E2E_MANAGER_TOTP_KEY'];
const MAILPIT = process.env['TPS_MAILPIT_URL'] ?? 'http://127.0.0.1:58025';

/** The decision emails in Mailpit: their subjects say which outcome they tell of. */
async function decisionEmails(): Promise<number> {
  const query = encodeURIComponent('subject:"Community Spaces Fund:"');
  const found = await fetch(`${MAILPIT}/api/v1/search?query=${query}`);
  const { messages_count: count } = (await found.json()) as { messages_count: number };
  return count;
}

/** Signs in as the programme manager, setting up the authenticator app on the first run and using its key after. Gives the last code used. */
async function signInAsManager(page: Page): Promise<string> {
  await page.goto('/northfield/sign-in');
  await page.getByRole('textbox', { name: 'Email address' }).fill(EMAIL ?? '');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();

  let code: string;
  if (
    await h1(page, 'Set up your authenticator app')
      .isVisible({ timeout: 10_000 })
      .catch(() => false)
  ) {
    const key = (
      (await page.getByText(/^[A-Z2-7]{4}( [A-Z2-7]{4})+$/).textContent()) ?? ''
    ).replace(/\s/g, '');
    console.info(`Set TPS_E2E_MANAGER_TOTP_KEY=${key} for the next runs.`);
    code = await nextCode(key, null);
    await page.getByLabel('Code from your app').fill(code);
    await page.getByRole('button', { name: 'Finish set-up' }).click();
  } else {
    await expect(h1(page, 'Enter your code')).toBeVisible();
    code = await nextCode(TOTP_KEY ?? '', null);
    await page.getByLabel('Code from your app').fill(code);
    await page.getByRole('button', { name: 'Confirm code' }).click();
  }
  await expect(h1(page, 'Programmes')).toBeVisible();
  return code;
}

test.describe('the decisions journey against the real API', () => {
  test.skip(
    process.env['TPS_E2E_STACK'] !== '1',
    'Runs against the stack: pnpm stack, then pnpm test:stack -- decisions.',
  );
  test.skip(
    EMAIL === undefined || PASSWORD === undefined || TOTP_KEY === undefined,
    "Needs the seed's Northfield programme manager: set TPS_E2E_MANAGER_EMAIL, TPS_E2E_MANAGER_PASSWORD and TPS_E2E_MANAGER_TOTP_KEY.",
  );
  test.setTimeout(300_000);

  test('@api records singly and in bulk, keeps them private, and releases with step-up so the emails go', async ({
    page,
  }) => {
    const spent = await signInAsManager(page);
    const before = await decisionEmails();

    // Step 12: one award from the submission's page, the rest in bulk. Nothing goes to applicants.
    await openFirstSubmission(page);
    await recordAwardFromTheDetail(page, '12,500');
    await openDecisions(page);
    await expectBudgetWords(page, /^£12,500 of £[\d,]+, £[\d,]+ left$/);
    await recordSeveral(page, 2, 'Waitlisted');
    await recordSeveral(page, 2, 'Declined');
    await expect(decisionsTable(page).getByText('Released', { exact: true })).toHaveCount(0);
    expect(await decisionEmails()).toBe(before);

    // Step 13: release after confirming it is them.
    await startRelease(page);
    await confirmItsYou(page, PASSWORD ?? '', await nextCode(TOTP_KEY ?? '', spent));
    await expectReleased(page);

    await expect.poll(decisionEmails, { message: 'The emails have not arrived.' }).toBe(before + 5);
    await page.getByRole('link', { name: 'Back to decisions' }).click();
    await expect(decisionRows(page).filter({ hasText: 'Email: sent' })).toHaveCount(5);
  });
});
