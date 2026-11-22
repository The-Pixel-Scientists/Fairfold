// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Duplicate signals, bands, dismissal reasons and what a merge moves, in
// the words the screens use. The matched values are never shown.

import type { DuplicateSignal, PartyKind } from '@pixel-scientists/party/contracts';

import type { DismissReason, ScoreBand } from '../../contracts/index.ts';

export const signalWords = {
  verified_identifier: 'Same verified number',
  claimed_identifier: 'Same number, not verified',
  name: 'Similar name',
  name_and_postcode: 'Similar name and the same postcode',
  email: 'Same email address',
  name_and_organisation: 'Similar name at the same organisation',
} as const satisfies Record<DuplicateSignal, string>;

export const bandWords = {
  high: 'Strong match',
  medium: 'Likely match',
  low: 'Possible match',
} as const satisfies Record<ScoreBand, string>;

export const reasonWords = {
  different_organisation: 'They are different organisations',
  different_person: 'They are different people',
  related_but_separate: 'They are related but stay separate',
  duplicate_allowed: 'Both records are needed',
} as const satisfies Record<DismissReason, string>;

/** The reasons that fit a kind of record. */
export const reasonsFor = (kind: PartyKind): readonly DismissReason[] =>
  kind === 'organisation'
    ? ['different_organisation', 'related_but_separate', 'duplicate_allowed']
    : ['different_person', 'related_but_separate', 'duplicate_allowed'];

/** One thing a merge moves, singular and plural. */
const things: Record<string, readonly [string, string]> = {
  'crm.list_member': ['list membership', 'list memberships'],
  'crm.interaction': ['timeline entry', 'timeline entries'],
  'crm.external_reference': ['link to another system', 'links to other systems'],
  'grants.application': ['application', 'applications'],
};

/** "3 applications" for a table, with a plain reading of any table not named above. */
export function countWords(table: string, count: number): string {
  const [one, many] = things[table] ?? [
    `${(table.split('.')[1] ?? table).replaceAll('_', ' ')} record`,
    `${(table.split('.')[1] ?? table).replaceAll('_', ' ')} records`,
  ];
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** "3 applications, 1 list membership and 2 timeline entries", or null when nothing moves. */
export function movesWords(
  counts: Record<string, Record<string, number> | undefined>,
): string | null {
  const parts = Object.values(counts)
    .flatMap((tables) => Object.entries(tables ?? {}))
    .filter(([, count]) => count > 0)
    .map(([table, count]) => countWords(table, count));
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0] ?? null;
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`;
}
