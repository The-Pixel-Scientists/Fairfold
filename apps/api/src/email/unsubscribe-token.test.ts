// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { addressHash, suppressionKeys } from './suppression-hash.ts';
import {
  signUnsubscribeToken,
  unsubscribeKeys,
  verifyUnsubscribeToken,
  type UnsubscribeTarget,
} from './unsubscribe-token.ts';

const SECRET = 'a-secret-of-at-least-thirty-two-characters';
const keys = unsubscribeKeys(new Map([[1, SECRET]]), 1);
const tenantId = randomUUID();
const hashKeys = suppressionKeys(new Map([[3, 'a-suppression-secret-of-at-least-32-chars']]), 3);
const address = addressHash(hashKeys, tenantId, 'ada@example.com');
const target: UnsubscribeTarget = {
  tenantId,
  personId: randomUUID(),
  purpose: 'future_funding',
  channel: 'email',
  address,
};

describe('unsubscribe token', () => {
  it('names the tenant, person, purpose, channel and address hash, and nothing else', () => {
    const token = signUnsubscribeToken(keys, target);

    expect(token).toMatch(/^[A-Za-z0-9_-]{32,512}$/);
    expect(verifyUnsubscribeToken(keys, token)).toEqual(target);
  });

  it('holds no readable id or code', () => {
    const token = signUnsubscribeToken(keys, target);
    const bytes = Buffer.from(token, 'base64url').toString('latin1');

    expect(token).not.toContain(target.tenantId);
    expect(bytes).not.toContain(target.personId);
    expect(bytes).not.toContain('future_funding');
  });

  it('carries the address hash and its key version, and never the address or the hash in clear', () => {
    const token = signUnsubscribeToken(keys, target);
    const opened = verifyUnsubscribeToken(keys, token);
    const bytes = Buffer.from(token, 'base64url');

    expect(opened?.address?.hash.equals(address.hash)).toBe(true);
    expect(opened?.address?.keyVersion).toBe(3);
    expect(bytes.includes(address.hash)).toBe(false);
    expect(bytes.toString('latin1')).not.toContain(address.hash.toString('base64url'));
    expect(bytes.toString('latin1')).not.toContain('ada@example.com');
  });

  it('differs each time it is made', () => {
    expect(signUnsubscribeToken(keys, target)).not.toBe(signUnsubscribeToken(keys, target));
  });

  it('refuses a token made under another secret, and another key version', () => {
    const token = signUnsubscribeToken(keys, target);
    const other = unsubscribeKeys(new Map([[1, 'another-secret-of-at-least-32-characters']]), 1);
    const later = unsubscribeKeys(new Map([[2, SECRET]]), 2);

    expect(verifyUnsubscribeToken(other, token)).toBeUndefined();
    expect(verifyUnsubscribeToken(later, token)).toBeUndefined();
  });

  it('verifies a token of an older key version while that version is kept', () => {
    const token = signUnsubscribeToken(keys, target);
    const rotated = unsubscribeKeys(
      new Map([
        [1, SECRET],
        [2, 'a-newer-secret-of-at-least-32-characters'],
      ]),
      2,
    );

    expect(verifyUnsubscribeToken(rotated, token)).toEqual(target);
    expect(verifyUnsubscribeToken(rotated, signUnsubscribeToken(rotated, target))).toEqual(target);
  });

  it('refuses any changed byte', () => {
    const bytes = Buffer.from(signUnsubscribeToken(keys, target), 'base64url');
    for (let index = 0; index < bytes.length; index += 1) {
      const changed = Buffer.from(bytes);
      changed[index] = (changed[index] ?? 0) ^ 1;
      expect(verifyUnsubscribeToken(keys, changed.toString('base64url'))).toBeUndefined();
    }
  });

  it('refuses a token that is cut, extended, empty or not base64url', () => {
    const token = signUnsubscribeToken(keys, target);

    for (const bad of [
      token.slice(0, -4),
      `${token}AAAA`,
      '',
      'a b',
      `${token}\n`,
      '!'.repeat(40),
    ]) {
      expect(verifyUnsubscribeToken(keys, bad)).toBeUndefined();
    }
  });

  it('is valid for two years and no longer, and never from the future', () => {
    const token = signUnsubscribeToken(keys, target, new Date('2027-01-06T10:00:00Z'));

    expect(verifyUnsubscribeToken(keys, token, new Date('2028-12-31T00:00:00Z'))).toEqual(target);
    expect(verifyUnsubscribeToken(keys, token, new Date('2029-01-08T00:00:00Z'))).toBeUndefined();
    expect(verifyUnsubscribeToken(keys, token, new Date('2026-12-01T00:00:00Z'))).toBeUndefined();
  });

  it('is never made from a target that is not valid', () => {
    expect(() => signUnsubscribeToken(keys, { ...target, personId: 'not-an-id' })).toThrow();
    expect(() => signUnsubscribeToken(keys, { ...target, purpose: 'other' as never })).toThrow();
    expect(() => signUnsubscribeToken(keys, { ...target, channel: 'fax' as never })).toThrow();
    expect(() => signUnsubscribeToken(keys, { ...target, address: null })).toThrow();
    expect(() =>
      signUnsubscribeToken(keys, { ...target, address: { hash: Buffer.alloc(31), keyVersion: 1 } }),
    ).toThrow();
    expect(() =>
      signUnsubscribeToken(keys, { ...target, address: { ...address, keyVersion: 0 } }),
    ).toThrow();
    expect(() => signUnsubscribeToken(keys, { ...target, channel: 'post' })).toThrow();
  });

  it('is not built from a short secret or a missing current version', () => {
    expect(() => unsubscribeKeys(new Map([[1, 'short']]), 1)).toThrow();
    expect(() => unsubscribeKeys(new Map([[1, SECRET]]), 2)).toThrow();
  });
});

describe('address hash', () => {
  const secrets = new Map([[3, 'a-suppression-secret-of-at-least-32-chars']]);

  it('ignores case and surrounding space, and differs by tenant, address and secret', () => {
    const base = addressHash(hashKeys, tenantId, 'ada@example.com');

    expect(base.hash).toHaveLength(32);
    expect(addressHash(hashKeys, tenantId, '  Ada@Example.COM ').hash.equals(base.hash)).toBe(true);
    expect(addressHash(hashKeys, randomUUID(), 'ada@example.com').hash.equals(base.hash)).toBe(
      false,
    );
    expect(addressHash(hashKeys, tenantId, 'bob@example.com').hash.equals(base.hash)).toBe(false);
    const other = suppressionKeys(new Map([[3, 'another-suppression-secret-of-32-chars!']]), 3);
    expect(addressHash(other, tenantId, 'ada@example.com').hash.equals(base.hash)).toBe(false);
  });

  it('is not made without a valid tenant, a long secret or the current version', () => {
    expect(() => addressHash(hashKeys, 'not-an-id', 'ada@example.com')).toThrow();
    expect(() => suppressionKeys(new Map([[1, 'short']]), 1)).toThrow();
    expect(() => suppressionKeys(secrets, 1)).toThrow();
  });
});
