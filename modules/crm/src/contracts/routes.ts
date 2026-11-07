// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Every crm route (ADR 0004), all for staff in the console under the
// `tenant` scope; crm has no portal route in v1. Paths start with
// `/console/crm/`, so none meets party's own `/console/organisations/` and
// `/console/people/` routes, which staff use to change a record.

import { duplicateRoutes } from './duplicates.ts';
import { importRoutes } from './imports.ts';
import { listRoutes } from './lists.ts';
import { mergeRoutes } from './merge.ts';
import { recordRoutes } from './records.ts';
import { referenceRoutes } from './references.ts';
import { searchParties } from './search.ts';
import { segmentRoutes } from './segments.ts';

export const crmRoutes = {
  searchParties,
  ...recordRoutes,
  ...referenceRoutes,
  ...duplicateRoutes,
  ...mergeRoutes,
  ...listRoutes,
  ...segmentRoutes,
  ...importRoutes,
} as const;
