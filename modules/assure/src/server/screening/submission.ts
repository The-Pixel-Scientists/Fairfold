// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The handler of assure's event queue for `grants.application_submitted.v1`
// (ADR 0034, ADR 0031). It starts a screening run for the applicant
// organisation, which covers its name, registered name, current contacts and
// officers. The submission is already committed and never waits for the run:
// this job only queues one. With assure off it does nothing. It reads no
// name, and a second delivery starts no second run. It is wired through
// defineEventHandler('assure', ...), which parses the event and checks that
// its tenant is the job's (ADR 0009), so it takes the parsed envelope.

import { idSchema } from '@pixel-scientists/domain';
import type { EventEnvelope } from '@pixel-scientists/domain/events';

import { assureIsOn, organisationIsErased } from '../registries/store.ts';
import type { PartyReader, RunAuditEvent, ScreeningFailureCode, ScreeningJob } from './run.ts';
import { insertRun, runStartedBy, type Tx } from './store.ts';

const SUBMITTED = 'grants.application_submitted.v1';

/** What defineEventHandler() passes: the job with its event parsed and checked. */
export type SubmissionJob = Omit<ScreeningJob, 'data'> & { readonly data: EventEnvelope };

export interface SubmissionDependencies {
  readonly party: PartyReader;
  readonly queueScreening: (
    tx: Tx,
    data: { readonly runId: string },
    by: ScreeningJob['context'],
  ) => Promise<unknown>;
  readonly audit: (tx: Tx, job: ScreeningJob, event: RunAuditEvent) => Promise<void>;
  readonly fail: (code: ScreeningFailureCode) => Error;
}

export function submissionSubscriber(deps: SubmissionDependencies) {
  return async (tx: Tx, job: SubmissionJob): Promise<void> => {
    if (job.data.type !== SUBMITTED) return;
    const submitted = idSchema.safeParse(
      (job.data.data as { organisationId?: unknown }).organisationId,
    );
    if (!submitted.success) throw deps.fail('invalid_payload');
    const partyId = submitted.data;

    if (!(await assureIsOn(tx)) || (await runStartedBy(tx, job.id))) return;
    if (
      (await organisationIsErased(tx, partyId)) ||
      (await deps.party.names(tx, partyId)) === null
    ) {
      return;
    }
    const runId = await insertRun(tx, partyId, 'submission', null);
    await deps.queueScreening(tx, { runId }, job.context);
    await deps.audit(tx, job, {
      action: 'assure.screening_run.started',
      entityId: runId,
      subjectPartyId: partyId,
      changes: { 'assure.screening_run.trigger': { after: 'submission' } },
    });
  };
}
