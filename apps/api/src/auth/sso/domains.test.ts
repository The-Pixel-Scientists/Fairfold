// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  checkDnsProof,
  dnsRecord,
  newDnsToken,
  normaliseDomain,
  type TxtLookup,
} from './domains.ts';

describe('normaliseDomain', () => {
  it('stores one form, so differently written names collide', () => {
    expect(normaliseDomain('Example.ORG.')).toBe('example.org');
    expect(normaliseDomain('  example.org ')).toBe('example.org');
    expect(normaliseDomain('Bücher.Example')).toBe('xn--bcher-kva.example');
    expect(normaliseDomain('xn--bcher-kva.example')).toBe('xn--bcher-kva.example');
  });

  it.each([
    ['a wildcard', '*.example.org'],
    ['an IPv4 literal', '192.0.2.1'],
    ['an IPv6 literal', '[2001:db8::1]'],
    ['a single label', 'org'],
    ['a public suffix', 'co.uk'],
    ['a public suffix with a dot', 'org.uk.'],
    ['an address', 'https://example.org'],
    ['an email address', 'name@example.org'],
    ['a label over 63 characters', `${'a'.repeat(64)}.example.org`],
    ['nothing', ''],
  ])('refuses %s', (_, input) => {
    expect(normaliseDomain(input)).toBeUndefined();
  });
});

describe('checkDnsProof', () => {
  const token = newDnsToken();
  const record = dnsRecord('example.org', token);
  const answering =
    (records: string[][], asked: string[] = []): TxtLookup =>
    (name) => {
      asked.push(name);
      return Promise.resolve(records);
    };

  it('makes a 43-character token and the record that holds it', () => {
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(record).toEqual({
      type: 'TXT',
      name: '_sso-verification.example.org',
      value: `sso-verification=${token}`,
    });
  });

  it("accepts the claim's own token, split into chunks or among other records", async () => {
    const asked: string[] = [];
    const lookup = answering(
      [['v=spf1 -all'], [record.value.slice(0, 20), record.value.slice(20)]],
      asked,
    );
    expect(await checkDnsProof(lookup, 'example.org', token)).toBe('proven');
    expect(asked).toEqual(['_sso-verification.example.org']);
  });

  it('refuses a token issued for another claim, and any near match', async () => {
    const other = newDnsToken();
    for (const value of [
      `sso-verification=${other}`,
      `sso-verification=${token} `,
      `sso-verification=${token.toUpperCase()}`,
      token,
    ]) {
      expect(await checkDnsProof(answering([[value]]), 'example.org', token), value).toBe(
        'not_found',
      );
    }
  });

  it('reads at most 20 records', async () => {
    const records = [...Array.from({ length: 20 }, () => ['filler']), [record.value]];
    expect(await checkDnsProof(answering(records), 'example.org', token)).toBe('not_found');
  });

  it('tells a missing record from a failed lookup', async () => {
    const failing =
      (code: string): TxtLookup =>
      () =>
        Promise.reject(Object.assign(new Error(code), { code }));
    expect(await checkDnsProof(failing('ENOTFOUND'), 'example.org', token)).toBe('not_found');
    expect(await checkDnsProof(failing('ENODATA'), 'example.org', token)).toBe('not_found');
    expect(await checkDnsProof(failing('ETIMEOUT'), 'example.org', token)).toBe('lookup_failed');
    expect(await checkDnsProof(failing('ESERVFAIL'), 'example.org', token)).toBe('lookup_failed');
  });
});
