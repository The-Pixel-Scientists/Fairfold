// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { isLoopbackHost, readSecret, readSetting } from './settings.ts';

const files: Record<string, string> = { '/run/secrets/password': 'from-file\n' };
const readFile = (path: string): string => {
  const content = files[path];
  if (content === undefined) throw new Error(`no such file: ${path}`);
  return content;
};

describe('readSetting', () => {
  it('reads a value, and refuses a missing or empty one', () => {
    expect(readSetting({ NAME: 'value' }, 'NAME')).toBe('value');
    expect(() => readSetting({}, 'NAME')).toThrow('Set NAME.');
    expect(() => readSetting({ NAME: '' }, 'NAME')).toThrow('Set NAME.');
  });
});

describe('readSecret', () => {
  it('reads the value from the environment', () => {
    expect(readSecret({ PASSWORD: 'from-env' }, 'PASSWORD', readFile)).toBe('from-env');
  });

  it('reads the value from the file named by NAME_FILE, without its final newline', () => {
    expect(readSecret({ PASSWORD_FILE: '/run/secrets/password' }, 'PASSWORD', readFile)).toBe(
      'from-file',
    );
  });

  it('refuses both NAME and NAME_FILE', () => {
    expect(() =>
      readSecret({ PASSWORD: 'a', PASSWORD_FILE: '/run/secrets/password' }, 'PASSWORD', readFile),
    ).toThrow('Set PASSWORD or PASSWORD_FILE, not both.');
  });

  it('refuses a missing or empty secret', () => {
    expect(() => readSecret({}, 'PASSWORD', readFile)).toThrow('Set PASSWORD or PASSWORD_FILE.');
    expect(() => readSecret({ PASSWORD: '' }, 'PASSWORD', readFile)).toThrow(
      'Set PASSWORD or PASSWORD_FILE.',
    );
  });

  it('names the variable, not the path, when the file cannot be read', () => {
    expect(() => readSecret({ PASSWORD_FILE: '/home/someone/x' }, 'PASSWORD', readFile)).toThrow(
      /^PASSWORD_FILE names a file that cannot be read\.$/,
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
