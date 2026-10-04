// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the party routes accept (ADR 0017). Inputs are strict and never name
// a person, user or tenant: an applicant's person comes from the session.
// An optional field left blank may be sent empty or left out; both mean
// none.

import { z } from 'zod';

import { identifierInputSchema, identifierSchemeIds } from './identifiers.ts';
import {
  consentPurposeSchema,
  consentStateSchema,
  legalFormSchema,
  portalConsentChannels,
} from './lists.ts';
import { partyMessages, says, type PartyMessage } from './messages.ts';

/** Line breaks and characters that hide or reorder text; Postgres also refuses NUL. */
const HIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .refine((value) => !HIDDEN.test(value), says(partyMessages.hiddenCharacters));
}

function text(max: number, empty: PartyMessage) {
  return optionalText(max).refine((value) => value !== '', says(empty));
}

/** Upper case, with one space before the inward code: `sw1a1aa` is `SW1A 1AA`. */
function normalisePostcode(value: string): string {
  const compact = value.toUpperCase().replace(/\s+/g, '');
  return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
}

const UK_POSTCODE = /^(?:[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}|GIR 0AA)$/;

/** A structured registered address. The postcode is checked as a UK one when the country is GB. */
export const addressInputSchema = z
  .strictObject({
    line1: text(100, partyMessages.addressLine),
    line2: optionalText(100).optional(),
    town: text(60, partyMessages.town),
    postcode: z.string().max(12),
    /** ISO 3166-1 alpha-2. */
    countryCode: z
      .string()
      .trim()
      .toUpperCase()
      .refine((value) => /^[A-Z]{2}$/.test(value), says(partyMessages.countryCode))
      .default('GB'),
  })
  .overwrite((address) => ({
    ...address,
    postcode:
      address.countryCode === 'GB'
        ? normalisePostcode(address.postcode)
        : address.postcode.trim().replace(/\s+/g, ' '),
  }))
  .refine((address) => address.countryCode !== 'GB' || UK_POSTCODE.test(address.postcode), {
    ...says(partyMessages.postcode),
    path: ['postcode'],
  })
  .refine(
    (address) => address.countryCode === 'GB' || /^[A-Z0-9][A-Z0-9 -]*$/i.test(address.postcode),
    {
      ...says(partyMessages.postcodeAbroad),
      path: ['postcode'],
    },
  );

/** `https://`, then only characters a web address may hold: RFC 3986 ones, and letters and digits in any script. */
const WEBSITE = /^https:\/\/[\p{L}\p{M}\p{N}\-._~:/?#[\]@!$&'()*+,;=%]+$/iu;

function isHttpsAddress(value: string): boolean {
  if (!WEBSITE.test(value) || !URL.canParse(value)) return false;
  const url = new URL(value);
  return url.username === '' && url.password === '' && url.hostname.includes('.');
}

/** Kept as the parser reads it, so links, emails and exports use exactly what was checked. */
const websiteSchema = z
  .string()
  .trim()
  .refine((value) => value === '' || isHttpsAddress(value), {
    ...says(partyMessages.website),
    abort: true,
  })
  .overwrite((value) => (value === '' ? value : new URL(value).href))
  .max(200);

/** An organisation as an applicant creates or replaces it, with at most one identifier per scheme. */
export const organisationInputSchema = z.strictObject({
  name: text(200, partyMessages.organisationName),
  legalForm: legalFormSchema,
  identifiers: z
    .array(identifierInputSchema)
    .max(identifierSchemeIds.length)
    .refine(
      (list) => new Set(list.map((item) => item.scheme)).size === list.length,
      says(partyMessages.identifierOncePerType),
    ),
  registeredAddress: addressInputSchema,
  website: websiteSchema.optional(),
});

export type OrganisationInput = z.infer<typeof organisationInputSchema>;

/** Digits, spaces, brackets, hyphens and a leading +, holding 10 to 15 digits. */
const phoneSchema = z
  .string()
  .trim()
  .max(25)
  .refine(
    (value) =>
      value === '' || (/^\+?[0-9 ()-]+$/.test(value) && /^(?:\D*\d){10,15}\D*$/.test(value)),
    says(partyMessages.phone),
  );

/** The profile an applicant edits. The email address is the account's and is not changed here. */
export const profileInputSchema = z.strictObject({
  givenName: text(100, partyMessages.givenName),
  familyName: text(100, partyMessages.familyName),
  phone: phoneSchema.optional(),
});

export type ProfileInput = z.infer<typeof profileInputSchema>;

/** A consent choice, recorded as a new row. The portal offers email only in MVP1. */
export const consentChangeSchema = z.strictObject({
  purpose: consentPurposeSchema,
  channel: z.enum(portalConsentChannels),
  state: consentStateSchema,
  /** The version of the privacy notice the applicant was shown. */
  privacyNoticeVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/),
});

export type ConsentChange = z.infer<typeof consentChangeSchema>;

/** Opaque to the apps: a page's `nextCursor`, sent back to read the next page. */
export const partyCursorSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);

/** Search by name or identifier, a page at a time, ordered by name. */
export const organisationQuerySchema = z.strictObject({
  search: z.string().trim().min(1).max(100).optional(),
  cursor: partyCursorSchema.optional(),
});

export type OrganisationQuery = z.infer<typeof organisationQuerySchema>;
