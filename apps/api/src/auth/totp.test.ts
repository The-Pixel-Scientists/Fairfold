// SPDX-License-Identifier: AGPL-3.0-or-later

import { productName } from '@pixel-scientists/domain/platform';
import { symmetricDecrypt } from 'better-auth/crypto';
import { describe, expect, it } from 'vitest';

import { base32, codeAt, matchingStep, newSecret, stepAt } from './totp.ts';

/** RFC 6238 appendix B's SHA-1 secret. */
const RFC_SECRET = Buffer.from('12345678901234567890');

describe('codes', () => {
  it("match RFC 6238's SHA-1 test values, as 6 digits", () => {
    const vectors: [number, string][] = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ];
    for (const [seconds, code] of vectors) {
      expect(codeAt(RFC_SECRET, stepAt(seconds * 1000))).toBe(code.slice(-6));
    }
  });

  it('are accepted one step either side and no further, as the latest matching step', () => {
    const now = 1_800_000_000_000;
    const step = stepAt(now);
    for (const offset of [-1, 0, 1]) {
      expect(matchingStep(RFC_SECRET, codeAt(RFC_SECRET, step + offset), now)).toBe(step + offset);
    }
    for (const offset of [-3, -2, 2, 3]) {
      expect(matchingStep(RFC_SECRET, codeAt(RFC_SECRET, step + offset), now)).toBeNull();
    }
    expect(matchingStep(RFC_SECRET, '12345', now)).toBeNull();
  });
});

describe('base32', () => {
  it("matches RFC 4648's test values, without padding", () => {
    const vectors = ['', 'MY', 'MZXQ', 'MZXW6', 'MZXW6YQ', 'MZXW6YTB', 'MZXW6YTBOI'];
    vectors.forEach((encoded, length) => {
      expect(base32(Buffer.from('foobar'.slice(0, length)))).toBe(encoded);
    });
  });
});

describe('a new secret', () => {
  it('gives the key and URI of the secret it stores only encrypted', async () => {
    const secret = await newSecret('a synthetic auth secret of 32 characters', 'jo@example.test');
    expect(secret.key).toMatch(/^[A-Z2-7]{52}$/);
    const issuer = encodeURIComponent(productName);
    expect(secret.uri).toBe(
      `otpauth://totp/${issuer}:jo%40example.test?secret=${secret.key}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`,
    );
    expect(secret.stored).toMatch(/^[0-9a-f]{80,}$/);
    expect(secret.stored).not.toContain(secret.key);
    const raw = await symmetricDecrypt({
      key: 'a synthetic auth secret of 32 characters',
      data: secret.stored,
    });
    expect(base32(Buffer.from(raw))).toBe(secret.key);
  });
});
