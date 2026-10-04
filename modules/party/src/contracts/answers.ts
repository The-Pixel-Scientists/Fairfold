// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the party routes answer (ADR 0017). Portal and console answers are
// separate schemas, so the portal never shows verification or anyone else's
// details.

import { idSchema, type Id } from '@pixel-scientists/domain';
import { z } from 'zod';

import { identifierSchemeSchema } from './identifiers.ts';
import { partyCursorSchema } from './inputs.ts';
import {
  consentChannelSchema,
  consentPurposeSchema,
  consentStateSchema,
  legalFormSchema,
} from './lists.ts';

export const addressSchema = z.object({
  line1: z.string(),
  line2: z.string().nullable(),
  town: z.string(),
  postcode: z.string(),
  countryCode: z.string(),
});

/** The latest choice for one purpose and channel. */
export const consentSchema = z.object({
  purpose: consentPurposeSchema,
  channel: consentChannelSchema,
  state: consentStateSchema,
  privacyNoticeVersion: z.string(),
  recordedAt: z.iso.datetime(),
});

export type Consent = z.infer<typeof consentSchema>;

const identifierSchema = z.object({ scheme: identifierSchemeSchema, identifier: z.string() });

/** An identifier as staff see it: verified by staff, or an unverified claim. */
const verifiedIdentifierSchema = identifierSchema.extend({ verified: z.boolean() });

/** The applicant's own person record. Names are null until they complete their profile. */
export const profileSchema = z.object({
  givenName: z.string().nullable(),
  familyName: z.string().nullable(),
  email: z.string(),
  phone: z.string().nullable(),
  consents: z.array(consentSchema),
});

export type Profile = z.infer<typeof profileSchema>;

/** One of the applicant's organisations, without verification or other contacts. */
export const portalOrganisationSchema = z.object({
  id: idSchema,
  name: z.string(),
  legalForm: legalFormSchema,
  identifiers: z.array(identifierSchema),
  registeredAddress: addressSchema,
  website: z.string().nullable(),
});

export type PortalOrganisation = z.infer<typeof portalOrganisationSchema>;

export const portalOrganisationListSchema = z.object({
  organisations: z.array(portalOrganisationSchema.pick({ id: true, name: true, legalForm: true })),
});

export type PortalOrganisationList = z.infer<typeof portalOrganisationListSchema>;

/** An organisation in a staff list, and what other modules read about one. */
export const organisationSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  legalForm: legalFormSchema,
  identifiers: z.array(verifiedIdentifierSchema),
});

export type OrganisationSummary = z.infer<typeof organisationSummarySchema>;

/** Ordered by name. `nextCursor` is null on the last page. */
export const organisationPageSchema = z.object({
  organisations: z.array(organisationSummarySchema),
  nextCursor: partyCursorSchema.nullable(),
});

export type OrganisationPage = z.infer<typeof organisationPageSchema>;

/** A current contact for an organisation. */
const contactSchema = z.object({
  personId: idSchema,
  givenName: z.string().nullable(),
  familyName: z.string().nullable(),
  email: z.string(),
});

export const consoleOrganisationSchema = organisationSummarySchema.extend({
  registeredAddress: addressSchema,
  website: z.string().nullable(),
  contacts: z.array(contactSchema),
});

export type ConsoleOrganisation = z.infer<typeof consoleOrganisationSchema>;

export const consolePersonSchema = z.object({
  id: idSchema,
  givenName: z.string().nullable(),
  familyName: z.string().nullable(),
  email: z.string(),
  phone: z.string().nullable(),
  /** Organisations the person is a current contact for. */
  organisations: z.array(z.object({ id: idSchema, name: z.string() })),
  consents: z.array(consentSchema),
});

export type ConsolePerson = z.infer<typeof consolePersonSchema>;

// What the party module's server contract gives other modules (S03-03), in
// the caller's transaction, besides organisationSummarySchema.

/** A person's name, for team lists, reviewer pools and the audit log. */
export interface PersonName {
  readonly personId: Id;
  readonly givenName: string | null;
  readonly familyName: string | null;
}

/** Enough to email a person. */
export interface ContactDetails {
  readonly givenName: string | null;
  readonly email: string;
}
