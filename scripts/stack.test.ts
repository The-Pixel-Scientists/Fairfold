// SPDX-License-Identifier: AGPL-3.0-or-later

import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { publishedPort, seedEnvironment, storageIdentities, storageSecurity } from './stack.ts';

describe('seedEnvironment', () => {
  it("points the seed at the stack's database through the tunnel, with secrets as files", () => {
    const secrets = join('home', '.tps', 'stack', 'tps_stack_w');
    const inherited = {
      PATH: '/usr/bin',
      TPS_DB_HOST: 'db.example.org',
      Tps_Dev_Databases: 'tps_production',
      TPS_SEED_PASSWORD: 'from-the-shell',
    };
    expect(seedEnvironment(inherited, '49153', secrets)).toEqual({
      PATH: '/usr/bin',
      TPS_DEV: '1',
      TPS_DB_HOST: '127.0.0.1',
      TPS_DB_PORT: '49153',
      TPS_DB_NAME: 'tps',
      TPS_DEV_DATABASES: 'tps',
      TPS_DB_MIGRATOR_PASSWORD_FILE: join(secrets, 'TPS_STACK_MIGRATOR_PASSWORD'),
      TPS_SEED_PASSWORD_FILE: join(secrets, 'TPS_STACK_SEED_PASSWORD'),
    });
  });
});

describe('publishedPort', () => {
  it('reads a port published on this machine only', () => {
    expect(publishedPort('127.0.0.1:49153\n')).toBe('49153');
    for (const output of ['0.0.0.0:49153', '[::]:49153', '', '127.0.0.1:']) {
      expect(() => publishedPort(output), output).toThrow('Docker published the tunnel at');
    }
  });
});

const storageSecrets = Object.fromEntries(
  [
    'ADMIN_SECRET_KEY',
    'WRITE_SECRET_KEY',
    'READ_SECRET_KEY',
    'JWT_WRITE_KEY',
    'JWT_READ_KEY',
    'JWT_FILER_WRITE_KEY',
    'JWT_FILER_READ_KEY',
  ].map((name) => [`TPS_STACK_STORAGE_${name}`, `${name.toLowerCase()}-for-tests`]),
);

describe('storageIdentities', () => {
  it('gives each key pair only the bucket and prefix its purpose needs', () => {
    expect(JSON.parse(storageIdentities(storageSecrets))).toEqual({
      identities: [
        {
          name: 'tps-admin',
          credentials: [{ accessKey: 'tps-admin', secretKey: 'admin_secret_key-for-tests' }],
          actions: ['Admin:tps-files'],
        },
        {
          name: 'tps-write',
          credentials: [{ accessKey: 'tps-write', secretKey: 'write_secret_key-for-tests' }],
          actions: ['Write:tps-files/clean/*'],
        },
        {
          name: 'tps-read',
          credentials: [{ accessKey: 'tps-read', secretKey: 'read_secret_key-for-tests' }],
          actions: ['Read:tps-files/clean/*'],
        },
      ],
    });
  });

  it('refuses a missing key rather than writing an identity without one', () => {
    const rest = { ...storageSecrets, TPS_STACK_STORAGE_READ_SECRET_KEY: '' };
    expect(() => storageIdentities(rest)).toThrow('TPS_STACK_STORAGE_READ_SECRET_KEY is missing.');
  });
});

describe('storageSecurity', () => {
  it("signs SeaweedFS's own requests with a key for each purpose", () => {
    expect(storageSecurity(storageSecrets)).toBe(
      [
        '[jwt.signing]',
        'key = "jwt_write_key-for-tests"',
        '[jwt.signing.read]',
        'key = "jwt_read_key-for-tests"',
        '[jwt.filer_signing]',
        'key = "jwt_filer_write_key-for-tests"',
        '[jwt.filer_signing.read]',
        'key = "jwt_filer_read_key-for-tests"',
        '',
      ].join('\n'),
    );
  });
});
