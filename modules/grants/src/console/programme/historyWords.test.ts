// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { configPathPattern } from '../../contracts/index.ts';
import type { ConfigDiff, ConfigVersion } from '../../contracts/index.ts';
import { describe as describeChanges, namesIn, summarise } from './historyWords.ts';

const REVIEW = 'd4e5f6a7-b8c9-4d0e-9f2a-3b4c5d6e7f80';
const NEED = 'f6a7b8c9-d0e1-4f2a-9b4c-5d6e7f8091a2';

function version(number: number, changes: ConfigDiff): ConfigVersion {
  return {
    version: number,
    createdAt: '2026-10-12T10:00:00.000Z',
    author: { membershipId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', name: 'Ada Reed' },
    changes,
  };
}

describe('a change in words', () => {
  it('says money as pounds, dates as dates and choices by their labels', () => {
    const words = describeChanges(
      [
        { path: 'budget.amountMinor', from: 15_000_000, to: 17_500_000 },
        { path: 'closesAt', from: '2026-11-02T17:00', to: '2026-11-09T17:00' },
        { path: 'latePolicy', from: 'refuse', to: 'accept_and_flag' },
        { path: 'status', from: 'draft', to: 'open' },
      ],
      new Map(),
    );

    expect(words).toEqual([
      { subject: 'budget', field: 'Budget', before: '£150,000', after: '£175,000' },
      {
        subject: 'closing date and time',
        field: 'Closing date and time',
        before: '2 November 2026 at 5pm',
        after: '9 November 2026 at 5pm',
      },
      {
        subject: 'late applications',
        field: 'Late applications',
        before: 'Refuse late applications',
        after: 'Accept late applications and mark them as late',
      },
      { subject: 'status', field: 'Status', before: 'Draft', after: 'Open' },
    ]);
  });

  it('says a value that was not there as not set, one that is gone as removed, and no text as empty', () => {
    const [added, removed, cleared] = describeChanges(
      [
        { path: `stages.${REVIEW}.name`, from: null, to: 'Review' },
        { path: `stages.${REVIEW}.position`, from: 2, to: null },
        { path: 'description', from: 'A fund', to: '' },
      ],
      new Map(),
    );

    expect(added).toMatchObject({ before: 'Not set', after: 'Review' });
    expect(removed).toMatchObject({ before: '2', after: 'Removed' });
    expect(cleared).toMatchObject({ before: 'A fund', after: 'Empty' });
  });

  it('names a stage and a criterion from the changes themselves, or from the names it is given', () => {
    const changes: ConfigDiff = [
      { path: `stages.${REVIEW}.name`, from: 'Review', to: 'Assessment' },
      { path: `stages.${REVIEW}.criteria.${NEED}.weight`, from: 3, to: 5 },
      { path: `stages.${REVIEW}.criteria.${NEED}.scaleMax`, from: 5, to: 10 },
    ];

    const [rename, weight, scale] = describeChanges(changes, new Map([[NEED, 'Need']]));

    expect(rename?.field).toBe('Stage “Assessment”: name');
    expect(weight?.field).toBe('Criterion “Need” in stage “Assessment”: weight');
    expect(scale?.field).toBe('Criterion “Need” in stage “Assessment”: highest score');
    expect(describeChanges(changes.slice(1, 2), new Map())[0]?.field).toBe(
      'A criterion in a stage: weight',
    );
  });

  it('names an email by its outcome', () => {
    const [subject, text] = describeChanges(
      [
        { path: 'emailTemplates.accepted.subject', from: 'Old', to: 'New' },
        { path: 'emailTemplates.waitlisted.body', from: 'Old', to: 'New' },
      ],
      new Map(),
    );

    expect(subject?.field).toBe('Accepted email subject');
    expect(text?.field).toBe('Waitlisted email text');
  });

  it('knows every path the contract allows how to name, with no raw path left in a label', () => {
    const paths = [
      'title',
      'opensAt',
      'timeZone',
      'budget.amountMinor',
      'budget.currency',
      'awardMinimum.amountMinor',
      'awardMaximum.amountMinor',
      `stages.${REVIEW}.position`,
      `stages.${REVIEW}.criteria.${NEED}.guidance`,
      'emailTemplates.declined.version',
    ];
    for (const path of paths) expect(configPathPattern.test(path)).toBe(true);

    for (const { field } of describeChanges(
      paths.map((path) => ({ path, from: null, to: '1' })),
      new Map(),
    )) {
      expect(field).not.toMatch(/[a-z]\.[a-z]|amountMinor|scaleM/);
    }
  });
});

describe('namesIn', () => {
  it('keeps the names it is given and adds those the changes carry', () => {
    const names = namesIn(
      [{ path: `stages.${REVIEW}.name`, from: null, to: 'Review' }],
      new Map([[NEED, 'Need']]),
    );

    expect([...names]).toEqual([
      [NEED, 'Need'],
      [REVIEW, 'Review'],
    ]);
  });
});

describe('a version in a line', () => {
  it('says created for the first version, when everything is new', () => {
    expect(
      summarise(version(1, [{ path: 'title', from: null, to: 'Spring 2027' }]), new Map()),
    ).toBe('Created');
  });

  it('lists what changed, once each, and counts the rest', () => {
    expect(summarise(version(2, [{ path: 'budget.amountMinor', from: 1, to: 2 }]), new Map())).toBe(
      'Changed budget',
    );
    expect(
      summarise(
        version(3, [
          { path: 'budget.amountMinor', from: 1, to: 2 },
          { path: 'budget.currency', from: 'GBP', to: 'GBP2' },
          { path: 'closesAt', from: '2026-11-02T17:00', to: '2026-11-09T17:00' },
        ]),
        new Map(),
      ),
    ).toBe('Changed budget and closing date and time');
    expect(
      summarise(
        version(
          4,
          ['title', 'summary', 'description', 'status', 'timeZone'].map((path) => ({
            path,
            from: 'a',
            to: 'b',
          })),
        ),
        new Map(),
      ),
    ).toBe('Changed title, summary, description and 2 more');
  });
});
