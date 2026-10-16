// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The configuration version writer (architecture rule 10). Each change to a
// tenant's settings, theme or modules appends the next `app.config_version`
// for its entity, in the request's transaction, with the acting membership as
// author. The table keeps its diff as an object, so the changes are stored
// under `changes`.

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
    diff: string;
  };
};

const UNIQUE_VIOLATION = '23505';

export async function recordConfigVersion<T extends ConfigEntityType>(
  tx: TenantTransaction,
  authorId: string,
  entityType: T,
  entityId: string,
  diff: ConfigDiff<T>,
): Promise<void> {
  const changes: unknown = configDiffSchemas[entityType].parse(diff);
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
