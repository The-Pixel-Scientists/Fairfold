// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { actionOptions, entityTypeOptions } from './actions.ts';
import {
  actorName,
  changeCount,
  entityLabel,
  entityModule,
  fieldLabel,
  formatWhen,
  valueText,
} from './words.ts';

describe('dates', () => {
  it('writes a time as 14 October 2026, 2:05pm, in the funder time zone', () => {
    expect(formatWhen('2026-10-14T13:05:00.000Z', 'Europe/London')).toBe('14 October 2026, 2:05pm');
    expect(formatWhen('2026-10-14T13:05:00.000Z', 'America/New_York')).toBe(
      '14 October 2026, 9:05am',
    );
    expect(formatWhen('2027-01-05T00:30:00.000Z', 'Europe/London')).toBe('5 January 2027, 12:30am');
  });

  it('falls back to the browser time zone for a zone it does not know', () => {
    expect(formatWhen('2026-10-14T13:05:00.000Z', 'Not/AZone')).toMatch(
      /^14 October 2026, \d{1,2}:05(am|pm)$/,
    );
  });
});

describe('words for the log', () => {
  it('names who acted, and never an applicant', () => {
    expect(actorName({ kind: 'staff', membershipId: 'm', name: 'Ada Morgan' })).toBe('Ada Morgan');
    expect(actorName({ kind: 'staff', membershipId: 'm', name: null })).toBe('Team member');
    expect(actorName({ kind: 'applicant', membershipId: 'm' })).toBe('Applicant');
    expect(actorName({ kind: 'system' })).toBe('System');
    expect(actorName({ kind: 'operator' })).toBe('Platform operator');
  });

  it('names entities, modules and fields from their codes', () => {
    expect(entityLabel('grants.form_version')).toBe('Form version');
    expect(entityModule('grants.form_version')).toBe('Grants');
    expect(entityModule('party.person')).toBe('Organisations and people');
    expect(fieldLabel('party.person.family_name')).toBe('Family name');
    expect(fieldLabel('f_abc123')).toBe('Form answer');
  });

  it('shows values as text', () => {
    expect(valueText('Open')).toBe('Open');
    expect(valueText(12)).toBe('12');
    expect(valueText(true)).toBe('Yes');
    expect(valueText(null)).toBe('Empty');
    expect(valueText(['a', 'b'])).toBe('a, b');
    expect(valueText([])).toBe('None');
  });

  it('counts the changed fields', () => {
    const event = { changes: { 'a.b.c': {}, 'a.b.d': {} } };
    expect(changeCount(event as never)).toBe('2 fields');
    expect(changeCount({ changes: { 'a.b.c': {} } } as never)).toBe('1 field');
    expect(changeCount({ changes: {} } as never)).toBe('None');
  });
});

describe('the options for the filters', () => {
  it('offers the actions of the module chosen, in words, and every module when none is', () => {
    const grants = actionOptions('grants', '');
    expect(grants.map((option) => option.value).every((code) => code.startsWith('grants.'))).toBe(
      true,
    );
    expect(grants.find((option) => option.value === 'grants.application.submitted')?.label).toBe(
      'Application submitted',
    );
    expect(actionOptions('', '').length).toBeGreaterThan(grants.length);
  });

  it('keeps an action or entity type from the address that the lists do not hold', () => {
    expect(actionOptions('party', 'party.person.merged')).toEqual([
      { value: 'party.person.merged', label: 'Person merged' },
    ]);
    expect(entityTypeOptions('party', 'party.person')).toEqual([
      { value: 'party.person', label: 'Person (Organisations and people)' },
    ]);
  });
});
