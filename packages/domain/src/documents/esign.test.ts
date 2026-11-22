// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { requestProblems } from '../api/schema-rules.ts';
import {
  canMoveTo,
  isExpiryAllowed,
  MAX_SIGNERS,
  signatureRequestSchema,
  signatureStatuses,
  type SignatureStatus,
} from './esign.ts';

const FILE = '0b8f3a52-6c1d-4e7a-9f20-3d5c8e1b7a64';
const PERSON_A = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const PERSON_B = '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a';
const TEMPLATE_VERSION = '3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b';

describe('canMoveTo', () => {
  const allowed: Record<SignatureStatus, readonly SignatureStatus[]> = {
    draft: ['sent', 'cancelled', 'failed'],
    sent: ['viewed', 'signed', 'declined', 'expired', 'cancelled', 'failed'],
    viewed: ['signed', 'declined', 'expired', 'cancelled', 'failed'],
    signed: [],
    declined: [],
    expired: [],
    cancelled: [],
    failed: [],
  };

  it.each(signatureStatuses.flatMap((from) => signatureStatuses.map((to) => [from, to] as const)))(
    'from %s to %s only as ADR 0040 lists',
    (from, to) => {
      expect(canMoveTo(from, to)).toBe(allowed[from].includes(to));
    },
  );

  it('refuses a status that is not on the list', () => {
    expect(canMoveTo('__proto__' as SignatureStatus, 'sent')).toBe(false);
  });
});

describe('signatureRequestSchema', () => {
  const request = {
    fileId: FILE,
    signers: [
      { personId: PERSON_A, order: 1 },
      { personId: PERSON_B, order: 2 },
    ],
    expiresAt: '2027-02-01T17:00:00Z',
  };

  it('takes a file, people in signing order, an expiry and an optional template version', () => {
    expect(signatureRequestSchema.parse(request)).toEqual(request);
    const generated = { ...request, templateVersionId: TEMPLATE_VERSION };
    expect(signatureRequestSchema.parse(generated)).toEqual(generated);
  });

  it('keeps the schema rules for a request body', () => {
    expect(requestProblems('/console/signature-requests', 'body', signatureRequestSchema)).toEqual(
      [],
    );
  });

  it.each([
    ['tenantId', FILE],
    ['actorId', FILE],
    ['senderId', FILE],
    ['email', 'jo@example.org'],
    ['providerSecret', 'secret'],
    ['callbackUrl', 'https://example.org/callback'],
    ['providerReference', 'env-1'],
  ])('refuses %s, or any key it does not name', (key, value) => {
    expect(signatureRequestSchema.safeParse({ ...request, [key]: value }).success).toBe(false);
  });

  it('refuses a signer with an address, or no signers, or too many', () => {
    const withEmail = { personId: PERSON_A, order: 1, email: 'jo@example.org' };
    const many = Array.from({ length: MAX_SIGNERS + 1 }, (_, i) => ({
      personId: `${String(i).padStart(8, '0')}-6c1d-4e7a-9f20-3d5c8e1b7a64`,
      order: i + 1,
    }));
    for (const signers of [[withEmail], [], many]) {
      expect(signatureRequestSchema.safeParse({ ...request, signers }).success).toBe(false);
    }
  });

  it('refuses a person twice, an order twice, and an order below 1', () => {
    for (const signers of [
      [
        { personId: PERSON_A, order: 1 },
        { personId: PERSON_A, order: 2 },
      ],
      [
        { personId: PERSON_A, order: 1 },
        { personId: PERSON_B, order: 1 },
      ],
      [{ personId: PERSON_A, order: 0 }],
    ]) {
      expect(signatureRequestSchema.safeParse({ ...request, signers }).success).toBe(false);
    }
  });
});

describe('isExpiryAllowed', () => {
  const now = new Date('2027-01-01T12:00:00Z');

  it('allows an expiry after now and up to 90 days ahead', () => {
    expect(isExpiryAllowed('2027-01-01T12:00:01Z', now)).toBe(true);
    expect(isExpiryAllowed('2027-04-01T12:00:00Z', now)).toBe(true);
  });

  it('refuses one now or before, more than 90 days ahead, or not a time', () => {
    for (const at of [
      '2027-01-01T12:00:00Z',
      '2026-12-31T00:00:00Z',
      '2027-04-01T12:00:01Z',
      'x',
    ]) {
      expect(isExpiryAllowed(at, now), at).toBe(false);
    }
  });
});
