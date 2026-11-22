// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The triage routes' handlers, matched with their contracts in
// apps/api/src/modules.ts.

import type { TriageDependencies } from './context.ts';
import { labelSetHandlers } from './label-set.ts';
import { labelHandlers } from './labels.ts';
import { ownerHandlers } from './owners.ts';

export function triageHandlers(deps: TriageDependencies) {
  return { ...ownerHandlers(deps), ...labelHandlers(deps), ...labelSetHandlers(deps) };
}
