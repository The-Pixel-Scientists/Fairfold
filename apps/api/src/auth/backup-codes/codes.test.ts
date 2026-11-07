// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Backup codes without a database (ADR 0010, "Secrets at rest" and "Tests"):
// random codes in the contract's form, kept under their own purpose key and
// useless under any other, and compared with every stored HMAC.

import * as crypto from 'node:crypto';

import { backupCodeSchema } from '@pixel-scientists/domain/auth';
import { symmetricDecrypt } from 'better-auth/crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Secret } from '../../config.ts';
import { newToken } from '../cookies.ts';
import { deviceKeys } from '../limits/device-cookie.ts';
import { backupCodeKeys, codeSet, decodeSet, encodeSet, matchIndex, newCodes } from './codes.ts';

vi.mock('node:crypto', async (original) => {
  const actual = await original<typeof crypto>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const secret = new Secret(newToken());
const one = (value: Secret) => ({ current: 1, versions: new Map([[1, value]]) });
const keys = backupCodeKeys(one(secret));
const USER = '0b9a3c1e-2f4d-4e6a-8b7c-1d2e3f4a5b6c';
const OTHER = '7c6b5a4f-3e2d-4c1b-9a8f-6e5d4c3b2a1f';

afterEach(() => {
  vi.mocked(crypto.timingSafeEqual).mockClear();
});

describe('new codes', () => {
  it('are 10 different codes in the contract’s form, from crypto.randomBytes only', () => {
    const random = vi.spyOn(Math, 'random');
    const codes = newCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(backupCodeSchema.parse(code)).toBe(code);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });
});

describe('a stored set', () => {
  const codes = newCodes();
  const set = codeSet(keys, USER, codes);
  const stored = encodeSet(set) ?? '';

  it('holds the key version and an HMAC per code, and no code', () => {
    expect(stored).toMatch(/^1:[0-9a-f]{64}(,[0-9a-f]{64}){9}$/);
    for (const code of codes) {
      expect(stored).not.toContain(code);
      expect(stored).not.toContain(code.replace('-', ''));
    }
    expect(decodeSet(stored)).toEqual(set);
    expect(encodeSet({ version: 1, hmacs: [] })).toBeNull();
    for (const junk of [null, '', '1:', '0:ab', `1:${'C3'.repeat(32)}`, codes.join(',')]) {
      expect(decodeSet(junk), String(junk)).toBeUndefined();
    }
  });

  it('matches each code however its case, spaces and hyphen are typed', () => {
    const [first = ''] = codes;
    for (const typed of [first, first.toUpperCase(), ` ${first.replace('-', ' ')} `]) {
      expect(matchIndex(keys, USER, set, typed), typed).toBe(0);
    }
    expect(matchIndex(keys, USER, set, codes[9] ?? '')).toBe(9);
    expect(matchIndex(keys, USER, set, 'zzzzz-zzzzz')).toBe(-1);
  });

  it('compares a code with every stored HMAC, even when the first matches', () => {
    expect(matchIndex(keys, USER, set, codes[0] ?? '')).toBe(0);
    expect(crypto.timingSafeEqual).toHaveBeenCalledTimes(10);
  });

  it('does nothing for another account, or a key version it does not know', () => {
    for (const code of codes) expect(matchIndex(keys, OTHER, set, code)).toBe(-1);
    expect(matchIndex(keys, USER, { ...set, version: 2 }, codes[0] ?? '')).toBe(-1);
  });

  it('still matches under version 1 once version 2 makes new sets', () => {
    const rotated = backupCodeKeys({
      current: 2,
      versions: new Map([
        [1, secret],
        [2, new Secret(newToken())],
      ]),
    });
    expect(matchIndex(rotated, USER, set, codes[3] ?? '')).toBe(3);
    const next = codeSet(rotated, USER, codes);
    expect(next.version).toBe(2);
    expect(next.hmacs).not.toEqual(set.hmacs);
  });

  it('cannot be reproduced with the auth secret or another purpose key', () => {
    const [first = ''] = codes;
    const other = [
      Buffer.from(secret.reveal()),
      deviceKeys(secret).keys.get(1),
      Buffer.from(crypto.hkdfSync('sha256', secret.reveal(), '', 'tps-auth-identifier', 32)),
    ];
    for (const key of other) {
      const wrong = { current: 1, keys: new Map([[1, key ?? Buffer.alloc(32)]]) };
      expect(matchIndex(wrong, USER, set, first)).toBe(-1);
    }
    expect(codeSet(backupCodeKeys(one(new Secret(newToken()))), USER, codes).hmacs).not.toEqual(
      set.hmacs,
    );
  });

  it('does not decrypt as Better Auth’s backup codes with the auth secret', async () => {
    const decrypted = await symmetricDecrypt({ key: secret.reveal(), data: stored }).catch(
      () => undefined,
    );
    for (const code of codes) expect(decrypted ?? '').not.toContain(code);
  });
});
