// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Every assure route (ADR 0004), all for staff in the console. No reviewer
// role holds an assure permission, and the portal has no assure route.

import { checklistRoutes } from './checklists.ts';
import { duplicateRoutes } from './duplicates.ts';
import { lookupRoutes } from './lookups.ts';
import { matchRoutes } from './matches.ts';
import { screeningRoutes } from './screening.ts';
import { visitRoutes } from './visits.ts';

export const assureRoutes = {
  ...lookupRoutes,
  ...screeningRoutes,
  ...matchRoutes,
  ...duplicateRoutes,
  ...checklistRoutes,
  ...visitRoutes,
} as const;
