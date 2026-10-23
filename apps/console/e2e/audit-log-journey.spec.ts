// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 15 against the real API: the administrator opens the audit log,
// filters it to Grants and the round's dates, and finds the release of
// decisions. The steps are those of audit-log.spec.ts, which runs them against
// a stand-in. It needs the stack (`pnpm stack`, then `pnpm test:stack`), the
// Northfield administrator from the seed's `base` scenario, and a release of
// decisions made in the last 30 days (demo step 14):
//
//   TPS_E2E_ADMIN_EMAIL     the administrator's email address
//   TPS_E2E_ADMIN_PASSWORD  the seed password
//   TPS_E2E_ADMIN_TOTP_KEY  the authenticator key, once it has been set
//                           up. The first run sets it up and prints the
//                           key, which the next runs need.

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { filterToGrantsAndDates, findRelease, h1, openAuditLog } from './audit-log-steps.ts';
import { nextCode } from './auth-totp.ts';

const EMAIL = process.env['TPS_E2E_ADMIN_EMAIL'];
const PASSWORD = process.env['TPS_E2E_ADMIN_PASSWORD'];
const TOTP_KEY = process.env['TPS_E2E_ADMIN_TOTP_KEY'];

/** A day in the funder's time zone, as `YYYY-MM-DD`. */
const day = (daysAgo: number): string =>
  new Date(Date.now() - daysAgo * 86_400_000).toLocaleDateString('en-CA', {
    timeZone: 'Europe/London',
  });

/** Signs in as the administrator, setting up the authenticator app on the first run and using its key after. */
async function signInAsAdministrator(page: Page): Promise<void> {
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
    console.info(`Set TPS_E2E_ADMIN_TOTP_KEY=${key} for the next runs.`);
    await page.getByLabel('Code from your app').fill(await nextCode(key, null));
    await page.getByRole('button', { name: 'Finish set-up' }).click();
  } else {
    await expect(h1(page, 'Enter your code')).toBeVisible();
    await page.getByLabel('Code from your app').fill(await nextCode(TOTP_KEY ?? '', null));
    await page.getByRole('button', { name: 'Confirm code' }).click();
  }
  await expect(
    page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Audit log' }),
  ).toBeVisible();
}

test.describe('the audit log journey against the real API', () => {
  test.skip(
    process.env['TPS_E2E_STACK'] !== '1',
    'Runs against the stack: pnpm stack, then pnpm test:stack.',
  );
  test.skip(
    EMAIL === undefined || PASSWORD === undefined,
    "Needs the seed's Northfield administrator: set TPS_E2E_ADMIN_EMAIL and TPS_E2E_ADMIN_PASSWORD.",
  );
  test.setTimeout(240_000);

  test('@api filters to Grants and the round dates and finds the release', async ({ page }) => {
    await signInAsAdministrator(page);
    await openAuditLog(page);

    await filterToGrantsAndDates(page, day(30), day(0));
    await findRelease(page);
  });
});
