// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Every forms route (ADR 0004): staff in the console, signed-in respondents
// in the portal, and anyone on a public form.

import { formRoutes } from './forms.ts';
import { portalFormRoutes } from './portal.ts';
import { publicFormRoutes } from './public.ts';
import { consoleResponseRoutes } from './responses.ts';
import { templateRoutes } from './templates.ts';

export const formsRoutes = {
  ...formRoutes,
  ...templateRoutes,
  ...consoleResponseRoutes,
  ...portalFormRoutes,
  ...publicFormRoutes,
} as const;
