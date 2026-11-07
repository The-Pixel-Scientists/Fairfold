// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Responses, for staff in the console (ADR 0004, ADR 0032, ADR 0036).
// Answers come only through the staff projection of the version the
// response pinned (rule 7), so aggregate-only answers, which are all the
// special category ones, never reach staff; the totals route counts
// responses, never answers. No response carries the respondent token, its
// hash, the idempotency key, the proof or anything about the client.
//
// - `forms.responses.read` lists responses and counts them, reads one
//   (`forms.response.viewed`, a sensitive read), and finds one by the
//   reference its respondent quotes, sent in the body so it never reaches a
//   URL or access log (`forms.response.viewed` again). The subject party id
//   of a signed-in respondent travels in the audit context (ADR 0027).
// - `forms.responses.manage` marks a response as spam with a reason code
//   (`forms.response.marked_spam`), which keeps it out of lists, exports and
//   the warehouse, and undoes that (`forms.response.unmarked_spam`).
//
// Code never removes, hides, rejects or scores a response (rule 9): one
// sent without the browser check is shown with that fact, for staff to
// judge.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute, projectedAnswersSchemas } from '@pixel-scientists/domain/api';
import { formDefinitionSchema } from '@pixel-scientists/domain/forms';
import { z } from 'zod';

import { formsMessages as m, says } from './messages.ts';
import { respondentTokenSchema } from './public.ts';
import {
  choice,
  classified,
  cursorSchema,
  responseRoutes,
  timestampSchema,
  type FieldClasses,
} from './schemas.ts';

export const spamReasons = ['automated', 'abusive', 'unrelated', 'duplicate', 'test'] as const;

export type SpamReason = (typeof spamReasons)[number];

/** Which responses a list shows: those not marked as spam, those of them sent without the check, or spam. */
export const responseViews = ['received', 'without_check', 'spam'] as const;

const summaryShape = {
  id: idSchema,
  formId: idSchema,
  formVersionId: idSchema,
  version: z.int(),
  route: z.enum(responseRoutes),
  /** The signed-in respondent's person record; null for an anonymous response, which links to none. */
  personId: idSchema.nullable(),
  submittedAt: timestampSchema,
  /** An anonymous response sent with no proof, when the browser check did not finish in time. */
  sentWithoutCheck: z.boolean(),
  spamReason: z.enum(spamReasons).nullable(),
};

const summarySchema = z.strictObject(summaryShape);

const summaryClasses = {
  id: 'internal',
  formId: 'internal',
  formVersionId: 'internal',
  version: 'internal',
  route: 'internal',
  personId: 'personal',
  submittedAt: 'internal',
  sentWithoutCheck: 'internal',
  spamReason: 'internal',
} as const satisfies FieldClasses<typeof summarySchema>;

export const responseSummarySchema = classified(summarySchema, summaryClasses);

export type ResponseSummary = z.infer<typeof responseSummarySchema>;

export const responsePageSchema = classified(
  z.strictObject({
    responses: z.array(responseSummarySchema),
    nextCursor: cursorSchema.nullable(),
  }),
  { responses: 'personal', nextCursor: 'internal' },
);

/** One response, with the pinned version's definition and the answers staff may see on it. */
export const responseSchema = classified(
  z.strictObject({
    ...summaryShape,
    definition: formDefinitionSchema,
    answers: projectedAnswersSchemas.staff,
  }),
  { ...summaryClasses, definition: 'internal', answers: 'answers' },
);

export type FormResponse = z.infer<typeof responseSchema>;

const filters = {
  formVersionId: idSchema.optional(),
  submittedFrom: timestampSchema.optional(),
  submittedTo: timestampSchema.optional(),
  route: choice(responseRoutes, m.responseRoute).optional(),
};

/** The newest first. */
export const responseQuerySchema = z.strictObject({
  ...filters,
  view: choice(responseViews, m.responseView).default('received'),
  cursor: cursorSchema.optional(),
});

export const responseTotalsQuerySchema = z.strictObject(filters);

/** Counts of responses matching the filters, never of answers. */
export const responseTotalsSchema = classified(
  z.strictObject({
    received: z.int(),
    signedIn: z.int(),
    anonymous: z.int(),
    sentWithoutCheck: z.int(),
    spam: z.int(),
  }),
  {
    received: 'internal',
    signedIn: 'internal',
    anonymous: 'internal',
    sentWithoutCheck: 'internal',
    spam: 'internal',
  },
);

export const spamInputSchema = z.strictObject({
  reason: choice(spamReasons, m.spamReason),
});

export const referenceInputSchema = z.strictObject({
  reference: z
    .string()
    .refine((value) => respondentTokenSchema.safeParse(value).success, {
      ...says(m.reference),
      abort: true,
    })
    .pipe(respondentTokenSchema),
});

const read = {
  audience: 'console',
  module: 'forms',
  scope: 'tenant',
  permission: 'forms.responses.read',
} as const;

const manage = { ...read, permission: 'forms.responses.manage' } as const;
const response = { params: z.strictObject({ responseId: idSchema }) } as const;
const form = { params: z.strictObject({ formId: idSchema }) } as const;

export const listResponses = defineRoute({
  ...read,
  ...form,
  method: 'GET',
  path: '/console/forms/:formId/responses',
  summary: "List a form's responses, the newest first, a page at a time",
  query: responseQuerySchema,
  responses: { 200: responsePageSchema },
});

export const getResponseTotals = defineRoute({
  ...read,
  ...form,
  method: 'GET',
  path: '/console/forms/:formId/response-totals',
  summary: "Count a form's responses, never their answers",
  query: responseTotalsQuerySchema,
  responses: { 200: responseTotalsSchema },
});

export const getResponse = defineRoute({
  ...read,
  ...response,
  method: 'GET',
  path: '/console/form-responses/:responseId',
  summary: 'Read a response with the answers staff may see, recorded as a sensitive read',
  responses: { 200: responseSchema },
});

export const findResponseByReference = defineRoute({
  ...read,
  method: 'POST',
  path: '/console/form-responses/lookup',
  summary: "Find an anonymous response by its respondent's reference, recorded as a sensitive read",
  body: referenceInputSchema,
  responses: { 200: responseSchema },
});

export const markResponseSpam = defineRoute({
  ...manage,
  ...response,
  method: 'POST',
  path: '/console/form-responses/:responseId/spam',
  summary: 'Mark a response as spam, with the reason',
  body: spamInputSchema,
  responses: { 200: responseSummarySchema },
});

export const unmarkResponseSpam = defineRoute({
  ...manage,
  ...response,
  method: 'POST',
  path: '/console/form-responses/:responseId/not-spam',
  summary: 'Undo marking a response as spam',
  responses: { 200: responseSummarySchema },
});

export const consoleResponseRoutes = {
  listResponses,
  getResponseTotals,
  getResponse,
  findResponseByReference,
  markResponseSpam,
  unmarkResponseSpam,
} as const;
