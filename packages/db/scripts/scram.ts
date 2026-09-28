// SPDX-License-Identifier: AGPL-3.0-or-later
//
// SCRAM-SHA-256 verifiers in PostgreSQL's stored format (RFC 5802 and
// RFC 7677). The roles script sets each role's password from a verifier, so
// the password itself never reaches the server, its log or an error message.

import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

/** PostgreSQL's default for scram_iterations. */
export const SCRAM_ITERATIONS = 4096;
const SALT_BYTES = 16;

/**
 * PostgreSQL prepares a password with SASLprep before hashing it. For
 * printable ASCII that changes nothing, so requiring it keeps this verifier
 * identical to the one the server would compute.
 */
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

export function scramSha256Verifier(
  password: string,
  salt: Buffer = randomBytes(SALT_BYTES),
  iterations: number = SCRAM_ITERATIONS,
): string {
  if (!PRINTABLE_ASCII.test(password)) {
    throw new Error('Database passwords must use printable ASCII characters only.');
  }
  const saltedPassword = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', saltedPassword).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', saltedPassword).update('Server Key').digest();
  return `SCRAM-SHA-256$${String(iterations)}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}
