// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Which switchable modules a tenant uses (ADR 0016). A module with no stored
// state is on. Switching one writes a configuration version and
// `platform.module.switched_on` or `switched_off`; the policy then answers
// 404 for the module's routes, and sessions drop its permissions.

import { switchableModuleIds } from '@pixel-scientists/domain/platform';
import type { listModules, switchModule } from '@pixel-scientists/domain/platform/settings';

import type { TenantTransaction } from '../../database.ts';
import type { Handler } from '../../routes/register.ts';
import { settingsTables } from './tables.ts';

async function readModules(tx: TenantTransaction) {
  const rows = await settingsTables(tx)
    .selectFrom('app.tenant_module')
    .select(['module', 'enabled'])
    .execute();
  const stored = new Map(rows.map((row) => [row.module, row.enabled]));
  return {
    modules: switchableModuleIds.map((module) => ({ module, enabled: stored.get(module) ?? true })),
  };
}

export const listModulesHandler: Handler<typeof listModules> = ({ tx }) => readModules(tx);

export const switchModuleHandler: Handler<typeof switchModule> = async ({ tx, context, input }) => {
  const { module, enabled } = input.body;
  const db = settingsTables(tx);
  const current = await db
    .selectFrom('app.tenant_module')
    .select('enabled')
    .where('module', '=', module)
    .forUpdate()
    .executeTakeFirst();
  const before = current?.enabled ?? true;
  if (before === enabled) return readModules(tx);

  const set = { enabled, updated_by: context.membership.id };
  const saved = await db
    .insertInto('app.tenant_module')
    .values((eb) => ({ tenant_id: eb.fn<string>('app.current_tenant_id', []), module, ...set }))
    .onConflict((conflict) => conflict.columns(['tenant_id', 'module']).doUpdateSet(set))
    .returning('id')
    .executeTakeFirstOrThrow();

  await context.config.record('platform.module', saved.id, [
    { field: 'enabled', from: before, to: enabled },
  ]);
  await context.audit.record({
    action: enabled ? 'platform.module.switched_on' : 'platform.module.switched_off',
    entityId: saved.id,
    changes: {
      'app.tenant_module.module': { after: module },
      'app.tenant_module.enabled': { before, after: enabled },
    },
  });
  return readModules(tx);
};
