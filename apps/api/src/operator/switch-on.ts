// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The operator switches tools on (ADR 0024), for `--modules` on tenant:create
// and the grants backfill. Runs in a tenant's transaction as app_worker, so
// the tenant is the one set and the database holds each row to it, to the
// operator author (migration 0039). A tool that already has a row, on or
// off, is left alone; a missing row means off. Each row added writes its configuration version
// (rule 10) and a switched_on or switched_off event (rule 4).

import type { Transaction } from '@pixel-scientists/db';
import { switchableModuleIds, type SwitchableModuleId } from '@pixel-scientists/domain/platform';
import { configDiffSchemas } from '@pixel-scientists/domain/platform/settings';

import { recordAudit } from '../audit/writer.ts';

type Generated<T> = {
  readonly __select__: T;
  readonly __insert__: T | undefined;
  readonly __update__: T;
};

type Tables = {
  'app.tenant_module': {
    tenant_id: string;
    id: Generated<string>;
    module: string;
    enabled: boolean;
    updated_by_kind: string;
  };
  'app.config_version': {
    tenant_id: string;
    entity_type: string;
    entity_id: string;
    version: number;
    author_kind: string;
    diff: { __select__: unknown; __insert__: string; __update__: string };
  };
};

/** The ids in a comma list, or the plain problem with it. An empty list is no tool. */
export function parseModules(value: string | undefined): SwitchableModuleId[] | string {
  if (value === undefined || value.trim() === '') return [];
  const ids = value.split(',').map((id) => id.trim());
  const known = new Set<string>(switchableModuleIds);
  const unknown = ids.find((id) => !known.has(id));
  if (unknown !== undefined) {
    return `Modules: unknown module. Use any of ${switchableModuleIds.join(', ')}.`;
  }
  if (new Set(ids).size !== ids.length) return 'Modules: a module is listed twice.';
  return ids as SwitchableModuleId[];
}

/**
 * Add a row for each of `rows` that has none, with its version and event.
 * A module that already has a row, on or off, is left alone. Returns how
 * many rows it added.
 */
async function addRows(
  trx: Transaction<unknown>,
  requestId: string,
  rows: readonly { readonly module: SwitchableModuleId; readonly enabled: boolean }[],
): Promise<number> {
  const db = trx.$extendTables<Tables>();
  let added = 0;
  for (const { module, enabled } of rows) {
    const row = await db
      .insertInto('app.tenant_module')
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        module,
        enabled,
        updated_by_kind: 'operator',
      }))
      .onConflict((conflict) => conflict.columns(['tenant_id', 'module']).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (row === undefined) continue;

    const changes: unknown = configDiffSchemas['platform.module'].parse([
      { field: 'enabled', from: false, to: enabled },
    ]);
    await db
      .insertInto('app.config_version')
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        entity_type: 'platform.module',
        entity_id: row.id,
        version: 1,
        author_kind: 'operator',
        diff: JSON.stringify({ changes }),
      }))
      .execute();
    await recordAudit(
      trx,
      { kind: 'operator', requestId },
      {
        action: enabled ? 'platform.module.switched_on' : 'platform.module.switched_off',
        entityId: row.id,
        changes: {
          'app.tenant_module.module': { after: module },
          'app.tenant_module.enabled': { before: false, after: enabled },
        },
      },
    );
    added += 1;
  }
  return added;
}

/** A new tenant's rows (ADR 0024): one on row per listed module; a missing row means off. */
export function createModuleRows(
  trx: Transaction<unknown>,
  requestId: string,
  on: readonly SwitchableModuleId[],
): Promise<number> {
  return switchModulesOn(trx, requestId, on);
}

/** Switch on each of `modules` that has no row yet. Returns how many it switched on. */
export function switchModulesOn(
  trx: Transaction<unknown>,
  requestId: string,
  modules: readonly SwitchableModuleId[],
): Promise<number> {
  return addRows(
    trx,
    requestId,
    modules.map((module) => ({ module, enabled: true })),
  );
}
