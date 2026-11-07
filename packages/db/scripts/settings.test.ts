// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  isLocalDevelopment,
  readDatabaseName,
  readServer,
  readServerConnection,
  type Env,
} from './settings.ts';

describe('readDatabaseName', () => {
  it('accepts a generated database name', () => {
    expect(readDatabaseName({ DB: 'tps_2026_w40' }, 'DB')).toBe('tps_2026_w40');
  });

  it('refuses names that would need quoting', () => {
    for (const name of ['Tps', 'tps-dev', '1tps', 'a"; DROP', 'x'.repeat(64)]) {
      expect(() => readDatabaseName({ DB: name }, 'DB')).toThrow('DB must be');
    }
  });

  it("refuses PostgreSQL's own databases", () => {
    for (const name of ['postgres', 'template0', 'template1']) {
      expect(() => readDatabaseName({ DB: name }, 'DB')).toThrow("names PostgreSQL's own database");
    }
  });
});

describe('readServer', () => {
  it('reads the host and port', () => {
    expect(readServer({ TPS_DB_HOST: '127.0.0.1', TPS_DB_PORT: '55432' })).toEqual({
      host: '127.0.0.1',
      port: 55432,
    });
  });

  it('refuses a port that is not a number', () => {
    expect(() => readServer({ TPS_DB_HOST: '127.0.0.1', TPS_DB_PORT: 'postgres' })).toThrow(
      'TPS_DB_PORT must be',
    );
  });
});

describe('isLocalDevelopment', () => {
  it('needs both the development flag and a server on this machine', () => {
    expect(isLocalDevelopment({ TPS_DEV: '1', TPS_DB_HOST: '127.0.0.1' })).toBe(true);
    expect(isLocalDevelopment({ TPS_DEV: '1', TPS_DB_HOST: 'db.example.org' })).toBe(false);
    expect(isLocalDevelopment({ TPS_DEV: '1' })).toBe(false);
    expect(isLocalDevelopment({ TPS_DEV: '0', TPS_DB_HOST: '127.0.0.1' })).toBe(false);
  });
});

describe('readServerConnection', () => {
  const remote = { TPS_DB_HOST: 'db.example.org', TPS_DB_PORT: '5432' };
  const ca = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';
  const noFile = (): string => {
    throw new Error('No file should be read.');
  };
  const sslFor = (env: Env, readFile = noFile) => readServerConnection(env, readFile).ssl;

  it('connects to a server on this machine without TLS by default', () => {
    expect(readServerConnection({ TPS_DB_HOST: '127.0.0.1', TPS_DB_PORT: '5432' })).toEqual({
      host: '127.0.0.1',
      port: 5432,
      ssl: false,
      sslnegotiation: 'postgres',
    });
  });

  it('refuses a server elsewhere until TPS_DB_TLS is set, naming the host', () => {
    for (const unset of [{}, { TPS_DB_TLS: '' }]) {
      expect(() => sslFor({ ...remote, ...unset })).toThrow(
        'Set TPS_DB_TLS for the database server at db.example.org to verify-full, or to disable on a private network.',
      );
    }
  });

  it('refuses modes that do not verify the server', () => {
    for (const mode of ['require', 'prefer', 'verify-ca', 'VERIFY-FULL']) {
      expect(() => sslFor({ ...remote, TPS_DB_TLS: mode })).toThrow(
        'TPS_DB_TLS must be verify-full or disable.',
      );
    }
  });

  it('turns TLS off only when told to', () => {
    expect(sslFor({ ...remote, TPS_DB_TLS: 'disable' })).toBe(false);
  });

  it('verifies the server with verify-full, with or without a CA', () => {
    expect(sslFor({ ...remote, TPS_DB_TLS: 'verify-full' })).toEqual({ rejectUnauthorized: true });
    expect(sslFor({ ...remote, TPS_DB_TLS: 'verify-full', TPS_DB_TLS_CA: ca })).toEqual({
      rejectUnauthorized: true,
      ca,
    });
    expect(
      sslFor(
        { ...remote, TPS_DB_TLS: 'verify-full', TPS_DB_TLS_CA_FILE: '/ca.pem' },
        () => `${ca}\n`,
      ),
    ).toEqual({ rejectUnauthorized: true, ca });
  });

  it('refuses a CA without verify-full', () => {
    for (const host of ['db.example.org', '127.0.0.1']) {
      for (const setting of [{ TPS_DB_TLS_CA: ca }, { TPS_DB_TLS_CA_FILE: '/ca.pem' }]) {
        for (const mode of [{}, { TPS_DB_TLS: 'disable' }]) {
          expect(() => sslFor({ ...remote, TPS_DB_HOST: host, ...setting, ...mode })).toThrow(
            'TPS_DB_TLS_CA is used only with TPS_DB_TLS=verify-full.',
          );
        }
      }
    }
  });

  it('refuses a CA set both ways', () => {
    const env = {
      ...remote,
      TPS_DB_TLS: 'verify-full',
      TPS_DB_TLS_CA: ca,
      TPS_DB_TLS_CA_FILE: '/ca.pem',
    };
    expect(() => sslFor(env)).toThrow('Set TPS_DB_TLS_CA or TPS_DB_TLS_CA_FILE, not both.');
  });

  it('names the setting, not the path, when the CA file cannot be read', () => {
    const env = { ...remote, TPS_DB_TLS: 'verify-full', TPS_DB_TLS_CA_FILE: '/secret/ca.pem' };
    expect(() => sslFor(env)).toThrow(/^TPS_DB_TLS_CA_FILE names a file that cannot be read\.$/);
  });
});
