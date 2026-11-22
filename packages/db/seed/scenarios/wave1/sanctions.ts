// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A synthetic sanctions-style list, in the shape of assure.sanctions_entry
// (migration 0053), for screening tests. It is not a real list and names no
// real person, entity or ship. Every name is built here from the hand-written
// lists in ../../names.ts and the words below, written by hand for this
// repository; nothing is taken from the UK sanctions list, OFAC, the EU
// list, OpenSanctions or any other published source. The regime is an
// invented label, every reference starts SYNTH- in a shape no published list
// uses, and every date of birth is invented.
//
// The first entries are the ones parts/assure.ts designs its screening
// cases against; the rest fill the list out to 60 rows.

import { givenNames } from '../../names.ts';

export const SYNTHETIC_LIST_VERSION = 'SYNTHETIC-2026-12';
export const SYNTHETIC_REGIME = 'Synthetic test regime (not a real regime)';

export interface SyntheticEntry {
  readonly listVersion: typeof SYNTHETIC_LIST_VERSION;
  readonly designationId: string;
  readonly entryKind: 'individual' | 'entity' | 'ship';
  readonly nameType: 'primary' | 'alias';
  readonly name: string;
  readonly regime: typeof SYNTHETIC_REGIME;
  /** Individuals only. */
  readonly datesOfBirth: readonly string[];
}

/**
 * Family names for the list: the first word of a place in names.ts, checked
 * by eye as not a common surname. The wave 1 tenants' own places are left out.
 */
export const listFamilyNames = [
  'Ambleford',
  'Ashcombe',
  'Bramblegate',
  'Brinkholt',
  'Calderwick',
  'Copperfold',
  'Dunholt',
  'Elderbrook',
  'Glenmarrow',
  'Hartswell',
  'Hollinbridge',
  'Ivybank',
  'Larchmere',
  'Millbourne',
  'Nettlecombe',
  'Pennywell',
  'Ravensholt',
  'Thistledown',
  'Whinmoor',
  'Willowmere',
  'Wrenfield',
  'Yarrowby',
  'Yewdale',
] as const;

/** What an entity's name ends with, after its place. */
export const entityWords = [
  'Trading Limited',
  'Shipping Limited',
  'Holdings Limited',
  'Logistics Limited',
  'Freight Company',
] as const;

type Designed = readonly [
  designationId: string,
  kind: SyntheticEntry['entryKind'],
  nameType: SyntheticEntry['nameType'],
  name: string,
  dateOfBirth?: string,
];

/** The entries the screening cases are designed against. */
const designed: readonly Designed[] = [
  ['SYNTH-I001', 'individual', 'primary', 'Ellis Dunholt', '1971-04-12'],
  ['SYNTH-I002', 'individual', 'primary', 'Kasia Elderbrook', '1966-11-02'],
  ['SYNTH-I002', 'individual', 'alias', 'Kasia Wrenfield', '1966-11-02'],
  ['SYNTH-I003', 'individual', 'primary', 'Rosa Calderwick', '1980-02-27'],
  ['SYNTH-I004', 'individual', 'primary', 'Theo Glenmarrow Ivybank', '1975-07-19'],
  ['SYNTH-I005', 'individual', 'primary', 'Léon Thistledown', '1969-05-30'],
  ['SYNTH-I006', 'individual', 'primary', 'Adam Hollinbridge', '1958-09-03'],
  ['SYNTH-E001', 'entity', 'primary', 'Ravensholt Trading Limited'],
  ['SYNTH-E002', 'entity', 'primary', 'Willowmere Community Holdings Limited'],
  ['SYNTH-S001', 'ship', 'primary', 'MV Pennywell Star'],
];

const pick = <T>(list: readonly T[], index: number): T => {
  const item = list[index % list.length];
  if (item === undefined) throw new Error('A list for the synthetic entries is empty.');
  return item;
};

const reference = (letter: 'I' | 'E' | 'S', n: number) =>
  `SYNTH-${letter}${String(n).padStart(3, '0')}`;

/** 30 more individuals, every fifth with an alias, 13 more entities and a second ship. */
function filler(): Designed[] {
  const rows: Designed[] = [];
  for (let n = 0; n < 30; n += 1) {
    const id = reference('I', 101 + n);
    const given = pick(givenNames, n * 7 + 3);
    const dateOfBirth = `${String(1950 + ((n * 3) % 40))}-${String(1 + (n % 12)).padStart(2, '0')}-${String(1 + ((n * 5) % 28)).padStart(2, '0')}`;
    rows.push([id, 'individual', 'primary', `${given} ${pick(listFamilyNames, n)}`, dateOfBirth]);
    if (n % 5 === 0) {
      const alias = `${given} ${pick(listFamilyNames, n + 11)}`;
      rows.push([id, 'individual', 'alias', alias, dateOfBirth]);
    }
  }
  for (let n = 0; n < 13; n += 1) {
    const name = `${pick(listFamilyNames, n * 2 + 1)} ${pick(entityWords, n)}`;
    rows.push([reference('E', 101 + n), 'entity', 'primary', name]);
  }
  rows.push([reference('S', 101), 'ship', 'primary', 'MV Yarrowby Dawn']);
  return rows;
}

export const syntheticEntries: readonly SyntheticEntry[] = [...designed, ...filler()].map(
  ([designationId, entryKind, nameType, name, dateOfBirth]) => ({
    listVersion: SYNTHETIC_LIST_VERSION,
    designationId,
    entryKind,
    nameType,
    name,
    regime: SYNTHETIC_REGIME,
    datesOfBirth: dateOfBirth === undefined ? [] : [dateOfBirth],
  }),
);
