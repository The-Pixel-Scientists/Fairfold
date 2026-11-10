// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The records of processing register (UK GDPR Article 30), built from the
// classification map alone: no database, no tenant data, no audit event. It
// holds codes only; the privacy tool and the DPIA inputs word them for people.

import {
  ARTICLE_9_CONDITIONS,
  classification,
  DATA_CATEGORIES,
  DATA_SUBJECTS,
  LEGAL_BASES,
  processing,
  PROCESSING_PURPOSES,
  PROCESSOR_ROLES,
  SENSITIVITIES,
  subjectPaths,
  type Article9Condition,
  type ClassificationRegistry,
  type DataCategory,
  type DataSubject,
  type FieldClassification,
  type LegalBasis,
  type ProcessingMap,
  type ProcessingPurpose,
  type ProcessorRole,
  type RetentionRule,
  type Sensitivity,
  type SubjectPath,
  type SubjectPathRegistry,
} from '../classification.ts';

export interface RegisterColumn {
  readonly column: string;
  readonly sensitivity: Sensitivity;
  readonly retention: RetentionRule;
  /** Classified per field, so `sensitivity` is the most any value can be. */
  readonly perField: boolean;
}

export interface RegisterEntry {
  readonly table: string;
  readonly purpose: ProcessingPurpose;
  readonly legalBasis: LegalBasis;
  readonly article9Condition: Article9Condition | null;
  readonly processors: readonly ProcessorRole[];
  readonly dataSubjects: readonly DataSubject[];
  readonly dataCategories: readonly DataCategory[];
  readonly highestSensitivity: Sensitivity;
  readonly columns: readonly RegisterColumn[];
  readonly subjectPath: SubjectPath | null;
}

export interface RegisterPurpose {
  readonly purpose: ProcessingPurpose;
  readonly legalBases: readonly LegalBasis[];
  readonly article9Conditions: readonly Article9Condition[];
  readonly processors: readonly ProcessorRole[];
  readonly dataSubjects: readonly DataSubject[];
  readonly dataCategories: readonly DataCategory[];
  readonly highestSensitivity: Sensitivity;
  readonly tables: readonly RegisterEntry[];
}

const rank = (sensitivity: Sensitivity) => SENSITIVITIES.indexOf(sensitivity);
const higher = (a: Sensitivity, b: Sensitivity) => (rank(a) >= rank(b) ? a : b);
const isPersonal = ({ sensitivity }: FieldClassification) => rank(sensitivity) >= rank('personal');
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Every way the map's processing entries break the rules, each naming its table. */
export function processingProblems(
  registry: ClassificationRegistry = classification,
  entries: ProcessingMap = processing,
  paths: SubjectPathRegistry = subjectPaths,
): string[] {
  const problems: string[] = [];
  for (const table of Object.keys(registry)) {
    if (!Object.hasOwn(entries, table)) problems.push(`${table} has no processing entry.`);
  }
  for (const [table, entry] of Object.entries(entries)) {
    const fields = Object.hasOwn(registry, table) ? Object.values(registry[table] ?? {}) : [];
    if (fields.length === 0) {
      problems.push(`${table} has a processing entry but no columns.`);
      continue;
    }
    const unknown = (list: readonly string[], allowed: readonly string[], name: string) => {
      for (const code of list) {
        if (!allowed.includes(code)) problems.push(`${table}: ${code} is not a ${name} code.`);
      }
    };
    unknown([entry.purpose], PROCESSING_PURPOSES, 'purpose');
    unknown([entry.legalBasis], LEGAL_BASES, 'legal basis');
    unknown(
      entry.article9Condition ? [entry.article9Condition] : [],
      ARTICLE_9_CONDITIONS,
      'Article 9 condition',
    );
    unknown(entry.processors, PROCESSOR_ROLES, 'processor role');
    unknown(entry.dataSubjects, DATA_SUBJECTS, 'data subject');
    unknown(entry.dataCategories, DATA_CATEGORIES, 'data category');
    if (entry.processors.length === 0) problems.push(`${table} names no processor role.`);

    const special = fields.some(({ sensitivity }) => sensitivity === 'special_category');
    if (special && !entry.article9Condition) {
      problems.push(`${table} has a special category column but no Article 9 condition.`);
    }
    if (!special && entry.article9Condition) {
      problems.push(`${table} has an Article 9 condition but no special category column.`);
    }

    const stated = entry.dataSubjects.length > 0 || entry.dataCategories.length > 0;
    if (fields.some(isPersonal)) {
      if (entry.dataSubjects.length === 0) problems.push(`${table} lists no data subject.`);
      if (entry.dataCategories.length === 0) problems.push(`${table} lists no data category.`);
    } else if (stated && (paths[table] === undefined || paths[table].kind === 'unlinked')) {
      problems.push(`${table} has no personal data and no path to a party, so must state none.`);
    }
  }
  return problems;
}

/**
 * The register: one entry per table, in schema, table and column order. It
 * throws if the map breaks the rules in `processingProblems`.
 */
export function recordsOfProcessing(
  registry: ClassificationRegistry = classification,
  entries: ProcessingMap = processing,
  paths: SubjectPathRegistry = subjectPaths,
): RegisterEntry[] {
  const problems = processingProblems(registry, entries, paths);
  if (problems.length > 0) throw new Error(problems.join('\n'));
  return Object.keys(registry)
    .sort(compare)
    .map((table) => {
      const entry = entries[table] as ProcessingMap[string];
      const columns = Object.entries(registry[table] ?? {})
        .sort(([a], [b]) => compare(a, b))
        .map(([column, { sensitivity, retention, perField }]) => ({
          column,
          sensitivity,
          retention,
          perField: perField !== undefined,
        }));
      return {
        table,
        purpose: entry.purpose,
        legalBasis: entry.legalBasis,
        article9Condition: entry.article9Condition ?? null,
        processors: entry.processors,
        dataSubjects: entry.dataSubjects,
        dataCategories: entry.dataCategories,
        highestSensitivity: columns
          .map(({ sensitivity }) => sensitivity)
          .reduce<Sensitivity>(higher, 'public'),
        columns,
        subjectPath: paths[table] ?? null,
      };
    });
}

/** The register grouped by purpose, in purpose order, as Article 30 sets it out. */
export function recordsByPurpose(
  register: readonly RegisterEntry[] = recordsOfProcessing(),
): RegisterPurpose[] {
  const merged = <T extends string>(lists: readonly (readonly T[])[]): T[] =>
    [...new Set(lists.flat())].sort(compare);
  return PROCESSING_PURPOSES.flatMap((purpose) => {
    const tables = register.filter((entry) => entry.purpose === purpose);
    if (tables.length === 0) return [];
    return [
      {
        purpose,
        legalBases: merged(tables.map((entry) => [entry.legalBasis])),
        article9Conditions: merged(
          tables.map((entry) => (entry.article9Condition ? [entry.article9Condition] : [])),
        ),
        processors: merged(tables.map((entry) => entry.processors)),
        dataSubjects: merged(tables.map((entry) => entry.dataSubjects)),
        dataCategories: merged(tables.map((entry) => entry.dataCategories)),
        highestSensitivity: tables
          .map((entry) => entry.highestSensitivity)
          .reduce<Sensitivity>(higher, 'public'),
        tables,
      },
    ];
  });
}
