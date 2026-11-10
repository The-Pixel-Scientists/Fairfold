// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The field classification map (architecture rule 5). Every column of every
// table in an application schema is registered here with a sensitivity level
// and a retention rule. Export, subject access requests, erasure and the
// warehouse feed read it. Beside the columns, each table records the path
// from its rows to the party they are about (ADR 0027) and why it is processed
// (UK GDPR Article 30). The schema-lint test (packages/db/test) fails if a
// column is missing from the map, the map names a column that does not exist,
// or a path is missing or broken; records-of-processing.test.ts fails if a
// table's processing entry is missing or wrong.

import * as appFile from './classification/app.ts';
import * as assureFile from './classification/assure.ts';
import * as authFile from './classification/auth.ts';
import * as crmFile from './classification/crm.ts';
import * as formsFile from './classification/forms.ts';
import * as grantsFile from './classification/grants.ts';
import * as insightFile from './classification/insight.ts';
import * as partyFile from './classification/party.ts';
import * as pgbossFile from './classification/pgboss.ts';
import * as privacyFile from './classification/privacy.ts';

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
 * - `parties`: the row is about two parties, each column holding a party id
 *   as for `party`. A reader follows both.
 * - `join`: the column is a foreign key to `table`, whose path continues.
 * - `account`: the column holds an `auth.user` id, which reaches a person in
 *   a tenant through `party.person.user_id`.
 * - `unlinked`: the personal values belong to no known subject, for `reason`.
 *   Every column is kept for a fixed 12 months or less.
 */
export type SubjectPath =
  | { readonly kind: 'party' | 'account'; readonly column: string }
  | { readonly kind: 'parties'; readonly columns: readonly [string, string] }
  | { readonly kind: 'join'; readonly column: string; readonly table: string }
  | { readonly kind: 'unlinked'; readonly reason: string };

/** Each table's subject path: `{ 'schema.table': path }`. */
export type SubjectPathRegistry = Readonly<Record<string, SubjectPath>>;

/** Why a table exists (UK GDPR Article 30(1)(b)). */
export const PROCESSING_PURPOSES = [
  'account_security',
  'tenant_administration',
  'party_records',
  'programme_administration',
  'grant_applications',
  'assessment',
  'decisions',
  'file_storage',
  'audit',
  'background_jobs',
  'service_reliability',
] as const;
export type ProcessingPurpose = (typeof PROCESSING_PURPOSES)[number];

/** UK GDPR Article 6(1). */
export const LEGAL_BASES = [
  'consent',
  'contract',
  'legal_obligation',
  'vital_interests',
  'public_task',
  'legitimate_interests',
] as const;
export type LegalBasis = (typeof LEGAL_BASES)[number];

/** UK GDPR Article 9(2). */
export const ARTICLE_9_CONDITIONS = [
  'explicit_consent',
  'employment_and_social_protection',
  'vital_interests',
  'not_for_profit_body',
  'made_public_by_subject',
  'legal_claims',
  'substantial_public_interest',
  'health_and_social_care',
  'public_health',
  'archiving_research_statistics',
] as const;
export type Article9Condition = (typeof ARTICLE_9_CONDITIONS)[number];

/**
 * What a processor does, never who it is (rule 1, ADR 0012): each deployment
 * maps these roles to its own providers.
 */
export const PROCESSOR_ROLES = ['hosting', 'backup', 'email', 'malware_scanning'] as const;
export type ProcessorRole = (typeof PROCESSOR_ROLES)[number];

/** `visitor` is anyone whose request or sign-in attempt reaches the service, known or not. */
export const DATA_SUBJECTS = [
  'applicant',
  'applicant_contact',
  'staff_member',
  'reviewer',
  'visitor',
] as const;
export type DataSubject = (typeof DATA_SUBJECTS)[number];

export const DATA_CATEGORIES = ['identity', 'contact', 'online_identifiers', 'other'] as const;
export type DataCategory = (typeof DATA_CATEGORIES)[number];

/**
 * Why a table is processed and by whom (UK GDPR Article 30). A table's
 * `article9Condition` is present when, and only when, a column is special
 * category, or has a special category ceiling when classified per field.
 * The categories list who and what the rows are about: a table with no
 * personal or special category column and no path to a party states none.
 * Every legal basis and condition is a proposal for the solicitor to confirm.
 */
export interface ProcessingEntry {
  readonly purpose: ProcessingPurpose;
  readonly legalBasis: LegalBasis;
  readonly article9Condition?: Article9Condition;
  readonly processors: readonly ProcessorRole[];
  readonly dataSubjects: readonly DataSubject[];
  readonly dataCategories: readonly DataCategory[];
}

/** A processing entry per table, merged across schemas. */
export type ProcessingMap = Readonly<Record<string, ProcessingEntry>>;

/**
 * One processing entry for every table of `Tables`, or a compile error. A
 * schema file declares its tables with `satisfies ClassificationRegistry`, so
 * `keyof` names them, and exports `<schema>Processing` beside them. A file
 * typed plainly as `ClassificationRegistry` names no tables, so this is
 * `never` for it.
 */
export type ProcessingRegistry<Tables extends ClassificationRegistry> = string extends keyof Tables
  ? never
  : { readonly [Table in keyof Tables]: ProcessingEntry };

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

export const classification: ClassificationRegistry = mergeSchemaMaps<
  Readonly<Record<string, FieldClassification>>
>({
  app: appFile.app,
  auth: authFile.auth,
  party: partyFile.party,
  grants: grantsFile.grants,
  pgboss: pgbossFile.pgboss,
  crm: crmFile.crm,
  assure: assureFile.assure,
  forms: formsFile.forms,
  privacy: privacyFile.privacy,
  insight: insightFile.insight,
});

export const subjectPaths: SubjectPathRegistry = mergeSchemaMaps({
  app: appFile.appSubjects,
  auth: authFile.authSubjects,
  party: partyFile.partySubjects,
  grants: grantsFile.grantsSubjects,
});

/** A schema file's `<schema>Processing` export, which a file with no tables yet does not have. */
export function fileProcessing(
  schema: string,
  file: Readonly<Record<string, unknown>>,
): ProcessingMap {
  return (file[`${schema}Processing`] as ProcessingMap | undefined) ?? {};
}

const schemaFiles: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  app: appFile,
  auth: authFile,
  party: partyFile,
  grants: grantsFile,
  pgboss: pgbossFile,
  crm: crmFile,
  assure: assureFile,
  forms: formsFile,
  privacy: privacyFile,
  insight: insightFile,
};

export const processing: ProcessingMap = mergeSchemaMaps(
  Object.fromEntries(
    Object.entries(schemaFiles).map(([schema, file]) => [schema, fileProcessing(schema, file)]),
  ),
);
