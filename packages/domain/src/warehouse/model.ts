// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How a warehouse table is defined (ADR 0016). Each column names its type
// and the application columns its value comes from, as the classification
// map names them, and takes the most sensitive class among them. Table and
// column names reach the load script as SQL identifiers, so they come only
// from this model.

import type { ModuleId } from '../platform/modules.ts';

/** The column types a load script creates, as PostgreSQL names them. */
export const warehouseTypes = [
  'uuid',
  'text',
  'integer',
  'bigint',
  'boolean',
  'date',
  'timestamptz',
] as const;

export type WarehouseType = (typeof warehouseTypes)[number];

/** An application column as the classification map names it: `schema.table.column`. */
export type SourceColumn = `${string}.${string}.${string}`;

export interface WarehouseColumn {
  readonly type: WarehouseType;
  readonly nullable: boolean;
  /**
   * The source columns its value comes from, is derived from, or is chosen
   * by. `module` marks `source_module`, which holds the feeding module's id,
   * a code: it is internal, and the load script fills it, not the module.
   */
  readonly from: readonly [SourceColumn, ...SourceColumn[]] | 'module';
}

export interface WarehouseTable {
  /** The one module whose contribution yields its rows; `platform` builds `date`. */
  readonly module: ModuleId;
  /** Which source rows become its rows, in words, for review and the loading guide. */
  readonly rows: string;
  /** Its key: the source row's id, or the day for `date`. */
  readonly key: string;
  /** In the order the load script creates them. */
  readonly columns: Readonly<Record<string, WarehouseColumn>>;
}

type Sources = readonly [SourceColumn, ...SourceColumn[]];

/** A column every row has a value for. */
export function column<const T extends WarehouseType>(type: T, ...from: Sources) {
  return { type, nullable: false, from } as const;
}

/** A column that may be null. */
export function nullable<const T extends WarehouseType>(type: T, ...from: Sources) {
  return { type, nullable: true, from } as const;
}

/** `source_module` on a shared table that any module may feed. */
export const sourceModule = { type: 'text', nullable: false, from: 'module' } as const;
