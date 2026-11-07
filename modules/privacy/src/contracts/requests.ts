// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Rights requests (UK GDPR Articles 15 to 22, and complaints under the DUAA
// 2025) and their clock. The subject is a `party.person` id; the request
// holds no identity evidence, only where the check is. Every change to the
// clock is its own POST with a reason code, so each is an audited state
// change by the session's member. Responses carry the clock as
// rightsRequestClock() computes it, so the console and server agree.
//
// `privacy.requests.manage` lists, logs (`privacy.rights_request.created`),
// reads (`.viewed`, a sensitive read) and changes (`.updated`) requests, and
// pauses, resumes, extends and closes their clock (`.paused`, `.resumed`,
// `.extended`, `.closed`).

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { z } from 'zod';

import { clockStates } from './deadline.ts';
import { privacyMessages as m, says } from './messages.ts';
import { choice, cursorSchema, dateSchema, paragraphs, timestampSchema } from './schemas.ts';

export const requestKinds = [
  'access',
  'rectification',
  'erasure',
  'restriction',
  'portability',
  'objection',
  'automated_decision',
  'complaint',
] as const;

export const requestChannels = [
  'email',
  'post',
  'phone',
  'in_person',
  'web_form',
  'social_media',
  'other',
] as const;

export const identityChecks = [
  'not_started',
  'requested',
  'verified',
  'not_needed',
  'failed',
] as const;

export const pauseReasons = ['identity_proof', 'clarification'] as const;
export const resumeReasons = ['information_received', 'no_longer_needed'] as const;
export const extensionReasons = ['complex', 'numerous'] as const;
export const closeReasons = [
  'completed',
  'refused',
  'withdrawn',
  'identity_not_confirmed',
] as const;

const MAX_SUMMARY = 2000;

/** What a request says, besides whom it is about and when it arrived. */
const detailsShape = {
  kind: choice(requestKinds, m.requestKind),
  channel: choice(requestChannels, m.requestChannel),
  summary: paragraphs(MAX_SUMMARY, m.summary),
  identityCheck: choice(identityChecks, m.identityCheck),
};

export const rightsRequestInputSchema = z.strictObject({
  personId: idSchema,
  /**
   * The server derives the received date in the tenant's time zone, and
   * rightsRequestClock() refuses one after today (`in_future`).
   */
  receivedAt: timestampSchema,
  ...detailsShape,
});

export type RightsRequestInput = z.infer<typeof rightsRequestInputSchema>;

/** A request keeps its subject and received time; log a new one to change them. */
export const rightsRequestUpdateSchema = z.strictObject(detailsShape);

export type RightsRequestUpdate = z.infer<typeof rightsRequestUpdateSchema>;

/**
 * The day it happened, in the tenant's time zone. rightsRequestClock()
 * refuses one after the day it is recorded (`in_future`), and judges a late
 * pause or extension by both days.
 */
const onShape = { on: dateSchema };

export const pauseInputSchema = z.strictObject({
  ...onShape,
  reason: choice(pauseReasons, m.pauseReason),
});

export const resumeInputSchema = z.strictObject({
  ...onShape,
  reason: choice(resumeReasons, m.resumeReason),
});

export const extensionInputSchema = z.strictObject({
  ...onShape,
  months: z
    .number()
    .refine((months) => months === 1 || months === 2, { ...says(m.extensionMonths), abort: true })
    .pipe(z.literal([1, 2])),
  reason: choice(extensionReasons, m.extensionReason),
});

export const closeInputSchema = z.strictObject({
  ...onShape,
  reason: choice(closeReasons, m.closeReason),
});

export const clockSchema = z.strictObject({
  state: z.enum(clockStates),
  /** Null while the clock is paused. */
  dueOn: dateSchema.nullable(),
});

const recorded = { on: dateSchema, membershipId: idSchema, recordedAt: timestampSchema };

/** A change to the clock, by the member who recorded it. */
export const clockEventSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('paused'), ...recorded, reason: z.enum(pauseReasons) }),
  z.strictObject({ kind: z.literal('resumed'), ...recorded, reason: z.enum(resumeReasons) }),
  z.strictObject({
    kind: z.literal('extended'),
    ...recorded,
    months: z.literal([1, 2]),
    reason: z.enum(extensionReasons),
  }),
  z.strictObject({ kind: z.literal('closed'), ...recorded, reason: z.enum(closeReasons) }),
]);

export const rightsRequestSchema = z.strictObject({
  id: idSchema,
  kind: z.enum(requestKinds),
  personId: idSchema,
  receivedAt: timestampSchema,
  receivedOn: dateSchema,
  channel: z.enum(requestChannels),
  summary: z.string(),
  identityCheck: z.enum(identityChecks),
  clock: clockSchema,
  clockEvents: z.array(clockEventSchema),
  /** The platform subject access export this request started, once started. */
  exportRequestId: idSchema.nullable(),
  /** The platform erasure this request started, once started. */
  erasureRequestId: idSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type RightsRequest = z.infer<typeof rightsRequestSchema>;

/** The soonest due first; paused requests last. */
export const rightsRequestQuerySchema = z.strictObject({
  kind: choice(requestKinds, m.requestKind).optional(),
  state: choice(clockStates, m.clockState).optional(),
  /** Due on or before today plus this many days, in the tenant's time zone. */
  dueWithinDays: z
    .string()
    .refine((days) => /^\d{1,3}$/.test(days) && Number(days) <= 366, says(m.dueWithinDays))
    .optional(),
  cursor: cursorSchema.optional(),
});

export type RightsRequestQuery = z.infer<typeof rightsRequestQuerySchema>;

export const rightsRequestPageSchema = z.strictObject({
  requests: z.array(
    rightsRequestSchema.pick({
      id: true,
      kind: true,
      personId: true,
      receivedOn: true,
      channel: true,
      identityCheck: true,
      clock: true,
    }),
  ),
  nextCursor: cursorSchema.nullable(),
});

const manage = {
  audience: 'console',
  module: 'privacy',
  permission: 'privacy.requests.manage',
  scope: 'tenant',
} as const;

export const requestParamsSchema = z.strictObject({ requestId: idSchema });

const request = { params: requestParamsSchema } as const;

export const listRightsRequests = defineRoute({
  ...manage,
  method: 'GET',
  path: '/console/rights-requests',
  summary: 'List rights requests by kind, status and due date, a page at a time',
  query: rightsRequestQuerySchema,
  responses: { 200: rightsRequestPageSchema },
});

export const createRightsRequest = defineRoute({
  ...manage,
  method: 'POST',
  idempotent: true,
  path: '/console/rights-requests',
  summary: 'Log a rights request from a person',
  body: rightsRequestInputSchema,
  responses: { 201: rightsRequestSchema },
});

export const getRightsRequest = defineRoute({
  ...manage,
  ...request,
  method: 'GET',
  path: '/console/rights-requests/:requestId',
  summary: 'Read a rights request with its clock',
  responses: { 200: rightsRequestSchema },
});

export const updateRightsRequest = defineRoute({
  ...manage,
  ...request,
  method: 'PUT',
  path: '/console/rights-requests/:requestId',
  summary: "Change a rights request's kind, channel, summary or identity check",
  body: rightsRequestUpdateSchema,
  responses: { 200: rightsRequestSchema },
});

const clockChange = <const P extends string, B extends z.ZodType>(
  path: P,
  summary: string,
  body: B,
) =>
  ({
    ...manage,
    ...request,
    method: 'POST',
    idempotent: true,
    path: `/console/rights-requests/:requestId/${path}`,
    summary,
    body,
    responses: { 200: rightsRequestSchema },
  }) as const;

export const pauseRightsRequest = defineRoute(
  clockChange(
    'pause',
    'Stop the clock while waiting for identity proof or clarification',
    pauseInputSchema,
  ),
);

export const resumeRightsRequest = defineRoute(
  clockChange('resume', 'Restart the clock', resumeInputSchema),
);

export const extendRightsRequest = defineRoute(
  clockChange('extension', 'Extend the deadline once, by 1 or 2 months', extensionInputSchema),
);

export const closeRightsRequest = defineRoute(
  clockChange('closure', 'Close a rights request', closeInputSchema),
);

export const rightsRequestRoutes = {
  listRightsRequests,
  createRightsRequest,
  getRightsRequest,
  updateRightsRequest,
  pauseRightsRequest,
  resumeRightsRequest,
  extendRightsRequest,
  closeRightsRequest,
} as const;
