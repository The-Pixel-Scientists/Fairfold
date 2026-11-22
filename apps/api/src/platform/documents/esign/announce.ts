// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a job that moves a signature request tells others (ADR 0040, "Audit
// and events"): one audit event for each signer, so each person's subject
// access finds it, and one published event, in the job's transaction. Ids,
// statuses and codes only: never a name, address, file name or provider
// message. Rules 8 and 9: this tells subscribers and a person decides.

import type { Transaction } from '@pixel-scientists/db';
import { publish } from '@pixel-scientists/db/jobs';
import type { RunningJob } from '@pixel-scientists/db/jobs';
import { signatureEvents, type SignatureStatus } from '@pixel-scientists/domain/documents';
import type { EventDefinition } from '@pixel-scientists/domain/events';

import { recordAudit } from '../../../audit/writer.ts';
import { jobActor } from '../../../worker/job-actor.ts';

export type AnnouncedStatus = Exclude<SignatureStatus, 'draft'>;

export interface SignatureChange {
  readonly request: string;
  readonly status: AnnouncedStatus;
  /** `signature.<code>` of a failed request. */
  readonly errorCode?: string;
  /** The people asked to sign, by party id. */
  readonly signers: readonly string[];
}

export async function announce(
  trx: Transaction<unknown>,
  job: Pick<RunningJob<unknown>, 'id' | 'context'>,
  { request, status, errorCode, signers }: SignatureChange,
): Promise<void> {
  const changes = {
    'app.signature_request.status': { after: status },
    ...(errorCode === undefined
      ? {}
      : { 'app.signature_request.error_code': { after: errorCode } }),
  };
  for (const subjectPartyId of signers) {
    await recordAudit(trx, jobActor(job), {
      action: `platform.signature.${status}`,
      entityId: request,
      changes,
      subjectPartyId,
    });
  }
  await publish(
    trx,
    signatureEvents[status] as EventDefinition,
    { signatureRequestId: request, status, changedAt: new Date().toISOString() },
    { ...job.context, causedBy: job.context.causingUserId },
  );
}
