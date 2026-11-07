// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The grants module's published events (ADR 0016, ADR 0034), for the crm
// timeline. Each carries ids and codes only: the tenant and the member who
// caused it travel in the envelope, and a handler reads anything else
// through grants' contracts. Only a release publishes a decision event, so
// nothing reveals an outcome before it is released (rule 8).

import { idSchema } from '@pixel-scientists/domain';
import { defineEvent } from '@pixel-scientists/domain/events';
import { z } from 'zod';

import { submissionRouteSchema } from '../applications/lists.ts';

/** Whether an application came in before its effective closing time, with the words staff see. */
export const submissionTimings = {
  on_time: 'On time',
  late: 'Late',
} as const;

export type SubmissionTiming = keyof typeof submissionTimings;

const timestamp = z.iso.datetime({ offset: true });

/**
 * An application was submitted, by the applicant or by staff for them. Its
 * party ids are those at submission: one merged since names the loser, which
 * a handler resolves to the survivor through party's read contract.
 */
export const applicationSubmitted = defineEvent('grants.application_submitted.v1', {
  read: 'grants.applications.read',
  data: z.strictObject({
    applicationId: idSchema,
    roundId: idSchema,
    programmeId: idSchema,
    organisationId: idSchema,
    applicantPersonId: idSchema,
    route: submissionRouteSchema,
    timing: z.enum(Object.keys(submissionTimings) as [SubmissionTiming, ...SubmissionTiming[]]),
    submittedAt: timestamp,
  }),
});

/**
 * A decision was released to the applicant. The outcome is not carried
 * (ADR 0034): a handler reads it through grants' contract, which checks the
 * decision is still released. Its party ids are those at release, resolved
 * through party after a merge like the submission's.
 */
export const decisionReleased = defineEvent('grants.decision_released.v1', {
  read: 'grants.applications.read',
  data: z.strictObject({
    decisionId: idSchema,
    applicationId: idSchema,
    roundId: idSchema,
    organisationId: idSchema,
    recipientPersonId: idSchema,
    releasedAt: timestamp,
  }),
});
