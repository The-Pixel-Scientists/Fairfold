// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 9 against the real API: a programme manager filters Northfield's
// submissions by round and status, opens one, comes back to the same list and
// moves five to Review. The steps are those of submissions.spec.ts, which
// runs them against a stand-in. It needs the stack (`pnpm stack`, then
// `pnpm test:stack`) and the seed's `applications` scenario, which holds six
// submitted applications to the Autumn 2026 round, one of them withdrawn:
//
//   TPS_E2E_MANAGER_EMAIL     the programme manager's email address
//   TPS_E2E_MANAGER_PASSWORD  the seed password
//   TPS_E2E_MANAGER_TOTP_KEY  the authenticator key, once it has been set
//                             up. The first run sets it up and prints the
//                             key, which the next runs need.

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { nextCode } from './auth-totp.ts';
import {
  filterByRoundAndStatus,
  h1,
  moveFiveToReview,
  openOneAndReturn,
  openSubmissions,
  submissionRows,
} from './submissions-steps.ts';

const EMAIL = process.env['TPS_E2E_MANAGER_EMAIL'];
const PASSWORD = process.env['TPS_E2E_MANAGER_PASSWORD'];
const TOTP_KEY = process.env['TPS_E2E_MANAGER_TOTP_KEY'];

/** Signs in as the programme manager, setting up the authenticator app on the first run and using its key after. */
async function signInAsManager(page: Page): Promise<void> {
  await page.goto('/northfield/sign-in');
  await page.getByRole('textbox', { name: 'Email address' }).fill(EMAIL ?? '');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();

  if (
    await h1(page, 'Set up your authenticator app')
      .isVisible({ timeout: 10_000 })
      .catch(() => false)
  ) {
    const key = (
      (await page.getByText(/^[A-Z2-7]{4}( [A-Z2-7]{4})+$/).textContent()) ?? ''
    ).replace(/\s/g, '');
    console.info(`Set TPS_E2E_MANAGER_TOTP_KEY=${key} for the next runs.`);
    await page.getByLabel('Code from your app').fill(await nextCode(key, null));
    await page.getByRole('button', { name: 'Finish set-up' }).click();
  } else {
    await expect(h1(page, 'Enter your code')).toBeVisible();
    await page.getByLabel('Code from your app').fill(await nextCode(TOTP_KEY ?? '', null));
    await page.getByRole('button', { name: 'Confirm code' }).click();
  }
  await expect(h1(page, 'Programmes')).toBeVisible();
}

test.describe('the submissions journey against the real API', () => {
  test.skip(
    process.env['TPS_E2E_STACK'] !== '1',
    'Runs against the stack: pnpm stack, then pnpm test:stack.',
  );
  test.skip(
    EMAIL === undefined || PASSWORD === undefined,
    "Needs the seed's Northfield programme manager: set TPS_E2E_MANAGER_EMAIL and TPS_E2E_MANAGER_PASSWORD.",
  );
  test.setTimeout(240_000);

  test('@api filters by round and status, opens one, comes back to the same list and moves five to Review', async ({
    page,
  }) => {
    await signInAsManager(page);
    await openSubmissions(page);
    await expect(submissionRows(page)).toHaveCount(6);

    await filterByRoundAndStatus(page);
    await expect(submissionRows(page)).toHaveCount(5);
    await openOneAndReturn(page);
    await moveFiveToReview(page);

    // Each moved one now stands in Review.
    await expect(submissionRows(page).filter({ hasText: 'Review' })).toHaveCount(5);
  });
});
