// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The single sign-on settings page in a real browser, with the API's answers
// stubbed from the contracts, then once against the real API. Every spec
// also fails on a Content Security Policy violation, so console-production
// checks the page under the production policy. The @a11y specs check each
// state at desktop width, 320 px wide and 200% zoom.

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { consoleSession, problem, stubSignedIn } from './auth-api.ts';
import type { Handler } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './auth-axe.ts';
import { nextCode } from './auth-totp.ts';

const OIDC_ID = '11111111-1111-4111-8111-111111111111';
const DOMAIN_ID = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-11-26T10:00:00.000Z';
const BASE = '/console/sso/providers';

const h1 = (page: Page) => page.getByRole('heading', { level: 1, name: 'Single sign-on' });
const summary = (page: Page) => page.getByRole('alert', { name: 'There is a problem' });
const addForm = (page: Page) => page.getByRole('form', { name: 'Add OIDC provider' });

const pending = { id: DOMAIN_ID, domain: 'example.org', status: 'pending', verifiedAt: null };
const oidc = (domains: unknown[] = []) => ({
  id: OIDC_ID,
  kind: 'oidc',
  name: 'Okta',
  issuer: 'https://login.example.org/',
  clientId: 'client-1',
  mfa: { amr: ['mfa'], acr: [] },
  redirectUri: 'https://grants.example.org/api/auth/callback',
  domains,
  updatedAt: NOW,
});

/** An administrator whose last sign-in is recent, so changes ask for nothing more. */
async function stubSso(page: Page, more: Record<string, Handler> = {}, providers: unknown[] = []) {
  const session = {
    ...consoleSession({ permissions: ['platform.sso.manage', 'platform.settings.manage'] }),
    recentAuthUntil: '2099-01-01T00:00:00.000Z',
  };
  return stubSignedIn(
    page,
    {},
    {
      'GET /auth/session': { status: 200, body: session },
      [`GET ${BASE}`]: {
        status: 200,
        body: {
          providers: providers.map((p) => {
            const { id, kind, name, updatedAt } = p as ReturnType<typeof oidc>;
            return { id, kind, name, updatedAt };
          }),
        },
      },
      [`GET ${BASE}/${OIDC_ID}`]: { status: 200, body: oidc([pending]) },
      ...more,
    },
  );
}

async function fillOidc(page: Page, issuer: string) {
  await page.getByLabel('Display name').fill('Okta');
  await page.getByLabel('Issuer or discovery URL').fill(issuer);
  await page.getByLabel('Client ID').fill('client-1');
  await page.getByLabel('Client secret').fill('a-long-client-secret');
  await page.getByLabel(/Values of amr/).fill('mfa');
  await addForm(page).getByRole('button', { name: 'Add OIDC provider' }).click();
}

test.describe('single sign-on settings', () => {
  test('adds an OIDC provider and shows the redirect URI to register', async ({ page }) => {
    const sent = await stubSso(page, { [`POST ${BASE}`]: { status: 201, body: oidc() } });
    await page.goto('/northfield/settings/sso');
    await expect(h1(page)).toBeVisible();
    await page.getByRole('button', { name: 'Add OIDC provider' }).click();
    await fillOidc(page, 'https://login.example.org');

    await expect(page.getByText('Okta is saved.')).toBeVisible();
    await expect(page.getByText('https://grants.example.org/api/auth/callback')).toBeVisible();
    expect(sent.find(({ key }) => key === `POST ${BASE}`)?.body).toMatchObject({
      clientSecret: 'a-long-client-secret',
    });
    expect(page.url()).not.toContain('secret');
    const stored = await page.evaluate(() =>
      JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]),
    );
    expect(stored).not.toContain('secret');
  });

  test('refuses a provider URL and puts the problem against its field', async ({ page }) => {
    await stubSso(page, {
      [`POST ${BASE}`]: problem(
        400,
        'Some fields are not valid. Fix the fields listed and try again.',
        [{ field: 'body.issuer', message: 'Enter an https address for a public host.' }],
      ),
    });
    await page.goto('/northfield/settings/sso');
    await page.getByRole('button', { name: 'Add OIDC provider' }).click();
    await fillOidc(page, 'https://internal.example.net');
    await expect(summary(page)).toBeFocused();
    await expect(page.locator('#issuer-error')).toContainText('Enter an https address');
  });

  test('adds a domain, shows the DNS record and verifies it', async ({ page }) => {
    await stubSso(
      page,
      {
        [`GET ${BASE}/${OIDC_ID}`]: { status: 200, body: oidc() },
        [`POST ${BASE}/${OIDC_ID}/domains`]: {
          status: 201,
          body: {
            ...pending,
            dnsRecord: { type: 'TXT', name: '_verify.example.org', value: 'token-123' },
          },
        },
        [`POST ${BASE}/${OIDC_ID}/domains/${DOMAIN_ID}/verify`]: {
          status: 200,
          body: { ...pending, status: 'verified', verifiedAt: NOW },
        },
      },
      [oidc()],
    );
    await page.goto('/northfield/settings/sso');
    await page.getByRole('button', { name: 'Add domain' }).click();
    await page.getByLabel('Email domain').fill('example.org');
    await page
      .getByRole('form', { name: /Add domain to/ })
      .getByRole('button', { name: 'Add domain' })
      .click();
    await expect(page.getByText('_verify.example.org')).toBeVisible();
    await expect(page.getByText('Waiting for verification')).toBeVisible();
    await page.getByRole('button', { name: 'Verify domain example.org' }).click();
    await expect(page.getByText('example.org is verified.')).toBeVisible();
  });

  test('asks for confirmation before removing a provider', async ({ page }) => {
    await stubSso(page, { [`DELETE ${BASE}/${OIDC_ID}`]: { status: 204 } }, [oidc()]);
    await page.goto('/northfield/settings/sso');
    await page.getByRole('button', { name: 'Remove provider Okta' }).click();
    const dialog = page.getByRole('dialog', { name: 'Remove provider Okta?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Remove provider' }).click();
    await expect(page.getByText('Okta is removed.')).toBeVisible();
  });

  test('moves focus into a form that opens and back to its button when it closes', async ({
    page,
  }) => {
    await stubSso(page, {}, [oidc()]);
    await page.goto('/northfield/settings/sso');
    const change = page.getByRole('button', { name: 'Change provider Okta' });
    await change.focus();
    await page.keyboard.press('Enter');
    const form = page.getByRole('form', { name: 'Change OIDC provider' });
    await expect(form.getByLabel('Display name')).toBeFocused();
    await form.getByRole('button', { name: 'Cancel' }).press('Enter');
    await expect(change).toBeFocused();

    const add = page.getByRole('button', { name: 'Add domain' });
    await add.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Email domain')).toBeFocused();
    await page.getByRole('button', { name: 'Cancel' }).press('Enter');
    await expect(add).toBeFocused();
  });

  test('shows the answer of the server to a member who cannot manage it', async ({ page }) => {
    await stubSso(page, { [`GET ${BASE}`]: problem(403, 'You cannot set up single sign-on.') });
    await page.goto('/northfield/settings/sso');
    await expect(page.getByText('You cannot set up single sign-on.')).toBeVisible();
  });
});

interface State {
  name: string;
  open: (page: Page) => Promise<void>;
  more?: Record<string, Handler>;
  providers?: unknown[];
}

const states: State[] = [
  {
    name: 'no providers',
    open: async (page) => {
      await expect(
        page.getByRole('heading', { name: 'No single sign-on providers' }),
      ).toBeVisible();
    },
  },
  {
    name: 'a provider with a pending domain',
    providers: [oidc()],
    open: async (page) => {
      await expect(page.getByText('Waiting for verification')).toBeVisible();
    },
  },
  {
    name: 'the OIDC form',
    open: async (page) => {
      await page.getByRole('button', { name: 'Add OIDC provider' }).click();
      await expect(addForm(page)).toBeVisible();
    },
  },
  {
    name: 'the SAML form',
    open: async (page) => {
      await page.getByRole('button', { name: 'Add SAML provider' }).click();
      await expect(page.getByRole('form', { name: 'Add SAML provider' })).toBeVisible();
    },
  },
  {
    name: 'a page the server refused',
    more: { [`GET ${BASE}`]: problem(403, 'You cannot set up single sign-on.') },
    open: async (page) => {
      await expect(page.getByText('You cannot set up single sign-on.')).toBeVisible();
    },
  },
  {
    name: 'the remove confirmation',
    providers: [oidc()],
    open: async (page) => {
      await page.getByRole('button', { name: 'Remove provider Okta' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
    },
  },
];

for (const variant of variants) {
  test.describe(`at ${variant.name}`, () => {
    test.use({
      viewport: variant.viewport,
      deviceScaleFactor: variant.deviceScaleFactor,
      colorScheme: variant.scheme,
    });
    for (const state of states) {
      test(`@a11y ${state.name} has no axe violations`, async ({ page }) => {
        await stubSso(page, state.more, state.providers);
        await page.goto('/northfield/settings/sso');
        await expect(h1(page)).toBeVisible();
        await state.open(page);
        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}

test.describe('the journey against the real API', () => {
  test.skip(
    process.env['TPS_E2E_STACK'] !== '1',
    'Runs against the stack: pnpm stack, then pnpm test:stack.',
  );
  const email = process.env['TPS_E2E_ADMIN_EMAIL'];
  const password = process.env['TPS_E2E_ADMIN_PASSWORD'];
  const key = process.env['TPS_E2E_ADMIN_TOTP_KEY'];
  test.skip(
    email === undefined || password === undefined || key === undefined,
    'Needs the seed administrator and TPS_E2E_ADMIN_TOTP_KEY.',
  );
  test.setTimeout(240_000);

  test('@api refuses a provider URL pointing at a private address', async ({ page }) => {
    await page.goto('/northfield/sign-in');
    await page.getByRole('textbox', { name: 'Email address' }).fill(email ?? '');
    await page.getByLabel('Password', { exact: true }).fill(password ?? '');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByLabel('Code from your app').fill(await nextCode(key ?? '', null));
    await page.getByRole('button', { name: 'Confirm code' }).click();
    await page.goto('/northfield/settings/sso');
    await expect(h1(page)).toBeVisible();

    // A recent sign-in may still count; if not, the person confirms it is them first.
    await page.getByRole('button', { name: 'Add OIDC provider' }).click();
    const dialog = page.getByRole('dialog', { name: 'Confirm it is you' });
    if (await dialog.isVisible({ timeout: 2000 }).catch(() => false)) {
      await dialog.getByLabel('Password').fill(password ?? '');
      await dialog.getByLabel(/Code from your authenticator/).fill(await nextCode(key ?? '', null));
      await dialog.getByRole('button', { name: 'Confirm it is you' }).click();
    }
    await fillOidc(page, 'https://127.0.0.1');
    await expect(summary(page)).toBeFocused();
  });
});
