// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { messages } from '../platform/messages.ts';
import { addProviderSchema, changeProviderSchema, domainNameSchema } from './sso-schemas.ts';

const PEM = (label: string) =>
  `-----BEGIN ${label}-----\n${'QUJD'.repeat(16)}\nQUJD\n-----END ${label}-----`;

const oidc = {
  kind: 'oidc',
  name: 'Staff sign-in',
  issuer: 'https://login.example.org/tenant',
  clientId: 'grants-console',
  clientSecret: 'synthetic-secret',
  mfa: { amr: ['mfa'], acr: [] },
};

const saml = {
  kind: 'saml',
  name: 'Staff sign-in',
  entityId: 'https://idp.example.org/metadata',
  ssoUrl: 'https://idp.example.org/sso',
  certificates: [PEM('CERTIFICATE')],
  mfaContexts: [],
};

function firstMessage(result: { error?: { issues: { message: string }[] } }): string | undefined {
  return result.error?.issues[0]?.message;
}

describe('SSO provider schemas', () => {
  it('take an OIDC or a SAML provider', () => {
    expect(addProviderSchema.safeParse(oidc).success).toBe(true);
    expect(addProviderSchema.safeParse(saml).success).toBe(true);
    const signing = { privateKey: PEM('PRIVATE KEY'), certificate: PEM('CERTIFICATE') };
    expect(addProviderSchema.safeParse({ ...saml, spSigning: signing }).success).toBe(true);
  });

  it('need the client secret to add an OIDC provider, but not to change one', () => {
    const withoutSecret = { ...oidc, clientSecret: undefined };
    expect(addProviderSchema.safeParse(withoutSecret).success).toBe(false);
    expect(changeProviderSchema.safeParse(withoutSecret).success).toBe(true);
  });

  it('take only HTTPS addresses with a domain name and no credentials', () => {
    for (const issuer of [
      'http://login.example.org',
      'https://203.0.113.7/oidc',
      'https://[2001:db8::1]/oidc',
      'https://admin:pw@login.example.org',
      'https://user@login.example.org',
      'https:user:pw@login.example.org/x',
      'https:/user:pw@login.example.org/x',
      'https:\\user:pw@login.example.org',
      'https://\\user:pw@login.example.org',
      'https://\tuser:pw@login.example.org',
      `https://login.example.org/${'a'.repeat(2048)}`,
    ]) {
      expect(firstMessage(addProviderSchema.safeParse({ ...oidc, issuer })), issuer).toBe(
        messages.httpsAddress,
      );
    }
  });

  it('keep an address in the form a URL parser reads it', () => {
    const result = addProviderSchema.parse({ ...oidc, issuer: 'HTTPS://Login.Example.org' });
    expect(result.kind === 'oidc' && result.issuer).toBe('https://login.example.org/');
    const sso = changeProviderSchema.parse({ ...saml, ssoUrl: 'https://IdP.example.org/s s' });
    expect(sso.kind === 'saml' && sso.ssoUrl).toBe('https://idp.example.org/s%20s');
  });

  it('take one to three PEM certificates, each one block of bounded size', () => {
    for (const certificates of [
      [],
      Array(4).fill(PEM('CERTIFICATE')),
      [`${PEM('CERTIFICATE')}\n${PEM('CERTIFICATE')}`],
      [PEM('PRIVATE KEY')],
      [PEM('CERTIFICATE').replace('QUJD', 'QU JD')],
      [`-----BEGIN CERTIFICATE-----\n${'QUJD\n'.repeat(2000)}-----END CERTIFICATE-----`],
    ]) {
      expect(addProviderSchema.safeParse({ ...saml, certificates }).success).toBe(false);
    }
  });

  it('refuse a key they do not name, such as a tenant', () => {
    expect(addProviderSchema.safeParse({ ...oidc, tenantId: 'x' }).success).toBe(false);
    expect(addProviderSchema.safeParse({ ...saml, kind: 'ldap' }).success).toBe(false);
  });
});

describe('domainNameSchema', () => {
  it('takes a domain in lower case IDNA ASCII form', () => {
    expect(domainNameSchema.parse(' Example.ORG ')).toBe('example.org');
    expect(domainNameSchema.safeParse('xn--bcher-kva.example').success).toBe(true);
    expect(domainNameSchema.safeParse('mail.charity.org.uk').success).toBe(true);
  });

  it('refuses IP literals, trailing dots, addresses and over-long names', () => {
    for (const domain of [
      'example',
      'example.org.',
      '203.0.113.7',
      '[2001:db8::1]',
      'https://example.org',
      'ada@example.org',
      'bücher.example',
      '-bad.example.org',
      `${'a'.repeat(64)}.org`,
      `${Array(64).fill('abc').join('.')}.org`,
    ]) {
      expect(firstMessage(domainNameSchema.safeParse(domain)), domain).toBe(messages.domainName);
    }
  });
});

describe('the domain conflict message', () => {
  it('is fixed words that name no tenant', () => {
    expect(typeof messages.ssoDomainConflict).toBe('string');
    expect(messages.ssoDomainConflict).not.toMatch(/tenant|\{|\$/i);
  });
});
