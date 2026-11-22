// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The synthetic screening list: every entry carries the synthetic list
// version and the invented regime, no reference could pass for a published
// list's, every name is built from the seed's hand-written lists, and every
// row fits assure.sanctions_entry's checks (migration 0053).

import { describe, expect, it } from 'vitest';

import { givenNames, places } from '../../names.ts';
import { screeningCases } from './parts/assure.ts';
import {
  entityWords,
  listFamilyNames,
  SYNTHETIC_LIST_VERSION,
  SYNTHETIC_REGIME,
  syntheticEntries,
} from './sanctions.ts';

// The UK sanctions list's unique ids are a regime prefix and four digits
// (RUS0001); OFSI's group ids and OFAC's entity numbers are plain numbers;
// the EU's are prefixed EU. A loose net over all of them.
const PUBLISHED_REFERENCE = [/^[A-Z]{2,4}[0-9]{3,6}$/, /^[0-9]+$/, /^EU\./i];

const bare = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '');

describe('the synthetic sanctions list', () => {
  it('has about 60 entries, all of the synthetic version and the invented regime', () => {
    expect(syntheticEntries).toHaveLength(60);
    for (const entry of syntheticEntries) {
      expect(entry.listVersion).toBe(SYNTHETIC_LIST_VERSION);
      expect(entry.regime).toBe(SYNTHETIC_REGIME);
    }
    expect(SYNTHETIC_LIST_VERSION).toMatch(/^SYNTHETIC-/);
  });

  it('uses no reference a published list could have issued', () => {
    for (const { designationId } of syntheticEntries) {
      expect(designationId).toMatch(/^SYNTH-[IES][0-9]{3}$/);
      for (const pattern of PUBLISHED_REFERENCE) expect(designationId).not.toMatch(pattern);
    }
  });

  it('builds every name from the hand-written lists', () => {
    const words = new Set<string>([
      ...givenNames,
      ...listFamilyNames,
      ...entityWords.flatMap((phrase) => phrase.split(' ')),
      'MV',
      'Star',
      'Dawn',
      'Community',
    ]);
    for (const { name } of syntheticEntries) {
      for (const word of bare(name).split(' ')) expect(words, name).toContain(word);
    }
    const placeWords = new Set(places.map((place) => place.split(' ')[0]));
    for (const family of listFamilyNames) expect(placeWords).toContain(family);
  });

  it('has one primary name per reference, and each kind of entry', () => {
    const primaries = syntheticEntries.filter((entry) => entry.nameType === 'primary');
    const ids = primaries.map((entry) => entry.designationId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(primaries.map((entry) => entry.name)).size).toBe(primaries.length);
    for (const entry of syntheticEntries.filter(({ nameType }) => nameType === 'alias')) {
      expect(ids).toContain(entry.designationId);
    }
    expect(new Set(syntheticEntries.map((entry) => entry.entryKind))).toEqual(
      new Set(['individual', 'entity', 'ship']),
    );
  });

  it("fits assure.sanctions_entry's checks", () => {
    for (const entry of syntheticEntries) {
      expect(entry.designationId).toMatch(/^[A-Za-z0-9][A-Za-z0-9/._-]{0,39}$/);
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.name.length).toBeLessThanOrEqual(300);
      for (const born of entry.datesOfBirth) {
        expect(born).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
        expect(Number.isNaN(Date.parse(born))).toBe(false);
      }
      if (entry.entryKind !== 'individual') expect(entry.datesOfBirth).toEqual([]);
    }
  });

  it('has the entry each screening case is designed against, and no other entry with its name', () => {
    // Without accents, these cases match one entry's name exactly; the rest match none.
    const exact = new Set([
      'exact name',
      'alias only',
      'diacritics',
      'name matches, date of birth does not',
    ]);
    for (const screening of screeningCases) {
      const party = 'person' in screening ? screening.person.join(' ') : screening.organisation;
      const named = syntheticEntries.filter((entry) => bare(entry.name) === party);
      expect(syntheticEntries.map((entry) => entry.designationId)).toContain(screening.entry);
      expect(
        named.map((entry) => entry.designationId),
        party,
      ).toEqual(exact.has(screening.case) ? [screening.entry] : []);
    }
  });
});
