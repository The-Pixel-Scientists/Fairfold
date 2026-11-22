// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import { PROOF_LIFETIME_SECONDS, type Proof } from '../../contracts/index.ts';
import { issueChallenge, verifyProof } from './proof.ts';
import { FORM_ID, KEYS, NOW, OTHER_FORM_ID, SLUG, solve } from './testing.ts';

// Solving a browser check hashes thousands of times, slowly on a busy machine.
vi.setConfig({ testTimeout: 60_000 });

const binding = { slug: SLUG, formId: FORM_ID };
const issue = async (difficulty = 8, formId = FORM_ID) =>
  (await issueChallenge(KEYS.proof, { slug: SLUG, formId }, difficulty, NOW)).challenge;
const verify = (proof: Proof, now = NOW, key: Uint8Array = KEYS.proof) =>
  verifyProof(key, proof, binding, now);

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** The same bytes spelled with other values in the unused trailing bits of the last character. */
function otherTrailingBits(text: string): string {
  const last = ALPHABET.indexOf(text.at(-1) ?? '');
  return `${text.slice(0, -1)}${ALPHABET[last ^ 1] ?? ''}`;
}

describe('issueChallenge', () => {
  it('binds the slug and form, and lasts ten minutes', async () => {
    const issued = await issueChallenge(KEYS.proof, binding, 10, NOW);
    expect(issued.difficulty).toBe(10);
    expect(issued.expiresAt.getTime() - NOW.getTime()).toBe(PROOF_LIFETIME_SECONDS * 1000);
    const [text] = issued.challenge.split('.');
    expect(JSON.parse(Buffer.from(text ?? '', 'base64url').toString())).toMatchObject({
      v: 1,
      slug: SLUG,
      formId: FORM_ID,
      difficulty: 10,
    });
  });

  it('refuses a difficulty outside the fixed bounds', async () => {
    await expect(issueChallenge(KEYS.proof, binding, 7, NOW)).rejects.toThrow();
    await expect(issueChallenge(KEYS.proof, binding, 25, NOW)).rejects.toThrow();
  });

  it('gives each challenge its own random bytes', async () => {
    expect(await issue()).not.toBe(await issue());
  });
});

describe('verifyProof', () => {
  it('accepts a solved challenge and names the time it was issued', async () => {
    const verified = await verify(await solve(await issue(), 8));
    expect(verified?.proofHash).toHaveLength(32);
    expect(verified?.issuedAt).toEqual(NOW);
  });

  it('gives one hash to one challenge whichever solutions come with it', async () => {
    const challenge = await issue();
    const first = await verify(await solve(challenge, 8));
    const second = await verify(await solve(challenge, 8, 100_000));
    const other = await verify(await solve(await issue(), 8));
    expect(first).not.toBeNull();
    expect(second?.proofHash.equals(first?.proofHash ?? Buffer.alloc(0))).toBe(true);
    expect(other?.proofHash.equals(first?.proofHash ?? Buffer.alloc(0))).toBe(false);
  });

  it('refuses a challenge signed under another key', async () => {
    const proof = await solve(await issue(), 8);
    expect(await verify(proof, NOW, new Uint8Array(32).fill(9))).toBeNull();
  });

  it('refuses an altered payload or signature', async () => {
    const [text = '', signature = ''] = (await issue()).split('.');
    const payload = JSON.parse(Buffer.from(text, 'base64url').toString()) as { expiresAt: number };
    const longer = Buffer.from(
      JSON.stringify({ ...payload, expiresAt: payload.expiresAt + 3600 }),
      'utf8',
    ).toString('base64url');
    expect(await verify(await solve(`${longer}.${signature}`, 8))).toBeNull();
    expect(await verify(await solve(`${text}.${'A'.repeat(signature.length)}`, 8))).toBeNull();
  });

  it('refuses an expired challenge, and one from the future', async () => {
    const proof = await solve(await issue(), 8);
    expect(await verify(proof, new Date(NOW.getTime() + PROOF_LIFETIME_SECONDS * 1000))).toBeNull();
    expect(await verify(proof, new Date(NOW.getTime() - 5000))).toBeNull();
    expect(await verify(proof, new Date(NOW.getTime() + 599_000))).not.toBeNull();
  });

  it('refuses a challenge bound to another form or slug', async () => {
    expect(await verify(await solve(await issue(8, OTHER_FORM_ID), 8))).toBeNull();
    const proof = await solve(await issue(), 8);
    expect(
      await verifyProof(KEYS.proof, proof, { ...binding, slug: 'southfield' }, NOW),
    ).toBeNull();
  });

  it('refuses a solution short of the difficulty, and a missing one', async () => {
    const challenge = await issue(9);
    expect(await verify(await solve(challenge, 8))).toBeNull();
    const good = await solve(challenge, 9);
    expect(await verify(good)).not.toBeNull();
    expect(await verify({ ...good, nonces: good.nonces.slice(0, 15) })).toBeNull();
  });

  it('accepts one spelling only', async () => {
    const challenge = await issue();
    const [text = '', signature = ''] = challenge.split('.');
    const spellings = [
      `${text}=.${signature}`,
      `${text}.${signature}=`,
      `${text}.${otherTrailingBits(signature)}`,
      `${text}\n.${signature}`,
      ` ${challenge}`,
      `${challenge}.`,
      `${text}.${signature}.${signature}`,
    ];
    expect(await verify(await solve(challenge, 8))).not.toBeNull();
    for (const spelling of spellings) expect(await verify(await solve(spelling, 8))).toBeNull();
  });

  it('refuses a payload that is not the signed shape', async () => {
    const text = Buffer.from('{"v":2}', 'utf8').toString('base64url');
    const signature = Buffer.alloc(32).toString('base64url');
    expect(await verify(await solve(`${text}.${signature}`, 8))).toBeNull();
    expect(await verify(await solve('x', 8))).toBeNull();
  });
});
