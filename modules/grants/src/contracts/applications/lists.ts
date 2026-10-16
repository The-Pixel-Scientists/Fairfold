// SPDX-License-Identifier: AGPL-3.0-or-later
//
// An application's checked lists. The database checks the same values, so
// adding one is a contract change and a migration.

import { z } from 'zod';

/** As stored: a draft is the applicant's own unsubmitted work. */
export const applicationStatuses = ['draft', 'submitted', 'withdrawn'] as const;

export type ApplicationStatus = (typeof applicationStatuses)[number];

export const applicationStatusSchema = z.enum(applicationStatuses);

/** The statuses staff see, with the words the console shows. Drafts never reach the console. */
export const submissionStatuses = {
  submitted: 'Submitted',
  withdrawn: 'Withdrawn',
} as const satisfies Partial<Record<ApplicationStatus, string>>;

export type SubmissionStatus = keyof typeof submissionStatuses;

export const submissionStatusSchema = z.enum(
  Object.keys(submissionStatuses) as [SubmissionStatus, ...SubmissionStatus[]],
);

/** A recorded eligibility check's outcome, with the words the console shows. */
export const eligibilityOutcomes = {
  eligible: 'Eligible',
  stopped: 'Not eligible',
} as const;

export type EligibilityOutcome = keyof typeof eligibilityOutcomes;

export const eligibilityOutcomeSchema = z.enum(
  Object.keys(eligibilityOutcomes) as [EligibilityOutcome, ...EligibilityOutcome[]],
);
