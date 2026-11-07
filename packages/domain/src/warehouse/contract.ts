// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Data contracts (ADR 0016, ADR 0032): what each module may put in a
// tenant's warehouse, at a numbered version. A contract adds one thing to
// the model's tables: the class each column is published under. Its types,
// nullability and sources are the model's own, so there is one copy of
// them. A class is public or internal and nothing else, so a contract
// cannot express personal or special category data at all.

import type { ModuleId } from '../platform/modules.ts';
import type { WarehouseColumn } from './model.ts';
import {
  warehouseTables,
  type ClassificationLookup,
  type WarehouseTableName,
  type WarehouseTableOf,
} from './tables.ts';

export const dataContractClasses = ['public', 'internal'] as const;

export type DataContractClass = (typeof dataContractClasses)[number];

export interface DataContractColumn extends WarehouseColumn {
  readonly class: DataContractClass;
}

export interface DataContractTable {
  readonly rows: string;
  readonly key: string;
  readonly columns: Readonly<Record<string, DataContractColumn>>;
}

export interface DataContract<M extends ModuleId = ModuleId> {
  readonly module: M;
  /** Raised whenever a column is removed, renamed or retyped, or its source or class changes. */
  readonly version: number;
  readonly tables: Readonly<Record<string, DataContractTable>>;
}

type ColumnsOf<T extends WarehouseTableName> = (typeof warehouseTables)[T]['columns'];

/** A class for every column of every table the module feeds, and nothing else. */
export type DataContractClasses<M extends ModuleId> = {
  readonly [T in WarehouseTableOf<M>]: { readonly [C in keyof ColumnsOf<T>]: DataContractClass };
};

const allowed: ReadonlySet<string> = new Set(dataContractClasses);

/** A module's contract at a version, from the model's tables and a class for each column. */
export function defineDataContract<const M extends ModuleId, const V extends number>(
  module: M,
  version: V,
  classes: DataContractClasses<M>,
): DataContract<M> & {
  readonly version: V;
  readonly tables: { readonly [T in WarehouseTableOf<M>]: DataContractTable };
} {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error(`The ${module} data contract's version must be a whole number from 1.`);
  }
  const tables: Record<string, DataContractTable> = {};
  for (const [name, given] of Object.entries(classes as Record<string, Record<string, string>>)) {
    const table = Object.hasOwn(warehouseTables, name)
      ? warehouseTables[name as WarehouseTableName]
      : undefined;
    if (table?.module !== module) throw new Error(`${module} does not feed the table ${name}.`);
    const model = table.columns as Readonly<Record<string, WarehouseColumn>>;
    if (Object.keys(given).sort().join() !== Object.keys(model).sort().join()) {
      throw new Error(`The ${module} data contract must class every column of ${name} once.`);
    }
    const columns: Record<string, DataContractColumn> = {};
    for (const [column, definition] of Object.entries(model)) {
      const value = given[column];
      if (value === undefined || !allowed.has(value)) {
        throw new Error(`${name}.${column} must be public or internal.`);
      }
      if (definition.from !== 'module' && definition.from.some(forbidden)) {
        throw new Error(`${name}.${column} names a source that never leaves.`);
      }
      columns[column] = { ...definition, class: value as DataContractClass };
    }
    tables[name] = { rows: table.rows, key: table.key, columns };
  }
  return { module, version, tables: tables as Record<WarehouseTableOf<M>, DataContractTable> };
}

/** The order of the classification map's levels, least sensitive first. */
const levels = ['public', 'internal', 'personal', 'special_category'];

/** A source a contract may never name: monitoring data, or answers that may hold `aggregate_only` fields. */
function forbidden(source: string): boolean {
  const [, table = '', column = ''] = source.split('.');
  return table.includes('monitoring') || column === 'answers';
}

/**
 * Everything wrong with a contract against the classification map, as
 * sentences: a source the map does not list, or lists as personal or
 * special category; a class that is not the most sensitive of its sources'
 * levels; or a source a contract may never name. Empty when it is sound.
 */
export function dataContractProblems(
  contract: DataContract,
  classification: ClassificationLookup,
): string[] {
  const problems: string[] = [];
  for (const [name, table] of Object.entries(contract.tables)) {
    for (const [column, { from, class: declared }] of Object.entries(table.columns)) {
      const where = `${name}.${column}`;
      if (!allowed.has(declared)) problems.push(`${where} must be public or internal.`);
      if (from === 'module') {
        if (declared !== 'internal') problems.push(`${where} holds a module id, so is internal.`);
        continue;
      }
      let highest = 0;
      let sound = true;
      for (const source of from) {
        const dot = source.lastIndexOf('.');
        const [owner, field] = [source.slice(0, dot), source.slice(dot + 1)];
        const columns = Object.hasOwn(classification, owner) ? classification[owner] : undefined;
        const level =
          columns && Object.hasOwn(columns, field) ? columns[field]?.sensitivity : undefined;
        if (forbidden(source)) problems.push(`${where} names ${source}, which never leaves.`);
        if (level === undefined) {
          problems.push(
            `${where} comes from ${source}, which the classification map does not list.`,
          );
        } else if (!allowed.has(level)) {
          problems.push(`${where} comes from ${source}, which is ${level}.`);
        } else {
          highest = Math.max(highest, levels.indexOf(level));
          continue;
        }
        sound = false;
      }
      if (sound && levels.indexOf(declared) !== highest) {
        problems.push(`${where} is classed ${declared}, but its sources are ${levels[highest]}.`);
      }
    }
  }
  return problems;
}

/** One column as a published contract records it: `type[?] class source,source`, `?` when nullable. */
export function columnSignature(column: DataContractColumn): string {
  const sources = column.from === 'module' ? 'module' : column.from.join(',');
  return `${column.type}${column.nullable ? '?' : ''} ${column.class} ${sources}`;
}

/** A contract as it was published: each table's key and its columns' signatures. */
export type PublishedDataContract = Readonly<
  Record<string, { readonly key: string; readonly columns: Readonly<Record<string, string>> }>
>;

export function publishDataContract(contract: DataContract): PublishedDataContract {
  return Object.fromEntries(
    Object.entries(contract.tables).map(([name, { key, columns }]) => [
      name,
      {
        key,
        columns: Object.fromEntries(
          Object.entries(columns).map(([column, value]) => [column, columnSignature(value)]),
        ),
      },
    ]),
  );
}

/**
 * How a contract differs from what was published at its version: `breaking`
 * lists each table or column removed (a rename removes one) and each key or
 * signature changed, which needs a new version; `added` lists each table or
 * column added, which a version may take only where its test says so.
 */
export function dataContractChanges(
  published: PublishedDataContract,
  contract: DataContract,
): { breaking: string[]; added: string[] } {
  const current = publishDataContract(contract);
  const breaking: string[] = [];
  const added: string[] = [];
  for (const [name, was] of Object.entries(published)) {
    const now = Object.hasOwn(current, name) ? current[name] : undefined;
    if (now === undefined) {
      breaking.push(`${name} removed`);
      continue;
    }
    if (now.key !== was.key) breaking.push(`${name} key changed`);
    for (const [column, signature] of Object.entries(was.columns)) {
      if (!Object.hasOwn(now.columns, column)) breaking.push(`${name}.${column} removed`);
      else if (now.columns[column] !== signature) breaking.push(`${name}.${column} changed`);
    }
    for (const column of Object.keys(now.columns)) {
      if (!Object.hasOwn(was.columns, column)) added.push(`${name}.${column}`);
    }
  }
  for (const name of Object.keys(current)) if (!Object.hasOwn(published, name)) added.push(name);
  return { breaking, added };
}
