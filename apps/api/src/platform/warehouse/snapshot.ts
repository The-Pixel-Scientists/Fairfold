// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Builds the warehouse snapshot (ADR 0016, D14): reads each module's
// contribution in the caller's transaction, adds the platform's `date`
// table, and writes the load script under the classification map.

import type { ModuleId } from '@pixel-scientists/domain/platform';
import {
  warehouseTableNames,
  warehouseTables,
  type ClassificationLookup,
  type WarehouseTableName,
  type WarehouseTenant,
} from '@pixel-scientists/domain/warehouse';

import type { TenantTransaction } from '../../database.ts';
import { dateRows } from './date.ts';
import { writeScript, type TableRows } from './script.ts';

type Rows = readonly Readonly<Record<string, unknown>>[];

/** What a module's server exports to feed the warehouse (WarehouseContribution). */
export interface Contribution {
  readonly module: ModuleId;
  readonly tables: Readonly<
    Partial<
      Record<WarehouseTableName, (tx: TenantTransaction, tenant: WarehouseTenant) => Promise<Rows>>
    >
  >;
}

export async function buildSnapshot(
  tx: TenantTransaction,
  input: {
    readonly tenantId: string;
    readonly tenant: WarehouseTenant;
    readonly contributions: readonly Contribution[];
    readonly classification: ClassificationLookup;
    readonly at: Date;
    readonly maxBytes: number;
  },
): Promise<ReturnType<typeof writeScript>> {
  const fed = new Map<WarehouseTableName, Rows>();
  for (const name of warehouseTableNames) {
    const { module } = warehouseTables[name];
    if (module === 'platform') continue;
    const read = input.contributions.find(
      (contribution) => contribution.module === module && Object.hasOwn(contribution.tables, name),
    )?.tables[name];
    if (read === undefined) throw new Error(`No module feeds the warehouse table ${name}.`);
    fed.set(name, await read(tx, input.tenant));
  }
  const days = (fed.get('commitment') ?? []).flatMap((row) =>
    typeof row['committed_on'] === 'string' ? [row['committed_on']] : [],
  );

  const tables: TableRows[] = warehouseTableNames.map((name) => ({
    name,
    rows: name === 'date' ? dateRows(days, input.tenant) : (fed.get(name) ?? []),
  }));
  return writeScript({
    tenantId: input.tenantId,
    at: input.at,
    tables,
    classification: input.classification,
    maxBytes: input.maxBytes,
  });
}
