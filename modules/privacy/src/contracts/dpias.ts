// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The data protection impact assessment register (UK GDPR Article 35). A
// DPIA covers processing activities by id. Screening answers are keyed by
// the stable id of the question (rule 7) and risks by their own stable id.
// Signing off is its own POST by the session's member; the reminder job
// (S12-27) marks a signed-off DPIA `review_due` when its review date comes.
// Templates are versioned configuration (rule 10) and wait for a
// `privacy.dpia_template` config entity type, which the platform does not
// define yet, so no template route is published here.
//
// `privacy.dpias.manage` lists, creates (`privacy.dpia.created`), reads
// (`.viewed`, a sensitive read), changes (`.updated`) and signs off
// (`.signed_off`) DPIAs.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { z } from 'zod';

import { privacyMessages as m, says } from './messages.ts';
import {
  choice,
  cursorSchema,
  dateSchema,
  ids,
  line,
  paragraphs,
  timestampSchema,
} from './schemas.ts';

export const dpiaStatuses = ['draft', 'in_review', 'signed_off', 'review_due'] as const;

/** The statuses a member sets by changing a DPIA; sign-off and review are their own steps. */
export const editableDpiaStatuses = ['draft', 'in_review'] as const;

export const screeningAnswers = ['yes', 'no', 'unsure'] as const;
export const likelihoods = ['remote', 'possible', 'probable'] as const;
export const severities = ['minimal', 'significant', 'severe'] as const;

export const MAX_SCREENING_ANSWERS = 100;

/** A screening question's stable id. */
export const screeningItemIdSchema = z.string().regex(/^q_[a-z0-9]{1,32}$/);

/** A risk's stable id, kept as the risk is edited. */
export const riskIdSchema = z.string().regex(/^r_[a-z0-9]{1,32}$/);

const riskInputSchema = z.strictObject({
  id: riskIdSchema,
  description: paragraphs(2000, m.riskDescription),
  likelihood: choice(likelihoods, m.likelihood),
  severity: choice(severities, m.severity),
  mitigation: paragraphs(2000),
});

const dpiaShape = {
  title: line(200, m.dpiaTitle),
  processingActivityIds: ids(50),
  screening: z
    .record(screeningItemIdSchema, choice(screeningAnswers, m.screeningAnswer))
    .refine(
      (answers) => Object.keys(answers).length <= MAX_SCREENING_ANSWERS,
      says(m.tooManyAnswers),
    ),
  risks: z
    .array(riskInputSchema)
    .max(50)
    .refine(
      (risks) => new Set(risks.map((risk) => risk.id)).size === risks.length,
      says(m.listedOnce),
    ),
  dpoAdvice: paragraphs(10_000),
};

/** A new DPIA is a draft. */
export const dpiaInputSchema = z.strictObject(dpiaShape);

export type DpiaInput = z.infer<typeof dpiaInputSchema>;

export const dpiaUpdateSchema = z.strictObject({
  ...dpiaShape,
  status: choice(editableDpiaStatuses, m.dpiaStatus),
});

export type DpiaUpdate = z.infer<typeof dpiaUpdateSchema>;

/** The signer is the session's member; the body says when to review. */
export const dpiaSignOffInputSchema = z.strictObject({ reviewOn: dateSchema });

export const dpiaSchema = z.strictObject({
  id: idSchema,
  title: z.string(),
  status: z.enum(dpiaStatuses),
  processingActivityIds: z.array(idSchema),
  screening: z.record(screeningItemIdSchema, z.enum(screeningAnswers)),
  risks: z.array(
    z.strictObject({
      id: riskIdSchema,
      description: z.string(),
      likelihood: z.enum(likelihoods),
      severity: z.enum(severities),
      mitigation: z.string(),
    }),
  ),
  dpoAdvice: z.string(),
  signOff: z
    .strictObject({ membershipId: idSchema, signedOffAt: timestampSchema, reviewOn: dateSchema })
    .nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type Dpia = z.infer<typeof dpiaSchema>;

export const dpiaQuerySchema = z.strictObject({
  status: choice(dpiaStatuses, m.dpiaStatus).optional(),
  cursor: cursorSchema.optional(),
});

export const dpiaPageSchema = z.strictObject({
  dpias: z.array(
    dpiaSchema.pick({ id: true, title: true, status: true, updatedAt: true }).extend({
      reviewOn: dateSchema.nullable(),
    }),
  ),
  nextCursor: cursorSchema.nullable(),
});

const manage = {
  audience: 'console',
  module: 'privacy',
  permission: 'privacy.dpias.manage',
  scope: 'tenant',
} as const;

const dpia = { params: z.strictObject({ dpiaId: idSchema }) } as const;

export const listDpias = defineRoute({
  ...manage,
  method: 'GET',
  path: '/console/dpias',
  summary: 'List data protection impact assessments, a page at a time',
  query: dpiaQuerySchema,
  responses: { 200: dpiaPageSchema },
});

export const createDpia = defineRoute({
  ...manage,
  method: 'POST',
  idempotent: true,
  path: '/console/dpias',
  summary: 'Start a data protection impact assessment',
  body: dpiaInputSchema,
  responses: { 201: dpiaSchema },
});

export const getDpia = defineRoute({
  ...manage,
  ...dpia,
  method: 'GET',
  path: '/console/dpias/:dpiaId',
  summary: 'Read a data protection impact assessment',
  responses: { 200: dpiaSchema },
});

export const updateDpia = defineRoute({
  ...manage,
  ...dpia,
  method: 'PUT',
  path: '/console/dpias/:dpiaId',
  summary: 'Change a data protection impact assessment',
  body: dpiaUpdateSchema,
  responses: { 200: dpiaSchema },
});

export const signOffDpia = defineRoute({
  ...manage,
  ...dpia,
  method: 'POST',
  idempotent: true,
  path: '/console/dpias/:dpiaId/sign-off',
  summary: 'Sign off a data protection impact assessment, with a date to review it',
  body: dpiaSignOffInputSchema,
  responses: { 200: dpiaSchema },
});

export const dpiaRoutes = { listDpias, createDpia, getDpia, updateDpia, signOffDpia } as const;
