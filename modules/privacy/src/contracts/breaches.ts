// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The breach log (UK GDPR Article 33(5)). A breach records when the tenant
// became aware, which starts the 72-hour clock and does not change after.
// Assessments are append-only, each by the session's member. Telling the
// ICO and telling the people affected are separate POSTs that record what a
// person did: nothing here notifies anyone. No time may be after the moment
// it is recorded, which the server checks with futureTimeProblem(), so the
// clock cannot be started late. A late ICO notification needs a reason code,
// which the server checks with icoNotificationProblem().
//
// `privacy.breaches.manage` lists, records (`privacy.breach.recorded`), reads
// (`.viewed`, a sensitive read) and changes (`.updated`) breaches, adds
// assessments (`.assessed`) and records notifications (`.ico_notified`,
// `.subjects_notified`).

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { z } from 'zod';

import { privacyMessages as m, says } from './messages.ts';
import { choice, choices, cursorSchema, line, paragraphs, timestampSchema } from './schemas.ts';

/** The kinds of personal data, for breaches and records of processing. */
export const dataCategories = [
  'identity',
  'contact',
  'financial',
  'location',
  'online_identifiers',
  'children',
  'criminal_offences',
  'racial_or_ethnic_origin',
  'political_opinions',
  'religious_or_philosophical_beliefs',
  'trade_union_membership',
  'genetic',
  'biometric',
  'health',
  'sex_life_or_orientation',
  'other',
] as const;

export type DataCategory = (typeof dataCategories)[number];

/** The special categories of Article 9(1). */
export const specialCategoryData = [
  'racial_or_ethnic_origin',
  'political_opinions',
  'religious_or_philosophical_beliefs',
  'trade_union_membership',
  'genetic',
  'biometric',
  'health',
  'sex_life_or_orientation',
] as const satisfies readonly DataCategory[];

export const riskLevels = ['unlikely', 'risk', 'high_risk'] as const;

export const lateReasons = [
  'still_investigating',
  'processor_reported_late',
  'reported_in_phases',
  'other',
] as const;

export const notificationMethods = ['email', 'post', 'phone', 'in_person'] as const;

const MAX_TEXT = 5000;

const count = z
  .number()
  .refine((value) => Number.isSafeInteger(value) && value >= 0, says(m.count))
  .nullable();

/** What a breach records, besides when the tenant became aware. */
const breachShape = {
  discoveredAt: timestampSchema,
  description: paragraphs(MAX_TEXT, m.breachDescription),
  dataCategories: choices(dataCategories, m.dataCategory).refine(
    (items) => items.length > 0,
    says(m.dataCategory),
  ),
  approximateSubjects: count,
  approximateRecords: count,
  likelyConsequences: paragraphs(MAX_TEXT),
  measuresTaken: paragraphs(MAX_TEXT),
};

export const breachInputSchema = z.strictObject({ becameAwareAt: timestampSchema, ...breachShape });

export type BreachInput = z.infer<typeof breachInputSchema>;

/** The awareness time starts the clock, so it stays as recorded. */
export const breachUpdateSchema = z.strictObject(breachShape);

export type BreachUpdate = z.infer<typeof breachUpdateSchema>;

export const assessmentInputSchema = z.strictObject({
  riskLevel: choice(riskLevels, m.riskLevel),
  notifyIco: z.boolean(),
  notifySubjects: z.boolean(),
  rationale: paragraphs(MAX_TEXT),
});

export type AssessmentInput = z.infer<typeof assessmentInputSchema>;

export const icoNotificationInputSchema = z.strictObject({
  notifiedAt: timestampSchema,
  reference: line(100, m.icoReference),
  /** Required when told more than 72 hours after becoming aware, and only then. */
  lateReason: choice(lateReasons, m.lateReason).nullable(),
});

export type IcoNotificationInput = z.infer<typeof icoNotificationInputSchema>;

export const subjectNotificationInputSchema = z.strictObject({
  notifiedAt: timestampSchema,
  method: choice(notificationMethods, m.notificationMethod),
});

export const assessmentSchema = z.strictObject({
  id: idSchema,
  riskLevel: z.enum(riskLevels),
  notifyIco: z.boolean(),
  notifySubjects: z.boolean(),
  rationale: z.string(),
  assessedByMembershipId: idSchema,
  assessedAt: timestampSchema,
});

/** As breachClock() computes it when the breach is read. */
export const breachClockSchema = z.strictObject({
  deadline: timestampSchema,
  hoursRemaining: z.int().min(0),
  late: z.boolean(),
});

const recordedBy = { recordedByMembershipId: idSchema, recordedAt: timestampSchema };

export const breachSchema = z.strictObject({
  id: idSchema,
  becameAwareAt: timestampSchema,
  discoveredAt: timestampSchema,
  description: z.string(),
  dataCategories: z.array(z.enum(dataCategories)),
  specialCategory: z.boolean(),
  approximateSubjects: z.int().min(0).nullable(),
  approximateRecords: z.int().min(0).nullable(),
  likelyConsequences: z.string(),
  measuresTaken: z.string(),
  clock: breachClockSchema,
  /** Oldest first; the last is the current assessment. */
  assessments: z.array(assessmentSchema),
  icoNotification: z
    .strictObject({
      notifiedAt: timestampSchema,
      reference: z.string(),
      lateReason: z.enum(lateReasons).nullable(),
      ...recordedBy,
    })
    .nullable(),
  subjectNotification: z
    .strictObject({
      notifiedAt: timestampSchema,
      method: z.enum(notificationMethods),
      ...recordedBy,
    })
    .nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type Breach = z.infer<typeof breachSchema>;

/** Newest first. */
export const breachQuerySchema = z.strictObject({ cursor: cursorSchema.optional() });

export const breachPageSchema = z.strictObject({
  breaches: z.array(
    breachSchema
      .pick({
        id: true,
        becameAwareAt: true,
        dataCategories: true,
        specialCategory: true,
        clock: true,
      })
      .extend({ riskLevel: z.enum(riskLevels).nullable(), icoNotified: z.boolean() }),
  ),
  nextCursor: cursorSchema.nullable(),
});

const manage = {
  audience: 'console',
  module: 'privacy',
  permission: 'privacy.breaches.manage',
  scope: 'tenant',
} as const;

const breach = { params: z.strictObject({ breachId: idSchema }) } as const;

export const listBreaches = defineRoute({
  ...manage,
  method: 'GET',
  path: '/console/breaches',
  summary: 'List personal data breaches with their 72-hour clock, a page at a time',
  query: breachQuerySchema,
  responses: { 200: breachPageSchema },
});

export const createBreach = defineRoute({
  ...manage,
  method: 'POST',
  idempotent: true,
  path: '/console/breaches',
  summary: 'Record a personal data breach',
  body: breachInputSchema,
  responses: { 201: breachSchema },
});

export const getBreach = defineRoute({
  ...manage,
  ...breach,
  method: 'GET',
  path: '/console/breaches/:breachId',
  summary: 'Read a breach with its clock, assessments and notifications',
  responses: { 200: breachSchema },
});

export const updateBreach = defineRoute({
  ...manage,
  ...breach,
  method: 'PUT',
  path: '/console/breaches/:breachId',
  summary: "Change a breach's description, data, counts, consequences or measures",
  body: breachUpdateSchema,
  responses: { 200: breachSchema },
});

export const assessBreach = defineRoute({
  ...manage,
  ...breach,
  method: 'POST',
  idempotent: true,
  path: '/console/breaches/:breachId/assessments',
  summary: 'Add an assessment of the risk to people and whom to tell',
  body: assessmentInputSchema,
  responses: { 201: assessmentSchema },
});

export const recordIcoNotification = defineRoute({
  ...manage,
  ...breach,
  method: 'POST',
  idempotent: true,
  path: '/console/breaches/:breachId/ico-notification',
  summary: 'Record that you told the ICO, with its reference',
  body: icoNotificationInputSchema,
  responses: { 200: breachSchema },
});

export const recordSubjectNotification = defineRoute({
  ...manage,
  ...breach,
  method: 'POST',
  idempotent: true,
  path: '/console/breaches/:breachId/subject-notification',
  summary: 'Record that you told the people affected',
  body: subjectNotificationInputSchema,
  responses: { 200: breachSchema },
});

export const breachRoutes = {
  listBreaches,
  createBreach,
  getBreach,
  updateBreach,
  assessBreach,
  recordIcoNotification,
  recordSubjectNotification,
} as const;
