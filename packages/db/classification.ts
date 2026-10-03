// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The field classification map (architecture rule 5). Every column of every
// table in an application schema is registered here with a sensitivity level
// and a retention rule. Export, subject access requests, erasure and the
// warehouse feed read it. The schema-lint test (packages/db/test) fails if a
// column is missing from the map, or the map names a column that does not
// exist.

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
  | { readonly kind: 'tenant_lifetime' };

export interface FieldClassification {
  readonly sensitivity: Sensitivity;
  readonly retention: RetentionRule;
}

/** Columns by table: `{ 'schema.table': { column: classification } }`. */
export type ClassificationRegistry = Readonly<
  Record<string, Readonly<Record<string, FieldClassification>>>
>;

/** Empty until the first tables arrive. */
export const classification: ClassificationRegistry = {};
