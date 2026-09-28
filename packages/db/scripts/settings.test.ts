// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { readDatabaseName, readSecret, readServer } from './settings.ts';

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
    expect(readDatabaseName({ DB: 'pixelgrant_2026_w40' }, 'DB')).toBe('pixelgrant_2026_w40');
  });

  it('refuses names that would need quoting', () => {
    for (const name of ['Pixelgrant', 'pixel-grant', '1pixelgrant', 'a"; DROP', 'x'.repeat(64)]) {
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
    expect(readServer({ PIXELGRANT_DB_HOST: '127.0.0.1', PIXELGRANT_DB_PORT: '55432' })).toEqual({
      host: '127.0.0.1',
      port: 55432,
    });
  });

  it('refuses a port that is not a number', () => {
    expect(() =>
      readServer({ PIXELGRANT_DB_HOST: '127.0.0.1', PIXELGRANT_DB_PORT: 'postgres' }),
    ).toThrow('PIXELGRANT_DB_PORT must be');
  });
});
