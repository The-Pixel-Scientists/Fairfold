// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The status refresh job (ADR 0040, "Statuses"), as app_worker in the
// request's tenant. It asks the provider for the envelope's state and acts on
// that alone: a callback is only a hint to run it, and no status, id or value
// from a callback body reaches here. A change is applied only when
// canMoveTo() allows it, so a final request never moves, and running the job
// again is harmless.
//
// When every signer has signed it fetches the signed file and the evidence,
// checks the hashes the provider records against ours, stores both clean
// through `storeResults` and links them in the same transaction as the move
// to `signed`. A provider that cannot be read leaves the request as it was
// and fails the job so it retries; it never assumes an expiry.

import { createHash } from 'node:crypto';

import { defineHandler, JobError, type JobHandler } from '@pixel-scientists/db/jobs';
import type { Transaction } from '@pixel-scientists/db';
import {
  canMoveTo,
  envelopeStatusSchema,
  providerEvidenceSchema,
  providerFileSchema,
  type EnvelopeStatus,
  type SignatureFailure,
  type SignatureStatus,
} from '@pixel-scientists/domain/documents';

import { announce, type AnnouncedStatus } from './announce.ts';
import { liveProvider, type ProviderDependencies } from './connection.ts';
import { signatureRefreshQueue } from './queues.ts';
import type { EsignTables } from './tables.ts';

/** The signed file and the evidence, as the provider gave them. */
export interface ResultFiles {
  readonly signed: Uint8Array;
  readonly evidence: Uint8Array;
}

/**
 * Stores both files through the quarantine and scan pipeline (ADR 0030) as
 * the request's asker, and returns their file ids once both are clean, or
 * null when either is refused.
 */
export type StoreResults = (
  trx: Transaction<unknown>,
  request: { readonly id: string; readonly createdBy: string },
  files: ResultFiles,
) => Promise<{ readonly signed: string; readonly evidence: string } | null>;

export interface RefreshJobDependencies extends ProviderDependencies {
  readonly storeResults: StoreResults;
}

const sha256 = (bytes: Uint8Array): Buffer => createHash('sha256').update(bytes).digest();

/** The status the provider's state asks for, or null while nothing has changed. */
function requestedStatus(
  envelope: EnvelopeStatus,
  current: SignatureStatus,
): AnnouncedStatus | null {
  switch (envelope.state) {
    case 'completed':
      return 'signed';
    case 'declined':
    case 'expired':
    case 'cancelled':
      return envelope.state;
    case 'open':
      return current === 'sent' &&
        envelope.signers.some(({ status }) => status !== 'waiting' && status !== 'sent')
        ? 'viewed'
        : null;
  }
}

export const refreshHandler = (deps: RefreshJobDependencies): JobHandler<unknown> =>
  defineHandler<unknown, (typeof signatureRefreshQueue)['data'], 'tenant'>(
    signatureRefreshQueue,
    async (trx, job) => {
      const db = trx.$extendTables<EsignTables>();
      const id = job.data.signature;
      const request = await db
        .selectFrom('app.signature_request')
        .select([
          'status',
          'connection_id',
          'provider_reference',
          'sent_sha256',
          'created_by',
          'tenant_id',
        ])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (request === undefined) throw new JobError('not_found');
      if (
        (request.status !== 'sent' && request.status !== 'viewed') ||
        request.provider_reference === null
      ) {
        return;
      }
      const live = await liveProvider(trx, deps, request.connection_id);
      if (live === undefined) throw new JobError('precondition_failed');
      const { adapter, connection } = live;
      const reference = request.provider_reference;
      const signers = await db
        .selectFrom('app.signature_signer')
        .select(['id', 'person_id', 'signing_order', 'status'])
        .where('signature_request_id', '=', id)
        .execute();
      const people = signers.map((signer) => signer.person_id);

      let envelope: EnvelopeStatus;
      try {
        envelope = envelopeStatusSchema.parse(await adapter.readStatus(connection, reference));
      } catch {
        throw new JobError('internal');
      }
      for (const { order, status } of envelope.signers) {
        const signer = signers.find((s) => s.signing_order === order);
        if (
          signer !== undefined &&
          signer.status !== status &&
          signer.status !== 'signed' &&
          signer.status !== 'declined'
        ) {
          await db
            .updateTable('app.signature_signer')
            .set({ status })
            .where('id', '=', signer.id)
            .execute();
        }
      }

      const target = requestedStatus(envelope, request.status);
      if (target === null || !canMoveTo(request.status, target)) return;

      const fail = async (code: SignatureFailure): Promise<void> => {
        const errorCode = `signature.${code}`;
        await db
          .updateTable('app.signature_request')
          .set({ status: 'failed', error_code: errorCode })
          .where('id', '=', id)
          .execute();
        await announce(trx, job, { request: id, status: 'failed', errorCode, signers: people });
      };

      if (target === 'signed') {
        let files: ResultFiles;
        let recorded: { original?: string; signed?: string };
        let providerOriginal: Buffer;
        try {
          providerOriginal = sha256(
            providerFileSchema.parse(await adapter.readOriginal(connection, reference)).bytes,
          );
          const signed = providerFileSchema.parse(
            await adapter.fetchSignedFile(connection, reference),
          );
          const evidence = providerEvidenceSchema.parse(
            await adapter.fetchEvidence(connection, reference),
          );
          files = { signed: signed.bytes, evidence: evidence.bytes };
          recorded = {
            ...(evidence.originalSha256 === undefined ? {} : { original: evidence.originalSha256 }),
            ...(evidence.signedSha256 === undefined ? {} : { signed: evidence.signedSha256 }),
          };
        } catch {
          throw new JobError('internal');
        }
        if (
          !providerOriginal.equals(request.sent_sha256) ||
          (recorded.original !== undefined &&
            recorded.original !== request.sent_sha256.toString('hex')) ||
          (recorded.signed !== undefined &&
            recorded.signed !== sha256(files.signed).toString('hex'))
        ) {
          return fail('document_mismatch');
        }
        const stored = await deps.storeResults(trx, { id, createdBy: request.created_by }, files);
        if (stored === null) return fail('document_mismatch');
        await db
          .insertInto('app.signature_request_file')
          .values([
            {
              tenant_id: request.tenant_id,
              signature_request_id: id,
              role: 'signed',
              file_id: stored.signed,
            },
            {
              tenant_id: request.tenant_id,
              signature_request_id: id,
              role: 'evidence',
              file_id: stored.evidence,
            },
          ])
          .execute();
      }

      await db
        .updateTable('app.signature_request')
        .set({ status: target })
        .where('id', '=', id)
        .execute();
      await announce(trx, job, { request: id, status: target, signers: people });
    },
  );
