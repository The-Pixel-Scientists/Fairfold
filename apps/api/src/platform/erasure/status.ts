// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How an erasure's counts are kept in its `platform.erasure.completed` event
// and read back for the status route. The audit writer keeps a value only
// for a classified internal column, so each table's count is the event's
// change to that table's `id` column: `{ "party.person.id": { "after": 1 } }`.
// Counts and table names only, never a value.

import {
  erasureCountsSchema,
  type ErasureCounts,
} from '@pixel-scientists/domain/platform/subject-access';
import type { AuditChanges } from '@pixel-scientists/db';

const SUFFIX = '.id';

export function countsAsChanges(counts: ErasureCounts): AuditChanges {
  return Object.fromEntries(
    Object.entries(counts).map(([table, count]) => [`${table}${SUFFIX}`, { after: count }]),
  );
}

/** The counts an event holds, or null if its changes are not counts by table. */
export function countsFromChanges(changes: unknown): ErasureCounts | null {
  if (typeof changes !== 'object' || changes === null) return null;
  const counts = Object.fromEntries(
    Object.entries(changes).flatMap(([field, change]) =>
      field.endsWith(SUFFIX)
        ? [[field.slice(0, -SUFFIX.length), (change as { after?: unknown }).after]]
        : [],
    ),
  );
  const parsed = erasureCountsSchema.safeParse(counts);
  return parsed.success ? parsed.data : null;
}
