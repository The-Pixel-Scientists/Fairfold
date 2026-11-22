// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Asking for signatures (ADR 0040, "Sending"). Platform and module server
// code call requestSignature() in the request's tenant transaction; no HTTP
// route does. It re-validates the request with the shared schema, takes the
// sender from the context and never from input (rule 6), checks that the
// file is a clean, unused PDF of this tenant and that every signer is a
// person who can still be reached, writes the draft request, its signers and
// the link to the file, and queues an ids-only send job in the same
// transaction. Nothing is sent from here: the worker does that, so a request
// that rolls back sends nothing. The callback reference belongs to the
// tenant's connection and is never handled here.

import type { JobSender } from '@pixel-scientists/db/jobs';
import { sendJob } from '@pixel-scientists/db/jobs';
import {
  documentsMessages,
  isExpiryAllowed,
  signatureRequestSchema,
} from '@pixel-scientists/domain/documents';

import type { RequestAudit } from '../../../context.ts';
import type { TenantTransaction } from '../../../database.ts';
import { ApiError } from '../../../problems.ts';
import { signerContact } from './contact.ts';
import { templateVersionById } from '../templates.ts';
import { signatureSendQueue } from './queues.ts';
import type { ProviderKey } from './registry.ts';
import type { EsignTables } from './tables.ts';

const messages = {
  notSetUp: 'Electronic signing is not set up. Ask your administrator to set it up.',
  badRequest: 'Check the file, the signers and the expiry date, then try again.',
  badFile: 'Choose a PDF that has passed its checks and is not used anywhere else.',
  badSigner: 'Choose signers who can still be contacted.',
  badTemplate: 'Choose a template version that exists.',
} as const;

/** Who asks, from the request's context: never from input. */
export interface SigningRequester {
  readonly tenant: string;
  readonly membershipId: string;
  readonly requestId: string;
  readonly audit: RequestAudit;
}

export interface SigningDependencies {
  readonly sender: JobSender;
  /** The cell's live provider (settings.ts), or null while signing is not set up. */
  readonly provider: ProviderKey | null;
  readonly now?: () => Date;
}

export function createSigning({ sender, provider, now = () => new Date() }: SigningDependencies) {
  return async function requestSignature(
    tx: TenantTransaction,
    by: SigningRequester,
    input: unknown,
  ): Promise<{ readonly id: string }> {
    const parsed = signatureRequestSchema.safeParse(input);
    if (!parsed.success) throw new ApiError(400, messages.badRequest, { reason: 'bad_signature' });
    const request = parsed.data;
    if (!isExpiryAllowed(request.expiresAt, now())) {
      throw new ApiError(400, documentsMessages.expiry, { reason: 'bad_expiry' });
    }
    const db = tx.$extendTables<EsignTables>();

    const connection =
      provider === null
        ? undefined
        : await db
            .selectFrom('app.signature_connection')
            .select('id')
            .where('tenant_id', '=', by.tenant)
            .where('provider', '=', provider)
            .where('status', '=', 'active')
            .executeTakeFirst();
    if (connection === undefined)
      throw new ApiError(409, messages.notSetUp, { reason: 'no_connection' });

    // A file of another tenant is invisible, so it answers like any unusable file.
    const file = await db
      .selectFrom('app.file')
      .select(['sha256', 'content_type', 'scan_state', 'erased_at', 'linked_at'])
      .where('tenant_id', '=', by.tenant)
      .where('id', '=', request.fileId)
      .executeTakeFirst();
    if (
      file?.sha256 === undefined ||
      file.sha256 === null ||
      file.content_type !== 'application/pdf' ||
      file.scan_state !== 'clean' ||
      file.erased_at !== null ||
      file.linked_at !== null
    ) {
      throw new ApiError(400, messages.badFile, { reason: 'bad_file' });
    }

    for (const { personId } of request.signers) {
      if ((await signerContact(tx, personId)) === null) {
        throw new ApiError(400, messages.badSigner, { reason: 'bad_signer' });
      }
    }
    if (
      request.templateVersionId !== undefined &&
      (await templateVersionById(tx, request.templateVersionId)) === undefined
    ) {
      throw new ApiError(400, messages.badTemplate, { reason: 'bad_template' });
    }

    const { id } = await db
      .insertInto('app.signature_request')
      .values({
        tenant_id: by.tenant,
        connection_id: connection.id,
        sent_sha256: file.sha256,
        template_version_id: request.templateVersionId ?? null,
        expires_at: request.expiresAt,
        created_by: by.membershipId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('app.signature_signer')
      .values(
        request.signers.map((signer) => ({
          tenant_id: by.tenant,
          signature_request_id: id,
          person_id: signer.personId,
          signing_order: signer.order,
        })),
      )
      .execute();
    await db
      .insertInto('app.signature_request_file')
      .values({
        tenant_id: by.tenant,
        signature_request_id: id,
        role: 'sent',
        file_id: request.fileId,
      })
      .execute();

    for (const { personId } of request.signers) {
      await by.audit.record({
        action: 'platform.signature.requested',
        entityId: id,
        changes: { 'app.signature_request.status': { after: 'draft' } },
        subjectPartyId: personId,
      });
    }
    await sendJob(
      tx,
      signatureSendQueue,
      { signature: id },
      { sender, requestId: by.requestId, causingUserId: by.membershipId },
      { singletonOn: ['signature'] },
    );
    return { id };
  };
}
