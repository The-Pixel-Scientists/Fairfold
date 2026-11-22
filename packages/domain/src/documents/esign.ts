// SPDX-License-Identifier: AGPL-3.0-or-later
//
// E-signature requests (ADR 0040): their statuses and what the server keeps
// to ask for signatures. We never sign anything ourselves; a provider does,
// through an adapter (provider.ts).
//
// Signers are `party.person` ids, never addresses. The worker resolves each
// signer's name and email address through the party contract at send time
// and hands them to the adapter beside the request, so no address is ever
// stored here. Sending a document never releases a decision (rule 8), and a
// declined, expired or failed request never changes an award or application
// on its own: it is shown to staff and a person decides (rule 9).
//
// No table here. S12-62 adds `app.signature_connection`,
// `app.signature_request`, `app.signature_signer`,
// `app.signature_request_file` and `app.signature_callback`, each with
// `tenant_id`, row-level security, a cross-tenant denial test, and every
// column classified with its retention: signer links and evidence are
// personal, and signed documents are kept as ADR 0027 decides.

import { z } from 'zod';

import { idSchema } from '../id.ts';
import { catalogueParams } from '../platform/messages.ts';
import { documentsMessages } from './messages.ts';

/** A request's status. `signed` means every signer signed and the signed file and evidence are stored clean. */
export const signatureStatuses = [
  'draft',
  'sent',
  'viewed',
  'signed',
  'declined',
  'expired',
  'cancelled',
  'failed',
] as const;

export type SignatureStatus = (typeof signatureStatuses)[number];

const moves: Readonly<Record<SignatureStatus, readonly SignatureStatus[]>> = {
  draft: ['sent', 'cancelled', 'failed'],
  sent: ['viewed', 'signed', 'declined', 'expired', 'cancelled', 'failed'],
  viewed: ['signed', 'declined', 'expired', 'cancelled', 'failed'],
  signed: [],
  declined: [],
  expired: [],
  cancelled: [],
  failed: [],
};

/**
 * Whether a request may move from one status to another, as the database's
 * trigger allows. Final statuses move nowhere; to send again, a person makes
 * a new request.
 */
export function canMoveTo(from: SignatureStatus, to: SignatureStatus): boolean {
  return Object.hasOwn(moves, from) && moves[from].includes(to);
}

/** One signer's status: `waiting` until it is their turn in the signing order. */
export const signerStatuses = ['waiting', 'sent', 'viewed', 'signed', 'declined'] as const;

export type SignerStatus = (typeof signerStatuses)[number];

/** Why the worker failed a request, stored as `signature.<code>` and never as text. */
export const signatureFailures = [
  'signer_unavailable',
  'upload_mismatch',
  'document_mismatch',
  'provider_unavailable',
] as const;

export type SignatureFailure = (typeof signatureFailures)[number];

export const MAX_SIGNERS = 10;
export const MAX_EXPIRY_DAYS = 90;

export const signerSchema = z.strictObject({
  personId: idSchema,
  /** From 1; signers are invited in this order. */
  order: z.int().min(1).max(MAX_SIGNERS),
});

const unique = (values: readonly unknown[]) => new Set(values).size === values.length;

/**
 * What the server keeps to ask for signatures: the clean PDF `app.file` to
 * sign, the people who sign it, its expiry, and the template version it was
 * generated from, if any. The sender comes from the session (rule 6) and
 * the connection from the tenant; no tenant, actor, sender, email address,
 * provider secret or callback address is ever taken from a request.
 */
export const signatureRequestSchema = z.strictObject({
  fileId: idSchema,
  signers: z
    .array(signerSchema)
    .min(1)
    .max(MAX_SIGNERS)
    .refine((signers) => unique(signers.map((signer) => signer.personId)), {
      error: documentsMessages.signerTwice,
      params: catalogueParams,
    })
    .refine((signers) => unique(signers.map((signer) => signer.order)), {
      error: documentsMessages.orderTwice,
      params: catalogueParams,
    }),
  expiresAt: z.iso.datetime({ offset: true }),
  templateVersionId: idSchema.optional(),
});

export type SignatureRequest = z.infer<typeof signatureRequestSchema>;

/** An expiry is after now and at most 90 days ahead; the server checks it against its own clock. */
export function isExpiryAllowed(expiresAt: string, now: Date): boolean {
  const at = Date.parse(expiresAt);
  return at > now.getTime() && at <= now.getTime() + MAX_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
}
