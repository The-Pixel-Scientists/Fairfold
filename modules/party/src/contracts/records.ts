// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What staff send and see when they manage party records (ADR 0017,
// ADR 0025). Console only: no portal route answers with these, so the
// portal never shows verification, merge state or value history.

import { idSchema } from '@pixel-scientists/domain';
import { z } from 'zod';

import { addressSchema } from './answers.ts';
import { identifierSchemeSchema } from './identifiers.ts';
import { organisationInputSchema, partyCursorSchema } from './inputs.ts';
import { legalFormSchema, valueHistoryFieldSchema } from './lists.ts';
import { consoleRelationshipSchema } from './relationships.ts';

/** An organisation's details as staff change them. Identifiers have routes of their own. */
export const organisationDetailsInputSchema = organisationInputSchema.omit({ identifiers: true });

export type OrganisationDetailsInput = z.infer<typeof organisationDetailsInputSchema>;

/** Who verified an identifier, from their session, and when. */
const verificationSchema = z.strictObject({
  verifiedAt: z.iso.datetime(),
  /** The member's membership id. */
  verifiedBy: idSchema,
  /** Null when the member has no name on record. */
  verifiedByName: z.string().nullable(),
});

/** An identifier as staff see it: verified, or an unverified claim when `verification` is null. */
export const consoleIdentifierSchema = z.strictObject({
  id: idSchema,
  scheme: identifierSchemeSchema,
  identifier: z.string(),
  verification: verificationSchema.nullable(),
});

export type ConsoleIdentifier = z.infer<typeof consoleIdentifierSchema>;

/** An organisation after a staff change, with every relationship, current or ended. */
export const managedOrganisationSchema = z.strictObject({
  id: idSchema,
  name: z.string(),
  legalForm: legalFormSchema,
  registeredAddress: z.strictObject(addressSchema.shape),
  website: z.string().nullable(),
  identifiers: z.array(consoleIdentifierSchema),
  relationships: z.array(consoleRelationshipSchema),
});

export type ManagedOrganisation = z.infer<typeof managedOrganisationSchema>;

/** A person after a staff change, with every relationship, current or ended. */
export const managedPersonSchema = z.strictObject({
  id: idSchema,
  givenName: z.string().nullable(),
  familyName: z.string().nullable(),
  email: z.string(),
  phone: z.string().nullable(),
  relationships: z.array(consoleRelationshipSchema),
});

export type ManagedPerson = z.infer<typeof managedPersonSchema>;

/**
 * One change to a party field (ADR 0025). Values are personal and shown to
 * staff only; an audit event never holds them.
 */
export const valueHistoryEntrySchema = z.strictObject({
  fieldId: valueHistoryFieldSchema,
  /** Null when the field was empty. */
  previousValue: z.string().nullable(),
  newValue: z.string().nullable(),
  changedAt: z.iso.datetime(),
  /** The changing membership; null for a change the system made. */
  changedBy: idSchema.nullable(),
});

export type ValueHistoryEntry = z.infer<typeof valueHistoryEntrySchema>;

/**
 * Newest first, across the party and every party merged into it.
 * `nextCursor` is null on the last page.
 */
export const valueHistoryPageSchema = z.strictObject({
  entries: z.array(valueHistoryEntrySchema),
  nextCursor: partyCursorSchema.nullable(),
});

export type ValueHistoryPage = z.infer<typeof valueHistoryPageSchema>;

export const valueHistoryQuerySchema = z.strictObject({ cursor: partyCursorSchema.optional() });
