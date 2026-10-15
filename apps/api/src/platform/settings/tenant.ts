// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The tenant's name, time zone and fiscal year (ADR 0016). A change writes a
// configuration version and `platform.tenant.updated`, with the changed values
// (all public or internal fields, which the audit writer keeps).

import type {
  ConfigDiff,
  getSettings,
  updateSettings,
} from '@pixel-scientists/domain/platform/settings';

import type { TenantTransaction } from '../../database.ts';
import type { Handler } from '../../routes/register.ts';
import { settingsTables } from './tables.ts';

async function readSettings(tx: TenantTransaction, tenant: string, lock = false) {
  const query = settingsTables(tx)
    .selectFrom('app.tenant')
    .select(['name', 'timezone', 'fiscal_year_start_month'])
    .where('id', '=', tenant);
  const row = await (lock ? query.forUpdate() : query).executeTakeFirstOrThrow();
  return {
    name: row.name,
    timeZone: row.timezone,
    fiscalYearStartMonth: row.fiscal_year_start_month,
  };
}

export const getSettingsHandler: Handler<typeof getSettings> = ({ tx, context }) =>
  readSettings(tx, context.session.tenant);

export const updateSettingsHandler: Handler<typeof updateSettings> = async ({
  tx,
  context,
  input,
}) => {
  const { name, timeZone, fiscalYearStartMonth } = input.body;
  const tenant = context.session.tenant;
  const before = await readSettings(tx, tenant, true);

  const diff: ConfigDiff<'platform.tenant'> = [];
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  if (before.name !== name) {
    diff.push({ field: 'name', from: before.name, to: name });
    changes['app.tenant.name'] = { before: before.name, after: name };
  }
  if (before.timeZone !== timeZone) {
    diff.push({ field: 'timeZone', from: before.timeZone, to: timeZone });
    changes['app.tenant.timezone'] = { before: before.timeZone, after: timeZone };
  }
  if (before.fiscalYearStartMonth !== fiscalYearStartMonth) {
    diff.push({
      field: 'fiscalYearStartMonth',
      from: before.fiscalYearStartMonth,
      to: fiscalYearStartMonth,
    });
    changes['app.tenant.fiscal_year_start_month'] = {
      before: before.fiscalYearStartMonth,
      after: fiscalYearStartMonth,
    };
  }
  if (diff.length === 0) return before;

  await settingsTables(tx)
    .updateTable('app.tenant')
    .set({ name, timezone: timeZone, fiscal_year_start_month: fiscalYearStartMonth })
    .where('id', '=', tenant)
    .execute();
  await context.config.record('platform.tenant', tenant, diff);
  await context.audit.record({ action: 'platform.tenant.updated', entityId: tenant, changes });
  return { name, timeZone, fiscalYearStartMonth };
};
