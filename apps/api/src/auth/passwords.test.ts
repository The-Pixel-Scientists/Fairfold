// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import {
  hashPassword,
  isCommonPassword,
  loadCommonPasswords,
  MINIMUM_COMMON_PASSWORDS,
  verifyNothing,
  verifyPassword,
} from './passwords.ts';

/** The check on auth.account.password (migration 0004). */
const STORED =
  /^\$argon2id\$v=19\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]{16,}\$[A-Za-z0-9+/]{32,}$/;

describe('password hashes', () => {
  it("are Argon2id at OWASP's minimum, as PHC strings the database accepts", async () => {
    const hash = await hashPassword('a long synthetic passphrase');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(hash).toMatch(STORED);
    expect(hash).not.toContain('passphrase');
  });

  it('use a new salt each time, and verify only the right password', async () => {
    const [first, second] = await Promise.all([
      hashPassword('a long synthetic passphrase'),
      hashPassword('a long synthetic passphrase'),
    ]);
    expect(first).not.toBe(second);
    expect(await verifyPassword(first, 'a long synthetic passphrase')).toBe(true);
    expect(await verifyPassword(first, 'a long synthetic passphrasE')).toBe(false);
  });

  it('refuse a string that is not one', async () => {
    expect(await verifyPassword('', 'anything at all')).toBe(false);
    expect(await verifyPassword('$scrypt$abc$def', 'anything at all')).toBe(false);
  });

  it('cost a dummy verification for an address without a password', async () => {
    expect(await verifyNothing('anything at all')).toBe(false);
  });
});

describe('the common-password list', () => {
  const folder = mkdtempSync(join(tmpdir(), 'tps-passwords-'));
  afterAll(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  function list(lines: readonly string[]): URL {
    const file = join(folder, `${String(lines.length)}.txt`);
    writeFileSync(file, lines.join('\r\n'), 'utf8');
    return pathToFileURL(file);
  }

  const synthetic = Array.from(
    { length: MINIMUM_COMMON_PASSWORDS },
    (_, index) => `syntheticpass${String(index)}`,
  );

  it('loads entries of 12 or more characters, compared without case', () => {
    const loaded = loadCommonPasswords(list([...synthetic, 'short', 'Correct Horse Battery']));
    expect(loaded?.size).toBe(MINIMUM_COMMON_PASSWORDS + 1);
    expect(isCommonPassword(loaded ?? new Set(), 'SyntheticPass42')).toBe(true);
    expect(isCommonPassword(loaded ?? new Set(), 'correct horse battery')).toBe(true);
    expect(isCommonPassword(loaded ?? new Set(), 'short')).toBe(false);
    expect(isCommonPassword(loaded ?? new Set(), 'a long synthetic passphrase')).toBe(false);
  });

  it('is refused when missing or shorter than the minimum, so no password can be set', () => {
    expect(loadCommonPasswords(pathToFileURL(join(folder, 'missing.txt')))).toBeUndefined();
    expect(loadCommonPasswords(list(synthetic.slice(1)))).toBeUndefined();
  });
});
