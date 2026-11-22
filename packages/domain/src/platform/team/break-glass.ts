// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Emergency access to a restricted record (ADR 0037). A member holding
// `platform.break_glass.use` opens one record for one hour, with step-up, a
// reason from a closed list and their own words. The database sets both
// times, so no request carries one, and nothing extends or ends a grant:
// renewing is a new grant with a new reason. A grant gives reach to read the
// record's own pages, never a permission, so it shows nothing the member's
// routes would not, blind-review identity included. Members holding
// `platform.break_glass.review` are alerted at once and review it after.
// No response carries a record's content.

import { z } from 'zod';

import { defineRoute } from '../../api/route.ts';
import { idSchema } from '../../id.ts';
import { restrictableRecords } from '../access.ts';
import { auditActionPattern } from '../audit.ts';
import { messages } from '../messages.ts';

export const breakGlassReasons = [
  'risk_to_life',
  'safeguarding_concern',
  'legal_duty',
  'named_people_unavailable',
  'other',
] as const;

export type BreakGlassReason = (typeof breakGlassReasons)[number];

export const breakGlassOutcomes = ['justified', 'not_justified'] as const;

export type BreakGlassOutcome = (typeof breakGlassOutcomes)[number];

const recordTypeSchema = z.enum(restrictableRecords);

const reasonSchema = z.enum(breakGlassReasons, { error: messages.chooseReason });

const outcomeSchema = z.enum(breakGlassOutcomes, { error: messages.chooseOutcome });

/** Why access is needed, in 20 to 1,000 characters. Line breaks are kept; hidden characters are refused. */
export const breakGlassReasonTextSchema = z
  .string()
  .trim()
  .min(20, { error: messages.breakGlassReasonText })
  .max(1000, { error: messages.breakGlassReasonText })
  .regex(/^(?:[\t\n\r]|[^\p{Cc}\p{Cf}\p{Cs}])*$/u, { error: messages.textHidden });

export const breakGlassOpenSchema = z.strictObject({
  recordType: recordTypeSchema,
  recordId: idSchema,
  reasonCode: reasonSchema,
  reasonText: breakGlassReasonTextSchema,
});

/** A grant as its holder sees it. */
export const breakGlassGrantSchema = z.strictObject({
  id: idSchema,
  recordType: recordTypeSchema,
  recordId: idSchema,
  reasonCode: reasonSchema,
  grantedAt: z.iso.datetime(),
  /** One hour after `grantedAt`, set by the database. */
  expiresAt: z.iso.datetime(),
});

export type BreakGlassGrant = z.infer<typeof breakGlassGrantSchema>;

const memberRefSchema = z.strictObject({
  membershipId: idSchema,
  /** From the member's person record; null when it has no name yet. */
  name: z.string().nullable(),
});

/** A grant waiting for review. */
export const breakGlassQueueItemSchema = breakGlassGrantSchema.extend({
  requester: memberRefSchema,
});

export const breakGlassReviewSchema = z.strictObject({
  outcome: outcomeSchema,
  reviewer: memberRefSchema,
  reviewedAt: z.iso.datetime(),
});

/** A grant as a reviewer reads it: the reason in the requester's words, and each read made under it, by id. */
export const breakGlassReviewItemSchema = breakGlassQueueItemSchema.extend({
  reasonText: z.string(),
  reads: z.array(
    z.strictObject({
      auditEventId: idSchema,
      action: z.string().regex(auditActionPattern),
      occurredAt: z.iso.datetime(),
    }),
  ),
  /** Null until a reviewer other than the requester records the outcome. */
  review: breakGlassReviewSchema.nullable(),
});

const use = {
  audience: 'console',
  module: 'platform',
  permission: 'platform.break_glass.use',
  scope: 'tenant',
} as const;

const review = { ...use, permission: 'platform.break_glass.review' } as const;

const grantParams = z.strictObject({ grantId: idSchema });

export const openBreakGlass = defineRoute({
  ...use,
  method: 'POST',
  stepUp: true,
  idempotent: true,
  path: '/console/break-glass',
  summary: 'Open a restricted record in an emergency, for one hour',
  body: breakGlassOpenSchema,
  responses: { 201: breakGlassGrantSchema },
});

export const listOwnBreakGlass = defineRoute({
  ...use,
  method: 'GET',
  path: '/console/break-glass',
  summary: 'List your emergency access grants that have not expired',
  responses: { 200: z.strictObject({ grants: z.array(breakGlassGrantSchema) }) },
});

export const listBreakGlassQueue = defineRoute({
  ...review,
  method: 'GET',
  path: '/console/break-glass-reviews',
  summary: 'List emergency access grants waiting for review',
  responses: { 200: z.strictObject({ grants: z.array(breakGlassQueueItemSchema) }) },
});

export const readBreakGlassReview = defineRoute({
  ...review,
  method: 'GET',
  path: '/console/break-glass-reviews/:grantId',
  summary: 'Read an emergency access grant, its reason and the reads made under it',
  params: grantParams,
  responses: { 200: breakGlassReviewItemSchema },
});

export const reviewBreakGlass = defineRoute({
  ...review,
  method: 'POST',
  idempotent: true,
  path: '/console/break-glass-reviews/:grantId',
  summary: "Record whether another member's emergency access was justified",
  params: grantParams,
  body: z.strictObject({ outcome: outcomeSchema }),
  responses: { 201: breakGlassReviewSchema },
});

export const breakGlassRoutes = {
  openBreakGlass,
  listOwnBreakGlass,
  listBreakGlassQueue,
  readBreakGlassReview,
  reviewBreakGlass,
} as const;
