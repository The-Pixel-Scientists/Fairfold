// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Subject keys for personal values in audit events (ADR 0027, "Audit:
// per-subject crypto-shredding"). Each party has one 256-bit data key per
// tenant in app.subject_key, wrapped with AES-256-GCM under the platform
// key of its version, with the tenant and party ids as associated data. A
// value is sealed under its subject's data key with a fresh 96-bit nonce,
// and the event id, field id and side as associated data, so it opens
// nowhere else. Once app.destroy_subject_key() has run, every value sealed
// for that subject opens as erased. Keys and values never reach an error.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

import { sql, type Transaction } from 'kysely';

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** The platform key-encryption keys by version, and the version that wraps new keys. */
export interface KeyEncryptionKeys {
  readonly current: number;
  readonly keys: ReadonlyMap<number, Buffer>;
}

/**
 * The platform key of `version`, derived from its secret, which the caller
 * reads with readSecret() and never logs. It wraps data keys and nothing else.
 */
export function keyEncryptionKeys(version: number, secret: string): KeyEncryptionKeys {
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('The platform key version must be a whole number from 1.');
  }
  if (secret.length < 32) throw new Error('The platform key secret is too short.');
  const key = Buffer.from(hkdfSync('sha256', secret, '', 'tps-subject-key-wrap', KEY_BYTES));
  return { current: version, keys: new Map([[version, key]]) };
}

/** A subject's data key, or the fact that it was destroyed. */
export type SubjectKey =
  { readonly kind: 'live'; readonly key: Buffer } | { readonly kind: 'erased' };

/** Where a sealed value sits in the audit log, which it is bound to. */
export interface ValuePlace {
  readonly eventId: string;
  readonly fieldId: string;
  readonly side: 'before' | 'after';
}

/** A sealed value as it is stored in an event's changes. */
export interface SealedValue {
  readonly v: number;
  readonly sealed: string;
}

export type OpenedValue =
  { readonly kind: 'value'; readonly value: string } | { readonly kind: 'erased' };

const associatedData = (...parts: readonly string[]): Buffer =>
  Buffer.from(parts.join('\0'), 'utf8');

function seal(key: Buffer, aad: Buffer, plain: Buffer): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([nonce, body, cipher.getAuthTag()]);
}

function open(key: Buffer, aad: Buffer, sealed: Buffer): Buffer {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, NONCE_BYTES), {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(aad);
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
    const body = sealed.subarray(NONCE_BYTES, sealed.length - TAG_BYTES);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new Error('A sealed value failed authentication.');
  }
}

/** Seal one value for `place` under a live data key. */
export function sealValue(key: Buffer, place: ValuePlace, value: string): SealedValue {
  const aad = associatedData('app.audit_event', place.eventId, place.fieldId, place.side);
  return { v: 1, sealed: seal(key, aad, Buffer.from(value, 'utf8')).toString('base64') };
}

/**
 * Open a value sealed for `place`. A destroyed key gives erased, never part
 * of a value; anything that fails authentication throws.
 */
export function openValue(key: SubjectKey, place: ValuePlace, value: SealedValue): OpenedValue {
  if (key.kind === 'erased') return { kind: 'erased' };
  const sealed = Buffer.from(value.sealed, 'base64');
  if (value.v !== 1 || sealed.length < NONCE_BYTES + TAG_BYTES) {
    throw new Error('A sealed value is not in a known form.');
  }
  const aad = associatedData('app.audit_event', place.eventId, place.fieldId, place.side);
  return { kind: 'value', value: open(key.key, aad, sealed).toString('utf8') };
}

/** Wrap a data key for a subject of a tenant under the current platform key. */
export function wrapKey(
  keys: KeyEncryptionKeys,
  tenantId: string,
  subjectPartyId: string,
  key: Buffer,
): Buffer {
  return seal(platformKey(keys, keys.current), wrapData(tenantId, subjectPartyId), key);
}

/** Unwrap a stored key; a destroyed one, with no wrapped key, is erased. */
export function unwrapKey(
  keys: KeyEncryptionKeys,
  tenantId: string,
  subjectPartyId: string,
  row: { readonly wrapped_key: Buffer | null; readonly kek_version: number | null },
): SubjectKey {
  if (row.wrapped_key === null) return { kind: 'erased' };
  const key = open(
    platformKey(keys, row.kek_version ?? 0),
    wrapData(tenantId, subjectPartyId),
    row.wrapped_key,
  );
  return { kind: 'live', key };
}

const wrapData = (tenantId: string, subjectPartyId: string) =>
  associatedData('app.subject_key', tenantId, subjectPartyId);

function platformKey(keys: KeyEncryptionKeys, version: number): Buffer {
  const key = keys.keys.get(version);
  if (key === undefined) throw new Error(`No platform key has version ${String(version)}.`);
  return key;
}

interface KeyRow {
  wrapped_key: Buffer | null;
  kek_version: number | null;
}

async function tenantOf<DB>(trx: Transaction<DB>): Promise<string> {
  const { rows } = await sql<{ tenant: string | null }>`
    SELECT app.current_tenant_id() AS tenant`.execute(trx);
  const tenant = rows[0]?.tenant;
  if (!tenant) throw new Error('Subject keys need a tenant set on the transaction.');
  return tenant;
}

async function readRow<DB>(
  trx: Transaction<DB>,
  tenantId: string,
  subjectPartyId: string,
): Promise<KeyRow | undefined> {
  const { rows } = await sql<KeyRow>`
    SELECT wrapped_key, kek_version FROM app.subject_key
     WHERE tenant_id = ${tenantId} AND subject_party_id = ${subjectPartyId}`.execute(trx);
  return rows[0];
}

/** The subject's key in the transaction's tenant, or undefined if it has none. */
export async function findSubjectKey<DB>(
  trx: Transaction<DB>,
  keys: KeyEncryptionKeys,
  subjectPartyId: string,
): Promise<SubjectKey | undefined> {
  const tenantId = await tenantOf(trx);
  const row = await readRow(trx, tenantId, subjectPartyId);
  return row && unwrapKey(keys, tenantId, subjectPartyId, row);
}

/**
 * The subject's key in the transaction's tenant, made now if it has none.
 * If another transaction makes it first, or it was destroyed, that row wins.
 */
export async function subjectKey<DB>(
  trx: Transaction<DB>,
  keys: KeyEncryptionKeys,
  subjectPartyId: string,
): Promise<SubjectKey> {
  const tenantId = await tenantOf(trx);
  let row = await readRow(trx, tenantId, subjectPartyId);
  if (!row) {
    const wrapped = wrapKey(keys, tenantId, subjectPartyId, randomBytes(KEY_BYTES));
    await sql`
      INSERT INTO app.subject_key (tenant_id, subject_party_id, wrapped_key, kek_version)
      VALUES (${tenantId}, ${subjectPartyId}, ${wrapped}, ${keys.current})
      ON CONFLICT DO NOTHING`.execute(trx);
    row = await readRow(trx, tenantId, subjectPartyId);
  }
  if (!row) throw new Error('The subject key could not be read.');
  return unwrapKey(keys, tenantId, subjectPartyId, row);
}
