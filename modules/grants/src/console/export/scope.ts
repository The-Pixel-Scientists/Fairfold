// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a 360Giving file can be made from: a programme's released awards or
// one round's, chosen from the programmes the funder runs.

import type { ProgrammeList, ThreeSixtyGivingQuery } from '../../contracts/index.ts';

export interface Scope {
  /** `programme:<id>` or `round:<id>`, which a select holds. */
  value: string;
  programme: string;
  /** What the choice is called in a list. */
  label: string;
  /** What it is called in a sentence, such as "Community Spaces Fund, Spring 2027". */
  name: string;
  query: ThreeSixtyGivingQuery;
}

/** Each programme with all its rounds, then each round on its own, in the order the API lists them. */
export function scopesOf(programmes: ProgrammeList['programmes']): Scope[] {
  return programmes.flatMap((programme) => [
    {
      value: `programme:${programme.id}`,
      programme: programme.title,
      label: 'All rounds',
      name: `${programme.title}, all rounds`,
      query: { programmeId: programme.id },
    },
    ...programme.rounds.map((round) => ({
      value: `round:${round.id}`,
      programme: programme.title,
      label: round.title,
      name: `${programme.title}, ${round.title}`,
      query: { roundId: round.id },
    })),
  ]);
}

/** The name of the file to save, such as `360giving-community-spaces-fund-all-rounds.json`. */
export function fileName(scope: Pick<Scope, 'name'>): string {
  const words = scope.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return words === '' ? '360giving.json' : `360giving-${words}.json`;
}

/** "1 grant", "12 grants". */
export const grantCount = (count: number): string =>
  `${count.toLocaleString('en-GB')} ${count === 1 ? 'grant' : 'grants'}`;
