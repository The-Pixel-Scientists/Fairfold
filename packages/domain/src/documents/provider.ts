// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A signature provider's adapter (ADR 0040). An adapter is the only code
// that knows a provider, and every reply it gives is parsed by a strict
// schema below before the platform uses it, so a provider's answer is never
// trusted as typed.

import { z } from 'zod';

import { MAX_FILE_BYTES } from '../files/types.ts';
import type { Id } from '../id.ts';
import { MAX_SIGNERS, signerSchema, signerStatuses } from './esign.ts';

/** Printable ASCII without spaces, for text a provider gives us that we store but never parse. */
const opaque = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[\x21-\x7e]+$/);

/** The provider's envelope reference: opaque text the platform stores, compares and never parses. */
export const providerReferenceSchema = opaque(200);

export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

const bytesSchema = z.custom<Uint8Array>(
  (value) =>
    value instanceof Uint8Array && value.byteLength >= 1 && value.byteLength <= MAX_FILE_BYTES,
);

/** findEnvelope()'s reply: the envelope made earlier with our request id as its external id, or null. */
export const envelopeFoundSchema = providerReferenceSchema.nullable();

/** createEnvelope()'s reply. */
export const envelopeCreatedSchema = z.strictObject({ providerReference: providerReferenceSchema });

/** The envelope's state at the provider. A completed envelope stays `sent` or `viewed` here until the worker has stored and checked its files. */
export const envelopeStates = ['open', 'completed', 'declined', 'expired', 'cancelled'] as const;

export type EnvelopeState = (typeof envelopeStates)[number];

/** readStatus()'s reply: the envelope's state and each signer's, by signing order. */
export const envelopeStatusSchema = z.strictObject({
  state: z.enum(envelopeStates),
  signers: z
    .array(z.strictObject({ order: signerSchema.shape.order, status: z.enum(signerStatuses) }))
    .min(1)
    .max(MAX_SIGNERS),
});

export type EnvelopeStatus = z.infer<typeof envelopeStatusSchema>;

/** readOriginal()'s and fetchSignedFile()'s reply: a PDF's bytes, within the 10 MiB ceiling. */
export const providerFileSchema = z.strictObject({ bytes: bytesSchema });

/**
 * fetchEvidence()'s reply: the provider's audit trail or completion
 * certificate as a PDF, and the hashes it records of the original and
 * signed files, where it records them, which must each match ours.
 */
export const providerEvidenceSchema = z.strictObject({
  bytes: bytesSchema,
  originalSha256: sha256Schema.optional(),
  signedSha256: sha256Schema.optional(),
});

/** parseCallback()'s reply: a hint that something changed, and the provider's event id (or the body's SHA-256). */
export const callbackHintSchema = z.strictObject({
  providerReference: providerReferenceSchema,
  eventId: opaque(200),
});

/** A tenant's account at the provider, decrypted by the worker for one call and never logged. */
export interface ProviderConnection {
  readonly accountId: string;
  readonly apiToken: string;
}

/** A signer's name and address, resolved through party at send time and never stored. */
export interface SignerContact {
  readonly name: string;
  readonly email: string;
}

export interface EnvelopeInput {
  /** Our request id, set as the provider's external id, so a retried job finds the envelope it made. */
  readonly requestId: Id;
  /** The clean PDF's bytes, read by the worker; never a storage key or a URL. */
  readonly document: Uint8Array;
  readonly signers: readonly z.infer<typeof signerSchema>[];
  readonly expiresAt: string;
}

/** The request a provider sent to the callback route, as received: the raw body and its headers in lower case. */
export interface CallbackRequest {
  readonly body: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * One provider's adapter. Only the worker calls the provider methods, and
 * the API only verifyCallback() and parseCallback(). Every `unknown` reply
 * is parsed by the schema named on it before anything uses it.
 *
 * Outbound calls go through the global dispatcher (ADR 0010) for a provider
 * at a public address; downloads, and every call to a self-hosted provider
 * on a private network, go through a client pinned to the one host and port
 * in the cell's configuration, over HTTPS, with no redirects and a 10 MiB
 * cap. No tenant setting names a host.
 *
 * The worker re-reads status from the provider before every change and
 * never takes one from a callback. The signed file and the evidence go
 * through ADR 0030's quarantine and scan like any upload, are linked to the
 * request only when clean, and the signed file's SHA-256 is recorded in
 * `app.file` and its audit event. Evidence holds signers' names, email
 * addresses, IP addresses and browser details: it is personal.
 */
export interface SignatureProvider {
  /** envelopeFoundSchema. */
  findEnvelope(connection: ProviderConnection, requestId: Id): Promise<unknown>;
  /** envelopeCreatedSchema. Sets the provider's own emails off: invitations go through our outbox. */
  createEnvelope(
    connection: ProviderConnection,
    envelope: EnvelopeInput,
    contacts: ReadonlyMap<Id, SignerContact>,
  ): Promise<unknown>;
  /** providerFileSchema: the provider's copy of the original, compared with the SHA-256 of the file sent. */
  readOriginal(connection: ProviderConnection, providerReference: string): Promise<unknown>;
  /** envelopeStatusSchema. */
  readStatus(connection: ProviderConnection, providerReference: string): Promise<unknown>;
  cancel(connection: ProviderConnection, providerReference: string): Promise<void>;
  /** providerFileSchema. */
  fetchSignedFile(connection: ProviderConnection, providerReference: string): Promise<unknown>;
  /** providerEvidenceSchema. */
  fetchEvidence(connection: ProviderConnection, providerReference: string): Promise<unknown>;
  /** Deletes the envelope's documents at the provider, where its API can. */
  deleteDocuments(connection: ProviderConnection, providerReference: string): Promise<void>;
  /**
   * Whether the provider signed this body with the secret derived for the
   * connection, compared in constant time and within 5 minutes where the
   * provider signs a timestamp. Called before the body is parsed.
   */
  verifyCallback(callback: CallbackRequest, secret: Uint8Array): Promise<boolean>;
  /** callbackHintSchema. Any status in the body is ignored. */
  parseCallback(body: Uint8Array): unknown;
}
