// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  isLocalDevelopment,
  isLoopbackHost,
  readDatabaseName,
  readSecret,
  readServer,
} from './settings.ts';

const files: Record<string, string> = { '/run/secrets/migrator': 'from-file\n' };
const readFile = (path: string): string => {
  const content = files[path];
  if (content === undefined) throw new Error(`no such file: ${path}`);
  return content;
};

describe('readSecret', () => {
  it('reads the value from the environment', () => {
    expect(readSecret({ PASSWORD: 'from-env' }, 'PASSWORD', readFile)).toBe('from-env');
  });

  it('reads the value from the file named by NAME_FILE, without its final newline', () => {
    expect(readSecret({ PASSWORD_FILE: '/run/secrets/migrator' }, 'PASSWORD', readFile)).toBe(
      'from-file',
    );
  });

  it('refuses both NAME and NAME_FILE', () => {
    expect(() =>
      readSecret({ PASSWORD: 'a', PASSWORD_FILE: '/run/secrets/migrator' }, 'PASSWORD', readFile),
    ).toThrow('Set PASSWORD or PASSWORD_FILE, not both.');
  });

  it('refuses a missing or empty secret', () => {
    expect(() => readSecret({}, 'PASSWORD', readFile)).toThrow('Set PASSWORD or PASSWORD_FILE.');
    expect(() => readSecret({ PASSWORD: '' }, 'PASSWORD', readFile)).toThrow(
      'Set PASSWORD or PASSWORD_FILE.',
    );
  });
});

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

describe('isLoopbackHost', () => {
  it('accepts this machine', () => {
    for (const host of ['localhost', '127.0.0.1', '127.1.2.3', '::1', '[::1]']) {
      expect(isLoopbackHost(host)).toBe(true);
    }
  });

  it('refuses any other host, including names that only look local', () => {
    for (const host of [
      'db.example.org',
      '10.0.0.5',
      '192.168.1.10',
      '0.0.0.0',
      '127.0.0.1.nip.io',
      'localhost.example.org',
      '127.999.0.1',
      '::ffff:10.0.0.5',
      '',
    ]) {
      expect(isLoopbackHost(host)).toBe(false);
    }
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
