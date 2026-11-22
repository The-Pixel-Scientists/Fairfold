// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { buildRequest, noFilters } from './search.ts';
import { formatDay, formatMoment, personName } from './words.ts';

describe('buildRequest', () => {
  it('sends only the term when no filter is chosen', () => {
    expect(buildRequest({ ...noFilters, term: 'Riverside' })).toEqual({ term: 'Riverside' });
  });

  it('sends the choices as the API names them, and the cursor for the next page', () => {
    expect(
      buildRequest(
        { term: 'Sam', kind: 'person', status: 'any', verification: 'claimed' },
        'next-page',
      ),
    ).toEqual({
      term: 'Sam',
      kinds: ['person'],
      statuses: ['active', 'archived', 'merged', 'erased'],
      verification: 'claimed',
      cursor: 'next-page',
    });
  });
});

describe('dates and names', () => {
  it('writes a date as the content style does', () => {
    expect(formatDay('2024-03-04')).toBe('4 March 2024');
  });

  it('writes a moment with the time as 9am or 5:30pm', () => {
    expect(formatMoment('2026-11-02T10:00:00.000Z')).toMatch(
      /^2 November 2026 at \d{1,2}(:\d\d)?[ap]m$/,
    );
  });

  it('names a person, or falls back to their email address', () => {
    expect(personName({ givenName: 'Sam', familyName: 'Patel', email: 'sam@example.org' })).toBe(
      'Sam Patel',
    );
    expect(personName({ givenName: null, familyName: null, email: 'sam@example.org' })).toBe(
      'sam@example.org',
    );
  });
});
