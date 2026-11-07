// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkSearchProvider, searchTermSchema } from '@pixel-scientists/domain/platform/search';
import { describe, expect, it } from 'vitest';

import './audit.ts';
import { isPersonal } from './schemas.ts';
import {
  partySearchRequestSchema,
  partySearchResultSchema,
  searchProviders,
  termSchema,
} from './search.ts';

describe('crm search', () => {
  it('has providers that keep the platform rules, auditing every page of people', () => {
    for (const provider of searchProviders) expect(checkSearchProvider(provider)).toEqual([]);
    expect(searchProviders.map((provider) => provider.kind)).toEqual([
      'crm.organisation',
      'crm.person',
    ]);
  });

  it.each(['  Ada   Lovelace ', 'ﬁeld trust', 'a', 'x'.repeat(101), 'tab\u0007bell', '  '])(
    'normalises and checks the term %j as the platform does',
    (term) => {
      const ours = termSchema.safeParse(term);
      const platform = searchTermSchema.safeParse(term);
      expect(ours.success).toBe(platform.success);
      expect(ours.data).toEqual(platform.data);
    },
  );

  it('takes the term and filters in the body, and nothing else', () => {
    const request = { term: 'Northfield', kinds: ['organisation'], verification: 'verified' };
    expect(partySearchRequestSchema.parse(request)).toEqual({ ...request, limit: 25 });
    for (const change of [
      { limit: 51 },
      { kinds: ['person', 'person'] },
      { email: 'a@example.org' },
      { term: undefined },
    ]) {
      expect(partySearchRequestSchema.safeParse({ ...request, ...change }).success).toBe(false);
    }
  });

  it('marks a result label as personal', () => {
    expect(isPersonal(partySearchResultSchema.shape.label)).toBe(true);
  });
});
