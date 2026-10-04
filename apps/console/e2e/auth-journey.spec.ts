// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The whole sign-in journey against the real API, from sign-up to a password
// reset, reading each emailed link from Mailpit and computing each code from
// the key on the screen, as a person does. It needs the stack: `pnpm stack`,
// then `pnpm test:stack`. The authenticator code check below needs nothing.

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { nextCode, totp } from './auth-totp.ts';

const MAILPIT = process.env['TPS_MAILPIT_URL'] ?? 'http://127.0.0.1:58025';
const PASSWORD = 'a first long passphrase';
const NEW_PASSWORD = 'a second long passphrase';

interface MailpitList {
  messages: { ID: string }[];
}

interface MailpitMessage {
  Text: string;
}

/** The newest emailed link to this address that contains `part`, or null while none has arrived. */
async function emailedLink(address: string, part: string): Promise<string | null> {
  const found = await fetch(
    `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
  );
  const { messages } = (await found.json()) as MailpitList;
  for (const { ID } of messages) {
    const message = (await (
      await fetch(`${MAILPIT}/api/v1/message/${ID}`)
    ).json()) as MailpitMessage;
    const link = message.Text.match(/https?:\/\/[^\s"<>]*#token=[\w-]+/g)?.find((url) =>
      url.slice(0, url.indexOf('#')).endsWith(part),
    );
    if (link) return link;
  }
  return null;
}

async function openEmailedLink(page: Page, address: string, part: string): Promise<void> {
  await expect
    .poll(() => emailedLink(address, part), {
      message: 'The email has not arrived.',
      timeout: 30_000,
    })
    .not.toBeNull();
  const link = await emailedLink(address, part);
  await page.goto(link ?? '');
}

async function signIn(page: Page, address: string, password: string): Promise<void> {
  await page.goto('/northfield/sign-in');
  await page.getByRole('textbox', { name: 'Email address' }).fill(address);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Where a person who has finished MFA lands: the console, or the notice that they have no membership yet. */
const afterMfa = (page: Page) =>
  page
    .getByRole('heading', { level: 1 })
    .filter({ hasText: /^(Programmes|You do not have access to northfield)$/ });

test.describe('authenticator codes', () => {
  // The test values of RFC 6238, appendix B, for the SHA-1 key "12345678901234567890", as six digits.
  const key = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // gitleaks:allow

  test('are worked out as RFC 6238 says', () => {
    expect(totp(key, 59_000)).toBe('287082');
    expect(totp(key, 1_111_111_109_000)).toBe('081804');
    expect(totp(key, 1_111_111_111_000)).toBe('050471');
    expect(totp(key, 1_234_567_890_000)).toBe('005924');
    expect(totp(key, 2_000_000_000_000)).toBe('279037');
    expect(totp(key, 20_000_000_000_000)).toBe('353130');
  });

  test('read a key with spaces and lower case, as shown on the screen', () => {
    expect(totp('gezd gnbv gy3t qojq gezd gnbv gy3t qojq', 59_000)).toBe('287082');
  });
});

test.describe('the journey against the real API', () => {
  test.skip(
    process.env['TPS_E2E_STACK'] !== '1',
    'Runs against the stack: pnpm stack, then pnpm test:stack.',
  );
  test.setTimeout(240_000);

  test('@api signs up, sets a password, sets up MFA, signs out, signs in with a code and resets the password', async ({
    page,
  }) => {
    const address = `journey-${String(Date.now())}@example.org`;

    // Sign up with an email address, then set a password from the emailed link.
    await page.goto('/northfield/sign-up');
    await page.getByRole('textbox', { name: 'Email address' }).fill(address);
    await page.getByRole('button', { name: 'Email me a link' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
    await openEmailedLink(page, address, '/sign-up/complete');
    await expect(page).toHaveURL(/\/northfield\/sign-up\/complete$/);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();

    // The first sign-in asks for an authenticator app. The key is on the screen.
    await signIn(page, address, PASSWORD);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Set up your authenticator app' }),
    ).toBeVisible();
    const key = (
      (await page.getByText(/^[A-Z2-7]{4}( [A-Z2-7]{4})+$/).textContent()) ?? ''
    ).replace(/\s/g, '');
    expect(key).toMatch(/^[A-Z2-7]{16,}$/);
    const first = await nextCode(key, null);
    await page.getByLabel('Code from your app').fill(first);
    await page.getByRole('button', { name: 'Finish set-up' }).click();
    await expect(afterMfa(page)).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'You have signed out' }),
    ).toBeVisible();

    // Signing in again asks for a code. The one just used does not work twice.
    await signIn(page, address, PASSWORD);
    await expect(page.getByRole('heading', { level: 1, name: 'Enter your code' })).toBeVisible();
    const second = await nextCode(key, first);
    await page.getByLabel('Code from your app').fill(second);
    await page.getByRole('button', { name: 'Confirm code' }).click();
    await expect(afterMfa(page)).toBeVisible();
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
    await expect(page.getByRole('heading', { level: 1, name: 'Enter your code' })).toBeVisible();
    await page.getByLabel('Code from your app').fill(await nextCode(key, second));
    await page.getByRole('button', { name: 'Confirm code' }).click();
    await expect(afterMfa(page)).toBeVisible();
  });
});
