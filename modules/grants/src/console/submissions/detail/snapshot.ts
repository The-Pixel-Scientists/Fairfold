// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Details as submitted (ADR 0017): what to say when the organisation's
// current record is not what it was at submission. The two are compared,
// never merged, and the snapshot is read only.

import type { OrganisationSnapshot } from '@pixel-scientists/party/contracts';

export type CurrentRecord = Pick<
  OrganisationSnapshot,
  'name' | 'legalForm' | 'registeredAddress' | 'website' | 'identifiers'
>;

const identifiersOf = ({ identifiers }: Pick<CurrentRecord, 'identifiers'>) =>
  identifiers.map(({ scheme, identifier }) => `${scheme}:${identifier}`).sort();

/** The parts of the record that have changed since it was submitted, in words for a sentence. */
export function changedSince(snapshot: CurrentRecord, current: CurrentRecord): string[] {
  const changed: string[] = [];
  if (snapshot.name !== current.name) changed.push('name');
  if (snapshot.legalForm !== current.legalForm) changed.push('legal form');
  if (JSON.stringify(snapshot.registeredAddress) !== JSON.stringify(current.registeredAddress)) {
    changed.push('registered address');
  }
  if (snapshot.website !== current.website) changed.push('website');
  if (JSON.stringify(identifiersOf(snapshot)) !== JSON.stringify(identifiersOf(current))) {
    changed.push('identifiers');
  }
  return changed;
}

/** "name", "name and website", "name, website and identifiers". */
export const listed = (items: readonly string[]): string =>
  items.length < 2
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
