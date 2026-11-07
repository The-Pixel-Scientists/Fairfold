// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Search contracts: the `/platform/search` subpath of the domain package.

import '../../jitless/index.ts';

export {
  checkSearchProvider,
  defineSearchProvider,
  reviewerKinds,
  searchableFields,
  searchAudiences,
  sensitivities,
  type ReviewerKind,
  type SearchAudience,
  type SearchField,
  type SearchFunction,
  type SearchHit,
  type SearchKind,
  type SearchProvider,
  type SearchRequest,
  type Sensitivity,
} from './provider.ts';
export { searchRoutes, searchTerm } from './routes.ts';
export {
  SEARCH_GROUP_LIMIT,
  searchRequestSchema,
  searchResponseSchema,
  searchResponseSchemas,
  type SearchRequestBody,
  type SearchResponse,
} from './schemas.ts';
export {
  normaliseSearchTerm,
  SEARCH_TERM_MAX_CHARACTERS,
  SEARCH_TERM_MIN_CHARACTERS,
  searchTermSchema,
  type SearchTerm,
} from './term.ts';
