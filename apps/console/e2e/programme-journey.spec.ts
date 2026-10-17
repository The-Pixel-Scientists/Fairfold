// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 5 against the real API: a programme manager sets up Community
// Spaces Fund with a round from 12 October to 2 November (Europe/London), a
// budget of £150,000, awards of £5,000 to £25,000, the stages Intake, Review
// and Decision, a rubric of three weighted criteria scored 1 to 5, and an
// outcome email, and sees each change in the configuration history. The steps
// are those of programme.spec.ts, which runs them against a stand-in. It needs
// the stack (`pnpm stack`, then `pnpm test:stack`) and the Northfield
// programme manager from the seed's `base` scenario, who has no programmes:
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
  addRound,
  addRubric,
  changeEmail,
  checkHistory,
  createProgramme,
  h1,
} from './programme-steps.ts';

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

test.describe('the programme set-up journey against the real API', () => {
  test.skip(
    process.env['TPS_E2E_STACK'] !== '1',
    'Runs against the stack: pnpm stack, then pnpm test:stack.',
  );
  test.skip(
    EMAIL === undefined || PASSWORD === undefined,
    "Needs the seed's Northfield programme manager: set TPS_E2E_MANAGER_EMAIL and TPS_E2E_MANAGER_PASSWORD.",
  );
  test.setTimeout(240_000);

  test('@api sets up Community Spaces Fund with a round, a rubric and an email, and finds each change in the history', async ({
    page,
  }) => {
    await signInAsManager(page);
    await expect(page.getByRole('heading', { level: 2, name: 'No programmes yet' })).toBeVisible();

    await createProgramme(page);
    await addRound(page);
    await addRubric(page);
    await changeEmail(page, 'Community Spaces Fund');
    await checkHistory(page);

    // The list shows the programme with the round, and it is still there after a reload.
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Programmes' })
      .click();
    await page.reload();
    const row = page.getByRole('row', { name: /Community Spaces Fund/ });
    await expect(row).toContainText('Autumn 2026');
    await expect(row).toContainText('£150,000');
  });
});
