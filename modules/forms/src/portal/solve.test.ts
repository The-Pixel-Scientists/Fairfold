// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { leadingZeroBits, PROOF_SOLUTIONS, proofMessage, proofSchema } from '../contracts/index.ts';
import { findNonces } from './solve.ts';

const CHALLENGE = `${'a'.repeat(60)}.${'b'.repeat(42)}A`;

describe('findNonces', () => {
  it('finds one nonce for each index, each making the hash start with the zero bits', async () => {
    const nonces = await findNonces(CHALLENGE, 4);

    expect(nonces).toHaveLength(PROOF_SOLUTIONS);
    for (const [index, nonce] of nonces.entries()) {
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(proofMessage(CHALLENGE, index, nonce)),
      );
      expect(leadingZeroBits(new Uint8Array(digest))).toBeGreaterThanOrEqual(4);
    }
  });

  it('makes a proof the contract accepts', async () => {
    const proof = { challenge: CHALLENGE, nonces: await findNonces(CHALLENGE, 4) };

    expect(proofSchema.safeParse(proof).success).toBe(true);
  });
});
