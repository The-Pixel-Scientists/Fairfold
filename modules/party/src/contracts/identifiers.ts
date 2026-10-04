// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Organisation identifiers, by org-id.guide scheme (ADR 0017). Each is
// stored as the register writes it, so `GB-CHC-1234567` is scheme `GB-CHC`
// and identifier `1234567`. An identifier an applicant types is a claim:
// it never links them to an organisation, and staff verify it later.

import { messages } from '@pixel-scientists/domain/platform';
import { z } from 'zod';

import { partyMessages, says, type PartyMessage } from './messages.ts';

interface SchemeRule {
  /** Plain words for the list an applicant chooses from. */
  readonly label: string;
  /** Applied after upper-casing and removing spaces. */
  readonly normalise?: (value: string) => string;
  readonly pattern: RegExp;
  readonly message: PartyMessage;
}

export const identifierSchemes = {
  // Charity Commission for England and Wales: 6 digits, or 7 starting with 1.
  'GB-CHC': {
    label: 'Registered charity in England and Wales',
    pattern: /^(?:[1-9][0-9]{5}|1[0-9]{6})$/,
    message: partyMessages.charityNumber,
  },
  // Office of the Scottish Charity Regulator.
  'GB-SC': {
    label: 'Registered charity in Scotland',
    pattern: /^SC[0-9]{6}$/,
    message: partyMessages.scottishCharityNumber,
  },
  // Charity Commission for Northern Ireland, shown on its register as NIC100123.
  'GB-NIC': {
    label: 'Registered charity in Northern Ireland',
    normalise: (value) => value.replace(/^NIC/, ''),
    pattern: /^1[0-9]{5}$/,
    message: partyMessages.northernIrishCharityNumber,
  },
  // Companies House: 8 digits (a dropped leading zero is put back), 2 letters
  // and 6 digits (SC, NI, OC and others), or R and 7 digits for old
  // Northern Ireland companies.
  'GB-COH': {
    label: 'Company registered with Companies House',
    normalise: (value) => (/^[0-9]{7}$/.test(value) ? `0${value}` : value),
    pattern: /^(?:[0-9]{8}|[A-Z]{2}[0-9]{6}|R[0-9]{7})$/,
    message: partyMessages.companyNumber,
  },
  // FCA Mutuals Public Register. Its numbers have changed form over the
  // years (12345R, IP12345R, RS001234, 2468R(S)), so this checks the shape
  // only; staff verification is the real check.
  'GB-MPR': {
    label: 'Society on the Mutuals Public Register',
    pattern: /^[A-Z]{0,2}[0-9]{1,6}(?:[A-Z]{1,2}|R\(S\))?$/,
    message: partyMessages.societyNumber,
  },
} as const satisfies Record<string, SchemeRule>;

export type IdentifierScheme = keyof typeof identifierSchemes;

export const identifierSchemeIds = Object.keys(identifierSchemes) as [
  IdentifierScheme,
  ...IdentifierScheme[],
];

export const identifierSchemeSchema = z.enum(identifierSchemeIds);

/** The identifier as the scheme's register writes it, or the value as typed when it is no match. */
export function normaliseIdentifier(scheme: IdentifierScheme, value: string): string {
  const compact = value.toUpperCase().replace(/\s+/g, '');
  const rule: SchemeRule = identifierSchemes[scheme];
  return rule.normalise?.(compact) ?? compact;
}

function identifierInput<S extends IdentifierScheme>(scheme: S) {
  const { pattern, message } = identifierSchemes[scheme];
  return z.strictObject({
    scheme: z.literal(scheme),
    identifier: z
      .string()
      .max(30)
      .overwrite((value) => normaliseIdentifier(scheme, value))
      .refine((value) => pattern.test(value), says(message)),
  });
}

/** One identifier as an applicant enters it, normalised and checked against its scheme. */
export const identifierInputSchema = z.discriminatedUnion(
  'scheme',
  [
    identifierInput('GB-CHC'),
    identifierInput('GB-SC'),
    identifierInput('GB-NIC'),
    identifierInput('GB-COH'),
    identifierInput('GB-MPR'),
  ],
  { error: messages.chooseAllowedValue },
);

export type IdentifierInput = z.infer<typeof identifierInputSchema>;
