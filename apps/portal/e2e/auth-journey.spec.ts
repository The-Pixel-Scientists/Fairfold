// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The whole applicant journey against the real API, from creating an account
// to resetting the password, reading each emailed link from Mailpit as a
// person reads their inbox. It needs the stack: `pnpm stack`, then
// `pnpm test:stack -- portal`.

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { createAccount, openEmailedLink, signIn } from './mailpit.ts';

const PASSWORD = 'a first long passphrase';
const NEW_PASSWORD = 'a second long passphrase';

test.describe('the journey against the real API', () => {
  test.skip(
    process.env['TPS_E2E_STACK'] !== '1',
    'Runs against the stack: pnpm stack, then pnpm test:stack -- portal.',
  );
  test.setTimeout(240_000);

  test('@api creates an account, sets a password, signs in, signs out and resets the password', async ({
    page,
  }) => {
    const address = `applicant-${String(Date.now())}@example.org`;

    // Create an account with an email address, then set a password from the emailed link.
    await createAccount(page, address, PASSWORD);

    // Sign in. An applicant has no second step, so the applicant page opens straight away.
    await signIn(page, address, PASSWORD);
    await expect(page.getByRole('heading', { level: 1, name: 'Apply for a grant' })).toBeVisible();
    await expect(page.getByRole('banner')).toContainText(address);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'You have signed out' }),
    ).toBeVisible();

    // Reset the password from the emailed link, then sign in with the new one.
    await page.goto('/northfield/forgot-password');
    await page.getByRole('textbox', { name: 'Email address' }).fill(address);
    await page.getByRole('button', { name: 'Email me a reset link' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
    await openEmailedLink(page, address, '/reset-password');
    await expect(page).toHaveURL(/\/northfield\/reset-password$/);
    await page.getByLabel('Password', { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(
      page.getByText('Your password has changed. Sign in with your new password.'),
    ).toBeVisible();
    await signIn(page, address, NEW_PASSWORD);
    await expect(page.getByRole('heading', { level: 1, name: 'Apply for a grant' })).toBeVisible();

    // The old password no longer works, and the refusal says nothing about why.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await signIn(page, address, PASSWORD);
    await expect(page.getByRole('alert', { name: 'There is a problem' })).toContainText(
      'The email address or password is not right.',
    );
  });
});
