// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the console's adjustment routes accept. Inputs are strict and never
// name a member: who granted or removed an adjustment comes from the
// session. The server checks everything again: the organisation exists in
// the tenant, a named application is that organisation's in the round, and
// a new closing time, read in the round's zone, is after the round's own
// closing time and has not passed. There is no free-text reason. Only an
// extension may name an application: the alternative route is for the
// organisation in the round, and assisted starting always makes a new
// application (applications/assisted.ts).

import { idSchema } from '@pixel-scientists/domain';
import { z } from 'zod';

import { localDateTimeSchema } from '../programme/inputs.ts';
import { adjustmentReasonSchema, revokeReasonSchema } from './lists.ts';

const given = { organisationId: idSchema, reasonCode: adjustmentReasonSchema };

export const grantAdjustmentInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('deadline_extension'),
    ...given,
    /** Left out for the organisation's application in the round, whenever it starts. */
    applicationId: idSchema.optional(),
    /** On the wall clock of the round's zone, like the round's own. */
    closesAt: localDateTimeSchema,
  }),
  z.strictObject({ kind: z.literal('alternative_route'), ...given }),
]);

export type GrantAdjustmentInput = z.infer<typeof grantAdjustmentInputSchema>;

export const revokeAdjustmentInputSchema = z.strictObject({ reasonCode: revokeReasonSchema });

export type RevokeAdjustmentInput = z.infer<typeof revokeAdjustmentInputSchema>;
