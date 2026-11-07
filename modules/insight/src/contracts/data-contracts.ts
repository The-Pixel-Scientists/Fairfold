// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The data contract pages (S12-67): each module's slot in the registry, its
// version, and its tables and columns with their classes and sources. Built
// from the registry alone, so it reads no tenant data.

import { moduleIds } from '@pixel-scientists/domain/platform';
import {
  dataContractClasses,
  dataContracts,
  warehouseTypes,
} from '@pixel-scientists/domain/warehouse';
import { z } from 'zod';

export const dataContractListSchema = z.object({
  contracts: z.array(
    z.object({
      module: z.enum(moduleIds),
      /** Null until the module's contribution is built. */
      version: z.int().min(1).nullable(),
      tables: z.array(
        z.object({
          name: z.string(),
          rows: z.string(),
          key: z.string(),
          columns: z.array(
            z.object({
              name: z.string(),
              type: z.enum(warehouseTypes),
              nullable: z.boolean(),
              class: z.enum(dataContractClasses),
              /** `schema.table.column`; none for `source_module`, which holds the feeding module's id. */
              sources: z.array(z.string()),
            }),
          ),
        }),
      ),
    }),
  ),
});

export type DataContractList = z.infer<typeof dataContractListSchema>;

export function dataContractList(): DataContractList {
  return {
    contracts: Object.entries(dataContracts).map(([module, contract]) => ({
      module: module as keyof typeof dataContracts,
      version: contract?.version ?? null,
      tables: Object.entries(contract?.tables ?? {}).map(([name, { rows, key, columns }]) => ({
        name,
        rows,
        key,
        columns: Object.entries(columns).map(([column, value]) => ({
          name: column,
          type: value.type,
          nullable: value.nullable,
          class: value.class,
          sources: value.from === 'module' ? [] : [...value.from],
        })),
      })),
    })),
  };
}
