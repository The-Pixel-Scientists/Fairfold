// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The approve journey against the real API: a second member opens the inbox,
// approves a pending request the first made, after step-up, and the request
// reads as approved; the requester sees no approve button for it. It needs
// the stack (`pnpm stack`, then `pnpm test:stack`) and a pending request made
// by the first member, with two synthetic members who each hold the approvals
// permissions. No seed makes the request yet, so the spec skips without:
//
//   TPS_E2E_APPROVAL_ID            the pending request's id
//   TPS_E2E_REQUESTER_EMAIL        the member who made it
//   TPS_E2E_REQUESTER_PASSWORD     their password
//   TPS_E2E_REQUESTER_TOTP_KEY     their authenticator key
//   TPS_E2E_APPROVER_EMAIL         the second member
//   TPS_E2E_APPROVER_PASSWORD      their password
//   TPS_E2E_APPROVER_TOTP_KEY      their authenticator key

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { nextCode } from './auth-totp.ts';

const env = (name: string) => process.env[`TPS_E2E_${name}`];
const REQUEST = env('APPROVAL_ID');
const requester = {
  email: env('REQUESTER_EMAIL'),
  password: env('REQUESTER_PASSWORD'),
  key: env('REQUESTER_TOTP_KEY'),
};
const approver = {
  email: env('APPROVER_EMAIL'),
  password: env('APPROVER_PASSWORD'),
  key: env('APPROVER_TOTP_KEY'),
};

interface Member {
  email: string | undefined;
  password: string | undefined;
  key: string | undefined;
}

/** Signs in and gives the last code used, as each code works once. */
async function signIn(page: Page, { email, password, key }: Member): Promise<string> {
  await page.goto('/northfield/sign-in');
  await page.getByRole('textbox', { name: 'Email address', exact: true }).fill(email ?? '');
  await page.getByLabel('Password', { exact: true }).fill(password ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  const code = await nextCode(key ?? '', null);
  await page.getByLabel('Code from your app').fill(code);
  await page.getByRole('button', { name: 'Confirm code' }).click();
  await expect(
    page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Approvals' }),
  ).toBeVisible();
  return code;
}

test.describe('the approve journey against the real API', () => {
  test.skip(
    process.env['TPS_E2E_STACK'] !== '1',
    'Runs against the stack: pnpm stack, then pnpm test:stack.',
  );
  test.skip(
    [REQUEST, ...Object.values(requester), ...Object.values(approver)].includes(undefined),
    'Needs a pending approval request and two synthetic members: see the variables at the top of this file.',
  );
  test.setTimeout(240_000);

  test('@api a second member approves a request, and the requester cannot', async ({
    browser,
    page,
  }) => {
    const spent = await signIn(page, approver);
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Approvals' })
      .click();
    await page
      .getByRole('link', { name: /approval/i })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/approvals/${REQUEST ?? ''}$`));

    await page.getByRole('button', { name: 'Approve request' }).click();
    await page
      .getByRole('dialog', { name: 'Approve this request?' })
      .getByRole('button', { name: 'Approve request' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Confirm it is you' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Password').fill(approver.password ?? '');
    await dialog
      .getByLabel('Code from your authenticator app')
      .fill(await nextCode(approver.key ?? '', spent));
    await dialog.getByRole('button', { name: 'Confirm it is you' }).click();

    await expect(page.getByRole('status').filter({ hasText: 'Request approved' })).toBeVisible();
    await page.reload();
    await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();

    const context = await browser.newContext();
    const own = await context.newPage();
    await signIn(own, requester);
    await own.goto(`/northfield/approvals/${REQUEST ?? ''}`);
    await expect(own.getByRole('heading', { level: 1, name: 'Approval request' })).toBeVisible();
    await expect(own.getByRole('button', { name: 'Approve request' })).toHaveCount(0);
    await context.close();
  });
});
