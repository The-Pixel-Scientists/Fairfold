// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Monitoring visits to an organisation, for a funded application or none.
// Attendees are `party.person` ids and evidence is `app.file` ids with a
// caption (ADR 0030); files are uploaded through the platform's file routes
// first. Findings are free text about the organisation and may name people,
// so they are personal.
//
// `assure.visits.manage` lists, records (`assure.visit.recorded`), reads and
// changes (`assure.visit.updated`) visits.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { z } from 'zod';

import { assureMessages } from './messages.ts';
import {
  choice,
  cursorSchema,
  dateSchema,
  line,
  paragraphs,
  timestampSchema,
  unique,
} from './schemas.ts';

export const visitTypes = ['in_person', 'video_call', 'phone_call'] as const;

const followUpSchema = z.strictObject({
  action: z.string(),
  dueOn: dateSchema.nullable(),
  done: z.boolean(),
});

const evidenceSchema = z.strictObject({ fileId: idSchema, caption: z.string() });

/** What a visit records, besides whom it is for. */
const visitShape = {
  visitedOn: dateSchema,
  type: choice(visitTypes, assureMessages.visitType),
  attendeePersonIds: z
    .array(idSchema)
    .max(50)
    .refine(...unique((id: string) => id)),
  findings: paragraphs(10_000),
  followUps: z.array(followUpSchema.extend({ action: line(300, assureMessages.followUp) })).max(50),
  evidence: z
    .array(evidenceSchema.extend({ caption: line(200, assureMessages.caption) }))
    .max(20)
    .refine(...unique((item: { fileId: string }) => item.fileId)),
};

export const visitInputSchema = z.strictObject({
  organisationId: idSchema,
  applicationId: idSchema.nullable(),
  ...visitShape,
});

export type VisitInput = z.infer<typeof visitInputSchema>;

/** A visit stays with its organisation and application. */
export const visitUpdateSchema = z.strictObject(visitShape);

export type VisitUpdate = z.infer<typeof visitUpdateSchema>;

export const visitSchema = z.strictObject({
  id: idSchema,
  organisationId: idSchema,
  applicationId: idSchema.nullable(),
  visitedOn: dateSchema,
  type: z.enum(visitTypes),
  attendeePersonIds: z.array(idSchema),
  findings: z.string(),
  followUps: z.array(followUpSchema),
  evidence: z.array(evidenceSchema),
  recordedAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type Visit = z.infer<typeof visitSchema>;

/** Newest visit first. */
export const visitQuerySchema = z.strictObject({
  organisationId: idSchema.optional(),
  applicationId: idSchema.optional(),
  cursor: cursorSchema.optional(),
});

export const visitPageSchema = z.strictObject({
  visits: z.array(
    visitSchema
      .pick({ id: true, organisationId: true, applicationId: true, visitedOn: true, type: true })
      .extend({ openFollowUps: z.int().min(0) }),
  ),
  nextCursor: cursorSchema.nullable(),
});

const manage = {
  audience: 'console',
  module: 'assure',
  scope: 'tenant',
  permission: 'assure.visits.manage',
} as const;

const visit = { params: z.strictObject({ visitId: idSchema }) } as const;

export const listVisits = defineRoute({
  ...manage,
  method: 'GET',
  path: '/console/visits',
  summary: 'List monitoring visits, for an organisation or application, a page at a time',
  query: visitQuerySchema,
  responses: { 200: visitPageSchema },
});

export const createVisit = defineRoute({
  ...manage,
  method: 'POST',
  idempotent: true,
  path: '/console/visits',
  summary: 'Record a monitoring visit',
  body: visitInputSchema,
  responses: { 201: visitSchema },
});

export const getVisit = defineRoute({
  ...manage,
  ...visit,
  method: 'GET',
  path: '/console/visits/:visitId',
  summary: 'Read a monitoring visit with its findings, follow-ups and evidence',
  responses: { 200: visitSchema },
});

export const updateVisit = defineRoute({
  ...manage,
  ...visit,
  method: 'PUT',
  path: '/console/visits/:visitId',
  summary: "Change a monitoring visit's record",
  body: visitUpdateSchema,
  responses: { 200: visitSchema },
});

export const visitRoutes = { listVisits, createVisit, getVisit, updateVisit } as const;
