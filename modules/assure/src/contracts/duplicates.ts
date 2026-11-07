// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Duplicate flags (ADR 0025, ADR 0031). A flag asks staff to look at two
// parties that may be one, by the signal that raised it, under party's
// matching rules. It is advisory: it never blocks a submission, and never
// links, merges or rejects anyone. Applicants never see one. Reused bank
// details wait for wave 2.
//
// `assure.duplicates.review` lists flags and dismisses one with a reason
// (`assure.duplicate_flag.dismissed`). A dismissed flag answers 409.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { z } from 'zod';

import { assureMessages } from './messages.ts';
import { choice, timestampSchema } from './schemas.ts';

export const duplicateSignals = [
  'shared_identifier',
  'similar_name',
  'shared_contact_point',
] as const;

export const flagDismissReasons = [
  'different_organisation',
  'different_person',
  'related_but_separate',
  'duplicate_allowed',
] as const;

/** `applicationId` and `otherApplicationId` are set when an application raised the flag. */
export const duplicateFlagSchema = z.strictObject({
  id: idSchema,
  partyId: idSchema,
  otherPartyId: idSchema,
  applicationId: idSchema.nullable(),
  otherApplicationId: idSchema.nullable(),
  signal: z.enum(duplicateSignals),
  raisedAt: timestampSchema,
  dismissal: z
    .strictObject({
      reason: z.enum(flagDismissReasons),
      dismissedAt: timestampSchema,
      /** The dismissing membership. */
      dismissedBy: idSchema,
    })
    .nullable(),
});

export type DuplicateFlag = z.infer<typeof duplicateFlagSchema>;

export const duplicateFlagListSchema = z.strictObject({ flags: z.array(duplicateFlagSchema) });

export const flagDismissalInputSchema = z.strictObject({
  reason: choice(flagDismissReasons, assureMessages.flagReason),
});

const review = {
  audience: 'console',
  module: 'assure',
  scope: 'tenant',
  permission: 'assure.duplicates.review',
} as const;

export const listApplicationDuplicateFlags = defineRoute({
  ...review,
  method: 'GET',
  path: '/console/applications/:applicationId/duplicate-flags',
  summary: "List an application's duplicate flags, newest first",
  params: z.strictObject({ applicationId: idSchema }),
  responses: { 200: duplicateFlagListSchema },
});

export const listPartyDuplicateFlags = defineRoute({
  ...review,
  method: 'GET',
  path: '/console/parties/:partyId/duplicate-flags',
  summary: "List an organisation's or person's duplicate flags, newest first",
  params: z.strictObject({ partyId: idSchema }),
  responses: { 200: duplicateFlagListSchema },
});

export const dismissDuplicateFlag = defineRoute({
  ...review,
  method: 'POST',
  path: '/console/duplicate-flags/:flagId/dismissal',
  summary: 'Dismiss a duplicate flag, with a reason from the list',
  params: z.strictObject({ flagId: idSchema }),
  body: flagDismissalInputSchema,
  responses: { 200: duplicateFlagSchema },
});

export const duplicateRoutes = {
  listApplicationDuplicateFlags,
  listPartyDuplicateFlags,
  dismissDuplicateFlag,
} as const;
