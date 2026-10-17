// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 6 against the real API: a programme manager builds the form of a
// new round with three sections, a question that stops applicants who are not
// eligible, a question that depends on an answer, a word limit, and contact
// answers hidden from reviewers, previews it as an applicant sees it, and
// publishes version 1. The steps are those of form-builder.spec.ts, which runs
// them against a stand-in. The budget table and the accounts file come with
// S05-11. It needs the stack (`pnpm stack`, then `pnpm test:stack`) and the
// Northfield programme manager from the seed's `base` scenario:
//
//   TPS_E2E_MANAGER_EMAIL     the programme manager's email address
//   TPS_E2E_MANAGER_PASSWORD  the seed password
//   TPS_E2E_MANAGER_TOTP_KEY  the authenticator key, once it has been set
//                             up. The first run sets it up and prints the
//                             key, which the next runs need.

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { nextCode } from './auth-totp.ts';
import {
  buildForm,
  checkVersions,
  h1,
  previewForm,
  publishVersionOne,
  saveDraft,
  startDraft,
} from './form-builder-steps.ts';
import { addRound } from './programme-steps.ts';

const expect = strictExpect.configure({ timeout: 15_000 });

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

/** Creates a programme and its round, and arrives on the round's own page. */
async function createRound(page: Page): Promise<void> {
  await page.goto('/northfield/programmes/new');
  await expect(h1(page, 'New programme')).toBeVisible();
  await page.getByRole('textbox', { name: 'Title' }).fill('Community Spaces Fund');
  await page
    .getByRole('textbox', { name: 'Summary' })
    .fill('Grants for places where neighbours meet.');
  await page.getByRole('radio', { name: 'Open' }).check();
  await page.getByRole('button', { name: 'Create programme' }).click();
  await expect(h1(page, 'Community Spaces Fund')).toBeFocused();
  await addRound(page);
}

test.describe('the form builder journey against the real API', () => {
  test.skip(
    process.env['TPS_E2E_STACK'] !== '1',
    'Runs against the stack: pnpm stack, then pnpm test:stack.',
  );
  test.skip(
    EMAIL === undefined || PASSWORD === undefined,
    "Needs the seed's Northfield programme manager: set TPS_E2E_MANAGER_EMAIL and TPS_E2E_MANAGER_PASSWORD.",
  );
  test.setTimeout(240_000);

  test('@api builds the form of a round, previews it as an applicant sees it, and publishes version 1', async ({
    page,
  }) => {
    await signInAsManager(page);
    await createRound(page);

    await page.goto(`${new URL(page.url()).pathname}/form`);
    await startDraft(page);
    await buildForm(page);
    await saveDraft(page);
    await previewForm(page);

    // What was saved is still there after a reload.
    await page.reload();
    await expect(page.getByRole('button', { name: /^3\. Your budget/ })).toBeVisible();
    await expect(page.getByText(/^Saved \d+ \w+ \d{4} at /)).toBeVisible();

    await publishVersionOne(page);
    await checkVersions(page);
  });
});
