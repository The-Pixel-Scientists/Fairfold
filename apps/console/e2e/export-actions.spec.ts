// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Export actions against the real API: a programme manager exports the open
// saved view as CSV and creates a board pack of three selected applications;
// the file links return the right type with an attachment disposition; a
// second member cannot reach the first member's status or download; and a
// member without the export permission sees neither action. It needs the
// stack (`pnpm stack`, then `pnpm test:stack`) with the worker and
// SeaweedFS running, the seed's `applications` scenario, and a saved view
// named "Export check" that the manager has saved:
//
//   TPS_E2E_MANAGER_EMAIL / _PASSWORD / _TOTP_KEY   the programme manager
//   TPS_E2E_REVIEWER_EMAIL / _PASSWORD / _TOTP_KEY  a member without the
//                                                   export permission
//   TPS_E2E_ADMIN_EMAIL / _PASSWORD / _TOTP_KEY     a second member who has it

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { nextCode } from './auth-totp.ts';

type Who = 'MANAGER' | 'REVIEWER' | 'ADMIN';

const env = (who: Who, name: 'EMAIL' | 'PASSWORD' | 'TOTP_KEY') =>
  process.env[`TPS_E2E_${who}_${name}`];

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

async function signIn(page: Page, who: Who): Promise<void> {
  await page.goto('/northfield/sign-in');
  await page
    .getByRole('textbox', { name: 'Email address', exact: true })
    .fill(env(who, 'EMAIL') ?? '');
  await page.getByLabel('Password', { exact: true }).fill(env(who, 'PASSWORD') ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(h1(page, 'Enter your code')).toBeVisible();
  await page
    .getByLabel('Code from your app')
    .fill(await nextCode(env(who, 'TOTP_KEY') ?? '', null));
  await page.getByRole('button', { name: 'Confirm code' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

async function openSubmissions(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Submissions' })
    .click();
  await expect(h1(page, 'Submissions')).toBeVisible();
}

/** Confirms it is the person if the route asks for a recent sign-in. */
async function confirmIfAsked(page: Page, who: Who): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Confirm it is you' });
  if (!(await dialog.isVisible({ timeout: 3000 }).catch(() => false))) return;
  await dialog.getByLabel('Password').fill(env(who, 'PASSWORD') ?? '');
  await dialog
    .getByLabel(/Code from your authenticator app/)
    .fill(await nextCode(env(who, 'TOTP_KEY') ?? '', null));
  await dialog.getByRole('button', { name: 'Confirm it is you' }).click();
}

test.describe('export actions against the real API', () => {
  test.skip(
    process.env['TPS_E2E_STACK'] !== '1',
    'Runs against the stack: pnpm stack, then pnpm test:stack.',
  );
  test.skip(
    env('MANAGER', 'EMAIL') === undefined ||
      env('REVIEWER', 'EMAIL') === undefined ||
      env('ADMIN', 'EMAIL') === undefined,
    'Needs the seed members: set the TPS_E2E_MANAGER, _REVIEWER and _ADMIN variables.',
  );
  test.setTimeout(300_000);

  test('@api a manager creates a board pack, and only they can download it', async ({
    page,
    browser,
  }) => {
    await signIn(page, 'MANAGER');
    await openSubmissions(page);
    const rows = page.getByRole('table', { name: 'Submissions' }).locator('tbody > tr');
    for (const row of [0, 1, 2]) {
      await rows.nth(row).getByRole('checkbox').check();
    }
    await expect(page.getByText('3 submissions selected')).toBeVisible();

    await page.getByRole('button', { name: 'Create board pack' }).click();
    await confirmIfAsked(page, 'MANAGER');
    const link = page.getByRole('link', { name: 'Download board pack' });
    await expect(link).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(/^Available until \d{1,2} \w+ \d{4}\./)).toBeVisible();

    const href = (await link.getAttribute('href')) ?? '';
    const file = await page.request.get(href);
    expect(file.status()).toBe(200);
    expect(file.headers()['content-type']).toContain('application/pdf');
    expect(file.headers()['content-disposition']).toContain('attachment');

    const other = await browser.newContext();
    const second = await other.newPage();
    await signIn(second, 'ADMIN');
    expect((await second.request.get(href)).status()).toBe(404);
    await other.close();
  });

  test('@api a manager exports the open saved view as CSV', async ({ page }) => {
    await signIn(page, 'MANAGER');
    await openSubmissions(page);
    await page
      .getByRole('combobox', { name: 'Saved views' })
      .selectOption({ label: 'Export check' });

    await page.getByRole('button', { name: 'Export as CSV' }).click();
    await confirmIfAsked(page, 'MANAGER');
    await expect(
      page.getByRole('status').filter({ hasText: 'Your CSV export is ready' }),
    ).toBeAttached({
      timeout: 120_000,
    });
    const link = page.getByRole('link', { name: 'Download CSV export' });
    const file = await page.request.get((await link.getAttribute('href')) ?? '');
    expect(file.status()).toBe(200);
    expect(file.headers()['content-type']).toContain('text/csv');
    expect(file.headers()['content-disposition']).toContain('attachment');
  });

  test('@api a member without the permission sees neither action', async ({ page }) => {
    await signIn(page, 'REVIEWER');
    await openSubmissions(page);
    await expect(page.getByRole('button', { name: 'Export as CSV' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create board pack' })).toHaveCount(0);
  });
});
