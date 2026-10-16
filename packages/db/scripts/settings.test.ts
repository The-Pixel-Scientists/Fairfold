// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { isLocalDevelopment, readDatabaseName, readServer } from './settings.ts';

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
