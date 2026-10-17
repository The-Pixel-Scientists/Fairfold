// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  configDiffSchema,
  type ConfigDiff,
  type GrantsConfigEntityType,
} from '../../contracts/index.ts';
import type { GrantsContext, GrantsDependencies } from './context.ts';
import type { Tx } from './tables.ts';

/**
 * Writes the diff as the next configuration version of the object whose
 * history it joins (architecture rule 10), after checking it against the
 * contract's format. A handler calls it only for a change that happened.
 */
export function recordConfig(
  deps: GrantsDependencies,
  tx: Tx,
  context: GrantsContext,
  entityType: GrantsConfigEntityType,
  entityId: string,
  diff: ConfigDiff,
): Promise<void> {
  return deps.recordConfig(
    tx,
    context.membership.id,
    entityType,
    entityId,
    configDiffSchema.parse(diff),
  );
}
