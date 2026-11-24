// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The forms response routes' store (ADR 0016): the module's reads and writes
// as SQL on the request's transaction. Row-level security keeps every
// statement inside the caller's tenant, so a response, form or version of
// another tenant is simply not there. Inserts take `tenant_id` from
// `app.current_tenant_id()`, never from a value. The database sets ids and
// times, keeps a submitted response pinned, and refuses a staff write to
// anything but the spam mark. Only submitted responses are read for staff;
// a person's reads are bound to their own person id.

import type { ExpressionBuilder } from '@pixel-scientists/db';
import type { DB, FormsResponse } from '@pixel-scientists/db/generated/forms';
import type {
  After,
  DetailRow,
  Filters,
  OwnSummary,
  ResponseStore,
  SummaryRow,
} from '@pixel-scientists/forms/server';
import type { ResponseRoute, SpamReason } from '@pixel-scientists/forms/contracts';
import { personIdForUser } from '@pixel-scientists/party/server';

import type { TenantTransaction } from '../database.ts';

/** A jsonb column, which pg reads as a value and takes as text. */
type Json = {
  readonly __select__: unknown;
  readonly __insert__: string;
  readonly __update__: string;
};

type Tables = Omit<DB, 'forms.response' | 'forms.form_version'> & {
  'forms.response': Omit<FormsResponse, 'answers'> & { answers: Json };
  'forms.form_version': Omit<DB['forms.form_version'], 'definition'> & { definition: unknown };
};

const db = (tx: TenantTransaction) => tx.$extendTables<Tables>();

type Db = ReturnType<typeof db>;

/** `submitted_at` to the millisecond a cursor holds, so a page boundary never repeats or skips a response. */
const submitted = (eb: ExpressionBuilder<Tables, 'forms.response'>) =>
  eb.fn<Date>('date_trunc', [eb.val('milliseconds'), eb.ref('forms.response.submitted_at')]);

/** The submitted responses of a form that match the filters. */
const matching = (d: Db, formId: string, filters: Filters) => {
  let query = d
    .selectFrom('forms.response')
    .where('forms.response.form_id', '=', formId)
    .where('forms.response.status', '=', 'submitted');
  if (filters.formVersionId !== undefined) {
    query = query.where('forms.response.form_version_id', '=', filters.formVersionId);
  }
  if (filters.submittedFrom !== undefined) {
    query = query.where('forms.response.submitted_at', '>=', filters.submittedFrom);
  }
  if (filters.submittedTo !== undefined) {
    query = query.where('forms.response.submitted_at', '<=', filters.submittedTo);
  }
  if (filters.route !== undefined) {
    query = query.where('forms.response.route', '=', filters.route);
  }
  return query;
};

const SUMMARY = [
  'forms.response.id as id',
  'forms.response.form_id as form_id',
  'forms.response.form_version_id as form_version_id',
  'forms.response.route as route',
  'forms.response.respondent_person_id as person_id',
  'forms.response.submitted_at as submitted_at',
  'forms.response.spam_reason as spam_reason',
] as const;

/** A response's summary, with its version's number and whether it was sent without the check. */
const summaries = (query: ReturnType<typeof matching>) =>
  query
    .innerJoin('forms.form_version as v', 'v.id', 'forms.response.form_version_id')
    .select(SUMMARY)
    .select((eb) => [
      'v.version as version',
      eb
        .and([
          eb('forms.response.route', '=', 'anonymous'),
          eb('forms.response.proof_hash', 'is', null),
        ])
        .as('without_check'),
    ]);

/** One submitted response with its version's definition and its answers as stored. */
const detail = (d: Db) =>
  summaries(d.selectFrom('forms.response').where('forms.response.status', '=', 'submitted')).select(
    ['v.definition as definition', 'forms.response.answers as answers'],
  );

type Stored = Awaited<ReturnType<ReturnType<typeof summaries>['execute']>>[number];

const toSummary = (row: Stored): SummaryRow => ({
  id: row.id,
  formId: row.form_id,
  formVersionId: row.form_version_id,
  version: row.version,
  route: row.route as ResponseRoute,
  personId: row.person_id,
  submittedAt: row.submitted_at as Date,
  sentWithoutCheck: Boolean(row.without_check),
  spamReason: row.spam_reason as SpamReason | null,
});

const toDetail = (row: Stored & { definition: unknown; answers: unknown }): DetailRow => ({
  ...toSummary(row),
  definition: row.definition,
  answers: row.answers,
});

const SIGNED_IN = ['signed_in', 'both'];

export function formsResponseStore(tx: TenantTransaction): ResponseStore {
  const d = db(tx);
  const tenant = <T extends keyof Tables>(eb: ExpressionBuilder<Tables, T>) =>
    eb.fn<string>('app.current_tenant_id', []);
  const now = <T extends keyof Tables>(eb: ExpressionBuilder<Tables, T>) => eb.fn<Date>('now', []);

  const after = (cursor: After | null) => (eb: ExpressionBuilder<Tables, 'forms.response'>) =>
    cursor === null
      ? eb.val(true)
      : eb.or([
          eb(submitted(eb), '<', cursor.submittedAt),
          eb.and([
            eb(submitted(eb), '=', cursor.submittedAt),
            eb('forms.response.id', '<', cursor.id),
          ]),
        ]);

  /** A person's submitted responses, with the form each answers. */
  const ownOf = (personId: string) =>
    d
      .selectFrom('forms.response')
      .innerJoin('forms.form as f', 'f.id', 'forms.response.form_id')
      .where('forms.response.respondent_person_id', '=', personId)
      .where('forms.response.status', '=', 'submitted');

  /** The titles of forms, by id. */
  const titles = async (formIds: readonly string[]) =>
    new Map(
      formIds.length === 0
        ? []
        : (
            await d
              .selectFrom('forms.form')
              .select(['id', 'title'])
              .where('id', 'in', formIds)
              .execute()
          ).map((form) => [form.id, form.title]),
    );

  async function readDraft(formId: string, personId: string) {
    const row = await d
      .selectFrom('forms.response')
      .innerJoin('forms.form_version as v', 'v.id', 'forms.response.form_version_id')
      .select([
        'forms.response.form_version_id as form_version_id',
        'v.definition as definition',
        'forms.response.answers as answers',
        'forms.response.updated_at as updated_at',
      ])
      .where('forms.response.form_id', '=', formId)
      .where('forms.response.respondent_person_id', '=', personId)
      .where('forms.response.status', '=', 'draft')
      .executeTakeFirst();
    return row === undefined
      ? undefined
      : {
          formVersionId: row.form_version_id,
          definition: row.definition,
          answers: row.answers,
          updatedAt: row.updated_at,
        };
  }

  return {
    async formExists(formId) {
      return (
        (await d
          .selectFrom('forms.form')
          .select('id')
          .where('id', '=', formId)
          .executeTakeFirst()) !== undefined
      );
    },

    async list(formId, view, filters, cursor, limit) {
      let query = summaries(matching(d, formId, filters)).where(after(cursor));
      query =
        view === 'spam'
          ? query.where('forms.response.spam_reason', 'is not', null)
          : query.where('forms.response.spam_reason', 'is', null);
      if (view === 'without_check') {
        query = query
          .where('forms.response.route', '=', 'anonymous')
          .where('forms.response.proof_hash', 'is', null);
      }
      const rows = await query
        .orderBy((eb) => submitted(eb), 'desc')
        .orderBy('forms.response.id', 'desc')
        .limit(limit)
        .execute();
      return rows.map(toSummary);
    },

    async totals(formId, filters) {
      const row = await matching(d, formId, filters)
        .select((eb) => [
          eb.fn
            .countAll<string>()
            .filterWhere('forms.response.spam_reason', 'is', null)
            .as('received'),
          eb.fn
            .countAll<string>()
            .filterWhere('forms.response.spam_reason', 'is', null)
            .filterWhere('forms.response.route', '=', 'signed_in')
            .as('signed_in'),
          eb.fn
            .countAll<string>()
            .filterWhere('forms.response.spam_reason', 'is', null)
            .filterWhere('forms.response.route', '=', 'anonymous')
            .as('anonymous'),
          eb.fn
            .countAll<string>()
            .filterWhere('forms.response.spam_reason', 'is', null)
            .filterWhere('forms.response.route', '=', 'anonymous')
            .filterWhere('forms.response.proof_hash', 'is', null)
            .as('without_check'),
          eb.fn
            .countAll<string>()
            .filterWhere('forms.response.spam_reason', 'is not', null)
            .as('spam'),
        ])
        .executeTakeFirstOrThrow();
      return {
        received: Number(row.received),
        signedIn: Number(row.signed_in),
        anonymous: Number(row.anonymous),
        sentWithoutCheck: Number(row.without_check),
        spam: Number(row.spam),
      };
    },

    async find(responseId, lock = false) {
      if (lock) {
        await d
          .selectFrom('forms.response')
          .select('id')
          .where('id', '=', responseId)
          .forUpdate()
          .execute();
      }
      const row = await detail(d).where('forms.response.id', '=', responseId).executeTakeFirst();
      return row === undefined ? undefined : toDetail(row);
    },

    async findByToken(tokenHash) {
      const row = await detail(d)
        .innerJoin('forms.respondent_token as t', 't.response_id', 'forms.response.id')
        .where('t.token_hash', '=', tokenHash)
        .where('t.revoked_at', 'is', null)
        .where((eb) => eb('t.expires_at', '>', eb.fn<Date>('now', [])))
        .executeTakeFirst();
      return row === undefined ? undefined : toDetail(row);
    },

    async setSpam(responseId, reason, actor) {
      await d
        .updateTable('forms.response')
        .set({
          spam_reason: reason,
          spam_marked_by: reason === null ? null : actor,
          updated_by: actor,
        })
        .where('id', '=', responseId)
        .where('status', '=', 'submitted')
        .executeTakeFirstOrThrow();
    },

    personFor: (userId) => personIdForUser(tx, userId),

    async openForm(formId) {
      const form = await d
        .selectFrom('forms.form')
        .select(['id', 'title', 'description', 'closes_at', 'confirmation_message'])
        .where('id', '=', formId)
        .where('respondents', 'in', SIGNED_IN)
        .where('archived_at', 'is', null)
        .where((eb) => eb.or([eb('opens_at', 'is', null), eb('opens_at', '<=', now(eb))]))
        .where((eb) => eb.or([eb('closes_at', 'is', null), eb('closes_at', '>', now(eb))]))
        .executeTakeFirst();
      if (form === undefined) return undefined;
      const version = await d
        .selectFrom('forms.form_version')
        .select(['id', 'respondents', 'definition'])
        .where('form_id', '=', formId)
        .where('status', '=', 'published')
        .orderBy('version', 'desc')
        .limit(1)
        .executeTakeFirst();
      if (version === undefined || !SIGNED_IN.includes(version.respondents ?? '')) return undefined;
      return {
        id: form.id,
        title: form.title,
        description: form.description,
        closesAt: form.closes_at,
        confirmationMessage: form.confirmation_message,
        formVersionId: version.id,
        definition: version.definition,
      };
    },

    async signedInVersion(formId, versionId) {
      return d
        .selectFrom('forms.form_version')
        .select(['id', 'definition'])
        .where('id', '=', versionId)
        .where('form_id', '=', formId)
        .where('status', '=', 'published')
        .where('respondents', 'in', SIGNED_IN)
        .executeTakeFirst();
    },

    draft: readDraft,

    async saveDraft(formId, personId, versionId, answers, actor) {
      await d
        .insertInto('forms.response')
        .values((eb) => ({
          tenant_id: tenant(eb),
          form_id: formId,
          form_version_id: versionId,
          route: 'signed_in',
          respondent_person_id: personId,
          status: 'draft',
          answers: JSON.stringify(answers),
          created_by: actor,
          updated_by: actor,
        }))
        .onConflict((conflict) =>
          conflict
            .columns(['tenant_id', 'form_id', 'respondent_person_id'])
            .where('status', '=', 'draft')
            .doUpdateSet((eb) => ({
              form_version_id: eb.ref('excluded.form_version_id'),
              answers: eb.ref('excluded.answers'),
              updated_by: actor,
            })),
        )
        .execute();
      const saved = await readDraft(formId, personId);
      if (saved === undefined) throw new Error('A saved draft was not found.');
      return saved;
    },

    async submit(formId, personId, versionId, answers, actor) {
      const text = JSON.stringify(answers);
      const draft = await d
        .updateTable('forms.response')
        .set({ status: 'submitted', form_version_id: versionId, answers: text, updated_by: actor })
        .where('form_id', '=', formId)
        .where('respondent_person_id', '=', personId)
        .where('status', '=', 'draft')
        .returning('id')
        .executeTakeFirst();
      if (draft !== undefined) return draft.id;
      const { id } = await d
        .insertInto('forms.response')
        .values((eb) => ({
          tenant_id: tenant(eb),
          form_id: formId,
          form_version_id: versionId,
          route: 'signed_in',
          respondent_person_id: personId,
          status: 'submitted',
          answers: text,
          created_by: actor,
          updated_by: actor,
        }))
        .returning('id')
        .executeTakeFirstOrThrow();
      return id;
    },

    async receipt(responseId, personId) {
      const row = await ownOf(personId)
        .select([
          'forms.response.id as id',
          'forms.response.submitted_at as submitted_at',
          'f.confirmation_message as confirmation_message',
        ])
        .where('forms.response.id', '=', responseId)
        .executeTakeFirst();
      return row === undefined
        ? undefined
        : {
            responseId: row.id,
            submittedAt: row.submitted_at as Date,
            confirmationMessage: row.confirmation_message,
          };
    },

    async own(personId, cursor, limit) {
      const rows = await d
        .selectFrom('forms.response')
        .select([
          'forms.response.id as id',
          'forms.response.form_id as form_id',
          'forms.response.submitted_at as submitted_at',
        ])
        .where('forms.response.respondent_person_id', '=', personId)
        .where('forms.response.status', '=', 'submitted')
        .where(after(cursor))
        .orderBy((eb) => submitted(eb), 'desc')
        .orderBy('forms.response.id', 'desc')
        .limit(limit)
        .execute();
      const names = await titles(rows.map((row) => row.form_id));
      return rows.map((row): OwnSummary => ({
        id: row.id,
        formId: row.form_id,
        formTitle: names.get(row.form_id) ?? '',
        submittedAt: row.submitted_at as Date,
      }));
    },

    async ownOne(responseId, personId) {
      const row = await ownOf(personId)
        .innerJoin('forms.form_version as v', 'v.id', 'forms.response.form_version_id')
        .select([
          'forms.response.id as id',
          'forms.response.form_id as form_id',
          'f.title as title',
          'forms.response.submitted_at as submitted_at',
          'forms.response.form_version_id as form_version_id',
          'v.definition as definition',
          'forms.response.answers as answers',
        ])
        .where('forms.response.id', '=', responseId)
        .executeTakeFirst();
      return row === undefined
        ? undefined
        : {
            id: row.id,
            formId: row.form_id,
            formTitle: row.title,
            submittedAt: row.submitted_at as Date,
            formVersionId: row.form_version_id,
            definition: row.definition,
            answers: row.answers,
          };
    },
  };
}
