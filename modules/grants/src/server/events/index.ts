// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Publishing grants' events (ADR 0016, ADR 0034). Each function is called
// inside the transaction that made the change, with values read from the
// rows it wrote, never from the request. The payload holds ids, a code and a
// time: the tenant and the causing member travel in the envelope. Only a
// release publishes a decision event (rule 8), and publishing changes no
// status, outcome or amount (rule 9).

import {
  applicationSubmitted,
  decisionReleased,
  type SubmissionRoute,
  type SubmissionTiming,
} from '../../contracts/index.ts';
import type { EventCause, GrantsDependencies } from '../programme/context.ts';
import type { Tx } from '../programme/tables.ts';

type Publisher = Pick<GrantsDependencies, 'publish'>;

/** An application the database marked late, or inside its effective closing time. */
export const timingOf = (late: boolean): SubmissionTiming => (late ? 'late' : 'on_time');

export interface SubmittedApplication {
  readonly id: string;
  readonly roundId: string;
  readonly programmeId: string;
  readonly organisationId: string;
  readonly applicantPersonId: string;
  readonly route: SubmissionRoute;
  readonly late: boolean;
  readonly submittedAt: Date;
}

export function publishApplicationSubmitted(
  tx: Tx,
  { publish }: Publisher,
  cause: EventCause,
  application: SubmittedApplication,
): Promise<void> {
  return publish(
    tx,
    applicationSubmitted,
    {
      applicationId: application.id,
      roundId: application.roundId,
      programmeId: application.programmeId,
      organisationId: application.organisationId,
      applicantPersonId: application.applicantPersonId,
      route: application.route,
      timing: timingOf(application.late),
      submittedAt: application.submittedAt.toISOString(),
    },
    cause,
  );
}

export interface ReleasedDecision {
  readonly id: string;
  readonly applicationId: string;
  readonly roundId: string;
  readonly organisationId: string;
  readonly recipientPersonId: string;
  readonly releasedAt: Date;
}

export function publishDecisionReleased(
  tx: Tx,
  { publish }: Publisher,
  cause: EventCause,
  decision: ReleasedDecision,
): Promise<void> {
  return publish(
    tx,
    decisionReleased,
    {
      decisionId: decision.id,
      applicationId: decision.applicationId,
      roundId: decision.roundId,
      organisationId: decision.organisationId,
      recipientPersonId: decision.recipientPersonId,
      releasedAt: decision.releasedAt.toISOString(),
    },
    cause,
  );
}
