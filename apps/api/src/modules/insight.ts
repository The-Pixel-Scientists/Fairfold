// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The insight module's composition (ADR 0016): its routes, built from the
// platform's dependencies. Every handler runs in the request's transaction, so
// row-level security keeps each answer in the caller's tenant, and the
// platform has checked the module switch, the permission and the step-up
// window before it runs.
//
// Grants' own server counts the equality monitoring answers in that same
// transaction, and the count goes straight to insight's suppression function
// (ADR 0032). The warehouse's rows come from the modules' contributions,
// through the classification filter, so a report reads public and internal
// columns only.
//
// Not yet wired, each for want of a piece another owner holds: the route that
// prepares a publication and the worker's preparation job. The queue has no
// migration (db-security), grants has no 360Giving build or committed figures
// for a period (api-builder, grants), and `app_worker` cannot store the output
// file (it has no INSERT on `app.file`; db-security). `regulatoryHandlers`
// serves the other three publication routes meanwhile.

import { classification } from '@pixel-scientists/db/classification';
import { insightRoutes as routes } from '@pixel-scientists/insight/contracts';
import {
  insightHandlers,
  regulatoryHandlers,
  type WarehouseRead,
  type WarehouseRow,
} from '@pixel-scientists/insight/server';
import { switchableModuleIds } from '@pixel-scientists/domain/platform';
import {
  warehouseColumns,
  warehouseTables,
  type WarehouseTableName,
} from '@pixel-scientists/domain/warehouse';
import { grantsWarehouse, monitoringCounts } from '@pixel-scientists/grants/server';
import { partyWarehouse } from '@pixel-scientists/party/server';

import type { TenantTransaction } from '../database.ts';
import { settingsTables } from '../platform/settings/tables.ts';
import type { Contribution } from '../platform/warehouse/snapshot.ts';
import { route } from '../routes/register.ts';
import type { ModuleFactory } from './types.ts';

const contributions: readonly Contribution[] = [partyWarehouse, grantsWarehouse];

const scalar = (value: unknown): WarehouseRow[string] =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : null;

/** A warehouse table's rows with the columns its data contract lets through, for a tenant that has its tool on. */
async function warehouseRows(
  tx: TenantTransaction,
  table: WarehouseTableName,
): Promise<WarehouseRead> {
  const { module } = warehouseTables[table];
  const read = contributions.find(
    (contribution) => contribution.module === module && Object.hasOwn(contribution.tables, table),
  )?.tables[table];
  if (read === undefined) return { status: 'unavailable' };

  const db = settingsTables(tx);
  if ((switchableModuleIds as readonly string[]).includes(module)) {
    const switched = await db
      .selectFrom('app.tenant_module')
      .select('enabled')
      .where('module', '=', module)
      .executeTakeFirst();
    if (switched?.enabled !== true) return { status: 'off' };
  }
  const tenant = await db
    .selectFrom('app.tenant')
    .select(['timezone', 'fiscal_year_start_month'])
    .executeTakeFirstOrThrow();
  const columns = warehouseColumns(table, classification);
  const rows = await read(tx, {
    timezone: tenant.timezone,
    fiscalYearStartMonth: tenant.fiscal_year_start_month,
  });
  return {
    status: 'rows',
    columns,
    rows: rows.map((row) =>
      Object.fromEntries(
        columns.map((column) => [
          column,
          column === 'source_module' ? module : scalar(row[column]),
        ]),
      ),
    ),
  };
}

export const insightComposition: ModuleFactory = ({ platform }) => {
  const insight = insightHandlers({
    notFound: platform.notFound,
    refuse: platform.refuse,
    monitoringCounts,
    warehouseRows,
  });
  const publications = regulatoryHandlers({
    notFound: platform.notFound,
    refuse: platform.refuse,
    sendPrepareJob: () =>
      Promise.reject(new Error('The publication preparation job is not built yet.')),
  });

  return {
    routes: [
      route(routes.listReportDefinitions, insight.listReportDefinitions),
      route(routes.getReportDefinition, insight.getReportDefinition),
      route(routes.createReportDefinition, insight.createReportDefinition, {
        replay: ({ tx, context, id }) =>
          insight.getReportDefinition({
            tx,
            context,
            input: { params: { reportId: platform.created(id) } },
          }),
      }),
      route(routes.updateReportDefinition, insight.updateReportDefinition),
      route(routes.archiveReportDefinition, insight.archiveReportDefinition),
      route(routes.runReport, insight.runReport),
      route(routes.getReportRun, insight.getReportRun),
      route(routes.runMonitoringReport, insight.runMonitoringReport),
      route(routes.getMonitoringReportRun, insight.getMonitoringReportRun),
      route(routes.listPublicationRuns, publications.listPublicationRuns),
      route(routes.getPublicationRun, publications.getPublicationRun),
      route(routes.markPublicationRunSubmitted, publications.markPublicationRunSubmitted),
      route(routes.getDisclosureRule, insight.getDisclosureRule),
      route(routes.updateDisclosureRule, insight.updateDisclosureRule),
      route(routes.listDataContracts, insight.listDataContracts),
    ],
  };
};
