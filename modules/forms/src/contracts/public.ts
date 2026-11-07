// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Anonymous answers to a public form (ADR 0036, ADR 0019): the only routes
// that write personal data with no session. They live under
// `/public/tenants/:slug/forms/:formId`, set no tenant, and reach data only
// through `forms.public_form()` and `forms.submit_public_response()`. The
// same 404 answers an unknown slug or form, a suspended tenant, `forms`
// switched off, and a form that is signed-in only, unpublished, archived,
// not yet open or closed, so they cannot be used to find forms or tenants.
//
// Submitting, in ADR 0036's order: the client rate limit; a body of at most
// PUBLIC_SUBMIT_MAX_BYTES (413 above it), then this strict schema with the
// `Idempotency-Key` header; the proof, used up at its first verified use;
// the form and tenant rate limits (429 with Retry-After, never saying
// which); the version answered, or the form-changed problem; the answers,
// by validateAnswers() on that version (a 400 by field id); then the
// function, whose codes map to these problems and to ADR 0028's key
// problems. No problem repeats an answer, the token, the key or the proof.
// A success answers 201 with the response id and the confirmation message
// alone. The function writes `forms.response.submitted` with the system
// actor and the request id, and never a client address or token.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { answersSchema, formDefinitionSchema } from '@pixel-scientists/domain/forms';
import { slugSchema } from '@pixel-scientists/domain/platform';
import { z } from 'zod';

import { formsMessages as m } from './messages.ts';
import { classified, timestampSchema } from './schemas.ts';

export const PUBLIC_SUBMIT_MAX_BYTES = 256 * 1024;

/**
 * 32 random bytes as unpadded base64url: 43 characters, the last carrying
 * the final 2 bits as zeros, so one token has one spelling. The browser makes
 * a new one with `crypto.getRandomValues()` for each submission and sends it
 * in the body only, never a URL or cookie. The server keeps only its keyed
 * hash, and never stores, logs or returns the token. Shown to the person as
 * their response reference.
 */
export const respondentTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);

/** Solutions a proof holds, how long a challenge lasts, and the difficulty's fixed bounds in leading zero bits. */
export const PROOF_SOLUTIONS = 16;
export const PROOF_LIFETIME_SECONDS = 600;
export const PROOF_DIFFICULTY = { min: 8, max: 24 } as const;

/**
 * What a challenge signs, as base64url JSON. The server alone reads it:
 * the binding to one tenant slug and form, the issue and expiry times in
 * seconds since 1970, the difficulty, and 16 random bytes.
 */
export const proofChallengePayloadSchema = z.strictObject({
  v: z.literal(1),
  slug: slugSchema,
  formId: idSchema,
  issuedAt: z.int().min(0),
  expiresAt: z.int().min(0),
  difficulty: z.int().min(PROOF_DIFFICULTY.min).max(PROOF_DIFFICULTY.max),
  /** 16 bytes as unpadded base64url, in one spelling, as the token is. */
  salt: z.string().regex(/^[A-Za-z0-9_-]{21}[AQgw]$/),
});

export type ProofChallengePayload = z.infer<typeof proofChallengePayloadSchema>;

/** `<payload>.<HMAC-SHA-256 of the payload text>`, both base64url, opaque to the browser. */
export const proofChallengeSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{40,400}\.[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);

/**
 * One nonce for each index from 0 to PROOF_SOLUTIONS - 1, each making the
 * SHA-256 of proofMessage() start with the challenge's number of zero bits.
 */
export const proofSchema = z.strictObject({
  challenge: proofChallengeSchema,
  nonces: z.array(z.int().min(0).max(0xffff_ffff)).length(PROOF_SOLUTIONS),
});

export type Proof = z.infer<typeof proofSchema>;

/** The UTF-8 text whose SHA-256 one solution hashes, the same in the browser and on the server. */
export function proofMessage(challenge: string, index: number, nonce: number): string {
  return `${challenge}:${String(index)}:${String(nonce)}`;
}

/** The number of zero bits a digest starts with. */
export function leadingZeroBits(digest: Uint8Array): number {
  let bits = 0;
  for (const byte of digest) {
    if (byte !== 0) return bits + Math.clz32(byte) - 24;
    bits += 8;
  }
  return bits;
}

/**
 * An anonymous response. `formVersionId` is the version the page was given,
 * which the answers were checked against and the response pins. `proof` is
 * null only when the browser check did not finish in time and the fallback
 * is open; otherwise it is the proof-invalid problem.
 */
export const publicResponseInputSchema = z.strictObject({
  formVersionId: idSchema,
  respondentToken: respondentTokenSchema,
  proof: proofSchema.nullable(),
  answers: answersSchema,
});

export type PublicResponseInput = z.infer<typeof publicResponseInputSchema>;

/**
 * The form to answer: its latest version for anonymous answers. A form
 * anyone can answer has no file question and none counted only in reports.
 * `noProofFallback` says whether a response may be sent without a proof
 * when the browser check takes too long.
 */
export const publicFormSchema = classified(
  z.strictObject({
    formId: idSchema,
    formVersionId: idSchema,
    title: z.string(),
    description: z.string(),
    definition: formDefinitionSchema,
    noProofFallback: z.boolean(),
  }),
  {
    formId: 'public',
    formVersionId: 'public',
    title: 'public',
    description: 'public',
    definition: 'public',
    noProofFallback: 'public',
  },
);

export type PublicForm = z.infer<typeof publicFormSchema>;

/** A challenge to solve before sending. `difficulty` is also signed inside it. */
export const proofChallengeResponseSchema = classified(
  z.strictObject({
    challenge: proofChallengeSchema,
    difficulty: z.int(),
    expiresAt: timestampSchema,
  }),
  { challenge: 'internal', difficulty: 'internal', expiresAt: 'internal' },
);

/** What a sent response gets back. Empty text means the page's own thanks. */
export const publicResponseReceiptSchema = classified(
  z.strictObject({ responseId: idSchema, confirmationMessage: z.string() }),
  { responseId: 'internal', confirmationMessage: 'public' },
);

/**
 * The problems these routes add, besides 404, a 400 by field id, 413, 429
 * and ADR 0028's key problems. Their words are fixed.
 */
export const publicFormProblems = {
  /**
   * The version answered is not, or no longer, one the form takes anonymous
   * answers against. The page reads the form again, keeps every answer whose
   * field id still exists, and asks the person to check and send again.
   */
  formChanged: {
    type: '/problems/form-changed',
    status: 409,
    title: m.formChangedTitle,
    detail: m.formChanged,
  },
  /**
   * A malformed, expired, wrongly bound or already used proof, or none while
   * the fallback is off: one type, so a caller learns nothing from which.
   */
  proofInvalid: {
    type: '/problems/proof-invalid',
    status: 400,
    title: m.proofInvalidTitle,
    detail: m.proofInvalid,
  },
} as const;

const publicForm = {
  audience: 'public',
  module: 'forms',
  permission: null,
  scope: null,
  params: z.strictObject({ slug: slugSchema, formId: idSchema }),
} as const;

export const getPublicForm = defineRoute({
  ...publicForm,
  method: 'GET',
  path: '/public/tenants/:slug/forms/:formId',
  summary: 'Read a published, open form that anyone can answer',
  responses: { 200: publicFormSchema },
});

export const getProofChallenge = defineRoute({
  ...publicForm,
  method: 'GET',
  path: '/public/tenants/:slug/forms/:formId/challenge',
  summary: 'Get a browser check to solve before sending a response',
  responses: { 200: proofChallengeResponseSchema },
});

export const submitPublicResponse = defineRoute({
  ...publicForm,
  method: 'POST',
  idempotent: true,
  path: '/public/tenants/:slug/forms/:formId/responses',
  summary: 'Send a response without signing in, with a solved browser check',
  body: publicResponseInputSchema,
  responses: { 201: publicResponseReceiptSchema },
});

export const publicFormRoutes = { getPublicForm, getProofChallenge, submitPublicResponse } as const;
