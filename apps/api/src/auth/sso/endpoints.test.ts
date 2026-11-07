// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The checks on save. A throwaway certificate and key are made with the
// openssl command for the signing-pair cases, in a temporary folder that is
// removed afterwards.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiError } from '../../problems.ts';
import {
  certificateFacts,
  checkDiscovery,
  checkSigningPair,
  discover,
  isAllowedEndpoint,
} from './endpoints.ts';

const ISSUER = 'https://login.example.test';
const document = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  jwks_uri: `${ISSUER}/keys`,
  userinfo_endpoint: `${ISSUER}/userinfo`,
  scopes_supported: ['openid'],
};

const REFUSED = [
  ['the metadata address', 'https://169.254.169.254/latest'],
  ['a private range', 'https://10.1.2.3/token'],
  ['loopback', 'https://127.0.0.1/token'],
  ['loopback written in hex', 'https://0x7f.1/token'],
  ['an IPv4-in-IPv6 literal', 'https://[::ffff:169.254.169.254]/token'],
  ['a NAT64 literal', 'https://[64:ff9b::a9fe:a9fe]/token'],
  ['plain HTTP', 'http://login.example.test/token'],
  ['a user name and password', 'https://user:pass@login.example.test/token'],
  ['no address at all', 'not a url'],
] as const;

/** The problem `work` throws, as the client would read it. */
function problemOf(work: () => unknown): { detail: string; errors: readonly unknown[] } {
  try {
    work();
  } catch (error) {
    if (error instanceof ApiError) return { detail: error.detail, errors: error.errors };
    throw error;
  }
  throw new Error('Nothing was refused.');
}

describe('isAllowedEndpoint', () => {
  it.each(REFUSED)('refuses %s', (_, url) => {
    expect(isAllowedEndpoint(url)).toBe(false);
  });

  it('allows HTTPS with a domain name or a public address', () => {
    expect(isAllowedEndpoint('https://login.example.test/token')).toBe(true);
    expect(isAllowedEndpoint('https://8.8.8.8/token')).toBe(true);
  });
});

describe('checkDiscovery', () => {
  it('returns the endpoints of a good document', () => {
    expect(checkDiscovery(ISSUER, document)).toEqual({
      authorizationEndpoint: `${ISSUER}/authorize`,
      tokenEndpoint: `${ISSUER}/token`,
      jwksUri: `${ISSUER}/keys`,
      userinfoEndpoint: `${ISSUER}/userinfo`,
    });
  });

  it.each(['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'userinfo_endpoint'] as const)(
    'refuses %s pointing anywhere the dispatcher would not go, naming the field and no value',
    (key) => {
      for (const [, url] of REFUSED) {
        const problem = problemOf(() => checkDiscovery(ISSUER, { ...document, [key]: url }));
        const text = JSON.stringify(problem);
        expect(text).toContain('body.issuer');
        expect(text).toContain(key);
        expect(text).not.toContain(url);
      }
    },
  );

  it('refuses a document for another issuer, or without its endpoints', () => {
    expect(
      problemOf(() => checkDiscovery(ISSUER, { ...document, issuer: 'https://evil.test' })).errors,
    ).toHaveLength(1);
    expect(problemOf(() => checkDiscovery(ISSUER, { issuer: ISSUER })).errors).toHaveLength(1);
    expect(problemOf(() => checkDiscovery(ISSUER, 'not a document')).errors).toHaveLength(1);
  });
});

describe('discover', () => {
  const answering =
    (body: string, status = 200): typeof fetch =>
    () =>
      Promise.resolve(new Response(body, { status }));

  it('fetches the discovery document once, from the issuer', async () => {
    const asked: string[] = [];
    const fetcher = ((url: string) => {
      asked.push(url);
      return Promise.resolve(new Response(JSON.stringify(document)));
    }) as typeof fetch;
    await expect(discover(`${ISSUER}/`, fetcher)).rejects.toThrow(ApiError);
    await discover(ISSUER, fetcher);
    expect(asked).toEqual([
      `${ISSUER}/.well-known/openid-configuration`,
      `${ISSUER}/.well-known/openid-configuration`,
    ]);
  });

  it.each(REFUSED)('refuses an issuer at %s without fetching', async (_, url) => {
    const fetcher = (() => Promise.reject(new Error('fetched'))) as typeof fetch;
    await expect(discover(url, fetcher)).rejects.toThrow(ApiError);
  });

  it.each([
    ['a failed fetch', () => Promise.reject(new Error('refused'))],
    ['an error status', answering('{}', 500)],
    ['a body that is not JSON', answering('<html>')],
    ['a body over 64 KB', answering(JSON.stringify({ ...document, pad: 'x'.repeat(70_000) }))],
  ])('refuses %s with a problem that names the issuer field', async (_, fetcher) => {
    const error = await discover(ISSUER, fetcher).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(JSON.stringify((error as ApiError).errors)).toContain('body.issuer');
  });
});

describe('certificates and signing keys', () => {
  let folder = '';
  let certificate = '';
  let privateKey = '';
  let otherKey = '';

  beforeAll(() => {
    folder = mkdtempSync(join(tmpdir(), 'tps-sso-'));
    const make = (name: string) => {
      const result = spawnSync('openssl', [
        'req',
        '-x509',
        '-newkey',
        'ec',
        '-pkeyopt',
        'ec_paramgen_curve:P-256',
        '-nodes',
        '-subj',
        '/CN=sp.example.test',
        '-days',
        '2',
        '-keyout',
        join(folder, `${name}.key`),
        '-out',
        join(folder, `${name}.crt`),
      ]);
      if (result.status !== 0) throw new Error('These tests need the openssl command.');
      return {
        key: readFileSync(join(folder, `${name}.key`), 'utf8'),
        crt: readFileSync(join(folder, `${name}.crt`), 'utf8').trim(),
      };
    };
    const one = make('one');
    certificate = one.crt;
    privateKey = one.key;
    otherKey = make('two').key;
  });

  afterAll(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it('gives each certificate its SHA-256 fingerprint and expiry', () => {
    const [facts] = certificateFacts([certificate]);
    expect(facts?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Date.parse(facts?.expiresAt ?? '')).toBeGreaterThan(Date.now());
  });

  it('names the certificate that does not parse, and echoes none of it', () => {
    const broken = '-----BEGIN CERTIFICATE-----\nMIIBtest\n-----END CERTIFICATE-----';
    const problem = problemOf(() => certificateFacts([certificate, broken]));
    expect(JSON.stringify(problem)).toContain('body.certificates.1');
    expect(JSON.stringify(problem)).not.toContain('MIIBtest');
  });

  it('accepts a key with its own certificate, and refuses any other', () => {
    expect(() => {
      checkSigningPair(privateKey, certificate);
    }).not.toThrow();
    const problem = problemOf(() => {
      checkSigningPair(otherKey, certificate);
    });
    expect(JSON.stringify(problem)).toContain('body.spSigning.privateKey');
    expect(JSON.stringify(problem)).not.toContain(otherKey.split('\n')[1] ?? 'never');
    expect(() => {
      checkSigningPair('not a key', certificate);
    }).toThrow(ApiError);
  });
});
