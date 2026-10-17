// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The shared warehouse's model, contributions and snapshot route: the
// `/warehouse` subpath of the domain package.

import '../jitless/index.ts';

export {
  warehouseTypes,
  type SourceColumn,
  type WarehouseColumn,
  type WarehouseTable,
  type WarehouseType,
} from './model.ts';
export { getWarehouseSnapshot, MAX_SNAPSHOT_BYTES, warehouseRoutes } from './routes.ts';
export {
  warehouseColumns,
  warehouseModelVersion,
  warehouseTableNames,
  warehouseTables,
  type ClassificationLookup,
  type WarehouseContribution,
  type WarehouseRow,
  type WarehouseTableName,
  type WarehouseTableOf,
  type WarehouseTenant,
} from './tables.ts';
