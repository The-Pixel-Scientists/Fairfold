// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The account security page in a real browser, with the API's answers
// stubbed from the contracts: a stand-in that asks for step-up until the
// person has confirmed it is them, as the real routes do. Axe checks run at
// desktop width, 320 px and 200% zoom. The `@api` journey runs against the
// stack (`pnpm stack`, then `pnpm test:stack`) with a virtual authenticator,
// and needs the Northfield administrator the team journey uses. Every spec
// also fails on a Content Security Policy violation under console-production.

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { consoleSession, problem, stubSignedIn } from './auth-api.ts';
import type { Handler, Reply } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, widths } from './auth-axe.ts';
import { nextCode } from './auth-totp.ts';
import { confirmItsYou, h1 } from './team-steps.ts';

const expect = strictExpect.configure({ timeout: 15_000 });

const STEP_UP_NEEDED = 'Confirm it is you again, then try again.';
const LAST_FACTOR =
  'You need another authenticator to sign in to the staff console. Add one first, then remove this one.';
const CODES = [
  'abcde-fghjk',
  'mnpqr-stvwx',
  'yz012-34567',
  '89abc-defgh',
  'jkmnp-qrstv',
  'wxyz0-12345',
  '6789a-bcdef',
  'ghjkm-npqrs',
  'tvwxy-z0123',
  '45678-9abcd',
];
const passkey = {
  id: '4a1b2c3d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  name: 'Work laptop',
  createdAt: '2026-10-01T09:00:00.000Z',
  lastUsedAt: null,
};

const ok = (body: unknown): Reply => ({ status: 200, body });

/** Changes are refused until the person has confirmed it is them. */
function stubSecurity(page: Page, more: Record<string, Handler> = {}) {
  let recent = false;
  const gated =
    (reply: Handler): Handler =>
    (body) =>
      recent ? (typeof reply === 'function' ? reply(body) : reply) : problem(403, STEP_UP_NEEDED);
  return stubSignedIn(
    page,
    {},
    {
      'GET /auth/passkeys': ok({ passkeys: [passkey] }),
      'GET /auth/backup-codes': ok({ remaining: 4 }),
      // Confirming it is you answers with the same signed-in session, now fresh.
      'POST /auth/step-up': () => {
        recent = true;
        return ok({ ...consoleSession(), recentAuthUntil: '2099-01-01T00:00:00.000Z' });
      },
      'POST /auth/backup-codes': gated(ok({ codes: CODES })),
      'POST /auth/account/email': gated({ status: 202 }),
      'POST /auth/account/password': gated({ status: 204 }),
      [`DELETE /auth/passkeys/${passkey.id}`]: gated({ status: 204 }),
      ...more,
    },
  );
}

const openPage = async (page: Page) => {
  await page.goto('/northfield/account/security');
  await expect(h1(page, 'Account security')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Your passkeys' })).toBeVisible();
};

const section = (page: Page, name: string) => page.getByRole('region', { name });

test.describe('the account security page', () => {
  test('shows the five sections and is reached from the account controls', async ({ page }) => {
    await stubSecurity(page);
    await page.goto('/northfield/settings');
    await page.getByRole('link', { name: 'Account security' }).click();

    await expect(h1(page, 'Account security')).toBeFocused();
    for (const name of [
      'Passkeys',
      'Authenticator app',
      'Backup codes',
      'Email address',
      'Password',
    ]) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
    }
    await expect(section(page, 'Passkeys')).toContainText('Work laptop');
    await expect(section(page, 'Backup codes')).toContainText('You have 4 backup codes left.');
  });

  test('removes a passkey after confirming it is them', async ({ page }) => {
    const sent = await stubSecurity(page);
    await openPage(page);

    await page.getByRole('button', { name: 'Remove passkey Work laptop' }).click();
    await page
      .getByRole('dialog', { name: 'Remove this passkey?' })
      .getByRole('button', { name: 'Remove passkey' })
      .click();
    await confirmItsYou(page, 'correct horse battery', '123456');

    await expect(section(page, 'Passkeys')).toContainText('Passkey Work laptop removed.');
    await expect(page.getByRole('heading', { level: 2, name: 'Passkeys' })).toBeFocused();
    await expect(page.getByRole('list', { name: 'Your passkeys' })).toBeHidden();
    expect(sent.filter(({ key }) => key.startsWith('DELETE')).length).toBe(2);
  });

  test('shows the last-factor refusal in the server words and keeps the button', async ({
    page,
  }) => {
    await stubSecurity(page, {
      [`DELETE /auth/passkeys/${passkey.id}`]: problem(409, LAST_FACTOR),
    });
    await openPage(page);

    await page.getByRole('button', { name: 'Remove passkey Work laptop' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove passkey' }).click();

    await expect(page.getByRole('alert', { name: 'There is a problem' })).toContainText(
      LAST_FACTOR,
    );
    await expect(page.getByRole('button', { name: 'Remove passkey Work laptop' })).toBeVisible();
  });

  test('shows backup codes once, with no trace in the address or storage', async ({ page }) => {
    await stubSecurity(page);
    await openPage(page);

    await page.getByRole('button', { name: 'Generate new backup codes' }).click();
    await confirmItsYou(page, 'correct horse battery', '123456');

    const list = page.getByRole('group', { name: 'Your backup codes' });
    await expect(list).toBeFocused();
    await expect(list).toContainText(CODES[0] ?? '');
    expect(page.url()).not.toContain(CODES[0]);
    const stored = await page.evaluate(() =>
      JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage), history.state]),
    );
    expect(stored).not.toContain(CODES[0]);
    await expect(page).toHaveTitle(/^Account security/);

    await page.getByRole('link', { name: 'Programmes' }).first().click();
    await expect(h1(page, 'Programmes')).toBeVisible();
    await expect(page.getByText(CODES[0] ?? '')).toBeHidden();
    await page.goBack();
    await expect(page.getByText(CODES[0] ?? '')).toBeHidden();
  });

  test('says check your email whatever the address', async ({ page }) => {
    await stubSecurity(page);
    await openPage(page);

    await page.getByLabel('New email address').fill('taken@example.org');
    await page.getByRole('button', { name: 'Change email address' }).click();
    await confirmItsYou(page, 'correct horse battery', '123456');

    await expect(section(page, 'Email address')).toContainText('Check your email.');
    await expect(
      page.getByRole('heading', { level: 2, name: 'Email address', exact: true }),
    ).toBeFocused();
  });

  test('changes the password and clears the field', async ({ page }) => {
    await stubSecurity(page);
    await openPage(page);

    await page
      .getByRole('textbox', { name: 'Password', exact: true })
      .fill('a new long passphrase');
    await page.getByRole('button', { name: 'Change password' }).click();
    await confirmItsYou(page, 'correct horse battery', '123456');

    await expect(section(page, 'Password')).toContainText(
      'Anywhere else you were signed in is signed out.',
    );
    await expect(page.getByRole('textbox', { name: 'Password', exact: true })).toHaveValue('');
    await expect(page.getByRole('heading', { level: 2, name: 'Password' })).toBeFocused();
  });

  test('the email link page changes nothing until the button is pressed, and clears the token', async ({
    page,
  }) => {
    const sent = await stubSecurity(page, { 'POST /auth/email-change/complete': { status: 204 } });
    await page.goto('/northfield/email-change#token=tok_0123456789abcdefghijklmnopqrstuvwxyz');

    await expect(h1(page, 'Confirm your new email address')).toBeVisible();
    expect(page.url()).not.toContain('token');
    expect(sent.some(({ key }) => key.includes('email-change'))).toBe(false);

    await page.getByRole('button', { name: 'Confirm new email address' }).click();
    await expect(h1(page, 'Your email address has changed')).toBeFocused();
    expect(sent.find(({ key }) => key.includes('email-change'))?.body).toEqual({
      token: 'tok_0123456789abcdefghijklmnopqrstuvwxyz',
    });
  });
});

for (const width of widths) {
  test.describe(`at ${width.name}`, () => {
    test.use({ viewport: width.viewport, deviceScaleFactor: width.deviceScaleFactor });

    test('@a11y the page has no axe violations', async ({ page }) => {
      await stubSecurity(page);
      await openPage(page);
      await expectNoViolations(page);
      await expectNoHorizontalScroll(page);
    });

    test('@a11y the backup codes have no axe violations', async ({ page }) => {
      await stubSecurity(page);
      await openPage(page);
      await page.getByRole('button', { name: 'Generate new backup codes' }).click();
      await confirmItsYou(page, 'correct horse battery', '123456');
      await expect(page.getByRole('group', { name: 'Your backup codes' })).toBeVisible();
      await expectNoViolations(page);
      await expectNoHorizontalScroll(page);
    });

    test('@a11y the last-factor refusal has no axe violations', async ({ page }) => {
      await stubSecurity(page, {
        [`DELETE /auth/passkeys/${passkey.id}`]: problem(409, LAST_FACTOR),
      });
      await openPage(page);
      await page.getByRole('button', { name: 'Remove passkey Work laptop' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Remove passkey' }).click();
      await expect(page.getByRole('alert', { name: 'There is a problem' })).toBeVisible();
      await expectNoViolations(page);
    });

    test('@a11y the remove confirmation has no axe violations', async ({ page }) => {
      await stubSecurity(page);
      await openPage(page);
      await page.getByRole('button', { name: 'Remove passkey Work laptop' }).click();
      await expect(page.getByRole('dialog', { name: 'Remove this passkey?' })).toBeVisible();
      await expectNoViolations(page);
    });

    test('@a11y the email link page has no axe violations', async ({ page }) => {
      await stubSecurity(page);
      await page.goto('/northfield/email-change#token=tok_0123456789abcdefghijklmnopqrstuvwxyz');
      await expect(h1(page, 'Confirm your new email address')).toBeVisible();
      await expectNoViolations(page);
      await expectNoHorizontalScroll(page);
    });
  });
}

const EMAIL = process.env['TPS_E2E_ADMIN_EMAIL'];
const PASSWORD = process.env['TPS_E2E_ADMIN_PASSWORD'];
const TOTP_KEY = process.env['TPS_E2E_ADMIN_TOTP_KEY'];

test.describe('@api the journey on the stack', () => {
  test.skip(
    EMAIL === undefined || PASSWORD === undefined || TOTP_KEY === undefined,
    'Needs the stack and the administrator from the seed.',
  );

  test('adds a passkey, then makes backup codes', async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
      },
    });
    await page.goto('/northfield/sign-in');
    await page.getByRole('textbox', { name: 'Email address', exact: true }).fill(EMAIL ?? '');
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(PASSWORD ?? '');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByLabel('Code from your app').fill(await nextCode(TOTP_KEY ?? '', null));
    await page.getByRole('button', { name: 'Confirm code' }).click();
    await page.goto('/northfield/account/security');

    const stepUp = async () => {
      const dialog = page.getByRole('dialog', { name: 'Confirm it is you' });
      await dialog.getByLabel('Password').fill(PASSWORD ?? '');
      await dialog
        .getByLabel('Code from your authenticator app')
        .fill(await nextCode(TOTP_KEY ?? '', null));
      await dialog.getByRole('button', { name: 'Confirm it is you' }).click();
    };

    await page.getByLabel('Name for the passkey').fill('Virtual key');
    await page.getByRole('button', { name: 'Add a passkey' }).click();
    await stepUp();
    await expect(section(page, 'Passkeys')).toContainText('Passkey Virtual key added.');

    await page.getByRole('button', { name: /^Generate (new )?backup codes$/ }).click();
    await expect(page.getByRole('group', { name: 'Your backup codes' })).toBeVisible();
  });
});
