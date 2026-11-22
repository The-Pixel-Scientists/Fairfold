// SPDX-License-Identifier: AGPL-3.0-or-later
//
// An in-memory signature provider for tests (`/documents/testing`), so the
// schema, worker and callback tests (S12-62, S12-85) share one adapter that
// keeps the contract. Tests move an envelope on with update(). It signs a
// callback by sending the secret's hex in a header: never use it outside
// tests.

import '../../jitless/index.ts';

import type { Id } from '../../id.ts';
import type { SignerStatus } from '../esign.ts';
import type {
  CallbackRequest,
  EnvelopeInput,
  EnvelopeState,
  ProviderConnection,
  SignatureProvider,
  SignerContact,
} from '../provider.ts';

export interface FakeEnvelope {
  readonly accountId: string;
  readonly requestId: Id;
  readonly original: Uint8Array;
  readonly signers: EnvelopeInput['signers'];
  state: EnvelopeState;
  signerStatuses: SignerStatus[];
  signed?: Uint8Array;
  evidence?: { bytes: Uint8Array; originalSha256?: string; signedSha256?: string };
  deleted: boolean;
}

const SIGNATURE_HEADER = 'x-fake-signature';

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const ascii = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0) & 0x7f);

/** Equal strings, compared without stopping at the first difference. */
function sameText(a: string, b: string): boolean {
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return difference === 0;
}

/** A callback as the fake provider would send it, signed with `secret`. */
export function fakeCallback(
  providerReference: string,
  eventId: string,
  secret: Uint8Array,
): CallbackRequest {
  return {
    body: ascii(JSON.stringify({ envelope: providerReference, event: eventId, status: 'signed' })),
    headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: hex(secret) },
  };
}

export class FakeSignatureProvider implements SignatureProvider {
  readonly envelopes = new Map<string, FakeEnvelope>();
  /** When true, every provider call rejects, as an unreachable provider does. */
  unavailable = false;

  update(providerReference: string, changes: Partial<FakeEnvelope>): void {
    Object.assign(this.envelope(providerReference), changes);
  }

  findEnvelope(connection: ProviderConnection, requestId: Id): Promise<unknown> {
    return this.settle(() => {
      for (const [reference, envelope] of this.envelopes) {
        if (envelope.accountId === connection.accountId && envelope.requestId === requestId) {
          return reference;
        }
      }
      return null;
    });
  }

  createEnvelope(
    connection: ProviderConnection,
    envelope: EnvelopeInput,
    contacts: ReadonlyMap<Id, SignerContact>,
  ): Promise<unknown> {
    return this.settle(() => {
      if (!envelope.signers.every((signer) => contacts.has(signer.personId))) {
        throw new Error('Every signer needs a contact.');
      }
      const reference = `fake-${this.envelopes.size + 1}`;
      this.envelopes.set(reference, {
        accountId: connection.accountId,
        requestId: envelope.requestId,
        original: envelope.document.slice(),
        signers: envelope.signers,
        state: 'open',
        signerStatuses: envelope.signers.map(() => 'sent'),
        deleted: false,
      });
      return { providerReference: reference };
    });
  }

  readOriginal(connection: ProviderConnection, reference: string): Promise<unknown> {
    return this.settle(() => ({ bytes: this.envelope(reference, connection).original }));
  }

  readStatus(connection: ProviderConnection, reference: string): Promise<unknown> {
    return this.settle(() => {
      const envelope = this.envelope(reference, connection);
      return {
        state: envelope.state,
        signers: envelope.signers.map((signer, i) => ({
          order: signer.order,
          status: envelope.signerStatuses[i],
        })),
      };
    });
  }

  cancel(connection: ProviderConnection, reference: string): Promise<void> {
    return this.settle(() => {
      const envelope = this.envelope(reference, connection);
      if (envelope.state === 'open') envelope.state = 'cancelled';
    });
  }

  fetchSignedFile(connection: ProviderConnection, reference: string): Promise<unknown> {
    return this.settle(() => ({ bytes: this.envelope(reference, connection).signed }));
  }

  fetchEvidence(connection: ProviderConnection, reference: string): Promise<unknown> {
    return this.settle(() => this.envelope(reference, connection).evidence);
  }

  deleteDocuments(connection: ProviderConnection, reference: string): Promise<void> {
    return this.settle(() => {
      this.envelope(reference, connection).deleted = true;
    });
  }

  verifyCallback(callback: CallbackRequest, secret: Uint8Array): Promise<boolean> {
    return Promise.resolve(sameText(callback.headers[SIGNATURE_HEADER] ?? '', hex(secret)));
  }

  parseCallback(body: Uint8Array): unknown {
    const { envelope, event } = JSON.parse(String.fromCharCode(...body)) as Record<string, unknown>;
    return { providerReference: envelope, eventId: event };
  }

  /** A provider call's reply, or its rejection while unavailable or when `make` throws. */
  private settle<T>(make: () => T): Promise<T> {
    return new Promise((resolve) => {
      if (this.unavailable) throw new Error('The fake provider is unavailable.');
      resolve(make());
    });
  }

  /** The envelope, reachable only from the account that made it. */
  private envelope(reference: string, connection?: ProviderConnection): FakeEnvelope {
    const envelope = this.envelopes.get(reference);
    if (envelope === undefined || (connection && envelope.accountId !== connection.accountId)) {
      throw new Error('No such envelope.');
    }
    return envelope;
  }
}
