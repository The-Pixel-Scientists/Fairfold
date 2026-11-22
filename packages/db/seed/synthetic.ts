// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Invented numbers, phone numbers, addresses and postcodes that can never be
// someone's real ones. Each register below issues its numbers in sequence,
// so a range far above the highest it has issued is one no organisation
// holds; beside each is that rule and where the register is published. The
// figure for each register's highest number is approximate: check it before
// a staging run if this file is more than a few years old.

/** org-id.guide schemes (S03-01), each with a range its register has not reached. */
export const inventedRanges = {
  // The Charity Commission for England and Wales numbers each newly
  // registered charity next in sequence, well under 1,300,000 by 2026.
  // Published: the register of charities,
  // https://register-of-charities.charitycommission.gov.uk
  'GB-CHC': { prefix: '', first: 1_900_000, last: 1_999_999, digits: 7 },
  // The Office of the Scottish Charity Regulator numbers each new charity
  // next in sequence after SC, well under SC060000 by 2026. Published: the
  // Scottish Charity Register, https://www.oscr.org.uk
  'GB-SC': { prefix: 'SC', first: 90_000, last: 99_999, digits: 6 },
  // The Charity Commission for Northern Ireland has numbered charities in
  // sequence from 100001 since 2013, well under 120000 by 2026. Published:
  // the register of charities, https://www.charitycommissionni.org.uk
  'GB-NIC': { prefix: '', first: 190_000, last: 199_999, digits: 6 },
  // Companies House numbers each company registered in England and Wales
  // next in sequence, with eight digits, well under 20,000,000 by 2026.
  // Published: Find and update company information,
  // https://find-and-update.company-information.service.gov.uk
  'GB-COH': { prefix: '', first: 90_000_000, last: 90_999_999, digits: 8 },
  // The Financial Conduct Authority numbers each society registered under the
  // Co-operative and Community Benefit Societies Act 2014 next in sequence
  // after RS, well under RS030000 by 2026. Published: the Mutuals Public
  // Register, https://mutuals.fca.org.uk
  'GB-MPR': { prefix: 'RS', first: 90_000, last: 99_999, digits: 6 },
} as const;

export type InventedScheme = keyof typeof inventedRanges;

/** The `n`th invented identifier of `scheme`, as its register writes it. */
export function inventedIdentifier(scheme: InventedScheme, n: number): string {
  const { prefix, first, last, digits } = inventedRanges[scheme];
  const number = first + n;
  if (!Number.isInteger(n) || n < 0 || number > last) {
    throw new Error(`The invented ${scheme} range has no number ${String(n)}.`);
  }
  return `${prefix}${String(number).padStart(digits, '0')}`;
}

export function isInventedIdentifier(scheme: InventedScheme, identifier: string): boolean {
  const { prefix, first, last, digits } = inventedRanges[scheme];
  const number = identifier.slice(prefix.length);
  return (
    identifier.startsWith(prefix) &&
    number.length === digits &&
    /^[0-9]+$/.test(number) &&
    Number(number) >= first &&
    Number(number) <= last
  );
}

// Ofcom keeps these ranges for TV and radio drama, so they are never given
// to anyone: "Telephone numbers for drama programmes",
// https://www.ofcom.org.uk/phones-and-broadband/phone-numbers/numbers-for-drama
const DRAMA_RANGES = [
  { prefix: '07700 900', first: 0, last: 999 },
  { prefix: '01632 960', first: 0, last: 999 },
] as const;

/** The `n`th drama number, alternating mobile and landline. */
export function dramaPhone(n: number): string {
  const range = DRAMA_RANGES[n % DRAMA_RANGES.length] ?? DRAMA_RANGES[0];
  const number = range.first + (Math.floor(n / DRAMA_RANGES.length) % (range.last + 1));
  return `${range.prefix}${String(number).padStart(3, '0')}`;
}

export function isDramaPhone(phone: string): boolean {
  return DRAMA_RANGES.some(
    ({ prefix, first, last }) =>
      phone.startsWith(prefix) &&
      /^[0-9]{3}$/.test(phone.slice(prefix.length)) &&
      Number(phone.slice(prefix.length)) >= first &&
      Number(phone.slice(prefix.length)) <= last,
  );
}

/** RFC 2606 keeps .example for examples, so no address under it reaches anyone. */
export const isExampleEmail = (email: string): boolean =>
  /^[a-z0-9.-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.example$/.test(email);

// Royal Mail's postcode areas (its Programmer's Guide to the Postcode
// Address File) have none called NF, so every NF postcode is fictional. The
// unit letters leave out C, I, K, M, O and V, as Royal Mail's do.
const FICTIONAL_AREA = 'NF';
const UNIT_LETTERS = 'ABDEFGHJLNPQRSTUWXYZ';

/** The `n`th fictional postcode, from NF1 0AA. */
export function fictionalPostcode(n: number): string {
  const units = UNIT_LETTERS.length ** 2;
  const unit = n % units;
  const sector = Math.floor(n / units) % 10;
  const district = (Math.floor(n / (units * 10)) % 9) + 1;
  const letters = `${UNIT_LETTERS[Math.floor(unit / UNIT_LETTERS.length)] ?? 'A'}${UNIT_LETTERS[unit % UNIT_LETTERS.length] ?? 'A'}`;
  return `${FICTIONAL_AREA}${String(district)} ${String(sector)}${letters}`;
}

export const isFictionalPostcode = (postcode: string): boolean =>
  new RegExp(`^${FICTIONAL_AREA}[1-9] [0-9][${UNIT_LETTERS}]{2}$`).test(postcode);
