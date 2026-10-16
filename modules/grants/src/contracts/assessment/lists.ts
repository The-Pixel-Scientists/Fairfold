// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Assessment's checked lists. The database checks the same values, so
// adding one is a contract change and a migration.

import { z } from 'zod';

/**
 * Where an assignment stands, with the words the console shows. A
 * conflicted one has ended: the reviewer declared a conflict and can no
 * longer reach it. It is kept for good as the record of that conflict.
 */
export const assignmentStatuses = {
  assigned: 'Assigned',
  submitted: 'Submitted',
  conflicted: 'Conflict declared',
} as const;

export type AssignmentStatus = keyof typeof assignmentStatuses;

export const assignmentStatusSchema = z.enum(
  Object.keys(assignmentStatuses) as [AssignmentStatus, ...AssignmentStatus[]],
);

/** The statuses a reviewer sees on their own assignments: never a conflicted one. */
export const reviewStatusSchema = assignmentStatusSchema.exclude(['conflicted']);

export type ReviewStatus = z.infer<typeof reviewStatusSchema>;
