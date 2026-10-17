// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The 360Giving file (D15): our own schema of the fields of the 360Giving
// Data Standard (1.4) that we publish, which the server checks a file
// against before sending it. A file holds one grant per released award, an
// accepted decision with its release time set, in the programme or round
// chosen. Nothing about a decision before its release, and nothing an
// applicant wrote, is published. Each grant is built as follows:
//   - id: the publisher's prefix and the application's id (grantIdentifier());
//   - title: the round's title, and description: the programme's summary;
//   - currency and amountAwarded: the award, in major units (amountAwarded());
//   - awardDate: the day it was released, in the tenant's time zone;
//   - recipientOrganization: the organisation as recipientOrganization() gives it;
//   - fundingOrganization: the publisher details' identifier and name;
//   - grantProgramme: the programme's title;
//   - dateModified: the latest change to the decision, round, programme or
//     organisation it is built from.
// Field names are the standard's, Organization included.

import { idSchema } from '@pixel-scientists/domain';
import { moneySchema, type Currency, type Money } from '@pixel-scientists/domain/platform';
import {
  identifierSchemeIds,
  type IdentifierScheme,
  type OrganisationSummary,
} from '@pixel-scientists/party/contracts';
import { z } from 'zod';

import { exportMessages, says } from './messages.ts';

/** The most grants one request exports (D14); past it, the admin narrows the export. */
export const MAX_EXPORT_GRANTS = 5000;

const identifier = z.string().regex(/^\S{1,200}$/);
const name = z.string().min(1).max(200);

const recipientSchema = z.strictObject({
  id: identifier,
  name,
  charityNumber: z.string().min(1).max(30).optional(),
  companyNumber: z.string().min(1).max(30).optional(),
});

export type RecipientOrganization = z.infer<typeof recipientSchema>;

export const threeSixtyGivingGrantSchema = z.strictObject({
  id: identifier,
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(300),
  currency: moneySchema.shape.currency,
  amountAwarded: z.number().positive(),
  awardDate: z.iso.date(),
  recipientOrganization: z.array(recipientSchema).length(1),
  fundingOrganization: z.array(z.strictObject({ id: identifier, name })).length(1),
  grantProgramme: z.array(z.strictObject({ title: z.string().min(1).max(120) })).length(1),
  dateModified: z.iso.datetime(),
});

export type ThreeSixtyGivingGrant = z.infer<typeof threeSixtyGivingGrantSchema>;

/** The file as published: a 360Giving JSON package. */
export const threeSixtyGivingFileSchema = z.strictObject({
  grants: z.array(threeSixtyGivingGrantSchema).max(MAX_EXPORT_GRANTS),
});

export type ThreeSixtyGivingFile = z.infer<typeof threeSixtyGivingFileSchema>;

/**
 * The file, and what the console says about it: how many grants it holds,
 * and each recipient whose published identifier no one on the staff has
 * verified, once, which includes those published under the prefix for want
 * of any identifier.
 */
export const threeSixtyGivingExportSchema = z.strictObject({
  file: threeSixtyGivingFileSchema,
  summary: z.strictObject({
    grants: z.int().min(0),
    unverifiedRecipients: z.array(z.strictObject({ id: idSchema, name: z.string() })),
  }),
});

export type ThreeSixtyGivingExport = z.infer<typeof threeSixtyGivingExportSchema>;

/** A programme's released awards, or a round's: one of the two. */
export const threeSixtyGivingQuerySchema = z
  .strictObject({ programmeId: idSchema.optional(), roundId: idSchema.optional() })
  .refine(
    (query) => (query.programmeId === undefined) !== (query.roundId === undefined),
    says(exportMessages.programmeOrRound),
  );

export type ThreeSixtyGivingQuery = z.infer<typeof threeSixtyGivingQuerySchema>;

/** `360G-northfield-<application id>`. */
export function grantIdentifier(prefix: string, applicationId: string): string {
  return `${prefix}-${applicationId}`;
}

/** Minor units in one major unit of each currency. */
const minorPerMajor: Readonly<Record<Currency, number>> = { GBP: 100 };

/** An amount as 360Giving writes it, in pounds: 2500050 pence is 25000.5. */
export function amountAwarded(money: Money): number {
  return money.amountMinor / minorPerMajor[money.currency];
}

const charitySchemes: readonly IdentifierScheme[] = ['GB-CHC', 'GB-SC', 'GB-NIC'];

/**
 * An organisation as a 360Giving recipient. Its id is its first identifier
 * in scheme order (GB-CHC, GB-SC, GB-NIC, GB-COH, GB-MPR), verified or not,
 * as org-id.guide writes it, or the prefix and the organisation's id if it
 * has none. Its charity number is its first charity register number, and
 * its company number its Companies House number. `verified` says whether
 * staff verified the identifier its id uses.
 */
export function recipientOrganization(
  prefix: string,
  organisation: Pick<OrganisationSummary, 'id' | 'name' | 'identifiers'>,
): { recipient: RecipientOrganization; verified: boolean } {
  const find = (schemes: readonly IdentifierScheme[]) =>
    schemes
      .map((scheme) => organisation.identifiers.find((held) => held.scheme === scheme))
      .find((held) => held !== undefined);
  const first = find(identifierSchemeIds);
  const charity = find(charitySchemes);
  const company = find(['GB-COH']);
  return {
    recipient: {
      id: first ? `${first.scheme}-${first.identifier}` : `${prefix}-${organisation.id}`,
      name: organisation.name,
      ...(charity && { charityNumber: charity.identifier }),
      ...(company && { companyNumber: company.identifier }),
    },
    verified: first?.verified ?? false,
  };
}
