// SPDX-License-Identifier: AGPL-3.0-or-later

import { generateKeyPairSync, verify } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  authnRequestUrl,
  authnRequestXml,
  newRequestId,
  SIG_ALG,
  type AuthnRequestInput,
} from './request.ts';

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });

const input = (overrides: Partial<AuthnRequestInput> = {}): AuthnRequestInput => ({
  requestId: newRequestId(),
  ssoUrl: 'https://idp.example.org/sso',
  spEntityId: 'https://console.example.org/saml/metadata',
  acsUrl: 'https://console.example.org/auth/tenants/a/sso/saml/p/acs',
  signingKey: rsa.privateKey,
  relayState: 'r'.repeat(43),
  forceAuthn: false,
  now: new Date('2026-11-24T09:00:00.123Z'),
  ...overrides,
});

/** The raw query parameters, in order, undecoded. */
const rawParameters = (href: string): [string, string][] =>
  new URL(href).search
    .slice(1)
    .split('&')
    .map((pair) => pair.split('=') as [string, string]);

const requestXml = (href: string): string => {
  const value = new URL(href).searchParams.get('SAMLRequest') ?? '';
  return inflateRawSync(Buffer.from(value, 'base64')).toString('utf8');
};

describe('newRequestId', () => {
  it('is an NCName holding 256 random bits', () => {
    const ids = Array.from({ length: 20 }, newRequestId);
    for (const id of ids) expect(id).toMatch(/^_[0-9a-f]{64}$/);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('authnRequestUrl', () => {
  it('sends a deflated request by the redirect binding, with the stored values', () => {
    const request = input();
    const href = authnRequestUrl(request);
    expect(href.startsWith('https://idp.example.org/sso?SAMLRequest=')).toBe(true);
    expect(href.length).toBeLessThan(8192);
    const xml = requestXml(href);
    expect(xml).toContain(`ID="${request.requestId}"`);
    expect(xml).toContain('IssueInstant="2026-11-24T09:00:00Z"');
    expect(xml).toContain('Destination="https://idp.example.org/sso"');
    expect(xml).toContain(`AssertionConsumerServiceURL="${request.acsUrl}"`);
    expect(xml).toContain(`<saml:Issuer>${request.spEntityId}</saml:Issuer>`);
    expect(xml).not.toContain('ForceAuthn');
    expect(new URL(href).searchParams.get('RelayState')).toBe(request.relayState);
  });

  it('signs the query string with RSA-SHA256, verifiable by the SP certificate', () => {
    const href = authnRequestUrl(input());
    const parameters = rawParameters(href);
    expect(parameters.map(([name]) => name)).toEqual([
      'SAMLRequest',
      'RelayState',
      'SigAlg',
      'Signature',
    ]);
    expect(new URL(href).searchParams.get('SigAlg')).toBe(SIG_ALG);
    const signed = parameters
      .slice(0, 3)
      .map((pair) => pair.join('='))
      .join('&');
    const signature = Buffer.from(decodeURIComponent(parameters[3]?.[1] ?? ''), 'base64');
    expect(verify('sha256', Buffer.from(signed), rsa.publicKey, signature)).toBe(true);
  });

  it('asks the provider to authenticate again for a step-up', () => {
    expect(requestXml(authnRequestUrl(input({ forceAuthn: true })))).toContain('ForceAuthn="true"');
  });

  it('keeps the stored URL’s own query but replaces our parameters in it', () => {
    const href = authnRequestUrl(
      input({ ssoUrl: 'https://idp.example.org/sso?tenant=x&RelayState=evil&Signature=forged' }),
    );
    const names = rawParameters(href).map(([name]) => name);
    expect(names).toEqual(['tenant', 'SAMLRequest', 'RelayState', 'SigAlg', 'Signature']);
    expect(href).not.toContain('evil');
    expect(href).not.toContain('forged');
  });

  it('escapes stored values in the XML', () => {
    const xml = authnRequestXml(input({ spEntityId: 'urn:a"&<b>' }));
    expect(xml).toContain('<saml:Issuer>urn:a&quot;&amp;&lt;b&gt;</saml:Issuer>');
  });

  it('refuses a key that is not RSA', () => {
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    expect(() => authnRequestUrl(input({ signingKey: ec.privateKey }))).toThrow(/RSA/);
  });
});
