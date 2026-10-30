// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The warehouse load script (ADR 0016): a header comment, then in one
// transaction a CREATE TABLE for each table and a COPY block for its rows,
// for loading into any PostgreSQL 16 or later with
// `psql -v ON_ERROR_STOP=1 -f`. The script sets client_encoding to UTF8, so
// the loader's locale cannot change what a value loads as. Table and column
// names come only from the model in packages/domain, and each column is
// written only if warehouseColumns() allows it under the classification map,
// whatever a row holds. Values are escaped by copyValue().

import { idSchema } from '@pixel-scientists/domain';
import {
  warehouseColumns,
  warehouseModelVersion,
  warehouseTables,
  type ClassificationLookup,
  type WarehouseTable,
  type WarehouseTableName,
} from '@pixel-scientists/domain/warehouse';

import { copyRow } from './escape.ts';

type Value = string | number | boolean | null;

/** A table's rows as a contribution yields them: every column but `source_module`. */
export interface TableRows {
  readonly name: WarehouseTableName;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

export class SnapshotTooLarge extends Error {
  constructor() {
    super('The snapshot is larger than its limit.');
    this.name = 'SnapshotTooLarge';
  }
}

/** A name that is safe as a SQL identifier, quoted. The model's names always are. */
function identifier(name: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(name))
    throw new Error('A warehouse name is not a safe identifier.');
  return `"${name}"`;
}

function valueOf(row: Readonly<Record<string, unknown>>, table: string, column: string): Value {
  const value = Object.hasOwn(row, column) ? row[column] : undefined;
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  throw new Error(`A ${table} row has no value for ${column}.`);
}

/**
 * The script and the number of rows in each table, in the order given.
 * Throws SnapshotTooLarge as soon as the script passes `maxBytes`.
 */
export function writeScript(input: {
  readonly tenantId: string;
  readonly at: Date;
  readonly tables: readonly TableRows[];
  readonly classification: ClassificationLookup;
  readonly maxBytes: number;
}): { script: string; counts: Record<string, number> } {
  const parts: string[] = [];
  let bytes = 0;
  const add = (text: string): void => {
    bytes += Buffer.byteLength(text);
    if (bytes > input.maxBytes) throw new SnapshotTooLarge();
    parts.push(text);
  };

  add(
    `-- Warehouse snapshot\n-- Tenant: ${idSchema.parse(input.tenantId)}\n` +
      `-- Created: ${input.at.toISOString()}\n-- Model version: ${warehouseModelVersion}\n\n` +
      // The file is UTF-8, whatever locale the loading machine's psql runs in.
      "SET client_encoding = 'UTF8';\nBEGIN;\n\n",
  );
  const written = input.tables.map(({ name, rows }) => {
    const model: WarehouseTable = warehouseTables[name];
    const allowed = new Set(warehouseColumns(name, input.classification));
    const columns = Object.entries(model.columns).filter(([column]) => allowed.has(column));
    add(
      `CREATE TABLE ${identifier(name)} (\n` +
        columns
          .map(
            ([column, { type, nullable }]) =>
              `  ${identifier(column)} ${type}${nullable ? '' : ' NOT NULL'},\n`,
          )
          .join('') +
        `  PRIMARY KEY (${identifier(model.key)})\n);\n\n`,
    );
    return { name, model, columns, rows };
  });

  const counts: Record<string, number> = {};
  for (const { name, model, columns, rows } of written) {
    const list = columns.map(([column]) => identifier(column)).join(', ');
    add(`COPY ${identifier(name)} (${list}) FROM stdin;\n`);
    for (const row of rows) {
      add(
        copyRow(
          columns.map(([column, { from, nullable }]) => {
            if (from === 'module') return model.module;
            const value = valueOf(row, name, column);
            if (value === null && !nullable) throw new Error(`${name}.${column} must not be null.`);
            return value;
          }),
        ),
      );
    }
    add('\\.\n\n');
    counts[name] = rows.length;
  }
  add('COMMIT;\n');
  return { script: parts.join(''), counts };
}
