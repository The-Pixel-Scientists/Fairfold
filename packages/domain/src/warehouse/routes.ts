// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The warehouse snapshot (ADR 0016, D14): one PostgreSQL load script of the
// tenant's warehouse tables, `CREATE TABLE` statements and `COPY` data,
// built inside the admin's request and sent as an attachment. Each download
// records `platform.warehouse.exported` with the table and row counts.

import { defineRoute } from '../api/route.ts';

/** The largest script one request builds; past it, the admin is asked to contact the operator. */
export const MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024;

export const getWarehouseSnapshot = defineRoute({
  method: 'GET',
  path: '/console/warehouse/snapshot',
  audience: 'console',
  module: 'platform',
  summary: "Download the tenant's warehouse snapshot as a PostgreSQL load script",
  permission: 'platform.warehouse.export',
  scope: 'tenant',
  responses: { 200: { raw: ['application/sql'] } },
});

export const warehouseRoutes = { getWarehouseSnapshot } as const;
