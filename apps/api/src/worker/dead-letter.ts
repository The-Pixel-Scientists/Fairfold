// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Dead-letter re-send without redrive (ADR 0009, "Consequences"). One dead
// letter of a tenant queue is read in the named tenant, sent again to its
// source queue with the same data from that tenant's transaction, audited in
// that transaction, and only then completed. A job of another tenant reads
// as not found. pg-boss's redrive is never called. Returns ids only.

import { withTenant, type Kysely, type TenantId, type Transaction } from '@pixel-scientists/db';
import {
  completeDeadLetter,
  readDeadLetter,
  sendJob,
  type JobSender,
  type Queue,
  type WorkerRunner,
} from '@pixel-scientists/db/jobs';
import type { z } from 'zod';

export interface Resend<S extends z.ZodObject> {
  readonly runner: WorkerRunner;
  /** The worker's app_worker client. */
  readonly db: Kysely<unknown>;
  readonly sender: JobSender;
  readonly queue: Queue<S, 'tenant'>;
  readonly tenant: TenantId;
  readonly deadLetterId: string;
  /** Writes the operator's audit event in the re-send's transaction. */
  readonly audit: (trx: Transaction<unknown>, ids: ResendIds) => Promise<void>;
}

export interface ResendIds {
  readonly deadLetterId: string;
  /** Null when an identical job was already waiting. */
  readonly newJobId: string | null;
}

/** Null when the dead letter is not waiting in that tenant. */
export async function resendDeadLetter<S extends z.ZodObject>(
  options: Resend<S>,
): Promise<ResendIds | null> {
  const { runner, db, queue, deadLetterId } = options;
  const sent = await withTenant(db, options.tenant, async (trx) => {
    const letter = await readDeadLetter(runner, trx, queue, deadLetterId);
    if (letter === null) return null;
    const context = {
      sender: options.sender,
      requestId: letter.requestId,
      causingUserId: letter.causingUserId,
    };
    const ids = {
      deadLetterId,
      newJobId: await sendJob(trx, queue, letter.data as z.input<S>, context),
    };
    await options.audit(trx, ids);
    return { letter, ids };
  });
  if (sent === null) return null;
  await completeDeadLetter(runner, sent.letter);
  return sent.ids;
}
