// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Records of processing (UK GDPR Article 30). The generated record is read
// only: one entry per table, built from the classification map by S11-84.
// Tenants add the processing activities and processors the map cannot know.
// Lawful bases and special category conditions are checked lists.
//
// `privacy.processing.manage` reads the generated record, and lists, adds
// and changes processing activities (`privacy.processing_activity.changed`)
// and processors (`privacy.processor.changed`).

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { classifications } from '@pixel-scientists/domain/forms';
import { moduleIds } from '@pixel-scientists/domain/platform';
import { tableNameSchema } from '@pixel-scientists/domain/platform/subject-access';
import { z } from 'zod';

import { dataCategories } from './breaches.ts';
import { privacyMessages as m, says } from './messages.ts';
import {
  choice,
  choices,
  cursorSchema,
  dateSchema,
  ids,
  line,
  paragraphs,
  timestampSchema,
} from './schemas.ts';

/** Article 6(1), with the recognised legitimate interests the DUAA 2025 adds. */
export const legalBases = [
  'consent',
  'contract',
  'legal_obligation',
  'vital_interests',
  'public_task',
  'legitimate_interests',
  'recognised_legitimate_interests',
] as const;

/** Article 9(2). */
export const specialCategoryConditions = [
  'explicit_consent',
  'employment_and_social_protection',
  'vital_interests',
  'not_for_profit_body',
  'made_public_by_subject',
  'legal_claims',
  'substantial_public_interest',
  'health_and_social_care',
  'public_health',
  'archiving_research_statistics',
] as const;

export const subjectCategories = [
  'applicants',
  'grant_holders',
  'beneficiaries',
  'staff',
  'volunteers',
  'trustees',
  'donors',
  'supporters',
  'contacts',
  'other',
] as const;

export const transferSafeguards = [
  'adequacy_regulations',
  'international_data_transfer_agreement',
  'uk_addendum',
  'binding_corporate_rules',
] as const;

/** One table in the generated record. */
export const processingRecordEntrySchema = z.strictObject({
  table: tableNameSchema,
  module: z.enum(moduleIds),
  dataCategories: z.array(z.enum(dataCategories)),
  /** The highest sensitivity of the table's fields. */
  sensitivity: z.enum(classifications),
  retention: z.strictObject({
    rule: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
    days: z.int().min(0).nullable(),
  }),
  /** The field ids through which the table reaches a person. */
  subjectPaths: z.array(z.string()),
  purpose: z.string(),
  legalBasis: z.enum(legalBases).nullable(),
  processorIds: z.array(idSchema),
});

export const processingRecordSchema = z.strictObject({
  generatedAt: timestampSchema,
  tables: z.array(processingRecordEntrySchema),
});

export type ProcessingRecord = z.infer<typeof processingRecordSchema>;

export const processingActivityInputSchema = z.strictObject({
  name: line(200, m.activityName),
  purpose: paragraphs(2000, m.purpose),
  legalBasis: choice(legalBases, m.legalBasis),
  specialCategoryCondition: choice(
    specialCategoryConditions,
    m.specialCategoryCondition,
  ).nullable(),
  dataCategories: choices(dataCategories, m.dataCategory),
  subjectCategories: choices(subjectCategories, m.subjectCategory),
  recipients: paragraphs(2000),
  processorIds: ids(50),
  transfersAbroad: paragraphs(2000),
  retention: paragraphs(1000),
  securityMeasures: paragraphs(2000),
});

export type ProcessingActivityInput = z.infer<typeof processingActivityInputSchema>;

export const processingActivitySchema = z.strictObject({
  id: idSchema,
  name: z.string(),
  purpose: z.string(),
  legalBasis: z.enum(legalBases),
  specialCategoryCondition: z.enum(specialCategoryConditions).nullable(),
  dataCategories: z.array(z.enum(dataCategories)),
  subjectCategories: z.array(z.enum(subjectCategories)),
  recipients: z.string(),
  processorIds: z.array(idSchema),
  transfersAbroad: z.string(),
  retention: z.string(),
  securityMeasures: z.string(),
  updatedAt: timestampSchema,
});

export type ProcessingActivity = z.infer<typeof processingActivitySchema>;

export const processorInputSchema = z.strictObject({
  name: line(200, m.processorName),
  service: line(300, m.processorService),
  countryCode: z.string().refine((code) => /^[A-Z]{2}$/.test(code), says(m.countryCode)),
  contractSignedOn: dateSchema.nullable(),
  transferSafeguard: choice(transferSafeguards, m.transferSafeguard).nullable(),
});

export type ProcessorInput = z.infer<typeof processorInputSchema>;

export const processorSchema = z.strictObject({
  id: idSchema,
  name: z.string(),
  service: z.string(),
  countryCode: z.string(),
  contractSignedOn: dateSchema.nullable(),
  transferSafeguard: z.enum(transferSafeguards).nullable(),
  updatedAt: timestampSchema,
});

export type Processor = z.infer<typeof processorSchema>;

/** By name. */
const pageQuerySchema = z.strictObject({ cursor: cursorSchema.optional() });

const manage = {
  audience: 'console',
  module: 'privacy',
  permission: 'privacy.processing.manage',
  scope: 'tenant',
} as const;

const activity = { params: z.strictObject({ activityId: idSchema }) } as const;
const processor = { params: z.strictObject({ processorId: idSchema }) } as const;

export const getProcessingRecord = defineRoute({
  ...manage,
  method: 'GET',
  path: '/console/records-of-processing',
  summary: 'Read the record of processing generated from the classification map',
  responses: { 200: processingRecordSchema },
});

export const listProcessingActivities = defineRoute({
  ...manage,
  method: 'GET',
  path: '/console/processing-activities',
  summary: 'List processing activities, a page at a time',
  query: pageQuerySchema,
  responses: {
    200: z.strictObject({
      activities: z.array(processingActivitySchema),
      nextCursor: cursorSchema.nullable(),
    }),
  },
});

export const createProcessingActivity = defineRoute({
  ...manage,
  method: 'POST',
  idempotent: true,
  path: '/console/processing-activities',
  summary: 'Add a processing activity',
  body: processingActivityInputSchema,
  responses: { 201: processingActivitySchema },
});

export const getProcessingActivity = defineRoute({
  ...manage,
  ...activity,
  method: 'GET',
  path: '/console/processing-activities/:activityId',
  summary: 'Read a processing activity',
  responses: { 200: processingActivitySchema },
});

export const updateProcessingActivity = defineRoute({
  ...manage,
  ...activity,
  method: 'PUT',
  path: '/console/processing-activities/:activityId',
  summary: 'Change a processing activity',
  body: processingActivityInputSchema,
  responses: { 200: processingActivitySchema },
});

export const listProcessors = defineRoute({
  ...manage,
  method: 'GET',
  path: '/console/processors',
  summary: 'List processors, a page at a time',
  query: pageQuerySchema,
  responses: {
    200: z.strictObject({
      processors: z.array(processorSchema),
      nextCursor: cursorSchema.nullable(),
    }),
  },
});

export const createProcessor = defineRoute({
  ...manage,
  method: 'POST',
  idempotent: true,
  path: '/console/processors',
  summary: 'Add a processor',
  body: processorInputSchema,
  responses: { 201: processorSchema },
});

export const updateProcessor = defineRoute({
  ...manage,
  ...processor,
  method: 'PUT',
  path: '/console/processors/:processorId',
  summary: 'Change a processor',
  body: processorInputSchema,
  responses: { 200: processorSchema },
});

export const processingRoutes = {
  getProcessingRecord,
  listProcessingActivities,
  createProcessingActivity,
  getProcessingActivity,
  updateProcessingActivity,
  listProcessors,
  createProcessor,
  updateProcessor,
} as const;
