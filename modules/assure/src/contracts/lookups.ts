// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Lookup routes (ADR 0031), for staff only: nothing here is in the portal,
// and an applicant is never told whether a register knows their identifier.
// A lookup copies a register's entry into a snapshot. It never links an
// applicant, verifies an identifier or changes a party record: verification
// stays a party action that cites the snapshot. Refreshing looks up an
// identifier the organisation already claims, so no request can look up a
// value it types.
//
// - `assure.lookup.read` reads snapshots. Their officers are a separate,
//   audited read (`assure.lookup.officers_viewed`), so a screen can leave
//   names out.
// - `assure.lookup.run` queues a refresh (`assure.lookup.refresh_requested`);
//   the worker records `assure.lookup.refreshed` with the register and outcome.
// - `assure.lookup.link` links an officer to a person after checking it is
//   them (`assure.lookup_officer.linked`), the only way an officer gets a
//   person. A linked officer answers 409.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { z } from 'zod';

import {
  officerRoleSchema,
  registryDetailsSchema,
  registryInputSchema,
  registrySchema,
} from './registry.ts';
import { timestampSchema } from './schemas.ts';

/** The newest snapshot of one identifier. `details` is null when the register had no entry. */
export const lookupSnapshotSchema = z.strictObject({
  id: idSchema,
  registry: registrySchema,
  identifier: z.string(),
  fetchedAt: timestampSchema,
  outcome: z.enum(['found', 'not_found']),
  details: registryDetailsSchema.extend({ officerCount: z.int().min(0) }).nullable(),
});

export type LookupSnapshot = z.infer<typeof lookupSnapshotSchema>;

/**
 * An organisation's snapshots, one per identifier it claims that a register
 * serves, and the registers this deployment cannot reach ("Not set up").
 */
export const organisationLookupsSchema = z.strictObject({
  snapshots: z.array(lookupSnapshotSchema),
  notSetUp: z.array(registrySchema),
});

export type OrganisationLookups = z.infer<typeof organisationLookupsSchema>;

/** Personal: shown only through the audited officers read. */
export const lookupOfficerSchema = z.strictObject({
  id: idSchema,
  name: z.string(),
  role: officerRoleSchema,
  personId: idSchema.nullable(),
});

export type LookupOfficer = z.infer<typeof lookupOfficerSchema>;

export const lookupOfficerListSchema = z.strictObject({ officers: z.array(lookupOfficerSchema) });

export const lookupRefreshInputSchema = z.strictObject({ registry: registryInputSchema });

/** The queued job, whose snapshot appears when it finishes. */
export const lookupRefreshSchema = z.strictObject({
  jobId: idSchema,
  registry: registrySchema,
  queuedAt: timestampSchema,
});

export const officerLinkInputSchema = z.strictObject({ personId: idSchema });

const staff = { audience: 'console', module: 'assure', scope: 'tenant' } as const;

const organisation = { params: z.strictObject({ organisationId: idSchema }) } as const;

export const listOrganisationLookups = defineRoute({
  ...staff,
  ...organisation,
  permission: 'assure.lookup.read',
  method: 'GET',
  path: '/console/organisations/:organisationId/lookups',
  summary: "Read an organisation's newest register snapshots, with their source and date",
  responses: { 200: organisationLookupsSchema },
});

export const refreshOrganisationLookup = defineRoute({
  ...staff,
  ...organisation,
  permission: 'assure.lookup.run',
  method: 'POST',
  idempotent: true,
  path: '/console/organisations/:organisationId/lookups',
  summary: "Queue a fresh lookup of an organisation's identifier on one register",
  body: lookupRefreshInputSchema,
  responses: { 202: lookupRefreshSchema },
});

export const listLookupOfficers = defineRoute({
  ...staff,
  permission: 'assure.lookup.read',
  method: 'GET',
  path: '/console/lookups/:snapshotId/officers',
  summary: "Read a snapshot's officers and trustees by name and role",
  params: z.strictObject({ snapshotId: idSchema }),
  responses: { 200: lookupOfficerListSchema },
});

export const linkLookupOfficer = defineRoute({
  ...staff,
  permission: 'assure.lookup.link',
  method: 'POST',
  path: '/console/lookup-officers/:officerId/link',
  summary: 'Link an officer to the person they are, once checked',
  params: z.strictObject({ officerId: idSchema }),
  body: officerLinkInputSchema,
  responses: { 200: lookupOfficerSchema },
});

export const lookupRoutes = {
  listOrganisationLookups,
  refreshOrganisationLookup,
  listLookupOfficers,
  linkLookupOfficer,
} as const;
