// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The configuration version writer (architecture rule 10). Each change to a
// tenant's settings, theme or modules, or to a module's own configuration,
// appends the next `app.config_version` for its entity, in the request's
// transaction, with the acting membership as author. The table keeps its diff
// as an object, so the changes are stored under `changes`.

import {
  configDiffSchemas,
  type ConfigDiff,
  type ConfigEntityType,
} from '@pixel-scientists/domain/platform/settings';

import type { TenantTransaction } from '../database.ts';
import { ApiError } from '../problems.ts';

type ConfigTables = {
  'app.config_version': {
    tenant_id: string;
    entity_type: string;
    entity_id: string;
    version: number;
    author_id: string;
    diff: { __select__: unknown; __insert__: string; __update__: string };
    created_at: { __select__: Date; __insert__: Date | undefined; __update__: Date };
  };
  'app.membership': { tenant_id: string; id: string; user_id: string };
};

const UNIQUE_VIOLATION = '23505';

/**
 * Appends the entity's next version with `changes`, which the caller has
 * checked against the entity type's format. A module writes its own entity
 * types through this, after checking the diff against its contract.
 */
export async function insertConfigVersion(
  tx: TenantTransaction,
  authorId: string,
  entityType: string,
  entityId: string,
  changes: unknown,
): Promise<void> {
  const db = tx.$extendTables<ConfigTables>();
  const { latest } = await db
    .selectFrom('app.config_version')
    .select((eb) => eb.fn.max<number | null>('version').as('latest'))
    .where('entity_type', '=', entityType)
    .where('entity_id', '=', entityId)
    .executeTakeFirstOrThrow();

  try {
    await db
      .insertInto('app.config_version')
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        entity_type: entityType,
        entity_id: entityId,
        version: (latest ?? 0) + 1,
        author_id: authorId,
        diff: JSON.stringify({ changes }),
      }))
      .execute();
  } catch (error) {
    // Another request wrote this version first.
    if ((error as { code?: unknown }).code === UNIQUE_VIOLATION) {
      throw new ApiError(409, undefined, { reason: 'config_version_conflict', cause: error });
    }
    throw error;
  }
}

export async function recordConfigVersion<T extends ConfigEntityType>(
  tx: TenantTransaction,
  authorId: string,
  entityType: T,
  entityId: string,
  diff: ConfigDiff<T>,
): Promise<void> {
  const changes: unknown = configDiffSchemas[entityType].parse(diff);
  await insertConfigVersion(tx, authorId, entityType, entityId, changes);
}

export interface ConfigHistoryRow {
  readonly version: number;
  readonly createdAt: Date;
  /** The membership that made the change. */
  readonly authorId: string;
  /** The account that membership belongs to, for naming its person. */
  readonly authorUserId: string;
  /** The stored diff, as the writer saved it. */
  readonly diff: unknown;
}

/** An entity's versions, newest first, each with its author's account. */
export async function readConfigHistory(
  tx: TenantTransaction,
  entityType: string,
  entityId: string,
): Promise<ConfigHistoryRow[]> {
  const rows = await tx
    .$extendTables<ConfigTables>()
    .selectFrom('app.config_version as v')
    .innerJoin('app.membership as m', (join) =>
      join.onRef('m.tenant_id', '=', 'v.tenant_id').onRef('m.id', '=', 'v.author_id'),
    )
    .select(['v.version', 'v.created_at', 'v.author_id', 'm.user_id', 'v.diff'])
    .where('v.entity_type', '=', entityType)
    .where('v.entity_id', '=', entityId)
    .orderBy('v.version', 'desc')
    .execute();
  return rows.map((row) => ({
    version: row.version,
    createdAt: row.created_at,
    authorId: row.author_id,
    authorUserId: row.user_id,
    diff: row.diff,
  }));
}
