// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The warehouse's conformed model (ADR 0016), what each module contributes
// to it, and the classification filter every delivery method applies.

import type { ModuleId } from '../platform/modules.ts';
import { grantsTables } from './grants.ts';
import type { WarehouseColumn } from './model.ts';
import { sharedTables } from './shared.ts';

/** Raised with any change to a table or column; the load script's header names it. */
export const warehouseModelVersion = 1;

export const warehouseTables = { ...sharedTables, ...grantsTables } as const;

export type WarehouseTableName = keyof typeof warehouseTables;

export const warehouseTableNames = Object.keys(warehouseTables) as WarehouseTableName[];

/** The tables a module feeds. */
export type WarehouseTableOf<M extends ModuleId> = {
  [T in WarehouseTableName]: (typeof warehouseTables)[T]['module'] extends M ? T : never;
}[WarehouseTableName];

type Columns<T extends WarehouseTableName> = (typeof warehouseTables)[T]['columns'];

/** Numbers for whole numbers (every amount fits), ISO 8601 text for dates and times. */
type Value<C> = C extends WarehouseColumn
  ? | (C['type'] extends 'integer' | 'bigint'
        ? number
        : C['type'] extends 'boolean'
          ? boolean
          : string)
    | (C['nullable'] extends true ? null : never)
  : never;

/** One row as a module yields it: every column but `source_module`, which the load script fills. */
export type WarehouseRow<T extends WarehouseTableName> = {
  readonly [K in keyof Columns<T> as Columns<T>[K] extends { from: 'module' } ? never : K]: Value<
    Columns<T>[K]
  >;
};

/** What a contribution needs to know about the tenant. */
export interface WarehouseTenant {
  /** An IANA time zone, such as Europe/London, for turning times into days. */
  readonly timezone: string;
  /** 1 for January to 12 for December. */
  readonly fiscalYearStartMonth: number;
}

/**
 * What a module's `server` exports to feed the warehouse: a reader for each
 * table it feeds. Each runs in the caller's transaction, which is the
 * admin's request under the tenant's row-level security (D14). The load
 * script writes only the columns warehouseColumns() allows, whatever a row
 * holds.
 */
export interface WarehouseContribution<M extends ModuleId, Tx> {
  readonly module: M;
  readonly tables: {
    readonly [T in WarehouseTableOf<M>]: (
      tx: Tx,
      tenant: WarehouseTenant,
    ) => Promise<readonly WarehouseRow<T>[]>;
  };
}

/** The classification map's shape (packages/db/classification.ts): `{ 'schema.table': { column: { sensitivity } } }`. */
export type ClassificationLookup = Readonly<
  Record<string, Readonly<Record<string, { readonly sensitivity: string }>>>
>;

/**
 * Public and internal values only. Personal data waits for a tenant's
 * opt-in, off by default and after MVP1; special category data never goes.
 */
const allowed: ReadonlySet<string> = new Set(['public', 'internal']);

function sensitivityOf(source: string, classification: ClassificationLookup, where: string) {
  const dot = source.lastIndexOf('.');
  const table = source.slice(0, dot);
  const name = source.slice(dot + 1);
  const columns = Object.hasOwn(classification, table) ? classification[table] : undefined;
  const level = columns && Object.hasOwn(columns, name) ? columns[name]?.sensitivity : undefined;
  if (level === undefined) {
    throw new Error(`${where} comes from ${source}, which the classification map does not list.`);
  }
  return level;
}

/**
 * A table's columns that a contribution may emit, in order: those whose
 * every source is public or internal in the classification map. Throws if a
 * source is not in the map, or if the table's key would be left out.
 */
export function warehouseColumns(
  table: WarehouseTableName,
  classification: ClassificationLookup,
): string[] {
  const { key, columns } = warehouseTables[table];
  const names = Object.entries(columns as Record<string, WarehouseColumn>)
    .filter(([name, { from }]) => {
      if (from === 'module') return true;
      const levels = from.map((source) =>
        sensitivityOf(source, classification, `${table}.${name}`),
      );
      return levels.every((level) => allowed.has(level));
    })
    .map(([name]) => name);
  if (!names.includes(key)) {
    throw new Error(`The key ${table}.${key} has a source that is neither public nor internal.`);
  }
  return names;
}
