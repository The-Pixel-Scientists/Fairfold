// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The programme set-up's checked lists. The database checks the same
// values, so adding one is a contract change and a migration.

import { z } from 'zod';

/** Whether a programme takes applications, with the words the console shows for it. */
export const programmeStatuses = {
  draft: 'Draft',
  open: 'Open',
  closed: 'Closed',
} as const;

export type ProgrammeStatus = keyof typeof programmeStatuses;

export const programmeStatusSchema = z.enum(
  Object.keys(programmeStatuses) as [ProgrammeStatus, ...ProgrammeStatus[]],
);

/** What happens to an application submitted after a round closes, in the words the console shows. */
export const latePolicies = {
  refuse: {
    label: 'Refuse late applications',
    hint: 'Applicants cannot submit after the closing time.',
  },
  accept_and_flag: {
    label: 'Accept late applications and mark them as late',
    hint: 'Applicants can still submit, and you see which applications came in late.',
  },
} as const;

export type LatePolicy = keyof typeof latePolicies;

export const latePolicySchema = z.enum(Object.keys(latePolicies) as [LatePolicy, ...LatePolicy[]]);

/** A decision's outcome, each with its own email template. */
export const outcomes = {
  accepted: 'Accepted',
  waitlisted: 'Waitlisted',
  declined: 'Declined',
} as const;

export type Outcome = keyof typeof outcomes;

export const outcomeIds = Object.keys(outcomes) as [Outcome, ...Outcome[]];

export const outcomeSchema = z.enum(outcomeIds);

/** The stages every new round starts with, in order. */
export const defaultStageNames = ['Intake', 'Review', 'Decision'] as const;
