// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import type { Adjustment } from '../../../contracts/index.ts';
import { closingOf, closingWords, givenWords, grantedWords, zoneWords } from './words.ts';

const extension: Adjustment = {
  id: '00000000-0000-4000-8000-000000000701',
  roundId: '00000000-0000-4000-8000-000000000702',
  organisation: { id: '00000000-0000-4000-8000-000000000703', name: 'Riverside Youth Trust' },
  applicationId: null,
  kind: 'deadline_extension',
  closesAt: '2026-11-09T17:00',
  timeZone: 'Europe/London',
  reasonCode: 'access_needs',
  grantedBy: { membershipId: '00000000-0000-4000-8000-000000000704', name: 'Ada Reed' },
  grantedAt: '2026-11-01T10:30:00.000Z',
  revoked: null,
};

describe('closing times', () => {
  it('names the zone, calling Europe/London UK time', () => {
    expect(zoneWords('Europe/London')).toBe('UK time');
    expect(zoneWords('Europe/Dublin')).toBe('Europe/Dublin');
    expect(closingWords('2026-11-09T17:00', 'Europe/London')).toBe(
      '9 November 2026 at 5pm, UK time',
    );
  });

  it('reads the wall clock as written, so a clock change cannot move it', () => {
    // 01:30 does not exist on 28 March 2027 and happens twice on 25 October 2026: both read as typed.
    expect(closingWords('2027-03-28T01:30', 'Europe/London')).toBe(
      '28 March 2027 at 1:30am, UK time',
    );
    expect(closingWords('2026-10-25T01:30', 'Europe/London')).toBe(
      '25 October 2026 at 1:30am, UK time',
    );
  });

  it('sends the minute as typed, and nothing until the date and time are both whole', () => {
    expect(closingOf({ date: '2026-11-09', time: '17:01' })).toBe('2026-11-09T17:01');
    expect(closingOf({ date: '2026-11-09', time: '' })).toBeNull();
    expect(closingOf({ date: null, time: '17:00' })).toBeNull();
    expect(closingOf({ date: '9 11', time: '17:00' })).toBeNull();
  });
});

describe('what an adjustment says', () => {
  it('says what it gives and who gave it', () => {
    expect(givenWords(extension)).toBe('More time to apply until 9 November 2026 at 5pm, UK time');
    expect(givenWords({ ...extension, kind: 'alternative_route', closesAt: null })).toBe(
      'Staff submit for the applicant',
    );
    expect(grantedWords(extension)).toMatch(/^Ada Reed, 1 November 2026 at /);
    expect(
      grantedWords({ ...extension, grantedBy: { ...extension.grantedBy, name: null } }),
    ).toMatch(/^A team member, /);
  });
});
