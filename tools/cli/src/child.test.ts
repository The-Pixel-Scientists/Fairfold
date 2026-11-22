// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { checkDatabaseTls, checkNoSecretValues, childEnv } from './child.ts';

describe('checkNoSecretValues', () => {
  it('refuses any setting that holds a secret, and allows files and other settings', () => {
    for (const name of [
      'TPS_DB_MIGRATOR_PASSWORD',
      'TPS_AUTH_SECRET',
      'TPS_AUTH_SECRET_2',
      'TPS_REQUEST_LIMIT_KEY',
      'TPS_SUBJECT_KEK',
      'TPS_STORAGE_WRITE_SECRET_ACCESS_KEY',
      'TPS_SMTP_PASSWORD',
    ]) {
      expect(() => {
        checkNoSecretValues({ [name]: 'value' });
      }, name).toThrow(`${name} holds a secret`);
    }
    expect(() => {
      checkNoSecretValues({
        TPS_DB_MIGRATOR_PASSWORD_FILE: '/run/secrets/migrator_password',
        TPS_DB_MIGRATOR_PASSWORD: '',
        TPS_AUTH_SECRET_CURRENT: '2',
        TPS_STORAGE_WRITE_ACCESS_KEY_ID: 'tps-write',
        TPS_SUBJECT_KEK_VERSION: '1',
        TPS_DB_HOST: 'db.example.org',
      });
    }).not.toThrow();
  });
});

describe('checkDatabaseTls', () => {
  it('refuses a server elsewhere unless TLS is verified', () => {
    for (const tls of [undefined, 'disable']) {
      expect(() => {
        checkDatabaseTls({ TPS_DB_HOST: 'db.example.org', TPS_DB_TLS: tls });
      }).toThrow('Set TPS_DB_TLS=verify-full');
    }
    expect(() => {
      checkDatabaseTls({ TPS_DB_HOST: 'db.example.org', TPS_DB_TLS: 'verify-full' });
    }).not.toThrow();
    expect(() => {
      checkDatabaseTls({ TPS_DB_HOST: '127.0.0.1' });
    }).not.toThrow();
    expect(() => {
      checkDatabaseTls({});
    }).toThrow('Set TPS_DB_HOST');
  });
});

describe('childEnv', () => {
  it('passes non-secret settings and the system path, then the secret files, and nothing else', () => {
    const env = childEnv(
      {
        PATH: '/usr/bin',
        HOME: '/home/operator',
        NODE_OPTIONS: '--require ./anything.js',
        HTTPS_PROXY: 'http://proxy.example.org',
        PGPASSWORD: 'inherited',
        TPS_DB_HOST: 'db.example.org',
        TPS_DB_MIGRATOR_PASSWORD: 'inherited',
        TPS_DB_MIGRATOR_PASSWORD_FILE: '/elsewhere',
        TPS_DB_TLS: undefined,
      },
      { TPS_DB_MIGRATOR_PASSWORD_FILE: '/secrets/migrator_password' },
    );
    expect(env).toEqual({
      PATH: '/usr/bin',
      TPS_DB_HOST: 'db.example.org',
      TPS_DB_MIGRATOR_PASSWORD_FILE: '/secrets/migrator_password',
    });
  });
});
