// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The console's search across tools (ADR 0025). The providers are listed here
// and imported only from their module's server entry point; adding a tool's
// search is one line. Every provider is checked when the handler is made, so
// the API does not start with one that breaks the rules.

import { partySearch } from '@pixel-scientists/party/server';
import { checkSearchProvider, type searchTerm } from '@pixel-scientists/domain/platform/search';

import type { Handler } from '../../routes/register.ts';
import { runSearch, type SearchEntry } from './runner.ts';

export { runSearch, SEARCH_TOTAL_LIMIT, type SearchEntry, type SearchRun } from './runner.ts';

export const searchEntries: readonly SearchEntry[] = [...partySearch];

export function searchHandler(
  entries: readonly SearchEntry[] = searchEntries,
): Handler<typeof searchTerm> {
  for (const { provider } of entries) {
    const problems = checkSearchProvider(provider);
    if (problems.length > 0) {
      throw new Error(`The ${provider.kind} search provider breaks the rules.`);
    }
  }
  return ({ tx, context, input }) =>
    runSearch({
      tx,
      permissions: context.membership.permissions,
      audit: context.audit,
      term: input.body.term,
      modules: input.body.modules,
      entries,
    });
}
