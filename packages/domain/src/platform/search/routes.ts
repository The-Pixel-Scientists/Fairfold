// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The console's one search route (ADR 0025). Every console role holds its
// permission; each provider then narrows by its own permission and scopes,
// the module switch and the caller's audience (S12-16). It is a POST so the
// term stays out of URLs, logs and history, not because it changes anything:
// it is not idempotent, so call() never retries it. A search that returns a
// provider's results writes that provider's read action with the result ids
// only, never the term.

import { defineRoute } from '../../api/route.ts';
import { searchRequestSchema, searchResponseSchema } from './schemas.ts';

export const searchTerm = defineRoute({
  audience: 'console',
  module: 'platform',
  permission: 'platform.search.use',
  scope: 'tenant',
  method: 'POST',
  path: '/console/search',
  summary: 'Search the tools the caller may use, with the term in the body',
  body: searchRequestSchema,
  responses: { 200: searchResponseSchema },
});

export const searchRoutes = { searchTerm } as const;
