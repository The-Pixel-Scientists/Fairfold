// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Passwords (ADR 0010): Argon2id at OWASP's minimum (19 MiB, 2 iterations,
// 1 lane) through Node.js's crypto.argon2, stored as a standard PHC string,
// and a bundled list of common passwords that every new password is checked
// against. Length is the contract's (passwordSchema).

import { argon2, randomBytes, timingSafeEqual, type Argon2Parameters } from 'node:crypto';
import { readFileSync } from 'node:fs';

const MEMORY_KIB = 19 * 1024;
const PASSES = 2;
const LANES = 1;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

function derive(
  password: string,
  salt: Buffer,
  params: Omit<Argon2Parameters, 'message' | 'nonce'>,
) {
  return new Promise<Buffer>((resolve, reject) => {
    argon2('argon2id', { ...params, message: password, nonce: salt }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

const b64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');

/** The password's Argon2id hash as a PHC string, with a new random salt. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, {
    memory: MEMORY_KIB,
    passes: PASSES,
    parallelism: LANES,
    tagLength: HASH_BYTES,
  });
  return `$argon2id$v=19$m=${String(MEMORY_KIB)},t=${String(PASSES)},p=${String(LANES)}$${b64(salt)}$${b64(hash)}`;
}

/** Whether the password matches a PHC string from hashPassword(). False for any other string. */
export async function verifyPassword(phc: string, password: string): Promise<boolean> {
  const [, memory, passes, lanes, salt, hash] = PHC.exec(phc) ?? [];
  if (salt === undefined || hash === undefined) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'), {
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(lanes),
    tagLength: expected.length,
  });
  return timingSafeEqual(actual, expected);
}

let dummy: Promise<string> | undefined;

/** Spend the time of one verification, for an address with no password, so timing reveals nothing. */
export async function verifyNothing(password: string): Promise<false> {
  dummy ??= hashPassword(randomBytes(32).toString('base64url'));
  await verifyPassword(await dummy, password);
  return false;
}

/** The fewest entries the bundled list may hold (ADR 0010). */
export const MINIMUM_COMMON_PASSWORDS = 3000;

/**
 * The bundled list: SecLists' xato-net 1,000,000 file at a pinned commit,
 * only its entries of 12 or more characters (D9), one per line in UTF-8, in
 * the file's order. Taken from
 * Passwords/Common-Credentials/xato-net-10-million-passwords-1000000.txt at
 * danielmiessler/SecLists f1196104c5594a19d78b486c52c0794b9d947993 (MIT; see
 * NOTICE).
 */
export const COMMON_PASSWORDS_FILE = new URL('./common-passwords.txt', import.meta.url);

/**
 * The list in `file`, lower-cased, or undefined if it is missing or holds
 * fewer than the minimum, in which case no new password can be set.
 */
export function loadCommonPasswords(
  file: URL = COMMON_PASSWORDS_FILE,
): ReadonlySet<string> | undefined {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  const entries = new Set(
    text
      .split(/\r?\n/)
      .filter((line) => line.length >= 12)
      .map((line) => line.toLowerCase()),
  );
  return entries.size >= MINIMUM_COMMON_PASSWORDS ? entries : undefined;
}

/** Whether a new password is on the list, ignoring case. */
export function isCommonPassword(list: ReadonlySet<string>, password: string): boolean {
  return list.has(password.toLowerCase());
}
