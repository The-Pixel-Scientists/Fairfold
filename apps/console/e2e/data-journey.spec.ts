// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 14 against the real API: the administrator opens Data, saves the
// funder's 360Giving details, downloads the 360Giving file and the warehouse
// snapshot, and the snapshot loads into a fresh PostgreSQL with psql and joins
// commitments to organisations and dates. The steps are those of data.spec.ts,
// which runs them against a stand-in. It needs the stack (`pnpm stack`, then
// `pnpm test:stack`), the Northfield administrator from the seed's `base`
// scenario with the programme manager role as well, which choosing a programme
// needs, a release of decisions (demo step 13), and Docker for the throwaway
// PostgreSQL:
//
//   TPS_E2E_ADMIN_EMAIL     the administrator's email address
//   TPS_E2E_ADMIN_PASSWORD  the seed password
//   TPS_E2E_ADMIN_TOTP_KEY  the authenticator key, once it has been set
//                           up. The first run sets it up and prints the
//                           key, which the next runs need.

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { nextCode } from './auth-totp.ts';
import { loadAndQuery } from './data-psql.ts';
import { downloadSnapshot, h1, openData, savePublisher, section } from './data-steps.ts';

const EMAIL = process.env['TPS_E2E_ADMIN_EMAIL'];
const PASSWORD = process.env['TPS_E2E_ADMIN_PASSWORD'];
const TOTP_KEY = process.env['TPS_E2E_ADMIN_TOTP_KEY'];

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
    page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Data' }),
  ).toBeVisible();
}

test.describe('the Data page journey against the real API', () => {
  test.skip(
    process.env['TPS_E2E_STACK'] !== '1',
    'Runs against the stack: pnpm stack, then pnpm test:stack.',
  );
  test.skip(
    EMAIL === undefined || PASSWORD === undefined,
    "Needs the seed's Northfield administrator: set TPS_E2E_ADMIN_EMAIL and TPS_E2E_ADMIN_PASSWORD.",
  );
  test.setTimeout(240_000);

  test('@api saves the details, downloads the 360Giving file and the snapshot, and loads the snapshot with psql', async ({
    page,
  }) => {
    await signInAsAdministrator(page);
    await openData(page);

    const panel = section(page, '360Giving file');
    await savePublisher(page, {
      funderIdentifier: 'GB-CHC-7654321',
      funderName: 'Northfield Foundation',
      identifierPrefix: '360G-northfield',
    });
    const chooser = panel.getByLabel('Awards to include');
    await expect(
      chooser.or(panel.getByText('You cannot choose a programme or round')),
    ).toBeVisible();
    // An administrator who cannot list programmes has no way to choose one yet; the page says so.
    if (await chooser.isVisible()) {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        panel.getByRole('button', { name: 'Download 360Giving file' }).click(),
      ]);
      expect(download.suggestedFilename()).toMatch(/^360giving-[a-z0-9-]+\.json$/);
      await expect(panel.getByText(/^Saved \d+ grants? to 360giving-/)).toBeVisible();
    } else {
      test.info().annotations.push({
        type: 'note',
        description:
          'The administrator cannot choose a programme, so the 360Giving file was not downloaded.',
      });
    }

    const script = await downloadSnapshot(page);
    expect(script).toContain('BEGIN;');
    const joined = await loadAndQuery(
      script,
      'select count(*) from commitment c join organisation o on o.id = c.organisation_id join "date" d on d."date" = c.committed_on',
    );
    expect(Number(joined.trim())).toBeGreaterThan(0);
  });
});
