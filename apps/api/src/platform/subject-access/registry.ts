// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Collects each module's rows about one party (ADR 0016, ADR 0027). Every
// registered contribution runs, whether or not the tenant has its module
// switched on, since a module keeps its data when it is off. Each runs in the
// caller's transaction, which carries the tenant, and its answer is checked
// against the shared schema before anything is written from it.

import type { Transaction } from '@pixel-scientists/db';
import { classification } from '@pixel-scientists/db/classification';
import type { ModuleId } from '@pixel-scientists/domain/platform';
import {
  subjectDataSchema,
  type SubjectData,
  type SubjectDataContribution,
} from '@pixel-scientists/domain/platform/subject-access';

export type Contribution = SubjectDataContribution<ModuleId, Transaction<unknown>>;

/** A column's table and name, from its field id; a form answer's id (`f_...`) has no dot. */
const COLUMN_FIELD_ID = /^(.+\..+)\.([^.]+)$/;

/**
 * Whether every column cell is in the classification map with the sensitivity
 * the map gives it. A module copies the map, so this catches a copy that has
 * drifted; form answers take their class from the pinned form version.
 */
function matchesMap(data: SubjectData): boolean {
  return Object.values(data).every((rows) =>
    rows.every((row) =>
      Object.entries(row).every(([id, cell]) => {
        const [, table = '', column = ''] = COLUMN_FIELD_ID.exec(id) ?? [];
        if (table === '') return id.startsWith('f_');
        const fields = Object.hasOwn(classification, table) ? classification[table] : undefined;
        const field = fields && Object.hasOwn(fields, column) ? fields[column] : undefined;
        return field?.sensitivity === cell.sensitivity;
      }),
    ),
  );
}

export type ModuleData = Partial<Record<ModuleId, SubjectData>>;

/**
 * The rows of every contribution about each of `subjectPartyIds`, by module:
 * the parties of one person's merge set, whose rows keep the ids they were
 * written with (ADR 0025).
 */
export async function collectModuleData(
  tx: Transaction<unknown>,
  contributions: readonly Contribution[],
  subjectPartyIds: readonly string[],
): Promise<ModuleData> {
  const modules = contributions.map(({ module }) => module);
  if (new Set(modules).size !== modules.length) {
    throw new Error('A module has more than one subject data contribution.');
  }
  const data: ModuleData = {};
  for (const { module, subjectData } of contributions) {
    const tables: SubjectData = {};
    for (const subjectPartyId of subjectPartyIds) {
      const rows = subjectDataSchema.safeParse(await subjectData(tx, subjectPartyId));
      // The error is not passed on: it could repeat a value.
      if (!rows.success || !matchesMap(rows.data)) {
        throw new Error(`The ${module} module's subject data is not valid.`);
      }
      for (const [table, held] of Object.entries(rows.data)) {
        (tables[table] ??= []).push(...held);
      }
    }
    data[module] = tables;
  }
  return data;
}
