// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The websites a tenant allows to frame its embeds (ADR 0035). Adding or
// removing one writes a `platform.embed_origins` configuration version and
// `platform.embed_origin.added` or `.removed` in the same transaction. An
// origin already listed, or a 21st, answers 409; the database's unique key
// and its limit trigger decide, so two requests cannot both pass.

import type { AppEmbedOrigin } from '@pixel-scientists/db/generated/app';
import type {
  addEmbedOrigin,
  listEmbedOrigins,
  removeEmbedOrigin,
} from '@pixel-scientists/domain/platform/settings';

import type { TenantTransaction } from '../../../database.ts';
import { ApiError } from '../../../problems.ts';
import type { Handler } from '../../../routes/register.ts';

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

const originsOf = (tx: TenantTransaction) =>
  tx.$extendTables<{ 'app.embed_origin': AppEmbedOrigin }>();

const toRow = (row: { id: string; origin: string; created_at: Date }) => ({
  id: row.id,
  origin: row.origin,
  createdAt: row.created_at.toISOString(),
});

const refuse = (detail: string, cause: unknown, reason: string): Error =>
  new ApiError(409, detail, { reason, cause });

export const listEmbedOriginsHandler: Handler<typeof listEmbedOrigins> = async ({ tx }) => {
  const rows = await originsOf(tx)
    .selectFrom('app.embed_origin')
    .select(['id', 'origin', 'created_at'])
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  return { origins: rows.map(toRow) };
};

export const addEmbedOriginHandler: Handler<typeof addEmbedOrigin> = async ({
  tx,
  context,
  input,
}) => {
  const { origin } = input.body;
  let row;
  try {
    row = await originsOf(tx)
      .insertInto('app.embed_origin')
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        origin,
        created_by: context.membership.id,
      }))
      .returning(['id', 'origin', 'created_at'])
      .executeTakeFirstOrThrow();
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === UNIQUE_VIOLATION) {
      throw refuse('That website is already on the list.', error, 'embed_origin_listed');
    }
    if (code === CHECK_VIOLATION) {
      throw refuse(
        'The list holds up to 20 websites. Remove one before you add another.',
        error,
        'embed_origin_limit',
      );
    }
    throw error;
  }
  await context.config.record('platform.embed_origins', row.id, [
    { field: 'origin', from: null, to: origin },
  ]);
  await context.audit.record({
    action: 'platform.embed_origin.added',
    entityId: row.id,
    changes: { 'app.embed_origin.origin': { after: origin } },
  });
  return toRow(row);
};

export const removeEmbedOriginHandler: Handler<typeof removeEmbedOrigin> = async ({
  tx,
  context,
  input,
}) => {
  const removed = await originsOf(tx)
    .deleteFrom('app.embed_origin')
    .where('id', '=', input.params.originId)
    .returning(['id', 'origin'])
    .executeTakeFirst();
  if (removed === undefined) throw new ApiError(404, undefined, { reason: 'not_found' });
  await context.config.record('platform.embed_origins', removed.id, [
    { field: 'origin', from: removed.origin, to: null },
  ]);
  await context.audit.record({
    action: 'platform.embed_origin.removed',
    entityId: removed.id,
    changes: { 'app.embed_origin.origin': { before: removed.origin } },
  });
};
