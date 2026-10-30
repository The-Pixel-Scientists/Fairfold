// SPDX-License-Identifier: AGPL-3.0-or-later

import { threeSixtyGivingQuerySchema } from '../../contracts/index.ts';
import type { ProgrammeList } from '../../contracts/index.ts';
import { describe, expect, it } from 'vitest';

import { fileName, grantCount, scopesOf } from './scope.ts';

const money = { amountMinor: 0, currency: 'GBP' } as const;
const at = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const programmes = [
  {
    id: at(1),
    title: 'Community Spaces Fund',
    summary: 'Places where neighbours meet.',
    status: 'open',
    rounds: [
      {
        id: at(2),
        programmeId: at(1),
        title: 'Spring 2027',
        opensAt: '2027-02-02T09:00',
        closesAt: '2027-03-02T17:00',
        timeZone: 'Europe/London',
        budget: money,
        awardMinimum: money,
        awardMaximum: money,
        latePolicy: 'refuse',
      },
    ],
  },
  { id: at(3), title: 'Small Grants', summary: 'Quick.', status: 'draft', rounds: [] },
] as unknown as ProgrammeList['programmes'];

describe('scopesOf', () => {
  it('offers each programme with all its rounds, then each round on its own', () => {
    expect(
      scopesOf(programmes).map(({ value, programme, label, name }) => [
        value,
        programme,
        label,
        name,
      ]),
    ).toEqual([
      [
        `programme:${at(1)}`,
        'Community Spaces Fund',
        'All rounds',
        'Community Spaces Fund, all rounds',
      ],
      [
        `round:${at(2)}`,
        'Community Spaces Fund',
        'Spring 2027',
        'Community Spaces Fund, Spring 2027',
      ],
      [`programme:${at(3)}`, 'Small Grants', 'All rounds', 'Small Grants, all rounds'],
    ]);
  });

  it('gives a query the export route takes, a programme or a round and never both', () => {
    for (const { query } of scopesOf(programmes)) {
      expect(threeSixtyGivingQuerySchema.safeParse(query).success).toBe(true);
      expect(Object.keys(query)).toHaveLength(1);
    }
  });

  it('offers nothing when there are no programmes', () => {
    expect(scopesOf([])).toEqual([]);
  });
});

describe('fileName', () => {
  it('writes the choice as a safe .json name', () => {
    expect(fileName({ name: 'Community Spaces Fund, Spring 2027' })).toBe(
      '360giving-community-spaces-fund-spring-2027.json',
    );
    expect(fileName({ name: '  ../Fund "A" & B/\\x  ' })).toBe('360giving-fund-a-b-x.json');
  });

  it('keeps a long name short and ends it on a word', () => {
    const name = fileName({ name: `${'word '.repeat(40)}end` });
    expect(name.length).toBeLessThanOrEqual(95);
    expect(name).toMatch(/^360giving-[a-z0-9-]+-word\.json$/);
  });

  it('falls back when the name holds no letters or numbers', () => {
    expect(fileName({ name: '…' })).toBe('360giving.json');
  });
});

describe('grantCount', () => {
  it('counts in words', () => {
    expect(grantCount(1)).toBe('1 grant');
    expect(grantCount(0)).toBe('0 grants');
    expect(grantCount(5000)).toBe('5,000 grants');
  });
});
