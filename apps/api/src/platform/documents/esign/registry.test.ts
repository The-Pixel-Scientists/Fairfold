// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';

import {
  callbackHintSchema,
  envelopeCreatedSchema,
  envelopeStatusSchema,
  providerEvidenceSchema,
  providerFileSchema,
  type ProviderConnection,
} from '@pixel-scientists/domain/documents';
import { sniffFileType } from '@pixel-scientists/domain/files';
import { describe, expect, it } from 'vitest';

import { FAKE_EVIDENCE_PDF, FAKE_SIGNED_PDF, FakeEsignProvider, fakeCallback } from './fake.ts';
import { createProviders, providerKeys } from './registry.ts';

const connection: ProviderConnection = { accountId: 'team-1', apiToken: 'test-token' };
const REQUEST = '3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b';
const PERSON = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const original = Buffer.from('%PDF-1.4 original');

describe('the adapter registry', () => {
  it('is a closed list', () => {
    expect(providerKeys).toEqual(['fake']);
  });

  it('gives the live adapter to its own key and to no other', () => {
    expect(createProviders('fake')('fake')).toBeInstanceOf(FakeEsignProvider);
    expect(createProviders('fake')('documenso')).toBeUndefined();
    expect(createProviders('fake')('__proto__')).toBeUndefined();
    expect(createProviders(null)('fake')).toBeUndefined();
  });
});

describe('the fake provider', () => {
  async function sent() {
    const fake = new FakeEsignProvider();
    const contacts = new Map([[PERSON, { name: 'Test Signer', email: 'signer@example.org' }]]);
    const input = {
      requestId: REQUEST,
      document: original,
      signers: [{ personId: PERSON, order: 1 }],
      expiresAt: new Date().toISOString(),
    };
    const { providerReference } = envelopeCreatedSchema.parse(
      await fake.createEnvelope(connection, input, contacts),
    );
    return { fake, providerReference };
  }

  it('keeps the envelope in memory and finds it again by our request id', async () => {
    const { fake, providerReference } = await sent();
    expect(await fake.findEnvelope(connection, REQUEST)).toBe(providerReference);
    expect(await fake.findEnvelope({ ...connection, accountId: 'team-2' }, REQUEST)).toBeNull();
  });

  it('is driven through each status and answers in the shapes the contract allows', async () => {
    const { fake, providerReference } = await sent();
    const status = async () =>
      envelopeStatusSchema.parse(await fake.readStatus(connection, providerReference));
    expect(await status()).toEqual({ state: 'open', signers: [{ order: 1, status: 'sent' }] });
    fake.view(providerReference);
    expect((await status()).signers).toEqual([{ order: 1, status: 'viewed' }]);
    fake.decline(providerReference);
    expect((await status()).state).toBe('declined');
  });

  it('returns a fixed signed PDF and evidence with the hashes it records', async () => {
    const { fake, providerReference } = await sent();
    fake.complete(providerReference);
    const signed = providerFileSchema.parse(
      await fake.fetchSignedFile(connection, providerReference),
    );
    const evidence = providerEvidenceSchema.parse(
      await fake.fetchEvidence(connection, providerReference),
    );
    expect(signed.bytes).toEqual(FAKE_SIGNED_PDF);
    expect(evidence.bytes).toEqual(FAKE_EVIDENCE_PDF);
    expect(sniffFileType(signed.bytes)).toBe('application/pdf');
    expect(sniffFileType(evidence.bytes)).toBe('application/pdf');
    expect(evidence.originalSha256).toBe(createHash('sha256').update(original).digest('hex'));
    expect(evidence.signedSha256).toBe(createHash('sha256').update(FAKE_SIGNED_PDF).digest('hex'));
  });

  it('signs its callbacks with the key it is given', async () => {
    const { fake, providerReference } = await sent();
    const secret = new Uint8Array(32).fill(7);
    const callback = fakeCallback(providerReference, 'event-1', secret);
    expect(await fake.verifyCallback(callback, secret)).toBe(true);
    expect(await fake.verifyCallback(callback, new Uint8Array(32).fill(8))).toBe(false);
    expect(callbackHintSchema.parse(fake.parseCallback(callback.body))).toEqual({
      providerReference,
      eventId: 'event-1',
    });
  });

  it('makes no network call', async () => {
    const calls: unknown[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (...args: Parameters<typeof fetch>) => {
      calls.push(args);
      return Promise.reject(new Error('no network'));
    };
    try {
      const { fake, providerReference } = await sent();
      await fake.readStatus(connection, providerReference);
    } finally {
      globalThis.fetch = real;
    }
    expect(calls).toEqual([]);
  });
});
