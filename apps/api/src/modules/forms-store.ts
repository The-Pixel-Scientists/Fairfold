// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The forms staff routes' store (ADR 0016): the module's reads and writes as
// SQL on the request's transaction. Row-level security keeps every statement
// inside the caller's tenant, so a form, draft or version of another tenant
// is simply not there. Inserts take `tenant_id` from `app.current_tenant_id()`,
// the transaction's own tenant, never from a value. The database sets ids and
// times, and holds a published version fixed: its UPDATE and DELETE policies
// match drafts only.

import type { DB, FormsFormVersion } from '@pixel-scientists/db/generated/forms';
import type { ExpressionBuilder } from '@pixel-scientists/db';
import type { FormDefinition } from '@pixel-scientists/domain/forms';
import type { DraftRow, FormRow, StaffStore, VersionRow } from '@pixel-scientists/forms/server';
import type { Respondents } from '@pixel-scientists/forms/contracts';

import type { TenantTransaction } from '../database.ts';

/** A jsonb column, which pg reads as a value and takes as text. */
type Json = {
  readonly __select__: unknown;
  readonly __insert__: string | null;
  readonly __update__: string | null;
};

type FormsTables = Omit<DB, 'forms.form_version'> & {
  'forms.form_version': Omit<FormsFormVersion, 'definition'> & { definition: Json };
  'app.config_version': { id: string; entity_type: string; entity_id: string; version: number };
};

type Db = ReturnType<typeof formsDb>;

const formsDb = (tx: TenantTransaction) => tx.$extendTables<FormsTables>();

const FORM_COLUMNS = [
  'id',
  'title',
  'description',
  'respondents',
  'opens_at',
  'closes_at',
  'retention_months',
  'confirmation_message',
  'created_at',
  'updated_at',
] as const;

type Stored = Awaited<ReturnType<ReturnType<typeof selectForms>['execute']>>[number];

const selectForms = (db: Db) => db.selectFrom('forms.form').select(FORM_COLUMNS);

/** The form's number of its latest published version, by form id. */
async function latestVersions(
  db: Db,
  formIds: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  if (formIds.length === 0) return new Map();
  const rows = await db
    .selectFrom('forms.form_version')
    .select(['form_id', (eb) => eb.fn.max<number>('version').as('latest')])
    .where('form_id', 'in', formIds)
    .where('status', '=', 'published')
    .groupBy('form_id')
    .execute();
  return new Map(rows.map((row) => [row.form_id, row.latest]));
}

async function toForms(db: Db, rows: readonly Stored[]): Promise<FormRow[]> {
  const latest = await latestVersions(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    respondents: row.respondents as Respondents,
    opensAt: row.opens_at,
    closesAt: row.closes_at,
    retentionMonths: row.retention_months,
    confirmationMessage: row.confirmation_message,
    latestVersion: latest.get(row.id) ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

const asDraft = (row: {
  id: string;
  version: number;
  definition: unknown;
  updated_at: Date;
}): DraftRow => ({
  id: row.id,
  version: row.version,
  definition: row.definition,
  updatedAt: row.updated_at,
});

const text = (definition: FormDefinition | null): string | null =>
  definition === null ? null : JSON.stringify(definition);

export function formsStore(tx: TenantTransaction): StaffStore {
  const db = formsDb(tx);
  const tenant = <T extends keyof FormsTables>(eb: ExpressionBuilder<FormsTables, T>) =>
    eb.fn<string>('app.current_tenant_id', []);

  /** Whether the form has a published version, as a condition on the form. */
  const published = (eb: ExpressionBuilder<FormsTables, 'forms.form'>) =>
    eb.exists(
      eb
        .selectFrom('forms.form_version as v')
        .select('v.id')
        .whereRef('v.form_id', '=', 'forms.form.id')
        .where('v.status', '=', 'published'),
    );

  /** `updated_at` to the millisecond a cursor holds, so a page boundary never repeats or skips a form. */
  const changed = (eb: ExpressionBuilder<FormsTables, 'forms.form'>) =>
    eb.fn<Date>('date_trunc', [eb.val('milliseconds'), eb.ref('updated_at')]);

  return {
    async list({ status, after, limit }) {
      let query = selectForms(db);
      if (status !== undefined) {
        query = query.where((eb) =>
          status === 'published' ? published(eb) : eb.not(published(eb)),
        );
      }
      if (after !== null) {
        query = query.where((eb) =>
          eb.or([
            eb(changed(eb), '<', after.updatedAt),
            eb.and([eb(changed(eb), '=', after.updatedAt), eb('id', '<', after.id)]),
          ]),
        );
      }
      const rows = await query
        .orderBy((eb) => changed(eb), 'desc')
        .orderBy('id', 'desc')
        .limit(limit)
        .execute();
      return toForms(db, rows);
    },

    async find(formId, lock = false) {
      const query = selectForms(db).where('id', '=', formId);
      const [row] = await toForms(db, await (lock ? query.forUpdate() : query).execute());
      return row;
    },

    async insert(settings, definition, actor) {
      const { id } = await db
        .insertInto('forms.form')
        .values((eb) => ({
          tenant_id: tenant(eb),
          title: settings.title,
          description: settings.description === '' ? null : settings.description,
          respondents: settings.respondents,
          opens_at: settings.opensAt,
          closes_at: settings.closesAt,
          confirmation_message: settings.confirmationMessage,
          created_by: actor,
          updated_by: actor,
        }))
        .returning('id')
        .executeTakeFirstOrThrow();
      await db
        .insertInto('forms.form_version')
        .values((eb) => ({
          tenant_id: tenant(eb),
          form_id: id,
          version: 1,
          definition: text(definition),
          created_by: actor,
          updated_by: actor,
        }))
        .execute();
      return id;
    },

    async updateSettings(formId, settings, actor) {
      await db
        .updateTable('forms.form')
        .set({
          title: settings.title,
          description: settings.description === '' ? null : settings.description,
          respondents: settings.respondents,
          opens_at: settings.opensAt,
          closes_at: settings.closesAt,
          confirmation_message: settings.confirmationMessage,
          updated_by: actor,
        })
        .where('id', '=', formId)
        .executeTakeFirstOrThrow();
    },

    async updateRetention(formId, months, actor) {
      await db
        .updateTable('forms.form')
        .set({ retention_months: months, updated_by: actor })
        .where('id', '=', formId)
        .executeTakeFirstOrThrow();
    },

    async draft(formId) {
      const row = await db
        .selectFrom('forms.form_version')
        .select(['id', 'version', 'definition', 'updated_at'])
        .where('form_id', '=', formId)
        .where('status', '=', 'draft')
        .executeTakeFirst();
      return row === undefined ? undefined : asDraft(row);
    },

    async insertDraft(formId, version, definition, actor) {
      return asDraft(
        await db
          .insertInto('forms.form_version')
          .values((eb) => ({
            tenant_id: tenant(eb),
            form_id: formId,
            version,
            definition: text(definition),
            created_by: actor,
            updated_by: actor,
          }))
          .returning(['id', 'version', 'definition', 'updated_at'])
          .executeTakeFirstOrThrow(),
      );
    },

    async saveDraft(draftId, definition, actor) {
      return asDraft(
        await db
          .updateTable('forms.form_version')
          .set({ definition: text(definition), updated_by: actor })
          .where('id', '=', draftId)
          .returning(['id', 'version', 'definition', 'updated_at'])
          .executeTakeFirstOrThrow(),
      );
    },

    async published(formId) {
      const rows = await db
        .selectFrom('forms.form_version')
        .select(['respondents', 'definition'])
        .where('form_id', '=', formId)
        .where('status', '=', 'published')
        .orderBy('version')
        .execute();
      return rows.map((row) => ({
        respondents: row.respondents as Respondents,
        definition: row.definition,
      }));
    },

    async versions(formId) {
      const rows = await db
        .selectFrom('forms.form_version')
        .select(['id', 'form_id', 'version', 'respondents', 'published_at'])
        .where('form_id', '=', formId)
        .where('status', '=', 'published')
        .orderBy('version', 'desc')
        .execute();
      return rows.map((row) => ({
        id: row.id,
        formId: row.form_id,
        version: row.version,
        respondents: row.respondents as Respondents,
        publishedAt: row.published_at as Date,
      }));
    },

    async version(formId, versionId): Promise<VersionRow | undefined> {
      const row = await db
        .selectFrom('forms.form_version')
        .select(['id', 'form_id', 'version', 'respondents', 'definition', 'published_at'])
        .where('id', '=', versionId)
        .where('form_id', '=', formId)
        .where('status', '=', 'published')
        .executeTakeFirst();
      return row === undefined
        ? undefined
        : {
            id: row.id,
            formId: row.form_id,
            version: row.version,
            respondents: row.respondents as Respondents,
            definition: row.definition,
            publishedAt: row.published_at as Date,
          };
    },

    async latestConfigVersion(formId) {
      const { id } = await db
        .selectFrom('app.config_version')
        .select('id')
        .where('entity_type', '=', 'forms.form')
        .where('entity_id', '=', formId)
        .orderBy('version', 'desc')
        .limit(1)
        .executeTakeFirstOrThrow();
      return id;
    },

    async publish(draftId, definition, configVersionId, actor) {
      await db
        .updateTable('forms.form_version')
        .set({
          status: 'published',
          definition: text(definition),
          published_by: actor,
          config_version_id: configVersionId,
          updated_by: actor,
        })
        .where('id', '=', draftId)
        .where('status', '=', 'draft')
        .returning('id')
        .executeTakeFirstOrThrow();
    },
  };
}
