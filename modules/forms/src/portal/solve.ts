// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The browser check before an anonymous response is sent (ADR 0036): 16 small
// puzzles, each a nonce that makes the SHA-256 of the challenge, its index
// and the nonce start with enough zero bits. Web Crypto only, no third-party
// script, and no puzzle for the person to see or solve.

import { leadingZeroBits, PROOF_SOLUTIONS, proofMessage } from '../contracts/index.ts';

const MAX_NONCE = 0xffff_ffff;

/** One nonce for each index. Slow by design, so it runs in a worker. */
export async function findNonces(challenge: string, difficulty: number): Promise<number[]> {
  const encoder = new TextEncoder();
  const nonces: number[] = [];
  for (let index = 0; index < PROOF_SOLUTIONS; index += 1) {
    let found = false;
    for (let nonce = 0; nonce <= MAX_NONCE && !found; nonce += 1) {
      const message = encoder.encode(proofMessage(challenge, index, nonce));
      // Each hash waits on the one before, so the nonces cannot be tried at once.
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', message));
      if (leadingZeroBits(digest) >= difficulty) {
        nonces.push(nonce);
        found = true;
      }
    }
    if (!found) throw new Error('No solution found.');
  }
  return nonces;
}
