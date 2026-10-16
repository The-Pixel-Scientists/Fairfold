// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Better Auth's database adapter, over the app_auth connection and the
// auth schema (ADR 0010). It differs from a plain adapter in three ways:
//
//   - A session token is stored, and looked up, only as its SHA-256 hash.
//     The new session Better Auth gets back carries the token it issued;
//     every session read from the database carries none.
//   - created_at and updated_at are the database's, so they are never
//     written; app_auth has no grant on them.
//   - An empty IP address, which Better Auth uses for "unknown", is left
//     out, since the column is inet.

import type { ExpressionBuilder, Kysely } from '@pixel-scientists/db';
import { createAdapterFactory, type CleanedWhere, type DBAdapter } from 'better-auth/adapters';
import type { BetterAuthOptions } from 'better-auth';

import { hashToken } from './cookies.ts';

type Row = Record<string, unknown>;
type Tables = Record<string, Row>;
type Store = Kysely<Tables>;
type Builder = ExpressionBuilder<Tables, string>;

const SET_BY_DATABASE = new Set(['created_at', 'updated_at']);

/** A LIKE pattern that matches `value` literally. */
function literal(value: unknown): string {
  return String(value).replace(/[\\%_]/g, '\\$&');
}

function condition(eb: Builder, table: string, where: CleanedWhere) {
  const column = `${table}.${where.field}`;
  const { value } = where;
  const insensitive = where.mode === 'insensitive' && typeof value === 'string';
  const ref = insensitive ? eb.fn<string>('lower', [eb.ref(column)]) : eb.ref(column);
  const compared = insensitive ? value.toLowerCase() : value;
  const like = insensitive ? 'ilike' : 'like';
  switch (where.operator) {
    case 'eq':
      return value === null ? eb(column, 'is', null) : eb(ref, '=', compared);
    case 'ne':
      return value === null ? eb(column, 'is not', null) : eb(ref, '<>', compared);
    case 'lt':
      return eb(column, '<', value);
    case 'lte':
      return eb(column, '<=', value);
    case 'gt':
      return eb(column, '>', value);
    case 'gte':
      return eb(column, '>=', value);
    case 'in':
      return eb(column, 'in', [value].flat());
    case 'not_in':
      return eb(column, 'not in', [value].flat());
    case 'contains':
      return eb(column, like, `%${literal(value)}%`);
    case 'starts_with':
      return eb(column, like, `${literal(value)}%`);
    case 'ends_with':
      return eb(column, like, `%${literal(value)}`);
  }
}

/** Better Auth's rule: every AND condition, and at least one OR condition if there are any. */
function matching(table: string, where: readonly CleanedWhere[] = []) {
  return (eb: Builder) => {
    const all = where.filter((w) => w.connector === 'AND').map((w) => condition(eb, table, w));
    const any = where.filter((w) => w.connector === 'OR').map((w) => condition(eb, table, w));
    return eb.and(any.length > 0 ? [...all, eb.or(any)] : all);
  };
}

/** The adapter, for `database` in Better Auth's options. `db` connects as app_auth. */
export function authAdapter(db: Kysely<unknown>) {
  const store = db.withSchema('auth') as unknown as Store;
  const factory = createAdapterFactory({
    config: {
      adapterId: 'tps-auth',
      adapterName: 'Auth schema adapter',
      supportsUUIDs: true,
      supportsJSON: true,
      disableIdGeneration: true,
      customTransformInput: ({ data, field, model, action }) => {
        const writing = action === 'create' || action === 'update' || action === 'updateMany';
        if (writing && SET_BY_DATABASE.has(field)) return undefined;
        if (model === 'session' && field === 'ip_address' && data === '') return undefined;
        if (model === 'session' && field === 'token_hash' && typeof data === 'string') {
          return hashToken(data);
        }
        return data as unknown;
      },
      customTransformOutput: ({ data, field, model }) =>
        model === 'session' && field === 'token' ? undefined : (data as unknown),
    },
    adapter: () => ({
      create: async ({ model, data }) =>
        (await store
          .insertInto(model)
          .values(data)
          .returningAll()
          .executeTakeFirstOrThrow()) as never,
      findOne: async ({ model, where }) =>
        ((await store
          .selectFrom(model)
          .selectAll()
          .where(matching(model, where))
          .limit(1)
          .executeTakeFirst()) ?? null) as never,
      findMany: async ({ model, where, limit, sortBy, offset }) => {
        let query = store.selectFrom(model).selectAll().where(matching(model, where)).limit(limit);
        if (sortBy) query = query.orderBy(`${model}.${sortBy.field}`, sortBy.direction);
        if (offset) query = query.offset(offset);
        return (await query.execute()) as never;
      },
      update: async ({ model, where, update }) =>
        ((await store
          .updateTable(model)
          .set(update as Row)
          .where(matching(model, where))
          .returningAll()
          .executeTakeFirst()) ?? null) as never,
      updateMany: async ({ model, where, update }) => {
        const result = await store
          .updateTable(model)
          .set(update)
          .where(matching(model, where))
          .executeTakeFirst();
        return Number(result.numUpdatedRows);
      },
      delete: async ({ model, where }) => {
        await store.deleteFrom(model).where(matching(model, where)).execute();
      },
      deleteMany: async ({ model, where }) => {
        const result = await store
          .deleteFrom(model)
          .where(matching(model, where))
          .executeTakeFirst();
        return Number(result.numDeletedRows);
      },
      count: async ({ model, where }) => {
        const row = await store
          .selectFrom(model)
          .select((eb) => eb.fn.countAll<string>().as('count'))
          .where(matching(model, where))
          .executeTakeFirstOrThrow();
        return Number(row.count);
      },
    }),
  });

  return (options: BetterAuthOptions): DBAdapter => {
    const adapter = factory(options);
    return {
      ...adapter,
      // The new session's token, for its cookie, which the database never sees.
      create: async (args) => {
        const created = await adapter.create(args);
        return (
          args.model === 'session' ? { ...(created as Row), token: args.data['token'] } : created
        ) as never;
      },
    };
  };
}
