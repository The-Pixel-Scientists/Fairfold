// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The triage routes' handlers, matched with their contracts in
// apps/api/src/modules.ts. The label set's create, rename and archive routes
// wait for the `grants.label` configuration entity type (rule 10).

import type { TriageDependencies } from './context.ts';
import { labelHandlers } from './labels.ts';
import { ownerHandlers } from './owners.ts';

export function triageHandlers(deps: TriageDependencies) {
  return { ...ownerHandlers(deps), ...labelHandlers(deps) };
}
