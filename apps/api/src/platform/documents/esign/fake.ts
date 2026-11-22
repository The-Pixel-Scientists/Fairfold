// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The fake signature provider (ADR 0040): an adapter that lives in the
// process, makes no network call and keeps its envelopes in memory, so tests
// and development run the whole round trip. A test or a developer moves an
// envelope on with sign(), decline() and the other drivers, and signs a
// callback with fakeCallback(). It signs by sending the secret itself, so it
// is registered only in development (see settings.ts).

import { createHash, randomUUID } from 'node:crypto';

import type {
  EnvelopeInput,
  ProviderConnection,
  SignerContact,
} from '@pixel-scientists/domain/documents';
import type { Id } from '@pixel-scientists/domain';
import { FakeSignatureProvider } from '@pixel-scientists/domain/documents/testing';

export { fakeCallback } from '@pixel-scientists/domain/documents/testing';

const pdf = (title: string): Uint8Array =>
  Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n` +
      `2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n` +
      `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n` +
      `trailer<</Root 1 0 R/Info<</Title(${title})>>>>\n%%EOF\n`,
    'latin1',
  );

/** The signed PDF and the evidence PDF the fake returns for every envelope. */
export const FAKE_SIGNED_PDF = pdf('Fake signed document');
export const FAKE_EVIDENCE_PDF = pdf('Fake signing evidence');

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export class FakeEsignProvider extends FakeSignatureProvider {
  /** A reference no other run has used, since a restarted process keeps no envelopes but the database keeps references. */
  override async createEnvelope(
    connection: ProviderConnection,
    envelope: EnvelopeInput,
    contacts: ReadonlyMap<Id, SignerContact>,
  ): Promise<unknown> {
    const { providerReference } = (await super.createEnvelope(connection, envelope, contacts)) as {
      providerReference: string;
    };
    const unique = `fake-${randomUUID()}`;
    const kept = this.envelopes.get(providerReference);
    if (kept === undefined) throw new Error('No such envelope.');
    this.envelopes.delete(providerReference);
    this.envelopes.set(unique, kept);
    return { providerReference: unique };
  }

  /** Every signer signed: the envelope is complete, with its fixed signed file and evidence. */
  complete(providerReference: string): void {
    const envelope = this.envelopes.get(providerReference);
    if (envelope === undefined) throw new Error('No such envelope.');
    this.update(providerReference, {
      state: 'completed',
      signerStatuses: envelope.signers.map(() => 'signed'),
      signed: FAKE_SIGNED_PDF,
      evidence: {
        bytes: FAKE_EVIDENCE_PDF,
        originalSha256: sha256(envelope.original),
        signedSha256: sha256(FAKE_SIGNED_PDF),
      },
    });
  }

  /** A signer opened the document. */
  view(providerReference: string): void {
    const envelope = this.envelopes.get(providerReference);
    if (envelope === undefined) throw new Error('No such envelope.');
    this.update(providerReference, { signerStatuses: envelope.signers.map(() => 'viewed') });
  }

  decline(providerReference: string): void {
    const envelope = this.envelopes.get(providerReference);
    if (envelope === undefined) throw new Error('No such envelope.');
    this.update(providerReference, {
      state: 'declined',
      signerStatuses: envelope.signers.map((_, i) => (i === 0 ? 'declined' : 'waiting')),
    });
  }
}
