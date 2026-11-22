// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The token in a marketing email's unsubscribe link (ADR 0033, ADR 0010).
// AES-256-GCM under a key used for nothing else, which HKDF-SHA-256 derives
// from a secret for the purpose `unsubscribe`. A random 96-bit nonce; the
// format and key versions travel in clear as associated data, so a changed
// byte anywhere fails the tag. The plaintext holds ids and codes only: the
// tenant, person, consent purpose and channel, the keyed hash of the address
// the message went to (so the public route can record the suppression without
// reading a tenant table), and the issue date. Never an address, name or
// tenant slug. It is valid for 24 months, and a key version
// verifies for as long as the caller keeps it. A bad token of any kind is
// `undefined`, never an error, and never says why.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

import { idSchema } from '@pixel-scientists/domain';
import { unsubscribeTokenSchema } from '@pixel-scientists/party/contracts';

import type { AddressHash } from './suppression-hash.ts';

const FORMAT = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 2;
const HASH_BYTES = 32;
const MAX_AGE_MS = 2 * 365 * 24 * 60 * 60 * 1000;

/** Purposes and channels by position in the token, so only a code travels. */
const PURPOSES = ['future_funding'] as const;
const CHANNELS = ['email', 'sms', 'phone', 'post'] as const;

export type UnsubscribePurpose = (typeof PURPOSES)[number];
export type UnsubscribeChannel = (typeof CHANNELS)[number];

export interface UnsubscribeTarget {
  readonly tenantId: string;
  readonly personId: string;
  readonly purpose: UnsubscribePurpose;
  readonly channel: UnsubscribeChannel;
  /** The keyed hash of the address and its key version: both set, or both null for post. */
  readonly address: AddressHash | null;
}

/** The purpose keys by version, and the version that signs new tokens. */
export interface UnsubscribeKeys {
  readonly current: number;
  readonly keys: ReadonlyMap<number, Buffer>;
}

/** Derive the keys from the secrets by version, which the caller reads and never logs. */
export function unsubscribeKeys(
  secrets: ReadonlyMap<number, string>,
  current: number,
): UnsubscribeKeys {
  if (!secrets.has(current)) throw new Error('The current unsubscribe key version has no secret.');
  const keys = new Map<number, Buffer>();
  for (const [version, secret] of secrets) {
    if (!Number.isInteger(version) || version < 1 || version > 255) {
      throw new Error('An unsubscribe key version must be a whole number from 1 to 255.');
    }
    if (secret.length < 32) throw new Error('An unsubscribe key secret is too short.');
    keys.set(version, Buffer.from(hkdfSync('sha256', secret, '', 'tps-unsubscribe', 32)));
  }
  return { current, keys };
}

const isAddress = (address: AddressHash | null, channel: UnsubscribeChannel): boolean =>
  address === null
    ? channel === 'post'
    : channel !== 'post' &&
      address.hash.length === HASH_BYTES &&
      Number.isInteger(address.keyVersion) &&
      address.keyVersion >= 1 &&
      address.keyVersion <= 255;

const plaintext = (target: UnsubscribeTarget, issuedAt: Date): Buffer =>
  Buffer.from(
    [
      target.tenantId,
      target.personId,
      PURPOSES.indexOf(target.purpose),
      CHANNELS.indexOf(target.channel),
      target.address?.hash.toString('base64url') ?? '',
      target.address?.keyVersion ?? '',
      Math.floor(issuedAt.getTime() / 1000),
    ].join('.'),
    'utf8',
  );

/** A token for the target, or throws if an id or code is not valid: a token is never made from unchecked input. */
export function signUnsubscribeToken(
  keys: UnsubscribeKeys,
  target: UnsubscribeTarget,
  issuedAt: Date = new Date(),
): string {
  if (
    !idSchema.safeParse(target.tenantId).success ||
    !idSchema.safeParse(target.personId).success ||
    !PURPOSES.includes(target.purpose) ||
    !CHANNELS.includes(target.channel) ||
    !isAddress(target.address, target.channel)
  ) {
    throw new Error('An unsubscribe token needs a valid target.');
  }
  const key = keys.keys.get(keys.current);
  if (key === undefined) throw new Error('The current unsubscribe key is missing.');
  const header = Buffer.from([FORMAT, keys.current]);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(header);
  const sealed = Buffer.concat([cipher.update(plaintext(target, issuedAt)), cipher.final()]);
  return Buffer.concat([header, nonce, sealed, cipher.getAuthTag()]).toString('base64url');
}

/** The target a token names, or undefined for any token that is not genuine, current and well formed. */
export function verifyUnsubscribeToken(
  keys: UnsubscribeKeys,
  token: string,
  now: Date = new Date(),
): UnsubscribeTarget | undefined {
  if (!unsubscribeTokenSchema.safeParse(token).success) return undefined;
  const bytes = Buffer.from(token, 'base64url');
  if (bytes.length < HEADER_BYTES + NONCE_BYTES + TAG_BYTES + 1) return undefined;
  const header = bytes.subarray(0, HEADER_BYTES);
  const key = keys.keys.get(header[1] ?? 0);
  if (header[0] !== FORMAT || key === undefined) return undefined;
  const nonce = bytes.subarray(HEADER_BYTES, HEADER_BYTES + NONCE_BYTES);
  const sealed = bytes.subarray(HEADER_BYTES + NONCE_BYTES, bytes.length - TAG_BYTES);
  let opened: string;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(header);
    decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));
    opened = Buffer.concat([decipher.update(sealed), decipher.final()]).toString('utf8');
  } catch {
    return undefined;
  }
  const [tenantId, personId, purpose, channel, hash, keyVersion, issued, ...extra] =
    opened.split('.');
  const issuedAt = Number(issued) * 1000;
  const address =
    hash === '' && keyVersion === ''
      ? null
      : { hash: Buffer.from(hash ?? '', 'base64url'), keyVersion: Number(keyVersion) };
  const target = {
    tenantId,
    personId,
    purpose: PURPOSES[Number(purpose)],
    channel: CHANNELS[Number(channel)],
    address,
  };
  if (
    extra.length > 0 ||
    !idSchema.safeParse(target.tenantId).success ||
    !idSchema.safeParse(target.personId).success ||
    target.purpose === undefined ||
    target.channel === undefined ||
    !isAddress(target.address, target.channel) ||
    !Number.isFinite(issuedAt) ||
    issuedAt > now.getTime() + 60_000 ||
    now.getTime() - issuedAt > MAX_AGE_MS
  ) {
    return undefined;
  }
  return target as UnsubscribeTarget;
}
