// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 6 against the real API, with the budget table and the accounts
// file: a programme manager builds the form of a new round, adds a table of
// costs and a file question for the latest accounts, previews them with
// uploading switched off, and publishes version 1. The steps are those of
// forms-builder-table-file.spec.ts, which runs them against a stand-in. It
// needs the stack (`pnpm stack`, then `pnpm test:stack`) and the Northfield
// programme manager from the seed's `base` scenario:
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
  editor,
  h1,
  publishVersionOne,
  saveDraft,
  startDraft,
} from './form-builder-steps.ts';
import {
  addAccountsFile,
  addBudgetTable,
  column,
  previewBudget,
} from './forms-builder-table-file-steps.ts';
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

test.describe('the budget table and file question journey against the real API', () => {
  test.skip(
    process.env['TPS_E2E_STACK'] !== '1',
    'Runs against the stack: pnpm stack, then pnpm test:stack.',
  );
  test.skip(
    EMAIL === undefined || PASSWORD === undefined,
    "Needs the seed's Northfield programme manager: set TPS_E2E_MANAGER_EMAIL and TPS_E2E_MANAGER_PASSWORD.",
  );
  test.setTimeout(300_000);

  test('@api adds a budget table and a file question to a round, previews them, and publishes version 1', async ({
    page,
  }) => {
    await signInAsManager(page);
    await createRound(page);

    await page.goto(`${new URL(page.url()).pathname}/form`);
    await startDraft(page);
    await buildForm(page);
    await addBudgetTable(page);
    await addAccountsFile(page);
    await saveDraft(page);
    await previewBudget(page);

    // What was saved is still there after a reload, with the columns as they were set.
    await page.reload();
    await page.getByRole('button', { name: /^3\. Your budget/ }).click();
    await page
      .getByRole('list', { name: 'Questions' })
      .getByRole('button', { name: /What will it cost/ })
      .click();
    const question = editor(page, 'Edit question');
    await expect(question.getByRole('textbox', { name: 'Name for one row' })).toHaveValue('cost');
    await expect(
      column(question, 2).getByRole('checkbox', { name: 'Add up this column under the table' }),
    ).toBeChecked();
    await expect(column(question, 3).getByRole('textbox', { name: 'Choice 2' })).toHaveValue(
      'Equipment',
    );

    await publishVersionOne(page);
    await checkVersions(page);
  });
});
