// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Staff routes that change party records (ADR 0017, ADR 0025), under
// `party.records.manage` in the whole tenant. The acting member, and the
// verifier, come from the session: no request names them. Verifying a
// value already verified on another organisation answers 409 with
// `partyMessages.identifierAlreadyVerified`, which never repeats the value.
// History reads are sensitive reads: each writes `party.value_history.viewed`.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { z } from 'zod';

import { identifierInputSchema } from './identifiers.ts';
import { profileInputSchema } from './inputs.ts';
import {
  consoleIdentifierSchema,
  managedOrganisationSchema,
  managedPersonSchema,
  organisationDetailsInputSchema,
  valueHistoryPageSchema,
  valueHistoryQuerySchema,
} from './records.ts';
import {
  consoleRelationshipSchema,
  endRelationshipSchema,
  relationshipInputSchema,
} from './relationships.ts';

const manage = {
  audience: 'console',
  module: 'party',
  permission: 'party.records.manage',
  scope: 'tenant',
} as const;

const organisation = { params: z.strictObject({ organisationId: idSchema }) } as const;
const person = { params: z.strictObject({ personId: idSchema }) } as const;
const identifier = {
  params: z.strictObject({ organisationId: idSchema, identifierId: idSchema }),
} as const;

export const updateOrganisation = defineRoute({
  ...manage,
  ...organisation,
  method: 'PUT',
  path: '/console/organisations/:organisationId',
  summary: "Change an organisation's details",
  body: organisationDetailsInputSchema,
  responses: { 200: managedOrganisationSchema },
});

export const updatePerson = defineRoute({
  ...manage,
  ...person,
  method: 'PUT',
  path: '/console/people/:personId',
  summary: "Change a person's name and phone number",
  body: profileInputSchema,
  responses: { 200: managedPersonSchema },
});

export const addIdentifier = defineRoute({
  ...manage,
  ...organisation,
  method: 'POST',
  idempotent: true,
  path: '/console/organisations/:organisationId/identifiers',
  summary: 'Add an unverified identifier to an organisation',
  body: identifierInputSchema,
  responses: { 201: consoleIdentifierSchema },
});

export const removeIdentifier = defineRoute({
  ...manage,
  ...identifier,
  method: 'DELETE',
  path: '/console/organisations/:organisationId/identifiers/:identifierId',
  summary: 'Remove an identifier from an organisation',
  responses: { 204: null },
});

export const verifyIdentifier = defineRoute({
  ...manage,
  ...identifier,
  method: 'PUT',
  path: '/console/organisations/:organisationId/identifiers/:identifierId/verification',
  summary: 'Record that you checked an identifier against its register',
  responses: { 200: consoleIdentifierSchema },
});

export const addRelationship = defineRoute({
  ...manage,
  ...organisation,
  method: 'POST',
  idempotent: true,
  path: '/console/organisations/:organisationId/relationships',
  summary: 'Add a person to an organisation, such as its contact',
  body: relationshipInputSchema,
  responses: { 201: consoleRelationshipSchema },
});

export const endRelationship = defineRoute({
  ...manage,
  method: 'PATCH',
  path: '/console/relationships/:relationshipId',
  summary: 'End a relationship on a date; it is kept, never deleted',
  params: z.strictObject({ relationshipId: idSchema }),
  body: endRelationshipSchema,
  responses: { 200: consoleRelationshipSchema },
});

export const getOrganisationHistory = defineRoute({
  ...manage,
  ...organisation,
  method: 'GET',
  path: '/console/organisations/:organisationId/history',
  summary: "Read the changes to an organisation's details, newest first",
  query: valueHistoryQuerySchema,
  responses: { 200: valueHistoryPageSchema },
});

export const getPersonHistory = defineRoute({
  ...manage,
  ...person,
  method: 'GET',
  path: '/console/people/:personId/history',
  summary: "Read the changes to a person's details, newest first",
  query: valueHistoryQuerySchema,
  responses: { 200: valueHistoryPageSchema },
});

/** Registered by the party server for crm v1 (S12-10). */
export const partyRecordRoutes = {
  updateOrganisation,
  updatePerson,
  addIdentifier,
  removeIdentifier,
  verifyIdentifier,
  addRelationship,
  endRelationship,
  getOrganisationHistory,
  getPersonHistory,
} as const;
