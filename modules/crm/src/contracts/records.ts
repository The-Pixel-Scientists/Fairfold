// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One organisation or person, with its timeline (ADR 0017, ADR 0025). The
// record itself is party's, read through party's contract and answered in
// party's console schema; crm adds its own parts: the lists it is on, its
// external references and a summary of its timeline. Staff change the record
// through party's routes (`party.records.manage`), never crm's.
//
// A merged id answers the survivor's id, for the screen to follow, and an
// erased person answers only that. Reading an organisation or a person
// writes `crm.party.viewed`, since an organisation's record holds its
// contacts' names and email addresses, and reading any timeline writes
// `crm.timeline.viewed` (crmReadAudits in audit.ts).
//
// The timeline holds references, not copies: an item from another module
// names the module, entity type and id, and the screen reads it through the
// owning module's contract, so erasure there needs nothing from crm.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { moduleSchema } from '@pixel-scientists/domain/platform';
import { consoleOrganisationSchema, consolePersonSchema } from '@pixel-scientists/party/contracts';
import { z } from 'zod';

import { crmMessages, says } from './messages.ts';
import { externalReferenceSchema } from './references.ts';
import {
  choice,
  cursorSchema,
  pageQuerySchema,
  paragraphs,
  personal,
  timestampSchema,
} from './schemas.ts';

/** What staff record by hand. */
export const manualInteractionKinds = ['note', 'call', 'meeting', 'email'] as const;

/** Every kind on a timeline: those staff record, then those another module's event adds. */
export const interactionKinds = [
  ...manualInteractionKinds,
  'application_submitted',
  'decision_released',
] as const;

export type InteractionKind = (typeof interactionKinds)[number];

/** The longest summary staff may write. */
export const INTERACTION_SUMMARY_MAX = 2000;

/** Where an item came from: an entity another module owns, such as a `grants.application`. */
export const sourceReferenceSchema = z.strictObject({
  module: moduleSchema,
  entityType: z.string().regex(/^[a-z]+\.[a-z][a-z_]*$/),
  entityId: idSchema,
});

export type SourceReference = z.infer<typeof sourceReferenceSchema>;

export const interactionSchema = z.strictObject({
  id: idSchema,
  kind: z.enum(interactionKinds),
  occurredAt: timestampSchema,
  /** The module that added it: `crm` for one staff recorded. */
  module: moduleSchema,
  /** Null for one staff recorded. */
  source: sourceReferenceSchema.nullable(),
  /** Staff's own words; null for an item another module added. */
  summary: personal(z.string().max(INTERACTION_SUMMARY_MAX)).nullable(),
  /** The recording membership; null for an item another module added. */
  recordedBy: idSchema.nullable(),
});

export type Interaction = z.infer<typeof interactionSchema>;

/** Newest first. `nextCursor` is null on the last page. */
export const timelinePageSchema = z.strictObject({
  interactions: z.array(interactionSchema),
  nextCursor: cursorSchema.nullable(),
});

export type TimelinePage = z.infer<typeof timelinePageSchema>;

/** The member and the party come from the session and the path. */
export const interactionInputSchema = z.strictObject({
  kind: choice(manualInteractionKinds, crmMessages.interactionKind),
  occurredAt: timestampSchema,
  summary: paragraphs(INTERACTION_SUMMARY_MAX).refine(
    (value) => value !== '',
    says(crmMessages.interactionSummary),
  ),
});

export type InteractionInput = z.input<typeof interactionInputSchema>;

/** crm's own parts of a record. List names are staff's words, not personal data. */
const crmParts = {
  lists: z.array(z.strictObject({ id: idSchema, name: z.string() })),
  externalReferences: z.array(externalReferenceSchema),
  timeline: z.strictObject({
    interactions: z.int().nonnegative(),
    latestAt: timestampSchema.nullable(),
  }),
};

const current = { state: z.literal('current'), status: z.enum(['active', 'archived']) };

/** The id was merged: read the survivor instead. */
const merged = z.strictObject({ state: z.literal('merged'), survivorId: idSchema });

export const organisationRecordSchema = z.discriminatedUnion('state', [
  z.strictObject({
    ...current,
    organisation: personal(consoleOrganisationSchema),
    ...crmParts,
  }),
  merged,
]);

export type OrganisationRecord = z.infer<typeof organisationRecordSchema>;

export const personRecordSchema = z.discriminatedUnion('state', [
  z.strictObject({ ...current, person: personal(consolePersonSchema), ...crmParts }),
  merged,
  z.strictObject({ state: z.literal('erased') }),
]);

export type PersonRecord = z.infer<typeof personRecordSchema>;

const read = {
  audience: 'console',
  module: 'crm',
  permission: 'crm.records.read',
  scope: 'tenant',
} as const;

const party = { params: z.strictObject({ partyId: idSchema }) } as const;

export const getOrganisationRecord = defineRoute({
  ...read,
  method: 'GET',
  path: '/console/crm/organisations/:organisationId',
  summary: 'Read an organisation with its lists, external references and timeline summary',
  params: z.strictObject({ organisationId: idSchema }),
  responses: { 200: organisationRecordSchema },
});

export const getPersonRecord = defineRoute({
  ...read,
  method: 'GET',
  path: '/console/crm/people/:personId',
  summary: 'Read a person with their lists, external references and timeline summary',
  params: z.strictObject({ personId: idSchema }),
  responses: { 200: personRecordSchema },
});

export const getTimeline = defineRoute({
  ...read,
  ...party,
  method: 'GET',
  path: '/console/crm/parties/:partyId/timeline',
  summary: "Read an organisation's or person's timeline, newest first",
  query: pageQuerySchema,
  responses: { 200: timelinePageSchema },
});

export const recordInteraction = defineRoute({
  ...read,
  ...party,
  permission: 'crm.records.manage',
  method: 'POST',
  idempotent: true,
  path: '/console/crm/parties/:partyId/interactions',
  summary: 'Record a note, call, meeting or email on a timeline',
  body: interactionInputSchema,
  responses: { 201: interactionSchema },
});

export const recordRoutes = {
  getOrganisationRecord,
  getPersonRecord,
  getTimeline,
  recordInteraction,
} as const;
