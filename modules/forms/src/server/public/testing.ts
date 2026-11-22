// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Test helpers for the anonymous routes: an in-memory platform and a solver
// for the browser check. Synthetic data only.

import { formDefinitionSchema } from '@pixel-scientists/domain/forms';

import {
  leadingZeroBits,
  PROOF_SOLUTIONS,
  proofMessage,
  type Proof,
} from '../../contracts/index.ts';
import type {
  PublicDependencies,
  PublicFormBucket,
  PublicRead,
  PublicSubmission,
  SubmitResult,
} from './context.ts';
import { issueChallenge } from './proof.ts';

export const SLUG = 'northfield';
export const FORM_ID = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';
export const OTHER_FORM_ID = 'c4d81b2f-7e65-4a03-8f9c-1b5e6a2d3c47';
export const VERSION_ID = '0b6f3c1e-58a2-4d1b-9c47-2e8d5f1a7b30';
export const RESPONSE_ID = '2e8d5f1a-7b30-4c1d-9c47-58a20b6f3c1e';
export const REQUEST_ID = '9d2f6a1c-3b4e-4f58-a7c9-0e1d2c3b4a59';
export const TOKEN = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE';
export const IDEMPOTENCY_KEY = 'retry-key-0001';
export const CLIENT = '203.0.113.7';
export const NOW = new Date('2027-03-01T10:00:00Z');
export const KEYS = { proof: new Uint8Array(32).fill(1), hash: new Uint8Array(32).fill(2) };

export const definition = formDefinitionSchema.parse({
  sections: [
    {
      id: 's_one',
      title: 'Your feedback',
      fields: [
        {
          id: 'f_rating',
          type: 'single_choice',
          label: 'How was it?',
          required: true,
          classification: 'internal',
          options: [
            { value: 'good', label: 'Good' },
            { value: 'poor', label: 'Poor' },
          ],
        },
        { id: 'f_comment', type: 'long_text', label: 'Anything else?', classification: 'personal' },
      ],
    },
  ],
});

const sha256 = async (text: string): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

/** The first nonce from `start` that solves one index, tried 64 at a time. */
async function findNonce(
  challenge: string,
  index: number,
  difficulty: number,
  start: number,
): Promise<number> {
  for (let from = start; ; from += 64) {
    const digests = await Promise.all(
      Array.from({ length: 64 }, (_, step) => sha256(proofMessage(challenge, index, from + step))),
    );
    const hit = digests.findIndex((digest) => leadingZeroBits(digest) >= difficulty);
    if (hit >= 0) return from + hit;
  }
}

/** Finds a nonce for each index from `start`, so two sets of solutions for one challenge can differ. */
export async function solve(challenge: string, difficulty: number, start = 0): Promise<Proof> {
  const nonces = await Promise.all(
    Array.from({ length: PROOF_SOLUTIONS }, (_, index) =>
      findNonce(challenge, index, difficulty, start),
    ),
  );
  return { challenge, nonces };
}

/** A challenge issued at NOW for the binding, solved. */
export async function solved(
  binding = { slug: SLUG, formId: FORM_ID },
  difficulty = 8,
): Promise<Proof> {
  const issued = await issueChallenge(KEYS.proof, binding, difficulty, NOW);
  return solve(issued.challenge, difficulty);
}

/** An in-memory platform: counters that count, a proof store that spends once, and records of every call. */
export function platform(
  options: { noProof?: boolean; submit?: SubmitResult; read?: PublicRead } = {},
) {
  const counts = new Map<string, number>();
  const spent = new Set<string>();
  const submitted: PublicSubmission[] = [];
  const reads: [string, string, string | null][] = [];
  const refused: { code: string; client: string }[] = [];
  const found: PublicRead = options.read ?? {
    code: 'ok',
    form: {
      formId: FORM_ID,
      formVersionId: VERSION_ID,
      title: 'Tell us what you think',
      description: null,
      confirmationMessage: 'Thank you.',
      definition,
    },
  };
  const deps: PublicDependencies = {
    notFound: () => new Error('not_found'),
    refuse: (_detail, errors) => new Error(`refused:${errors.map((e) => e.field).join(',')}`),
    problem: (kind) => new Error(`problem:${kind}`),
    slowDown: (seconds) => new Error(`slow:${String(seconds)}`),
    forms: {
      read(slug, formId, version) {
        reads.push([slug, formId, version]);
        return Promise.resolve(found);
      },
      submit(submission) {
        submitted.push(submission);
        return Promise.resolve(options.submit ?? { code: 'ok', responseId: RESPONSE_ID });
      },
    },
    limits: {
      count(bucket: PublicFormBucket, key: string) {
        const id = `${bucket}:${key}`;
        const count = (counts.get(id) ?? 0) + 1;
        counts.set(id, count);
        return Promise.resolve({ count, retryAfter: 1800 });
      },
    },
    proofs: {
      claim(hash) {
        const id = hash.toString('hex');
        const first = !spent.has(id);
        spent.add(id);
        return Promise.resolve(first);
      },
    },
    settings: () => Promise.resolve({ difficulty: 8, noProof: options.noProof ?? true }),
    keys: KEYS,
    refused: (event) => refused.push(event),
    now: () => NOW,
  };
  const counted = (bucket: PublicFormBucket, key: string): number =>
    counts.get(`${bucket}:${key}`) ?? 0;
  return { deps, submitted, reads, refused, counted, spent };
}
