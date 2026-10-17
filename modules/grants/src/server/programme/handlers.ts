// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The programme set-up routes' handlers (ADR 0004), matched with their
// contracts in apps/api/src/modules.ts. The email template handlers are in
// their own file so they can be left out.

import type { GrantsDependencies } from './context.ts';
import { historyHandlers } from './history.ts';
import { programmeHandlers } from './programmes.ts';
import { roundHandlers } from './rounds.ts';
import { stageHandlers } from './stages.ts';
import { templateHandlers } from './templates.ts';

export function programmeSetUpHandlers(deps: GrantsDependencies) {
  return {
    ...programmeHandlers(deps),
    ...roundHandlers(deps),
    ...stageHandlers(deps),
    ...templateHandlers(deps),
    ...historyHandlers(deps),
  };
}
