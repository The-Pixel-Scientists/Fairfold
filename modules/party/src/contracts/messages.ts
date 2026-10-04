// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The party module's validation messages, in the words of
// docs/CONTENT-STYLE.md: what is wrong and how to fix it, at a reading age
// the portal can use. Each is attached with says(), which marks it as written
// from a catalogue, so messageForIssue() shows it on both sides.

import { catalogueParams } from '@pixel-scientists/domain/platform';

export const partyMessages = {
  organisationName: 'Enter the name of the organisation.',
  givenName: 'Enter your first name.',
  familyName: 'Enter your last name.',
  hiddenCharacters: 'Remove line breaks and hidden characters.',
  addressLine: 'Enter the first line of the address.',
  town: 'Enter the town or city.',
  postcode: 'Enter a UK postcode, like SW1A 1AA.',
  postcodeAbroad: 'Enter the postcode or zip code.',
  countryCode: 'Enter the country as a 2-letter code, like GB.',
  website: 'Enter a website address that starts with https://, like https://example.org.',
  phone: 'Enter a phone number, like 01632 960 001 or +44 7700 900 982.',
  identifierOncePerType: 'Add each type of number only once.',
  charityNumber: 'Enter a charity number of 6 or 7 digits, like 1234567.',
  scottishCharityNumber: 'Enter a Scottish charity number: SC and 6 digits, like SC012345.',
  northernIrishCharityNumber: 'Enter a Northern Ireland charity number, like NIC100123 or 100123.',
  companyNumber: 'Enter a company number of 8 numbers, or 2 letters and 6 numbers, like SC123456.',
  societyNumber: "Enter the society's register number, like 12345R or RS001234.",
} as const;

export type PartyMessage = (typeof partyMessages)[keyof typeof partyMessages];

/** A refinement's options, for a message from the list above. */
export function says(message: PartyMessage) {
  return { error: message, params: catalogueParams };
}
