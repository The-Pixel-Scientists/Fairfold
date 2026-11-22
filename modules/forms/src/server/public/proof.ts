// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The browser check's challenge and its verification (ADR 0036). A challenge
// names the tenant slug and form it was issued for, its issue and expiry
// times, a difficulty and 16 random bytes, signed with HMAC-SHA-256 under a
// key used for nothing else, so no table is needed to issue one. A proof is
// the challenge and 16 nonces. Every string is accepted in its one canonical
// unpadded base64url spelling only, so no two strings stand for one proof.
// verifyProof() answers a proof's hash or null, and never says which check
// failed. It does not spend the proof: the caller claims its hash once.

import {
  leadingZeroBits,
  PROOF_LIFETIME_SECONDS,
  PROOF_SOLUTIONS,
  proofChallengePayloadSchema,
  proofMessage,
  type Proof,
} from '../../contracts/index.ts';

const { subtle } = crypto;
const utf8 = new TextEncoder();

const encode = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

/** The bytes `text` spells, or null unless it is the one canonical spelling of them. */
function decode(text: string): Buffer | null {
  const bytes = Buffer.from(text, 'base64url');
  return bytes.toString('base64url') === text ? bytes : null;
}

const hmacKey = (key: Uint8Array) =>
  subtle.importKey('raw', new Uint8Array(key), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);

async function sign(key: Uint8Array, text: string): Promise<Uint8Array> {
  return new Uint8Array(await subtle.sign('HMAC', await hmacKey(key), utf8.encode(text)));
}

const sha256 = async (bytes: Uint8Array): Promise<Buffer> =>
  Buffer.from(await subtle.digest('SHA-256', new Uint8Array(bytes)));

/** What a challenge is bound to: the tenant slug and form of the route it is used on. */
export interface Binding {
  readonly slug: string;
  readonly formId: string;
}

export interface IssuedChallenge {
  readonly challenge: string;
  readonly difficulty: number;
  readonly expiresAt: Date;
}

export async function issueChallenge(
  key: Uint8Array,
  binding: Binding,
  difficulty: number,
  now: Date,
  random: (size: number) => Uint8Array = (size) => crypto.getRandomValues(new Uint8Array(size)),
): Promise<IssuedChallenge> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload = proofChallengePayloadSchema.parse({
    v: 1,
    ...binding,
    issuedAt,
    expiresAt: issuedAt + PROOF_LIFETIME_SECONDS,
    difficulty,
    salt: encode(random(16)),
  });
  const text = encode(Buffer.from(JSON.stringify(payload), 'utf8'));
  return {
    challenge: `${text}.${encode(await sign(key, text))}`,
    difficulty,
    expiresAt: new Date(payload.expiresAt * 1000),
  };
}

export interface VerifiedProof {
  /** The SHA-256 of the verified fields alone, the same for every spelling and every set of solutions. */
  readonly proofHash: Buffer;
  /** The challenge's signed issue time, the window its single-use marker lives in. */
  readonly issuedAt: Date;
}

function u64(value: number): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(value));
  return bytes;
}

/**
 * The proof's hash: a fixed binary layout of the decoded challenge, with the
 * slug length-prefixed, and never text the client chose the spelling of.
 */
function hashOf(
  payload: ReturnType<typeof proofChallengePayloadSchema.parse>,
  salt: Buffer,
): Promise<Buffer> {
  const slug = Buffer.from(payload.slug, 'utf8');
  const length = Buffer.alloc(2);
  length.writeUInt16BE(slug.length);
  return sha256(
    Buffer.concat([
      Buffer.from([payload.v]),
      length,
      slug,
      Buffer.from(payload.formId.replaceAll('-', ''), 'hex'),
      u64(payload.issuedAt),
      u64(payload.expiresAt),
      Buffer.from([payload.difficulty]),
      salt,
    ]),
  );
}

/**
 * The signature in constant time, then the expiry, the binding to this slug
 * and form, and every solution.
 */
export async function verifyProof(
  key: Uint8Array,
  proof: Proof,
  binding: Binding,
  now: Date,
): Promise<VerifiedProof | null> {
  const parts = proof.challenge.split('.');
  const [text, signature] = parts;
  if (parts.length !== 2 || text === undefined || signature === undefined) return null;
  const given = decode(signature);
  const body = decode(text);
  if (given === null || body === null) return null;
  // subtle.verify() compares the signature in constant time.
  if (!(await subtle.verify('HMAC', await hmacKey(key), new Uint8Array(given), utf8.encode(text))))
    return null;

  let json: unknown;
  try {
    json = JSON.parse(body.toString('utf8'));
  } catch {
    return null;
  }
  const parsed = proofChallengePayloadSchema.safeParse(json);
  const salt = parsed.success ? decode(parsed.data.salt) : null;
  if (!parsed.success || salt === null || salt.length !== 16) return null;
  const payload = parsed.data;

  const seconds = Math.floor(now.getTime() / 1000);
  if (payload.slug !== binding.slug || payload.formId !== binding.formId) return null;
  if (payload.issuedAt > seconds || seconds >= payload.expiresAt) return null;

  for (let index = 0; index < PROOF_SOLUTIONS; index += 1) {
    const nonce = proof.nonces[index];
    if (nonce === undefined) return null;
    const digest = await sha256(utf8.encode(proofMessage(proof.challenge, index, nonce)));
    if (leadingZeroBits(digest) < payload.difficulty) return null;
  }
  return { proofHash: await hashOf(payload, salt), issuedAt: new Date(payload.issuedAt * 1000) };
}
