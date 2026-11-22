// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The send job (ADR 0040, "Sending"), as app_worker in the request's tenant.
// It re-reads the request and does nothing unless it is still a draft, since
// delivery is at least once. Each signer's address is read from party now and
// passed to the adapter only. The file's bytes are read from storage and
// checked against the SHA-256 the request recorded. A retried job finds the
// envelope an earlier run made, by our request id, instead of making another.
// A provider failure becomes a closed code and `failed`; the provider's
// message is never kept.

import { createHash } from 'node:crypto';

import { defineHandler, JobError, type JobHandler } from '@pixel-scientists/db/jobs';
import {
  envelopeCreatedSchema,
  envelopeFoundSchema,
  providerFileSchema,
  type SignatureFailure,
  type SignerContact,
} from '@pixel-scientists/domain/documents';

import { announce } from './announce.ts';
import { liveProvider, type ProviderDependencies } from './connection.ts';
import { signerContact } from './contact.ts';
import { signatureSendQueue } from './queues.ts';
import type { EsignTables } from './tables.ts';

export interface SendJobDependencies extends ProviderDependencies {
  /** A stored file's bytes by its storage key, or null if the object is missing or too large. */
  readonly readFile: (storageKey: string) => Promise<Uint8Array | null>;
}

const sha256 = (bytes: Uint8Array): Buffer => createHash('sha256').update(bytes).digest();

export const sendHandler = (deps: SendJobDependencies): JobHandler<unknown> =>
  defineHandler<unknown, (typeof signatureSendQueue)['data'], 'tenant'>(
    signatureSendQueue,
    async (trx, job) => {
      const db = trx.$extendTables<EsignTables>();
      const id = job.data.signature;
      const request = await db
        .selectFrom('app.signature_request')
        .select(['status', 'connection_id', 'sent_sha256', 'expires_at'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (request === undefined) throw new JobError('not_found');
      if (request.status !== 'draft') return;
      const signers = await db
        .selectFrom('app.signature_signer')
        .select(['person_id', 'signing_order'])
        .where('signature_request_id', '=', id)
        .orderBy('signing_order')
        .execute();
      const people = signers.map((signer) => signer.person_id);

      const fail = async (code: SignatureFailure): Promise<void> => {
        const errorCode = `signature.${code}`;
        await db
          .updateTable('app.signature_request')
          .set({ status: 'failed', error_code: errorCode })
          .where('id', '=', id)
          .execute();
        await announce(trx, job, { request: id, status: 'failed', errorCode, signers: people });
      };

      const live = await liveProvider(trx, deps, request.connection_id);
      if (live === undefined) return fail('provider_unavailable');
      const contacts = new Map<string, SignerContact>();
      for (const personId of people) {
        const contact = await signerContact(trx, personId);
        if (contact === null) return fail('signer_unavailable');
        contacts.set(personId, contact);
      }
      const sent = await db
        .selectFrom('app.signature_request_file as link')
        .innerJoin('app.file as file', (join) =>
          join.onRef('file.tenant_id', '=', 'link.tenant_id').onRef('file.id', '=', 'link.file_id'),
        )
        .select('file.storage_key')
        .where('link.signature_request_id', '=', id)
        .where('link.role', '=', 'sent')
        .executeTakeFirst();
      const bytes =
        sent?.storage_key === undefined || sent.storage_key === null
          ? null
          : await deps.readFile(sent.storage_key);
      if (bytes === null || !sha256(bytes).equals(request.sent_sha256)) {
        return fail('document_mismatch');
      }

      const { adapter, connection } = live;
      const delivery = await (async (): Promise<
        { readonly reference: string } | { readonly failure: SignatureFailure }
      > => {
        try {
          const found = envelopeFoundSchema.parse(await adapter.findEnvelope(connection, id));
          const reference =
            found ??
            envelopeCreatedSchema.parse(
              await adapter.createEnvelope(
                connection,
                {
                  requestId: id,
                  document: bytes,
                  signers: signers.map((s) => ({ personId: s.person_id, order: s.signing_order })),
                  expiresAt: request.expires_at.toISOString(),
                },
                contacts,
              ),
            ).providerReference;
          const original = providerFileSchema.parse(
            await adapter.readOriginal(connection, reference),
          );
          if (sha256(original.bytes).equals(request.sent_sha256)) return { reference };
          await adapter.cancel(connection, reference);
          return { failure: 'upload_mismatch' };
        } catch {
          return { failure: 'provider_unavailable' };
        }
      })();
      if ('failure' in delivery) return fail(delivery.failure);
      const { reference } = delivery;

      await db
        .updateTable('app.signature_request')
        .set({ status: 'sent', provider_reference: reference })
        .where('id', '=', id)
        .execute();
      await announce(trx, job, { request: id, status: 'sent', signers: people });
    },
  );
