// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { newToken } from './cookies.ts';
import { appResolver, normaliseHost, singleHostRewrite } from './hosts.ts';
import { loadAuthSettings } from './settings.ts';

const base = {
  TPS_AUTH_SECRET: newToken(),
  TPS_DB_APP_AUTH_PASSWORD: 'a-long-enough-password',
};

const twoHosts = loadAuthSettings({
  ...base,
  TPS_CONSOLE_ORIGIN: 'https://console.example.org',
  TPS_PORTAL_ORIGIN: 'https://bücher.example.org',
});

const oneHost = loadAuthSettings({
  ...base,
  TPS_CONSOLE_ORIGIN: 'https://grants.example.org',
  TPS_PORTAL_ORIGIN: 'https://grants.example.org',
  TPS_CONSOLE_PATH_PREFIX: '/console',
});

describe('normaliseHost', () => {
  it.each([
    ['Console.Example.ORG', 'console.example.org'],
    ['console.example.org.', 'console.example.org'],
    ['console.example.org:8443', 'console.example.org'],
    ['BÜCHER.example.org', 'xn--bcher-kva.example.org'],
    ['[::1]:3000', '[::1]'],
  ])('reads %s as %s', (host, expected) => {
    expect(normaliseHost(host)).toBe(expected);
  });

  it.each([
    '',
    'user@console.example.org',
    'console.example.org/x',
    'console.example.org\\x',
    'console.example.org?x',
    'console.example.org#x',
    'console.example.org%2f',
    'console example.org',
    'console.example.org\t',
    '.',
  ])('refuses %j', (host) => {
    expect(normaliseHost(host)).toBeNull();
  });
});

describe('appResolver', () => {
  it('resolves each configured host, whatever its case, trailing dot, IDNA form or port', () => {
    const resolve = appResolver(twoHosts);
    expect(resolve('console.example.org', '/api/auth/session')).toBe('console');
    expect(resolve('CONSOLE.example.org.:443', '/api/auth/session')).toBe('console');
    expect(resolve('xn--bcher-kva.example.org', '/api/auth/session')).toBe('portal');
    expect(resolve('bücher.example.org:8080', '/api/auth/session')).toBe('portal');
  });

  it('resolves no other host', () => {
    const resolve = appResolver(twoHosts);
    for (const host of ['example.org', 'evil.example', 'console.example.org.evil.example', '']) {
      expect(resolve(host, '/api/auth/session')).toBeNull();
    }
  });

  it('on a single host, tells the console by its path prefix alone', () => {
    const resolve = appResolver(oneHost);
    expect(resolve('grants.example.org', '/console/api/auth/session')).toBe('console');
    expect(resolve('grants.example.org', '/console')).toBe('console');
    expect(resolve('grants.example.org', '/api/auth/session')).toBe('portal');
    expect(resolve('grants.example.org', '/consoles/api/auth/session')).toBe('portal');
    expect(resolve('other.example.org', '/console/api/auth/session')).toBeNull();
  });
});

describe('singleHostRewrite', () => {
  it('removes the console prefix before routing, and leaves other paths alone', () => {
    const rewrite = singleHostRewrite(oneHost);
    expect(rewrite?.({ url: '/console/api/auth/session' })).toBe('/api/auth/session');
    expect(rewrite?.({ url: '/console?x=1' })).toBe('/?x=1');
    expect(rewrite?.({ url: '/api/auth/session' })).toBe('/api/auth/session');
    expect(rewrite?.({ url: '/consoles/api' })).toBe('/consoles/api');
  });

  it('is not needed with two hosts', () => {
    expect(singleHostRewrite(twoHosts)).toBeUndefined();
  });
});
