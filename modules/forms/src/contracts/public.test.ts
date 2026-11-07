// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { formsMessages } from './messages.ts';
import {
  leadingZeroBits,
  PROOF_SOLUTIONS,
  proofChallengePayloadSchema,
  proofChallengeSchema,
  proofMessage,
  publicFormProblems,
  publicFormSchema,
  publicResponseInputSchema,
  publicResponseReceiptSchema,
  respondentTokenSchema,
} from './public.ts';

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
const token = base64url(new Uint8Array(32).fill(7));
const mac = base64url(new Uint8Array(32).fill(200));
const id = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';

const payload = {
  v: 1,
  slug: 'northfield',
  formId: id,
  issuedAt: 1_800_000_000,
  expiresAt: 1_800_000_600,
  difficulty: 14,
  salt: base64url(new Uint8Array(16).fill(9)),
};
const challenge = `${base64url(new TextEncoder().encode(JSON.stringify(payload)))}.${mac}`;

const input = {
  formVersionId: id,
  respondentToken: token,
  proof: { challenge, nonces: Array.from({ length: PROOF_SOLUTIONS }, (_, i) => i * 1000) },
  answers: { f_overall: 'good', f_helped: 'The staff listened.' },
};

describe('the respondent token', () => {
  it('is 32 bytes as unpadded base64url, in exactly one spelling', () => {
    expect(token).toHaveLength(43);
    expect(respondentTokenSchema.safeParse(token).success).toBe(true);
    for (const wrong of [
      `${token.slice(0, -1)}B`,
      `${token}=`,
      token.slice(1),
      `${token.slice(0, -2)}+A`,
    ]) {
      expect(respondentTokenSchema.safeParse(wrong).success, wrong).toBe(false);
    }
  });
});

describe('the proof of work', () => {
  it('signs a strict payload bound to a slug and form', () => {
    expect(proofChallengePayloadSchema.parse(payload)).toEqual(payload);
    expect(proofChallengePayloadSchema.safeParse({ ...payload, tenantId: id }).success).toBe(false);
    expect(proofChallengePayloadSchema.safeParse({ ...payload, difficulty: 30 }).success).toBe(
      false,
    );
    expect(proofChallengePayloadSchema.safeParse({ ...payload, salt: 'short' }).success).toBe(
      false,
    );
  });

  it('takes a challenge as a payload and a 32-byte signature, and 16 nonces', () => {
    expect(proofChallengeSchema.safeParse(challenge).success).toBe(true);
    expect(proofChallengeSchema.safeParse(`${challenge}x`).success).toBe(false);
    expect(proofChallengeSchema.safeParse(`a.${mac}`).success).toBe(false);
    const proof = input.proof;
    expect(
      publicResponseInputSchema.safeParse({ ...input, proof: { ...proof, nonces: [1] } }).success,
    ).toBe(false);
    expect(
      publicResponseInputSchema.safeParse({
        ...input,
        proof: { ...proof, nonces: [...proof.nonces.slice(1), -1] },
      }).success,
    ).toBe(false);
  });

  it('hashes the challenge, index and nonce, counting leading zero bits', () => {
    expect(proofMessage('abc.def', 3, 42)).toBe('abc.def:3:42');
    expect(leadingZeroBits(new Uint8Array([0, 0, 0x1f, 0xff]))).toBe(19);
    expect(leadingZeroBits(new Uint8Array([0x80]))).toBe(0);
    expect(leadingZeroBits(new Uint8Array([0, 0]))).toBe(16);
  });
});

describe('a public response', () => {
  it('takes the version answered, the token, a proof or none, and answers, and nothing else', () => {
    expect(publicResponseInputSchema.parse(input)).toEqual(input);
    expect(publicResponseInputSchema.safeParse({ ...input, proof: null }).success).toBe(true);
    for (const key of ['formVersionId', 'respondentToken', 'proof', 'answers'] as const) {
      const rest = Object.fromEntries(Object.entries(input).filter(([name]) => name !== key));
      expect(publicResponseInputSchema.safeParse(rest).success, key).toBe(false);
    }
    for (const extra of [
      { formId: id },
      { slug: 'northfield' },
      { email: 'a@example.org' },
      { client: 'x' },
    ]) {
      expect(publicResponseInputSchema.safeParse({ ...input, ...extra }).success).toBe(false);
    }
    expect(publicResponseInputSchema.safeParse({ ...input, answers: { name: 'x' } }).success).toBe(
      false,
    );
  });

  it('gets back the response id and confirmation alone, never the token or answers', () => {
    const receipt = { responseId: id, confirmationMessage: 'Thank you.' };
    expect(publicResponseReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(
      publicResponseReceiptSchema.safeParse({ ...receipt, respondentToken: token }).success,
    ).toBe(false);
    expect(Object.keys(publicFormSchema.shape)).not.toContain('confirmationMessage');
  });

  it('has its own fixed problems for a changed form and a failed check', () => {
    expect(publicFormProblems).toEqual({
      formChanged: {
        type: '/problems/form-changed',
        status: 409,
        title: formsMessages.formChangedTitle,
        detail: formsMessages.formChanged,
      },
      proofInvalid: {
        type: '/problems/proof-invalid',
        status: 400,
        title: formsMessages.proofInvalidTitle,
        detail: formsMessages.proofInvalid,
      },
    });
  });
});
