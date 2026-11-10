// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Passkeys for staff (ADR 0010), with a Chromium virtual authenticator: CTAP2,
// internal, resident keys and user verification on. Adding and removing go
// through the console's security page; signing in with a passkey is driven in
// the page that holds the authenticator, as the console has no screen for it
// yet. Each test adds its own authenticator and removes it at the end.

import type { Page } from '@playwright/test';

import { expectNoViolations } from '../../apps/portal/e2e/axe.ts';
import { signInStaff } from '../support/api.ts';
import { auditEvents } from '../support/audit.ts';
import { subjectsTo } from '../support/mail.ts';
import { person, updateState } from '../support/state.ts';
import { expect, h1, inOrder, test } from '../support/test.ts';
import {
  afterTheJourney,
  confirmIfAsked,
  createStaff,
  deleteMessagesTo,
  membershipOf,
} from './people.ts';
import { addAuthenticator, postInPage, signWithPasskey, type Authenticator } from './webauthn.ts';

inOrder();
afterTheJourney();

const WHO = 'passkeyManager';
const SECURITY = '/northfield/account/security';

const countOf = async (action: string) => {
  const admin = await signInStaff('northfield', 'colleague');
  const events = await auditEvents(admin, { action });
  await admin.dispose();
  return events;
};

const hasSubject = async (pattern: RegExp) =>
  (await subjectsTo(person(WHO).email)).some((subject) => pattern.test(subject));

async function addInPage(page: Page, name: string): Promise<void> {
  await page.goto(SECURITY);
  await expect(h1(page, 'Account security')).toBeVisible();
  await page.getByRole('textbox', { name: 'Name for the passkey' }).fill(name);
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await confirmIfAsked(page, WHO, page.getByText(`Passkey ${name} added.`, { exact: true }));
}

/** Runs a test body with a virtual authenticator on the page, and removes it afterwards. */
async function withAuthenticator(
  page: Page,
  body: (authenticator: Authenticator) => Promise<void>,
): Promise<void> {
  const authenticator = await addAuthenticator(page);
  try {
    await body(authenticator);
  } finally {
    await authenticator.remove();
  }
}

/** Password first, then the passkey as the second factor. */
async function signInWithPasswordAndPasskey(page: Page) {
  const { email, password } = person(WHO);
  const first = await postInPage(page, '/auth/tenants/northfield/sign-in', { email, password });
  expect(first.status).toBe(200);
  return signWithPasskey(page, {
    optionsPath: '/auth/passkey-mfa/options',
    finishPath: '/auth/passkey-mfa',
  });
}

test.describe('staff passkeys', () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    await createStaff(WHO, 'programme_manager');
  });

  test.afterAll(async () => {
    await deleteMessagesTo(person(WHO).email);
  });

  test('the last authenticator cannot be removed, and the server’s reason is shown', async ({
    pages,
  }) => {
    const page = await pages.staff(WHO);
    await page.goto(SECURITY);
    await page.getByRole('button', { name: 'Remove authenticator app' }).click();
    const dialog = page.getByRole('dialog', { name: 'Remove your authenticator app?' });
    await dialog.getByRole('button', { name: 'Remove authenticator app' }).click();
    const reason = page.getByText(/You need another authenticator to sign in to the staff console/);
    await confirmIfAsked(page, WHO, reason.first());
    await expect(reason.first()).toBeVisible();
    expect((await page.request.get('/api/console/team')).ok()).toBe(true);
  });

  test('@a11y a manager adds a passkey after step-up and signs in with it as their second factor', async ({
    pages,
  }) => {
    const page = await pages.staff(WHO);
    const before = (await countOf('platform.auth.passkey_added')).length;
    await withAuthenticator(page, async () => {
      await page.goto(SECURITY);
      await expect(page.getByText('You have no passkeys.')).toBeVisible();
      await expectNoViolations(page);
      await addInPage(page, 'Work laptop');
      await expect(page.getByRole('list', { name: 'Your passkeys' })).toContainText('Work laptop');
      await expectNoViolations(page);

      const listed = await page.request.get('/api/auth/passkeys');
      const { passkeys } = (await listed.json()) as { passkeys: { id: string }[] };
      expect(passkeys).toHaveLength(1);

      await expect
        .poll(async () => (await countOf('platform.auth.passkey_added')).length)
        .toBe(before + 1);
      const events = await countOf('platform.auth.passkey_added');
      const membership = await membershipOf(WHO);
      expect(events[0]?.actor).toMatchObject({ kind: 'user', membershipId: membership });
      const text = JSON.stringify(events);
      expect(text.includes(passkeys[0]?.id ?? '#'), 'the passkey is in the event').toBe(false);
      expect(text).not.toMatch(/publicKey|credentialId/i);
      await expect.poll(() => hasSubject(/passkey.*added|added.*passkey/i)).toBe(true);

      await postInPage(page, '/auth/sign-out');
      const signedIn = await signInWithPasswordAndPasskey(page);
      expect(signedIn).toMatchObject({ stage: 'finish', status: 200 });
      await page.goto('/northfield/team');
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    });
  });

  test('a passkey that is not verified by the user is refused, and nothing is added', async ({
    pages,
  }) => {
    const page = await pages.staff(WHO);
    await withAuthenticator(page, async (authenticator) => {
      await addInPage(page, 'Phone');
      await postInPage(page, '/auth/sign-out');

      await authenticator.verifyUser(false);
      const refused = await signInWithPasswordAndPasskey(page);
      expect(
        refused.stage === 'finish' && refused.status === 200,
        'a passkey without user verification signed in',
      ).toBe(false);
      expect((await page.request.get('/api/console/team')).status()).toBe(401);

      await authenticator.verifyUser(true);
      await postInPage(page, '/auth/sign-out');
      expect(await signInWithPasswordAndPasskey(page)).toMatchObject({ status: 200 });
      await authenticator.verifyUser(false);
      await page.goto(SECURITY);
      const before = await page.request.get('/api/auth/passkeys');
      const count = ((await before.json()) as { passkeys: unknown[] }).passkeys.length;
      await page.getByRole('textbox', { name: 'Name for the passkey' }).fill('Unverified');
      await page.getByRole('button', { name: 'Add a passkey' }).click();
      const reason = page.getByText(/nothing has changed/).first();
      await confirmIfAsked(page, WHO, reason);
      await expect(reason).toBeVisible();
      await expectNoViolations(page);
      const after = await page.request.get('/api/auth/passkeys');
      expect(((await after.json()) as { passkeys: unknown[] }).passkeys).toHaveLength(count);
    });
  });

  test('removing a passkey needs step-up, is audited and emailed, and signs out the other browser', async ({
    pages,
  }) => {
    const page = await pages.staff(WHO);
    await withAuthenticator(page, async () => {
      await addInPage(page, 'Spare key');
      const other = await pages.staff(WHO, 'northfield', true);
      expect((await other.request.get('/api/console/team')).ok()).toBe(true);
      const before = (await countOf('platform.auth.passkey_removed')).length;

      await page.goto(SECURITY);
      await page.getByRole('button', { name: 'Remove passkey Spare key' }).click();
      await page
        .getByRole('dialog', { name: 'Remove this passkey?' })
        .getByRole('button', { name: 'Remove passkey' })
        .click();
      await confirmIfAsked(
        page,
        WHO,
        page.getByText('Passkey Spare key removed.', { exact: true }),
      );

      expect((await other.request.get('/api/console/team')).status()).toBe(401);
      await expect
        .poll(async () => (await countOf('platform.auth.passkey_removed')).length)
        .toBe(before + 1);
      await expect.poll(() => hasSubject(/A passkey was removed from your/)).toBe(true);
    });
  });

  // Last: wrong passwords delay this account's password sign-in.
  test('a passkey signs in while password sign-in is delayed by failed attempts', async ({
    pages,
  }) => {
    const page = await pages.staff(WHO);
    await withAuthenticator(page, async () => {
      await addInPage(page, 'Delay key');
      // The next spec file names this passkey's id from another funder's session.
      const listed = (await (await page.request.get('/api/auth/passkeys')).json()) as {
        passkeys: { id: string }[];
      };
      updateState((state) => {
        state.ids['passkeyId'] = listed.passkeys[0]?.id ?? '';
      });
      await postInPage(page, '/auth/sign-out');

      const { email } = person(WHO);
      let delayed = false;
      for (let attempt = 0; attempt < 15 && !delayed; attempt += 1) {
        const wrong = await postInPage(page, '/auth/tenants/northfield/sign-in', {
          email,
          password: 'not the right passphrase',
        });
        delayed = wrong.status === 429;
      }
      expect(delayed, 'failed attempts delayed password sign-in').toBe(true);

      const signedIn = await signWithPasskey(page, {
        optionsPath: '/auth/tenants/northfield/passkey-sign-in/options',
        finishPath: '/auth/tenants/northfield/passkey-sign-in',
      });
      expect(signedIn).toMatchObject({ stage: 'finish', status: 200 });
    });
  });
});
