// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Better Auth's versioned secrets: the version TPS_AUTH_SECRET_CURRENT names
// seals new values, every configured version opens its own, and version 1
// also opens values stored with no version.

import { createDatabase } from '@pixel-scientists/db';
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { describe, expect, it } from 'vitest';

import { createBetterAuth } from './better-auth.ts';
import { newToken } from './cookies.ts';
import { loadAuthSettings } from './settings.ts';

const ONE = newToken();
const TWO = newToken();
const env = {
  TPS_DB_APP_AUTH_PASSWORD: 'a-long-enough-password',
  TPS_CONSOLE_ORIGIN: 'https://console.example.org',
  TPS_PORTAL_ORIGIN: 'https://apply.example.org',
};

/** Better Auth's key set as createAuth() configures it, on a database never reached. */
async function secretConfig(secrets: Record<string, string>) {
  const db = createDatabase<unknown>({
    host: '127.0.0.1',
    port: 9,
    database: 'tps_unused',
    role: 'app_auth',
    password: 'x'.repeat(16),
    applicationName: 'tps-unused',
  });
  try {
    const auth = createBetterAuth(loadAuthSettings({ ...env, ...secrets }), db);
    return (await auth.$context).secretConfig;
  } finally {
    await db.destroy();
  }
}

describe("Better Auth's secrets", () => {
  it('seal with the current version and open every configured one', async () => {
    const key = await secretConfig({
      TPS_AUTH_SECRET: ONE,
      TPS_AUTH_SECRET_2: TWO,
      TPS_AUTH_SECRET_CURRENT: '2',
    });
    const sealed = await symmetricEncrypt({ key, data: 'totp' });
    expect(sealed).toMatch(/^\$ba\$2\$/);
    expect(sealed).not.toContain(TWO);

    const bare = await symmetricEncrypt({ key: ONE, data: 'bare' });
    expect(await symmetricDecrypt({ key, data: bare })).toBe('bare');
    const one = await symmetricEncrypt({
      key: await secretConfig({ TPS_AUTH_SECRET: ONE }),
      data: 'one',
    });
    expect(one).toMatch(/^\$ba\$1\$/);
    expect(await symmetricDecrypt({ key, data: one })).toBe('one');
  });

  it('cannot open a value from a version that is not configured', async () => {
    const key = await secretConfig({ TPS_AUTH_SECRET_2: TWO });
    const one = await symmetricEncrypt({
      key: await secretConfig({ TPS_AUTH_SECRET: ONE }),
      data: 'one',
    });
    await expect(symmetricDecrypt({ key, data: one })).rejects.toThrow();
    const bare = await symmetricEncrypt({ key: ONE, data: 'bare' });
    await expect(symmetricDecrypt({ key, data: bare })).rejects.toThrow();
  });
});
