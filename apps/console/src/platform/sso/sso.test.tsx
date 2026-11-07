// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { consoleSession, problem, stubApi } from '../../testing/api.ts';
import type { Reply } from '../../testing/api.ts';
import { openConsole, setUpConsoleTests } from '../../testing/render.tsx';
import { SESSION, administrator, heading, ok } from '../settings/testing.ts';
import { STEP_UP_NEEDED } from '../team/change.ts';

setUpConsoleTests();

const LIST = 'GET /console/sso/providers';
const STEP_UP = 'POST /auth/step-up';
const OIDC_ID = '11111111-1111-4111-8111-111111111111';
const SAML_ID = '22222222-2222-4222-8222-222222222222';
const DOMAIN_ID = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-11-26T10:00:00.000Z';

const pending = { id: DOMAIN_ID, domain: 'example.org', status: 'pending', verifiedAt: null };
const verified = { ...pending, status: 'verified', verifiedAt: NOW };

const oidc = (domains: unknown[] = []) => ({
  id: OIDC_ID,
  kind: 'oidc',
  name: 'Okta',
  issuer: 'https://login.example.org/',
  clientId: 'client-1',
  mfa: { amr: ['mfa'], acr: [] },
  redirectUri: 'https://grants.example.org/api/auth/tenants/northfield/sso/oidc/1/callback',
  domains,
  updatedAt: NOW,
});

const saml = {
  id: SAML_ID,
  kind: 'saml',
  name: 'Entra',
  entityId: 'https://idp.example.org/entity',
  ssoUrl: 'https://idp.example.org/sso',
  certificates: [{ sha256: 'AB:CD', expiresAt: NOW }],
  mfaContexts: [],
  domains: [],
  updatedAt: NOW,
  sp: {
    entityId: 'https://grants.example.org/sp',
    acsUrl: 'https://grants.example.org/acs',
    signs: false,
  },
};

type Handlers = Record<string, Reply | ((body: unknown) => Reply)>;

const summaryOf = (p: { id: string; kind: string; name: string }) => ({
  id: p.id,
  kind: p.kind,
  name: p.name,
  updatedAt: NOW,
});

function providers(list: { id: string; kind: string; name: string }[], more: Handlers = {}) {
  const details = Object.fromEntries(
    list.map((p) => [`GET /console/sso/providers/${p.id}`, ok(p)]),
  );
  return { [LIST]: ok({ providers: list.map(summaryOf) }), ...details, ...more };
}

/** A session whose last re-authentication is recent, so no step-up is asked for. */
const recentSession = () =>
  ok({ ...administrator(), recentAuthUntil: new Date(Date.now() + 300_000).toISOString() });

async function openSso(handlers: Handlers, recent = true) {
  const sent = stubApi({ [SESSION]: recent ? recentSession() : ok(administrator()), ...handlers });
  openConsole('/northfield/settings/sso');
  await heading('Single sign-on');
  return sent;
}

describe('the single sign-on page', () => {
  it('says what to do when there are no providers', async () => {
    await openSso(providers([]));
    expect(
      await screen.findByRole('heading', { name: 'No single sign-on providers' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add OIDC provider' })).toBeTruthy();
  });

  it('lists OIDC and SAML providers with their domains and what to register', async () => {
    await openSso(
      providers([oidc([pending, { ...verified, id: SAML_ID, domain: 'done.org' }]), saml]),
    );
    const card = within(await screen.findByRole('region', { name: 'Okta' }));
    expect(card.getByText('Waiting for verification')).toBeTruthy();
    expect(card.getByText('Verified')).toBeTruthy();
    expect(card.getByText(/^https:\/\/grants\.example\.org\/api\/auth/)).toBeTruthy();
    const other = within(screen.getByRole('region', { name: 'Entra' }));
    expect(other.getByText('https://grants.example.org/acs')).toBeTruthy();
    expect(other.getByText(/Staff enter a code/)).toBeTruthy();
  });

  it('shows the answer of the server to someone without the permission', async () => {
    await openSso({ [LIST]: problem(403, 'You cannot set up single sign-on.') });
    expect(await screen.findByText('You cannot set up single sign-on.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add OIDC provider' })).toBeNull();
  });

  it('adds an OIDC provider, sends the secret once and keeps it out of storage and the address', async () => {
    const user = userEvent.setup();
    const created = oidc();
    const sent = await openSso(
      providers([], { 'POST /console/sso/providers': { status: 201, body: created } }),
    );
    await user.click(await screen.findByRole('button', { name: 'Add OIDC provider' }));
    const form = within(await screen.findByRole('form', { name: 'Add OIDC provider' }));
    await user.type(form.getByLabelText('Display name'), 'Okta');
    await user.type(form.getByLabelText('Issuer or discovery URL'), 'https://login.example.org');
    await user.type(form.getByLabelText('Client ID'), 'client-1');
    await user.type(form.getByLabelText('Client secret'), 'top-secret-value');
    await user.type(form.getByLabelText(/Values of amr/), 'mfa');
    await user.click(form.getByRole('button', { name: 'Add OIDC provider' }));

    expect(await screen.findByText('Okta is saved.')).toBeTruthy();
    const write = sent.find(({ key }) => key === 'POST /console/sso/providers');
    expect(write?.body).toMatchObject({ kind: 'oidc', clientSecret: 'top-secret-value' });
    expect(screen.queryByLabelText('Client secret')).toBeNull();
    expect(document.body.innerHTML).not.toContain('top-secret-value');
    expect(JSON.stringify(window.history.state)).not.toContain('top-secret-value');
    expect(window.location.href).not.toContain('top-secret-value');
    expect(
      JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]),
    ).not.toContain('top-secret-value');
  });

  it('keeps the stored secret when the change form leaves it blank', async () => {
    const user = userEvent.setup();
    const sent = await openSso(
      providers([oidc()], { [`PUT /console/sso/providers/${OIDC_ID}`]: ok(oidc()) }),
    );
    await user.click(await screen.findByRole('button', { name: 'Change provider Okta' }));
    const form = within(await screen.findByRole('form', { name: 'Change OIDC provider' }));
    expect(form.getByText(/A client secret is saved/)).toBeTruthy();
    expect(form.getByLabelText<HTMLInputElement>('Client secret').value).toBe('');
    await user.click(form.getByRole('button', { name: 'Save provider' }));
    await screen.findByText('Okta is saved.');
    const put = sent.find(({ key }) => key.startsWith('PUT'));
    expect(put?.body).not.toHaveProperty('clientSecret');
  });

  it('shows a refused URL against its field', async () => {
    const user = userEvent.setup();
    await openSso(
      providers([], {
        'POST /console/sso/providers': problem(400, 'Some fields are not valid.', [
          { field: 'body.issuer', message: 'Enter an https address for a public host.' },
        ]),
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Add OIDC provider' }));
    const form = within(await screen.findByRole('form', { name: 'Add OIDC provider' }));
    await user.type(form.getByLabelText('Display name'), 'Okta');
    await user.type(form.getByLabelText('Issuer or discovery URL'), 'https://internal.example.net');
    await user.type(form.getByLabelText('Client ID'), 'c');
    await user.type(form.getByLabelText('Client secret'), 's');
    await user.type(form.getByLabelText(/Values of amr/), 'mfa');
    await user.click(form.getByRole('button', { name: 'Add OIDC provider' }));
    expect(await screen.findByRole('alert', { name: 'There is a problem' })).toBeTruthy();
    expect(form.getAllByText(/Enter an https address for a public host\./).length).toBeGreaterThan(
      0,
    );
  });

  it('asks for MFA values when MFA is trusted', async () => {
    const user = userEvent.setup();
    const sent = await openSso(providers([]));
    await user.click(await screen.findByRole('button', { name: 'Add SAML provider' }));
    const form = within(await screen.findByRole('form', { name: 'Add SAML provider' }));
    await user.type(form.getByLabelText('Display name'), 'Entra');
    await user.click(form.getByRole('button', { name: 'Add SAML provider' }));
    expect(
      await screen.findAllByText(/Enter at least one value that counts as MFA/),
    ).not.toHaveLength(0);
    expect(sent.some(({ key }) => key.startsWith('POST'))).toBe(false);
  });

  it('asks it is you first when recent sign-in has passed, before the form opens', async () => {
    const user = userEvent.setup();
    stubApi({
      [SESSION]: ok(administrator()),
      ...providers([]),
      [STEP_UP]: ok({
        ...consoleSession({ roles: ['tenant_admin'] }),
        recentAuthUntil: new Date(Date.now() + 300_000).toISOString(),
      }),
    });
    openConsole('/northfield/settings/sso');
    await user.click(await screen.findByRole('button', { name: 'Add OIDC provider' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    expect(screen.queryByRole('form', { name: 'Add OIDC provider' })).toBeNull();
    await user.type(within(dialog).getByLabelText('Password'), 'correct horse battery');
    await user.type(within(dialog).getByLabelText(/Code from your authenticator/), '123456');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm it is you' }));
    expect(await screen.findByRole('form', { name: 'Add OIDC provider' })).toBeTruthy();
  });

  it('adds a domain and shows the DNS record to publish', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await openSso(
      providers([oidc()], {
        [`POST /console/sso/providers/${OIDC_ID}/domains`]: {
          status: 201,
          body: {
            ...pending,
            dnsRecord: { type: 'TXT', name: '_verify.example.org', value: 'token-123' },
          },
        },
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Add domain' }));
    await user.type(await screen.findByLabelText('Email domain'), 'example.org');
    await user.click(screen.getByRole('button', { name: 'Add domain' }));
    expect(await screen.findByText('_verify.example.org')).toBeTruthy();
    expect(screen.getByText('Waiting for verification')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Copy record value' }));
    expect(writeText).toHaveBeenCalledWith('token-123');
    expect(await screen.findByText('Copied')).toBeTruthy();
  });

  it('says the record was not found when a verify stays pending', async () => {
    const user = userEvent.setup();
    await openSso(
      providers([oidc([pending])], {
        [`POST /console/sso/providers/${OIDC_ID}/domains/${DOMAIN_ID}/verify`]: ok(pending),
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Verify domain example.org' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('could not find the DNS record yet'),
    );
  });

  it('marks a domain verified', async () => {
    const user = userEvent.setup();
    await openSso(
      providers([oidc([pending])], {
        [`POST /console/sso/providers/${OIDC_ID}/domains/${DOMAIN_ID}/verify`]: ok(verified),
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Verify domain example.org' }));
    expect(await screen.findByText('example.org is verified.')).toBeTruthy();
  });

  it('shows only the servers words for a domain conflict', async () => {
    const user = userEvent.setup();
    const words =
      'Another organisation has already verified this domain. Contact support if it should be yours.';
    await openSso(
      providers([oidc([pending])], {
        [`POST /console/sso/providers/${OIDC_ID}/domains/${DOMAIN_ID}/verify`]: problem(409, words),
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Verify domain example.org' }));
    expect((await screen.findByRole('alert')).textContent).toBe(words);
  });

  it('repeats a change once after the server asks for step-up', async () => {
    const user = userEvent.setup();
    let calls = 0;
    const sent = await openSso(
      providers([oidc([pending])], {
        [`POST /console/sso/providers/${OIDC_ID}/domains/${DOMAIN_ID}/verify`]: () => {
          calls += 1;
          return calls === 1 ? problem(403, STEP_UP_NEEDED) : ok(verified);
        },
        [STEP_UP]: ok(recentSessionBody()),
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Verify domain example.org' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    await user.type(within(dialog).getByLabelText('Password'), 'correct horse battery');
    await user.type(within(dialog).getByLabelText(/Code from your authenticator/), '123456');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm it is you' }));
    expect(await screen.findByText('example.org is verified.')).toBeTruthy();
    expect(sent.filter(({ key }) => key.endsWith('/verify'))).toHaveLength(2);
  });

  it('says how long to wait after too many requests', async () => {
    const user = userEvent.setup();
    await openSso(
      providers([oidc([pending])], {
        [`POST /console/sso/providers/${OIDC_ID}/domains/${DOMAIN_ID}/verify`]: {
          ...problem(429, 'Slow down.'),
          headers: { 'retry-after': '30' },
        },
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Verify domain example.org' }));
    expect(
      await screen.findByText('Too many attempts. Wait 30 seconds, then try again.'),
    ).toBeTruthy();
  });

  it('asks before removing a provider, naming it and what happens', async () => {
    const user = userEvent.setup();
    const sent = await openSso(
      providers([oidc()], { [`DELETE /console/sso/providers/${OIDC_ID}`]: { status: 204 } }),
    );
    await user.click(await screen.findByRole('button', { name: 'Remove provider Okta' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove provider Okta?' });
    expect(within(dialog).getByText(/sign in with a password and code instead/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Remove provider' }));
    expect(await screen.findByText('Okta is removed.')).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Okta' })).toBeNull();
    });
    expect(sent.some(({ key }) => key.startsWith('DELETE'))).toBe(true);
  });
});

describe('names and focus on the single sign-on page', () => {
  it('starts every button name with the words on it', async () => {
    await openSso(providers([oidc([pending])]));
    const card = within(await screen.findByRole('region', { name: 'Okta' }));
    for (const visible of [
      'Change provider',
      'Remove provider',
      'Verify domain',
      'Remove domain',
    ]) {
      const button = card.getByRole('button', { name: new RegExp(`^${visible}`) });
      expect(button.getAttribute('aria-label')?.startsWith(visible)).toBe(true);
      expect(button.textContent).toBe(visible);
    }
  });

  it('gives the certificate file input its own id, label and description', async () => {
    const user = userEvent.setup();
    await openSso(providers([]));
    await user.click(await screen.findByRole('button', { name: 'Add SAML provider' }));
    const form = await screen.findByRole('form', { name: 'Add SAML provider' });
    const file = within(form).getByLabelText('Or choose a certificate file');
    const area = within(form).getByLabelText('Identity provider signing certificate');
    expect(file.id).toBe('certificate-file');
    expect(area.id).toBe('certificates');
    expect(file.getAttribute('aria-describedby')).toBe('certificate-file-hint');
    expect(form.querySelectorAll('[id="certificates"]')).toHaveLength(1);

    await user.upload(file, new File(['x'.repeat(20_000)], 'big.pem', { type: 'text/plain' }));
    const error = await within(form).findByText('Choose a certificate file under 16 KB.');
    expect(file.getAttribute('aria-invalid')).toBe('true');
    expect(file.getAttribute('aria-describedby')).toContain(error.parentElement?.id);
    expect(area.getAttribute('aria-invalid')).toBeNull();
  });

  it('moves focus into a form that opens and back to its button when it closes', async () => {
    const user = userEvent.setup();
    await openSso(providers([oidc(), saml]));
    const add = await screen.findByRole('button', { name: 'Add SAML provider' });
    await user.click(add);
    const form = within(await screen.findByRole('form', { name: 'Add SAML provider' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(form.getByLabelText('Display name'));
    });
    await user.click(form.getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(add);

    const change = screen.getByRole('button', { name: 'Change provider Entra' });
    await user.click(change);
    const changing = within(await screen.findByRole('form', { name: 'Change SAML provider' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(changing.getByLabelText('Display name'));
    });
    await user.click(changing.getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(change);
  });

  it('returns focus to the button after a provider is saved', async () => {
    const user = userEvent.setup();
    await openSso(providers([oidc()], { [`PUT /console/sso/providers/${OIDC_ID}`]: ok(oidc()) }));
    const change = await screen.findByRole('button', { name: 'Change provider Okta' });
    await user.click(change);
    const form = within(await screen.findByRole('form', { name: 'Change OIDC provider' }));
    await user.click(form.getByRole('button', { name: 'Save provider' }));
    await screen.findByText('Okta is saved.');
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Change provider Okta' }),
      );
    });
  });

  it('moves focus into the domain form and back to Add domain on cancel and on success', async () => {
    const user = userEvent.setup();
    await openSso(
      providers([oidc()], {
        [`POST /console/sso/providers/${OIDC_ID}/domains`]: {
          status: 201,
          body: {
            ...pending,
            dnsRecord: { type: 'TXT', name: '_verify.example.org', value: 'token-123' },
          },
        },
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Add domain' }));
    const input = await screen.findByLabelText('Email domain');
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add domain' }));

    await user.click(screen.getByRole('button', { name: 'Add domain' }));
    await user.type(await screen.findByLabelText('Email domain'), 'example.org');
    await user.click(screen.getByRole('button', { name: 'Add domain' }));
    await screen.findByText('_verify.example.org');
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add domain' }));
    });
  });
});

function recentSessionBody() {
  return {
    ...consoleSession({ roles: ['tenant_admin'] }),
    recentAuthUntil: new Date(Date.now() + 300_000).toISOString(),
  };
}
