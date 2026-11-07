// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { relationshipTypeRules, relationshipTypes } from './lists.ts';
import { partyMessages } from './messages.ts';
import { relationshipProblems, type RelationshipLink } from './relationships.ts';

const contact: RelationshipLink = {
  type: 'contact_for',
  fromKind: 'person',
  toKind: 'organisation',
  startsOn: null,
  endsOn: null,
};

describe('relationshipProblems', () => {
  it('accepts each type with its own kinds', () => {
    for (const type of relationshipTypes) {
      const { from, to } = relationshipTypeRules[type];
      expect(relationshipProblems({ ...contact, type, fromKind: from, toKind: to })).toEqual([]);
    }
  });

  it('refuses a type used with the wrong kinds at either end', () => {
    for (const kinds of [
      { fromKind: 'organisation', toKind: 'organisation' },
      { fromKind: 'person', toKind: 'person' },
      { fromKind: 'organisation', toKind: 'person' },
    ] as const) {
      expect(relationshipProblems({ ...contact, ...kinds })).toEqual([
        partyMessages.relationshipKinds,
      ]);
    }
  });

  it('refuses an end before the start, and takes an end on the start or open dates', () => {
    expect(
      relationshipProblems({ ...contact, startsOn: '2026-11-12', endsOn: '2026-11-11' }),
    ).toEqual([partyMessages.relationshipDates]);
    for (const dates of [
      { startsOn: '2026-11-12', endsOn: '2026-11-12' },
      { startsOn: null, endsOn: '2026-01-01' },
      { startsOn: '2026-11-12', endsOn: null },
    ]) {
      expect(relationshipProblems({ ...contact, ...dates })).toEqual([]);
    }
  });
});
