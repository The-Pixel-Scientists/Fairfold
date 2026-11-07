// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Every privacy route (ADR 0004), all for staff in the console over the
// whole tenant. There is no portal or public route; while the tool is off
// for a tenant, every route answers 404 (ADR 0024).

import { breachRoutes } from './breaches.ts';
import { consentRoutes } from './consent.ts';
import { dpiaRoutes } from './dpias.ts';
import { processingRoutes } from './processing.ts';
import { rightsRequestRoutes } from './requests.ts';
import { subjectActionRoutes } from './subject-actions.ts';
import { requestTaskRoutes } from './tasks.ts';

export const privacyRoutes = {
  ...rightsRequestRoutes,
  ...requestTaskRoutes,
  ...subjectActionRoutes,
  ...breachRoutes,
  ...dpiaRoutes,
  ...processingRoutes,
  ...consentRoutes,
} as const;
