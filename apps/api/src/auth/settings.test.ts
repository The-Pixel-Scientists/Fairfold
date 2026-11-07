// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { ConfigError } from '../config.ts';
import { newToken } from './cookies.ts';
import { loadAuthSettings } from './settings.ts';

const SECRET = newToken();

const valid = {
  TPS_AUTH_SECRET: SECRET,
  TPS_DB_APP_AUTH_PASSWORD: 'a-long-enough-password',
  TPS_CONSOLE_ORIGIN: 'https://console.example.org',
  TPS_PORTAL_ORIGIN: 'https://apply.example.org',
};

function problems(env: Record<string, string | undefined>, readFile?: (path: string) => string) {
  try {
    loadAuthSettings(env, readFile);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  return [];
}

describe('loadAuthSettings', () => {
  it('reads valid settings, and never shows a secret', () => {
    const settings = loadAuthSettings(valid);
    expect(settings.secret.reveal()).toBe(SECRET);
    expect(settings.origins).toEqual({
      console: 'https://console.example.org',
      portal: 'https://apply.example.org',
    });
    expect(settings.consolePathPrefix).toBeUndefined();
    expect(JSON.stringify(settings)).not.toContain(SECRET);
    expect(JSON.stringify(settings)).not.toContain('a-long-enough-password');
  });

  it('reads the secret from a file, without its final newline', () => {
    const settings = loadAuthSettings(
      { ...valid, TPS_AUTH_SECRET: undefined, TPS_AUTH_SECRET_FILE: '/run/secrets/auth' },
      () => `${SECRET}\n`,
    );
    expect(settings.secret.reveal()).toBe(SECRET);
  });

  it('reports every problem at once', () => {
    expect(problems({})).toEqual([
      'Set TPS_AUTH_SECRET or TPS_AUTH_SECRET_FILE.',
      'Set TPS_DB_APP_AUTH_PASSWORD or TPS_DB_APP_AUTH_PASSWORD_FILE.',
      'Set TPS_CONSOLE_ORIGIN.',
      'Set TPS_PORTAL_ORIGIN.',
    ]);
  });

  it('refuses a secret under 32 bytes', () => {
    expect(problems({ ...valid, TPS_AUTH_SECRET: 'x'.repeat(31) })).toEqual([
      'TPS_AUTH_SECRET must be at least 32 bytes.',
    ]);
  });

  it.each([
    'better-auth-secret-12345678901234567890',
    'better-auth-secret-that-is-long-enough-for-validation-test',
  ])("refuses Better Auth's published secret %s, even in development", (secret) => {
    for (const env of [valid, { ...valid, TPS_DEV: '1' }]) {
      expect(problems({ ...env, TPS_AUTH_SECRET: secret })).toEqual([
        'TPS_AUTH_SECRET is a published value. Set a random one of at least 32 bytes.',
      ]);
    }
  });

  it('refuses a development secret outside development', () => {
    const secret = 'dev-auth-secret-for-this-machine-not-a-secret';
    expect(problems({ ...valid, TPS_AUTH_SECRET: secret })).toHaveLength(1);
    expect(problems({ ...valid, TPS_DEV: '1', TPS_AUTH_SECRET: secret })).toEqual([]);
  });

  it('refuses both a secret and its file, and an unreadable file, naming no path', () => {
    expect(problems({ ...valid, TPS_AUTH_SECRET_FILE: '/run/secrets/auth' })).toEqual([
      'Set TPS_AUTH_SECRET or TPS_AUTH_SECRET_FILE, not both.',
    ]);
    const unreadable = problems(
      { ...valid, TPS_AUTH_SECRET: undefined, TPS_AUTH_SECRET_FILE: '/home/someone/secret' },
      () => {
        throw new Error('ENOENT /home/someone/secret');
      },
    );
    expect(unreadable).toEqual(['TPS_AUTH_SECRET_FILE names a file that cannot be read.']);
  });

  it('reads TPS_AUTH_SECRET alone as key version 1', () => {
    const { secret, secrets } = loadAuthSettings(valid);
    expect(secrets.current).toBe(1);
    expect([...secrets.versions.keys()]).toEqual([1]);
    expect(secrets.versions.get(1)).toBe(secret);
  });

  it('reads key versions, and seals with the one TPS_AUTH_SECRET_CURRENT names', () => {
    const two = newToken();
    const settings = loadAuthSettings(
      {
        ...valid,
        TPS_AUTH_SECRET_2: undefined,
        TPS_AUTH_SECRET_2_FILE: '/run/secrets/auth-2',
        TPS_AUTH_SECRET_CURRENT: '2',
      },
      () => `${two}\n`,
    );
    expect(settings.secrets.current).toBe(2);
    expect([...settings.secrets.versions].map(([v, s]) => [v, s.reveal()])).toEqual([
      [1, SECRET],
      [2, two],
    ]);
    expect(settings.secret.reveal()).toBe(two);
    expect(JSON.stringify(settings)).not.toContain(two);

    const without = loadAuthSettings({
      ...valid,
      TPS_AUTH_SECRET: undefined,
      TPS_AUTH_SECRET_7: two,
    });
    expect(without.secrets.current).toBe(7);
    expect(without.secrets.versions.has(1)).toBe(false);
  });

  it('refuses key versions it cannot use, naming each', () => {
    const two = newToken();
    expect(problems({ ...valid, TPS_AUTH_SECRET_2: two })).toEqual([
      'More than one auth key version is set, so set TPS_AUTH_SECRET_CURRENT.',
    ]);
    for (const current of ['3', '02', 'two', '0']) {
      expect(
        problems({ ...valid, TPS_AUTH_SECRET_2: two, TPS_AUTH_SECRET_CURRENT: current }),
      ).toEqual(['TPS_AUTH_SECRET_CURRENT must name a key version that is set.']);
    }
    expect(problems({ ...valid, TPS_AUTH_SECRET_1: two })).toEqual([
      'Set TPS_AUTH_SECRET or TPS_AUTH_SECRET_1, not both: each is version 1.',
    ]);
    expect(problems({ ...valid, TPS_AUTH_SECRET_2: SECRET, TPS_AUTH_SECRET_CURRENT: '2' })).toEqual(
      ["TPS_AUTH_SECRET_2 repeats another key version's secret. Set a new random one."],
    );
    expect(
      problems({ ...valid, TPS_AUTH_SECRET_2: 'x'.repeat(31), TPS_AUTH_SECRET_CURRENT: '2' }),
    ).toEqual(['TPS_AUTH_SECRET_2 must be at least 32 bytes.']);
    expect(
      problems({
        ...valid,
        TPS_AUTH_SECRET_2: 'dev-auth-secret-for-this-machine-not-a-secret',
        TPS_AUTH_SECRET_CURRENT: '2',
      }),
    ).toEqual(['TPS_AUTH_SECRET_2 is a published value. Set a random one of at least 32 bytes.']);
    for (const name of ['TPS_AUTH_SECRET_0', 'TPS_AUTH_SECRET_1000', 'TPS_AUTH_SECRET_OLD']) {
      expect(problems({ ...valid, [name]: two }), name).toEqual([
        `${name} is not a setting. Name key versions TPS_AUTH_SECRET_1 to _999.`,
      ]);
    }
  });

  it('refuses a short app_auth password, and a development one unless developing here', () => {
    expect(problems({ ...valid, TPS_DB_APP_AUTH_PASSWORD: 'short' })).toEqual([
      'TPS_DB_APP_AUTH_PASSWORD must be at least 16 characters.',
    ]);
    const password = 'dev-app-auth-password-not-a-secret';
    expect(problems({ ...valid, TPS_DB_APP_AUTH_PASSWORD: password })).toHaveLength(1);
    expect(
      problems({
        ...valid,
        TPS_DEV: '1',
        TPS_DB_HOST: 'db.internal',
        TPS_DB_APP_AUTH_PASSWORD: password,
      }),
    ).toHaveLength(1);
    expect(
      problems({
        ...valid,
        TPS_DEV: '1',
        TPS_DB_HOST: '127.0.0.1',
        TPS_DB_APP_AUTH_PASSWORD: password,
      }),
    ).toEqual([]);
  });

  it.each([
    'console.example.org',
    'https://console.example.org/console',
    'https://console.example.org?x=1',
    'https://user:pass@console.example.org',
    'ftp://console.example.org',
    'http://console.example.org',
  ])('refuses %s as an origin', (origin) => {
    expect(problems({ ...valid, TPS_CONSOLE_ORIGIN: origin })).toHaveLength(1);
  });

  it('allows http only for localhost names on this machine, and normalises origins', () => {
    const settings = loadAuthSettings({
      ...valid,
      TPS_CONSOLE_ORIGIN: 'http://console.localhost:5173',
      TPS_PORTAL_ORIGIN: 'HTTPS://Apply.Example.org:443/',
    });
    expect(settings.origins).toEqual({
      console: 'http://console.localhost:5173',
      portal: 'https://apply.example.org',
    });
  });

  it('needs the console prefix when both apps share a host, even on different ports', () => {
    const oneHost = {
      ...valid,
      TPS_CONSOLE_ORIGIN: 'https://grants.example.org:8443',
      TPS_PORTAL_ORIGIN: 'https://grants.example.org',
    };
    expect(problems(oneHost)).toEqual([
      'TPS_CONSOLE_ORIGIN and TPS_PORTAL_ORIGIN share a host, so set TPS_CONSOLE_PATH_PREFIX, such as /console. Two host names are safer.',
    ]);
    expect(
      loadAuthSettings({ ...oneHost, TPS_CONSOLE_PATH_PREFIX: '/console' }).consolePathPrefix,
    ).toBe('/console');
    for (const prefix of ['console', '/console/', '/api', '/Console', '/a/b']) {
      expect(problems({ ...oneHost, TPS_CONSOLE_PATH_PREFIX: prefix })).toHaveLength(1);
    }
  });

  it('refuses the console prefix with two hosts', () => {
    expect(problems({ ...valid, TPS_CONSOLE_PATH_PREFIX: '/console' })).toEqual([
      'TPS_CONSOLE_PATH_PREFIX is used only when console and portal share a host.',
    ]);
  });

  it('turns the breach check on unless it is off, and refuses any other value', () => {
    expect(loadAuthSettings(valid).breachCheck).toBe(true);
    expect(loadAuthSettings({ ...valid, TPS_AUTH_BREACH_CHECK: 'on' }).breachCheck).toBe(true);
    expect(loadAuthSettings({ ...valid, TPS_AUTH_BREACH_CHECK: 'off' }).breachCheck).toBe(false);
    for (const value of ['OFF', 'false', '0', 'no']) {
      expect(problems({ ...valid, TPS_AUTH_BREACH_CHECK: value })).toEqual([
        'TPS_AUTH_BREACH_CHECK must be on or off.',
      ]);
    }
  });
});
