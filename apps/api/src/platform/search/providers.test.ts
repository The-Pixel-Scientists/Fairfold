// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The listed providers keep the search rules and declare each field no less
// sensitive than the classification map does (architecture rule 5).

import {
  classification,
  SENSITIVITIES,
  type Sensitivity,
} from '@pixel-scientists/db/classification';
import { checkSearchProvider, type SearchProvider } from '@pixel-scientists/domain/platform/search';
import { describe, expect, it } from 'vitest';

import { searchEntries, searchHandler } from './index.ts';

/** The column each provider field is matched on, as `table.column`, by the provider's kind. */
const sources: Record<string, Record<string, string>> = {
  'party.organisation': {
    name: 'party.organisation.name',
    identifier: 'party.organisation_identifier.identifier',
  },
  'party.person': {
    given_name: 'party.person.given_name',
    family_name: 'party.person.family_name',
    email: 'party.person.email',
  },
};

const rank = (level: Sensitivity): number => SENSITIVITIES.indexOf(level);

/** Fields missing from the map or the sources, and fields declared less sensitive than the map says. */
function classificationProblems(provider: SearchProvider): string[] {
  const columns = sources[provider.kind];
  if (columns === undefined) return [`${provider.kind} has no source columns listed.`];
  return provider.fields.flatMap((field) => {
    const source = columns[field.id];
    if (source === undefined) return [`${provider.kind} ${field.id} has no source column listed.`];
    const at = source.lastIndexOf('.');
    const classified = classification[source.slice(0, at)]?.[source.slice(at + 1)];
    if (classified === undefined) return [`${source} is not in the classification map.`];
    return rank(field.sensitivity) < rank(classified.sensitivity)
      ? [`${source} is ${classified.sensitivity}, declared ${field.sensitivity}.`]
      : [];
  });
}

describe('the search providers', () => {
  it('keep the contract’s rules', () => {
    for (const { provider } of searchEntries) expect(checkSearchProvider(provider)).toEqual([]);
    expect(() => searchHandler()).not.toThrow();
  });

  it('declare each field as sensitive as the classification map does', () => {
    for (const { provider } of searchEntries) expect(classificationProblems(provider)).toEqual([]);
  });

  it('are caught when a field is declared less sensitive or is not in the map', () => {
    const [first] = searchEntries;
    const provider = first?.provider as SearchProvider;
    const lax = {
      ...provider,
      fields: [{ id: 'email', sensitivity: 'internal', audiences: ['staff'] }],
    };
    expect(classificationProblems({ ...lax, kind: 'party.person' } as SearchProvider)).toEqual([
      'party.person.email is personal, declared internal.',
    ]);
    const unknown = { ...lax, kind: 'party.person', fields: [{ ...lax.fields[0], id: 'phone' }] };
    expect(classificationProblems(unknown as SearchProvider)).toEqual([
      'party.person phone has no source column listed.',
    ]);
    expect(classificationProblems({ ...provider, kind: 'crm.contact' } as SearchProvider)).toEqual([
      'crm.contact has no source columns listed.',
    ]);
  });

  it('are refused at start-up when one breaks the rules', () => {
    const [first] = searchEntries;
    const broken = {
      ...(first as (typeof searchEntries)[number]),
      provider: { ...first?.provider, audiences: [] },
    };
    expect(() => searchHandler([broken as (typeof searchEntries)[number]])).toThrow(
      'search provider breaks the rules',
    );
  });
});
