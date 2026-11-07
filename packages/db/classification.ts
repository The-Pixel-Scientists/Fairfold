// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The field classification map (architecture rule 5). Every column of every
// table in an application schema is registered here with a sensitivity level
// and a retention rule. Export, subject access requests, erasure and the
// warehouse feed read it. Beside the columns, each table records the path
// from its rows to the party they are about (ADR 0027). The schema-lint test
// (packages/db/test) fails if a column is missing from the map, the map
// names a column that does not exist, or a path is missing or broken.

import { app, appSubjects } from './classification/app.ts';
import { auth, authSubjects } from './classification/auth.ts';
import { grants, grantsSubjects } from './classification/grants.ts';
import { party, partySubjects } from './classification/party.ts';
import { pgboss } from './classification/pgboss.ts';

/** How sensitive a field's values are, from least to most. */
export const SENSITIVITIES = ['public', 'internal', 'personal', 'special_category'] as const;

/**
 * - `public`: may be shown to anyone, such as an open programme's title.
 * - `internal`: the tenant's own working data that identifies no person,
 *   such as ids, statuses and settings.
 * - `personal`: personal data under UK GDPR, such as a name or an email
 *   address.
 * - `special_category`: special category data under UK GDPR Article 9, such
 *   as health or ethnicity.
 *
 * Audit events hold no personal or special category values at all, only ids,
 * codes and field ids (ADR 0003).
 */
export type Sensitivity = (typeof SENSITIVITIES)[number];

/** When a field's values are deleted. */
export type RetentionRule =
  /**
   * A fixed period: deleted `days` days after the time in the same row's
   * `from` column, such as 7 days after a job's completion.
   */
  | { readonly kind: 'fixed'; readonly days: number; readonly from: string }
  /**
   * A period each tenant sets under `policy` in its retention settings,
   * never shorter than `minimumDays`, which only a migration can lower.
   */
  | { readonly kind: 'tenant_policy'; readonly policy: string; readonly minimumDays: number }
  /** Kept while the tenant is a customer, and deleted when it leaves. */
  | { readonly kind: 'tenant_lifetime' }
  /** Kept while the person's account exists, and deleted with it. */
  | { readonly kind: 'account_lifetime' };

/**
 * A column of answers classified field by field (ADR 0027, "Form answers"):
 * each answer takes its question's class from the form version the row
 * pinned in `versionColumn`, whose definition is `definition.column` of
 * `definition.table`. Read the answers' classes only through
 * packages/db/src/classification-answers.ts.
 */
export interface PerFieldClassification {
  readonly versionColumn: string;
  readonly definition: { readonly table: string; readonly column: string };
}

export interface FieldClassification {
  /**
   * For a per-field column, the most sensitive any of its values can be, so
   * a reader that does not know per-field columns treats it at that level.
   */
  readonly sensitivity: Sensitivity;
  readonly retention: RetentionRule;
  readonly perField?: PerFieldClassification;
}

/** Columns by table: `{ 'schema.table': { column: classification } }`. */
export type ClassificationRegistry = Readonly<
  Record<string, Readonly<Record<string, FieldClassification>>>
>;

/**
 * The path from a table's row to the party it is about (ADR 0027, "Subject
 * paths"). Subject access, erasure and export follow it. The column may be
 * null on a row with no known subject.
 * - `party`: the column holds a party id: it is a party key itself, or
 *   references `party.party`, `party.person` or `party.organisation`.
 * - `join`: the column is a foreign key to `table`, whose path continues.
 * - `account`: the column holds an `auth.user` id, which reaches a person in
 *   a tenant through `party.person.user_id`.
 * - `unlinked`: the personal values belong to no known subject, for `reason`.
 *   Every column is kept for a fixed 12 months or less.
 */
export type SubjectPath =
  | { readonly kind: 'party' | 'account'; readonly column: string }
  | { readonly kind: 'join'; readonly column: string; readonly table: string }
  | { readonly kind: 'unlinked'; readonly reason: string };

/** Each table's subject path: `{ 'schema.table': path }`. */
export type SubjectPathRegistry = Readonly<Record<string, SubjectPath>>;

/**
 * Merge one map per schema, each from its own file in classification/ (ADR
 * 0016). A file may name only its own schema's tables, so no table is in two
 * maps.
 */
export function mergeSchemaMaps<T>(
  maps: Readonly<Record<string, Readonly<Record<string, T>>>>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(maps).flatMap(([schema, tables]) =>
      Object.entries(tables).map(([table, entry]) => {
        if (!table.startsWith(`${schema}.`)) {
          throw new Error(`classification/${schema}.ts names ${table}, outside its schema.`);
        }
        return [table, entry] as const;
      }),
    ),
  );
}

export const classification: ClassificationRegistry = mergeSchemaMaps({
  app,
  auth,
  party,
  grants,
  pgboss,
});

export const subjectPaths: SubjectPathRegistry = mergeSchemaMaps({
  app: appSubjects,
  auth: authSubjects,
  party: partySubjects,
  grants: grantsSubjects,
});
