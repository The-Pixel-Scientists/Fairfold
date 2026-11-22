// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The generated record of processing (UK GDPR Article 30): the shipped
// classification map's register, shaped as the contract's entries. It reads
// no database and no tenant data, so it is the same for every tenant. The
// entries come in purpose order, so a table that is added to the map shows
// up here with no change to this file. Codes pass through as codes for the
// screen to word. Tables of a module that is switched off stay in the record,
// because their data is kept (ADR 0016).

import { recordsByPurpose } from '@pixel-scientists/db';
import { modules, type ModuleId } from '@pixel-scientists/domain/platform';

import type { ProcessingRecord } from '../../contracts/index.ts';

type Entry = ProcessingRecord['tables'][number];
type RegisterEntry = ReturnType<typeof recordsByPurpose>[number]['tables'][number];
type RetentionRule = RegisterEntry['columns'][number]['retention'];

/** The module that owns a table's schema; the job schema belongs to the platform. */
function moduleOf(table: string): ModuleId {
  const schema = table.slice(0, table.indexOf('.'));
  const found = (Object.keys(modules) as ModuleId[]).find((id) =>
    (modules[id].schemas as readonly string[]).includes(schema),
  );
  return found ?? 'platform';
}

/** How long a rule keeps a value, and a rule that never ends as the longest. */
const keptDays = (rule: RetentionRule): number | null =>
  rule.kind === 'fixed' ? rule.days : rule.kind === 'tenant_policy' ? rule.minimumDays : null;

/** The rule that keeps a table's data longest: a table is kept as long as its longest-kept column. */
function longestRetention(columns: RegisterEntry['columns']): Entry['retention'] {
  const rules = columns.map(({ retention }) => retention);
  const forever = rules.find(
    (rule) => rule.kind === 'tenant_lifetime' || rule.kind === 'account_lifetime',
  );
  const rule =
    forever ??
    rules.reduce((longest, next) =>
      (keptDays(next) ?? 0) > (keptDays(longest) ?? 0) ? next : longest,
    );
  return { rule: rule.kind, days: keptDays(rule) };
}

/** The field ids through which the table reaches a person. */
function pathFields({ table, subjectPath }: RegisterEntry): string[] {
  switch (subjectPath?.kind) {
    case 'party':
    case 'account':
    case 'join':
      return [`${table}.${subjectPath.column}`];
    case 'parties':
      return subjectPath.columns.map((column) => `${table}.${column}`);
    default:
      return [];
  }
}

export function processingRecordEntries(): Entry[] {
  return recordsByPurpose()
    .flatMap(({ tables }) => tables)
    .map((entry) => ({
      table: entry.table,
      module: moduleOf(entry.table),
      dataCategories: [...entry.dataCategories],
      sensitivity: entry.highestSensitivity,
      retention: longestRetention(entry.columns),
      subjectPaths: pathFields(entry),
      purpose: entry.purpose,
      legalBasis: entry.legalBasis,
      processorIds: [],
    }));
}
