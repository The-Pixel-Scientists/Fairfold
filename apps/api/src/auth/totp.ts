// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Authenticator app codes (ADR 0010): RFC 6238 with SHA-1, 6 digits and
// 30-second steps, one step either side. A secret is made and encrypted with
// Better Auth's own helpers and key, exactly as its two-factor plugin does,
// so its key rotation covers it; Better Auth's verify route stays unmounted.
// useCode() is the only way a code is accepted. In the caller's transaction
// it locks the user's row, refuses a code for the last accepted step or an
// earlier one, and records the new step, so a code works once, even in
// requests sent at the same moment.

import { createHmac, timingSafeEqual } from 'node:crypto';

import type { Transaction } from '@pixel-scientists/db';
import { productName } from '@pixel-scientists/domain/platform';
import {
  generateRandomString,
  symmetricDecrypt,
  symmetricEncrypt,
  type SecretConfig,
} from 'better-auth/crypto';

import type { AuthTables } from './tables.ts';

const STEP_SECONDS = 30;
const DIGITS = 6;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Better Auth's key: the auth secret, or its versioned secrets. */
export type TotpKey = string | SecretConfig;

/** RFC 4648 base32 without padding, as authenticator apps take a key. */
export function base32(bytes: Uint8Array): string {
  let text = '';
  let value = 0;
  let bits = 0;
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xfff;
    bits += 8;
    for (; bits >= 5; bits -= 5) text += BASE32.charAt((value >>> (bits - 5)) & 31);
  }
  return bits > 0 ? text + BASE32.charAt((value << (5 - bits)) & 31) : text;
}

/** The time step `ms` falls in. */
export const stepAt = (ms: number): number => Math.floor(ms / 1000 / STEP_SECONDS);

/** The code for one time step (RFC 4226, with RFC 6238's counter). */
export function codeAt(secret: Uint8Array, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const value = mac.readUInt32BE((mac.at(-1) ?? 0) & 0xf) & 0x7fffffff;
  return String(value % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** The latest step within one of now whose code is `code`. Every candidate is compared in full. */
export function matchingStep(secret: Uint8Array, code: string, now = Date.now()): number | null {
  if (code.length !== DIGITS) return null;
  const typed = Buffer.from(code);
  const current = stepAt(now);
  let matched: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    if (timingSafeEqual(Buffer.from(codeAt(secret, step)), typed)) matched = step;
  }
  return matched;
}

export interface NewSecret {
  /** The key to type into the app. */
  readonly key: string;
  /** The `otpauth://` URI for the QR code. */
  readonly uri: string;
  /** What auth.two_factor stores: the secret as Better Auth encrypts it. */
  readonly stored: string;
}

/** A new secret for `account` (an email address), with the product as issuer. */
export async function newSecret(key: TotpKey, account: string): Promise<NewSecret> {
  const secret = generateRandomString(32);
  const text = base32(Buffer.from(secret, 'utf8'));
  const issuer = encodeURIComponent(productName);
  const query = `secret=${text}&issuer=${issuer}&algorithm=SHA1&digits=${String(DIGITS)}&period=${String(STEP_SECONDS)}`;
  return {
    key: text,
    uri: `otpauth://totp/${issuer}:${encodeURIComponent(account)}?${query}`,
    stored: await symmetricEncrypt({ key, data: secret }),
  };
}

/**
 * Accept `code` from the user, once, in `trx` as app_auth: `confirm` checks
 * the secret still being set up and confirms it, `verify` the confirmed one.
 * The user's row stays locked until `trx` ends. False for a wrong code, a
 * step already used or no such secret.
 */
export async function useCode(
  trx: Transaction<unknown>,
  key: TotpKey,
  userId: string,
  code: string,
  use: 'confirm' | 'verify',
): Promise<boolean> {
  const db = trx.$extendTables<AuthTables>();
  const row = await db
    .selectFrom('auth.two_factor')
    .select(['secret', 'last_used_step'])
    .where('user_id', '=', userId)
    .where('verified', '=', use === 'verify')
    .forUpdate()
    .executeTakeFirst();
  if (row === undefined) return false;
  const secret = Buffer.from(await symmetricDecrypt({ key, data: row.secret }), 'utf8');
  const step = matchingStep(secret, code);
  if (step === null || (row.last_used_step !== null && step <= Number(row.last_used_step))) {
    return false;
  }
  await db
    .updateTable('auth.two_factor')
    .set({ last_used_step: step, verified: true })
    .where('user_id', '=', userId)
    .execute();
  return true;
}
