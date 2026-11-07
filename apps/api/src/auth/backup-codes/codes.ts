// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Backup codes (ADR 0010, "Secrets at rest"): 10 codes of 10 random
// characters in backupCodeSchema's alphabet, shown once as `xxxxx-xxxxx`.
// Each is kept only as an HMAC-SHA-256 of the user's id and the normalised
// code, under the backup code purpose key, which HKDF-SHA-256 derives from
// the auth secret; the set records the key's version. A code presented is
// compared with every stored HMAC in constant time, never stopping early.

import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

import type { Secret } from '../../config.ts';

const CODE_COUNT = 10;
/** Crockford base32 in lower case, as backupCodeSchema takes it. */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
/** As the column's check (migration 0025) requires. */
const STORED = /^([1-9][0-9]{0,8}):([0-9a-f]{64}(?:,[0-9a-f]{64}){0,9})$/;

/** The backup code purpose keys by version, and the version that makes new sets. */
export interface BackupCodeKeys {
  readonly current: number;
  readonly keys: ReadonlyMap<number, Buffer>;
}

export function backupCodeKeys(secret: Secret): BackupCodeKeys {
  const key = Buffer.from(hkdfSync('sha256', secret.reveal(), '', 'tps-auth-backup-code', 32));
  return { current: 1, keys: new Map([[1, key]]) };
}

/** A set of codes as HMACs, under the key of `version`. */
export interface CodeSet {
  readonly version: number;
  readonly hmacs: readonly Buffer[];
}

/** Lower case, with no space or hyphen: how a code is kept and checked. */
export const normalise = (code: string): string => code.toLowerCase().replaceAll(/[\s-]/g, '');

/** 10 different codes. 32 divides 256, so every character is equally likely. */
export function newCodes(): string[] {
  const codes = new Set<string>();
  while (codes.size < CODE_COUNT) {
    const text = [...randomBytes(10)].map((byte) => ALPHABET.charAt(byte & 31)).join('');
    codes.add(`${text.slice(0, 5)}-${text.slice(5)}`);
  }
  return [...codes];
}

function hmacOf(key: Buffer, userId: string, code: string): Buffer {
  return createHmac('sha256', key)
    .update(`${userId}:${normalise(code)}`)
    .digest();
}

/** The set for the user's `codes`, under the current key. */
export function codeSet(keys: BackupCodeKeys, userId: string, codes: readonly string[]): CodeSet {
  const key = keys.keys.get(keys.current);
  if (key === undefined) throw new Error('Backup codes need a key for the current version.');
  return { version: keys.current, hmacs: codes.map((code) => hmacOf(key, userId, code)) };
}

/** The column's value for `set`: null once no code is left. */
export function encodeSet(set: CodeSet): string | null {
  if (set.hmacs.length === 0) return null;
  return `${String(set.version)}:${set.hmacs.map((hmac) => hmac.toString('hex')).join(',')}`;
}

/** The set in the column, or none. */
export function decodeSet(stored: string | null): CodeSet | undefined {
  const [, version, hmacs] = STORED.exec(stored ?? '') ?? [];
  if (version === undefined || hmacs === undefined) return undefined;
  return {
    version: Number(version),
    hmacs: hmacs.split(',').map((hex) => Buffer.from(hex, 'hex')),
  };
}

/**
 * The index in `set` of the HMAC that `code` matches, or -1. The HMAC is made
 * even for an empty set, and compared with every stored one.
 */
export function matchIndex(
  keys: BackupCodeKeys,
  userId: string,
  set: CodeSet,
  code: string,
): number {
  const key = keys.keys.get(set.version);
  if (key === undefined) return -1;
  const presented = hmacOf(key, userId, code);
  let matched = -1;
  set.hmacs.forEach((stored, index) => {
    if (timingSafeEqual(stored, presented)) matched = index;
  });
  return matched;
}
