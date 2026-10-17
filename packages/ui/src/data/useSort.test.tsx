// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useSort } from './useSort.ts';

interface Row {
  name: string;
  amount: number;
}

const rows: readonly Row[] = [
  { name: 'Brightwater', amount: 9 },
  { name: 'Ashfield', amount: 100 },
  { name: 'Éclair', amount: 20 },
];

const keys = {
  name: (row: Row) => row.name,
  amount: (row: Row) => row.amount,
};

const names = (sorted: readonly Row[]) => sorted.map((row) => row.name);

describe('useSort', () => {
  it('keeps the order it is given until a column is chosen', () => {
    const { result } = renderHook(() => useSort(rows, keys));

    expect(result.current.sort).toBeUndefined();
    expect(result.current.sorted).toBe(rows);
  });

  it('sorts text in British English order and numbers by size, either way', () => {
    const { result } = renderHook(() =>
      useSort(rows, keys, { key: 'name', direction: 'ascending' }),
    );
    expect(names(result.current.sorted)).toEqual(['Ashfield', 'Brightwater', 'Éclair']);

    act(() => {
      result.current.setSort({ key: 'amount', direction: 'ascending' });
    });
    expect(names(result.current.sorted)).toEqual(['Brightwater', 'Éclair', 'Ashfield']);

    act(() => {
      result.current.setSort({ key: 'amount', direction: 'descending' });
    });
    expect(names(result.current.sorted)).toEqual(['Ashfield', 'Éclair', 'Brightwater']);
  });

  it('leaves the rows as they are for a column that has no sort key', () => {
    const { result } = renderHook(() =>
      useSort(rows, keys, { key: 'unknown', direction: 'ascending' }),
    );

    expect(result.current.sorted).toBe(rows);
  });
});
