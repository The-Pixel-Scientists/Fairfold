// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  callbackHintSchema,
  envelopeCreatedSchema,
  envelopeFoundSchema,
  envelopeStatusSchema,
  providerEvidenceSchema,
  providerFileSchema,
} from './provider.ts';
import { FakeSignatureProvider, fakeCallback } from './testing/index.ts';

const PERSON_A = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const REQUEST = '3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b';
const SHA256 = 'ab'.repeat(32);

describe('provider replies', () => {
  it('are strict, with an opaque reference of printable text', () => {
    expect(envelopeCreatedSchema.parse({ providerReference: 'env_1/a' })).toEqual({
      providerReference: 'env_1/a',
    });
    expect(envelopeFoundSchema.parse(null)).toBeNull();
    for (const reply of [
      { providerReference: '' },
      { providerReference: 'has space' },
      { providerReference: 'x'.repeat(201) },
      { providerReference: 'env-1', status: 'signed' },
    ]) {
      expect(envelopeCreatedSchema.safeParse(reply).success, JSON.stringify(reply)).toBe(false);
    }
  });

  it('take status only from the closed lists', () => {
    const status = { state: 'completed', signers: [{ order: 1, status: 'signed' }] };
    expect(envelopeStatusSchema.parse(status)).toEqual(status);
    for (const reply of [
      { ...status, state: 'signed' },
      { ...status, signers: [{ order: 1, status: 'approved' }] },
      { ...status, signers: [] },
      { ...status, signers: [{ order: 1, status: 'signed', email: 'jo@example.org' }] },
    ]) {
      expect(envelopeStatusSchema.safeParse(reply).success, JSON.stringify(reply)).toBe(false);
    }
  });

  it('cap a file at 10 MiB and take a SHA-256 as 64 lower-case hex characters', () => {
    expect(providerFileSchema.safeParse({ bytes: new Uint8Array(1) }).success).toBe(true);
    for (const bytes of [new Uint8Array(0), new Uint8Array(10 * 1024 * 1024 + 1), 'JVBERi0=']) {
      expect(providerFileSchema.safeParse({ bytes }).success).toBe(false);
    }
    const evidence = { bytes: new Uint8Array(1), originalSha256: SHA256 };
    expect(providerEvidenceSchema.safeParse(evidence).success).toBe(true);
    for (const sha of [SHA256.toUpperCase(), SHA256.slice(1), `${SHA256}0`]) {
      const reply = { ...evidence, signedSha256: sha };
      expect(providerEvidenceSchema.safeParse(reply).success, sha).toBe(false);
    }
  });

  it('take a callback hint as a reference and an event id, and nothing else', () => {
    const hint = { providerReference: 'env-1', eventId: 'evt-1' };
    expect(callbackHintSchema.parse(hint)).toEqual(hint);
    expect(callbackHintSchema.safeParse({ ...hint, status: 'signed' }).success).toBe(false);
  });
});

describe('the fake provider', () => {
  const connection = { accountId: 'team-1', apiToken: 'token-1' };
  const document = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
  const envelope = {
    requestId: REQUEST,
    document,
    signers: [{ personId: PERSON_A, order: 1 }],
    expiresAt: '2027-02-01T17:00:00Z',
  };
  const contacts = new Map([[PERSON_A, { name: 'Jo Example', email: 'jo@example.org' }]]);

  it('keeps the contract: every reply parses, and a retried send finds its envelope', async () => {
    const provider = new FakeSignatureProvider();
    expect(envelopeFoundSchema.parse(await provider.findEnvelope(connection, REQUEST))).toBeNull();
    const { providerReference } = envelopeCreatedSchema.parse(
      await provider.createEnvelope(connection, envelope, contacts),
    );
    expect(envelopeFoundSchema.parse(await provider.findEnvelope(connection, REQUEST))).toBe(
      providerReference,
    );
    expect(
      providerFileSchema.parse(await provider.readOriginal(connection, providerReference)).bytes,
    ).toEqual(document);

    provider.update(providerReference, {
      state: 'completed',
      signerStatuses: ['signed'],
      signed: new Uint8Array([1]),
      evidence: { bytes: new Uint8Array([2]), signedSha256: SHA256 },
    });
    expect(
      envelopeStatusSchema.parse(await provider.readStatus(connection, providerReference)),
    ).toEqual({ state: 'completed', signers: [{ order: 1, status: 'signed' }] });
    expect(
      providerFileSchema.parse(await provider.fetchSignedFile(connection, providerReference)),
    ).toEqual({ bytes: new Uint8Array([1]) });
    expect(
      providerEvidenceSchema.parse(await provider.fetchEvidence(connection, providerReference)),
    ).toEqual({ bytes: new Uint8Array([2]), signedSha256: SHA256 });
  });

  it("never reaches another account's envelope, and fails while unavailable", async () => {
    const provider = new FakeSignatureProvider();
    const { providerReference } = envelopeCreatedSchema.parse(
      await provider.createEnvelope(connection, envelope, contacts),
    );
    const other = { accountId: 'team-2', apiToken: 'token-2' };
    await expect(provider.readStatus(other, providerReference)).rejects.toThrow();
    expect(await provider.findEnvelope(other, REQUEST)).toBeNull();
    provider.unavailable = true;
    await expect(provider.readStatus(connection, providerReference)).rejects.toThrow();
  });

  it('verifies a callback before its body is parsed, and its status never reaches the hint', async () => {
    const provider = new FakeSignatureProvider();
    const secret = new Uint8Array([1, 2, 3]);
    const callback = fakeCallback('fake-1', 'evt-1', secret);
    expect(await provider.verifyCallback(callback, secret)).toBe(true);
    expect(await provider.verifyCallback(callback, new Uint8Array([1, 2, 4]))).toBe(false);
    expect(callbackHintSchema.parse(provider.parseCallback(callback.body))).toEqual({
      providerReference: 'fake-1',
      eventId: 'evt-1',
    });
  });
});
