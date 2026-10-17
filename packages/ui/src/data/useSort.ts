// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';

import type { SortState } from './DataTable.tsx';

type SortValue = string | number;

/**
 * Holds the sort of a DataTable and gives the rows in that order. `keys`
 * says what each sortable column sorts by, under the column's `key`; text
 * sorts in British English order and numbers by size. Pass `sort` and
 * `setSort` to the table as `sort` and `onSortChange`.
 */
export function useSort<Row>(
  rows: readonly Row[],
  keys: Readonly<Record<string, (row: Row) => SortValue>>,
  initial?: SortState,
) {
  const [sort, setSort] = useState<SortState | undefined>(initial);
  const valueOf = sort === undefined ? undefined : keys[sort.key];
  const direction = sort?.direction === 'descending' ? -1 : 1;
  const sorted = valueOf
    ? [...rows].sort((a, b) => {
        const left = valueOf(a);
        const right = valueOf(b);
        return (
          direction *
          (typeof left === 'number' && typeof right === 'number'
            ? left - right
            : String(left).localeCompare(String(right), 'en-GB'))
        );
      })
    : rows;
  return { sort, setSort, sorted };
}
