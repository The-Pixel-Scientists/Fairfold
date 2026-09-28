// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { scramSha256Verifier } from './scram.ts';

// PostgreSQL 16 stored this for `CREATE ROLE ... PASSWORD 'correct horse battery staple'`.
const POSTGRES_VERIFIER =
  'SCRAM-SHA-256$4096:lBCtzAdZr9/zNOXCRGdLhw==$ZikiiUNsPQ1AgZigdsKELaQCr66IpFJ2GN0mOPAv9hE=:Lki4DhftfvqjUlYXx8uVO+VtXCZhE3VaJr8ew8R2tUA=';

describe('scramSha256Verifier', () => {
  it('matches the verifier PostgreSQL computes for the same salt', () => {
    const salt = Buffer.from('lBCtzAdZr9/zNOXCRGdLhw==', 'base64');
    expect(scramSha256Verifier('correct horse battery staple', salt, 4096)).toBe(POSTGRES_VERIFIER);
  });

  it('uses a fresh salt each time', () => {
    expect(scramSha256Verifier('correct horse battery staple')).not.toBe(
      scramSha256Verifier('correct horse battery staple'),
    );
  });

  it('never contains the password', () => {
    expect(scramSha256Verifier('correct horse battery staple')).not.toContain('horse');
  });

  it('refuses characters outside printable ASCII', () => {
    for (const password of ['pässwörd-long-enough', 'tab\tseparated-password', '']) {
      expect(() => scramSha256Verifier(password)).toThrow('printable ASCII');
    }
  });
});
