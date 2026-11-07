// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reasonable adjustments' checked lists (Equality Act 2010), with the words
// the console shows. The database checks the same values, so adding one is a
// contract change and a migration. Reason codes are coarse and never name a
// condition, and there is no free-text reason. They are still classified
// special category, since `access_needs` can reveal health, so they never go
// in an audit value or reach the applicant.

import { z } from 'zod';

/** What staff give: more time, or submitting for the applicant through the alternative route. */
export const adjustmentKinds = {
  deadline_extension: 'More time to apply',
  alternative_route: 'Staff submit for the applicant',
} as const;

export type AdjustmentKind = keyof typeof adjustmentKinds;

export const adjustmentKindSchema = z.enum(
  Object.keys(adjustmentKinds) as [AdjustmentKind, ...AdjustmentKind[]],
);

export const adjustmentReasons = {
  access_needs: 'Access needs',
  caring_responsibilities: 'Caring responsibilities',
  technical_problem: 'Technical problem',
  bereavement: 'Bereavement',
  other: 'Another reason',
} as const;

export type AdjustmentReason = keyof typeof adjustmentReasons;

export const adjustmentReasonSchema = z.enum(
  Object.keys(adjustmentReasons) as [AdjustmentReason, ...AdjustmentReason[]],
);

export const revokeReasons = {
  no_longer_needed: 'No longer needed',
  applicant_asked: 'The applicant asked',
  granted_in_error: 'Given by mistake',
  other: 'Another reason',
} as const;

export type RevokeReason = keyof typeof revokeReasons;

export const revokeReasonSchema = z.enum(
  Object.keys(revokeReasons) as [RevokeReason, ...RevokeReason[]],
);
