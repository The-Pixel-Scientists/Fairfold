// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The code an authenticator app shows for a set-up key (RFC 6238: HMAC-SHA1,
// 30-second steps, 6 digits), so the journey against the real API can finish
// MFA the way a person does, from the key on the screen.

import { createHmac } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;

/** The bytes of a base32 key (RFC 4648), ignoring spaces, case and padding. */
function base32Decode(key: string): Buffer {
  let bits = '';
  for (const character of key.replace(/[\s=]/g, '').toUpperCase()) {
    const value = ALPHABET.indexOf(character);
    if (value < 0) throw new Error('The key is not base32.');
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((byte) => Number.parseInt(byte, 2)));
}

/** The six-digit code for a key at a time, in milliseconds since 1970. */
export function totp(key: string, atMs = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 1000 / STEP_SECONDS)));
  const hash = createHmac('sha1', base32Decode(key)).update(counter).digest();
  const offset = (hash[hash.length - 1] ?? 0) & 0x0f;
  const value =
    (((hash[offset] ?? 0) & 0x7f) << 24) |
    ((hash[offset + 1] ?? 0) << 16) |
    ((hash[offset + 2] ?? 0) << 8) |
    (hash[offset + 3] ?? 0);
  return String(value % 1_000_000).padStart(6, '0');
}

/**
 * A code that has not been used yet: each code works once, so after one has
 * been spent this waits for the next 30-second step.
 */
export async function nextCode(key: string, spent: string | null): Promise<string> {
  for (;;) {
    const code = totp(key);
    if (code !== spent) return code;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
