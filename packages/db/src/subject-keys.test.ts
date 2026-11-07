// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomBytes, randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  keyEncryptionKeys,
  openValue,
  sealValue,
  unwrapKey,
  wrapKey,
  type SubjectKey,
  type ValuePlace,
} from './subject-keys.ts';

const SECRET = 'a'.repeat(48);
const keys = keyEncryptionKeys(1, SECRET);
const tenant = randomUUID();
const subject = randomUUID();
const dataKey = randomBytes(32);
const live: SubjectKey = { kind: 'live', key: dataKey };
const place: ValuePlace = { eventId: randomUUID(), fieldId: 'party.person.email', side: 'after' };

/** `sealed` with one byte at `at` flipped. */
function flipped(sealed: string, at: number): string {
  const bytes = Buffer.from(sealed, 'base64');
  bytes.writeUInt8(bytes.readUInt8(at) ^ 1, at);
  return bytes.toString('base64');
}

describe('sealed values', () => {
  it('open where they were sealed', () => {
    const sealed = sealValue(dataKey, place, 'ada@example.test');
    expect(sealed.sealed).not.toContain('ada');
    expect(openValue(live, place, sealed)).toEqual({ kind: 'value', value: 'ada@example.test' });
  });

  it('use a fresh nonce each time', () => {
    expect(sealValue(dataKey, place, 'x').sealed).not.toBe(sealValue(dataKey, place, 'x').sealed);
  });

  it.each([
    ['another event', { ...place, eventId: randomUUID() }],
    ['another field', { ...place, fieldId: 'party.person.phone' }],
    ['the other side', { ...place, side: 'before' as const }],
  ])('fail to open for %s', (_, elsewhere) => {
    const sealed = sealValue(dataKey, place, 'ada@example.test');
    expect(() => openValue(live, elsewhere, sealed)).toThrow(
      'A sealed value failed authentication.',
    );
  });

  it.each([
    ['nonce', 0],
    ['ciphertext', 12],
    ['tag', 12 + 'ada@example.test'.length],
  ])('fail to open with a changed %s', (_, at) => {
    const sealed = sealValue(dataKey, place, 'ada@example.test');
    const changed = { ...sealed, sealed: flipped(sealed.sealed, at) };
    expect(() => openValue(live, place, changed)).toThrow('A sealed value failed authentication.');
  });

  it('fail to open under another key, without echoing the value', () => {
    const sealed = sealValue(dataKey, place, 'ada@example.test');
    const other: SubjectKey = { kind: 'live', key: randomBytes(32) };
    expect(() => openValue(other, place, sealed)).toThrow(
      /^A sealed value failed authentication\.$/,
    );
  });

  it('refuse an unknown form', () => {
    const sealed = sealValue(dataKey, place, 'x');
    expect(() => openValue(live, place, { ...sealed, v: 2 })).toThrow('not in a known form');
    expect(() => openValue(live, place, { v: 1, sealed: '' })).toThrow('not in a known form');
  });

  it('read as erased once the key is destroyed', () => {
    const sealed = sealValue(dataKey, place, 'ada@example.test');
    expect(openValue({ kind: 'erased' }, place, sealed)).toEqual({ kind: 'erased' });
  });
});

describe('wrapped data keys', () => {
  const wrapped = wrapKey(keys, tenant, subject, dataKey);
  const row = { wrapped_key: wrapped, kek_version: 1 };

  it('unwrap for their tenant and subject', () => {
    expect(wrapped).toHaveLength(60);
    expect(unwrapKey(keys, tenant, subject, row)).toEqual(live);
  });

  it.each([
    ['another tenant', randomUUID(), subject],
    ['another subject', tenant, randomUUID()],
  ])('fail to unwrap for %s', (_, otherTenant, otherSubject) => {
    expect(() => unwrapKey(keys, otherTenant, otherSubject, row)).toThrow(
      'A sealed value failed authentication.',
    );
  });

  it('fail closed for a platform key version the deployment does not hold', () => {
    expect(() => unwrapKey(keys, tenant, subject, { ...row, kek_version: 2 })).toThrow(
      'No platform key has version 2.',
    );
    expect(() => unwrapKey(keyEncryptionKeys(1, 'b'.repeat(48)), tenant, subject, row)).toThrow(
      'A sealed value failed authentication.',
    );
  });

  it('read as erased once destroyed', () => {
    expect(unwrapKey(keys, tenant, subject, { wrapped_key: null, kek_version: 1 })).toEqual({
      kind: 'erased',
    });
  });
});

describe('keyEncryptionKeys', () => {
  it('refuses a bad version or a short secret, without echoing it', () => {
    expect(() => keyEncryptionKeys(0, SECRET)).toThrow('whole number from 1');
    expect(() => keyEncryptionKeys(1, 'short')).toThrow(/^The platform key secret is too short\.$/);
  });
});
