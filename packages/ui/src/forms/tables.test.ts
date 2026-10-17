// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { capitalise, cellOf, isTotalled, plural, rowsOf, totalLabel, totalText } from './tables.ts';

const money = { amountMinor: 1_250_000, currency: 'GBP' } as const;
const pounds = ({ amountMinor }: typeof money) => `£${(amountMinor / 100).toLocaleString('en-GB')}`;

describe('rowsOf', () => {
  it('reads a list of rows, and a row that is not an object as an empty row', () => {
    expect(rowsOf([{ c_a: 1 }, 'x', null, [1], { c_b: 'y' }])).toEqual([
      { c_a: 1 },
      {},
      {},
      {},
      { c_b: 'y' },
    ]);
  });

  it('reads anything that is not a list as no rows', () => {
    for (const answer of [null, undefined, 'rows', 3, { c_a: 1 }]) {
      expect(rowsOf(answer)).toEqual([]);
    }
  });
});

describe('cellOf', () => {
  it('gives a cell the row holds, and null for one it does not', () => {
    expect(cellOf({ c_a: 'x', c_b: 0 }, { id: 'c_a' })).toBe('x');
    expect(cellOf({ c_a: 'x', c_b: 0 }, { id: 'c_b' })).toBe(0);
    expect(cellOf({ c_a: 'x' }, { id: 'c_c' })).toBeNull();
    expect(cellOf({}, { id: 'toString' })).toBeNull();
  });
});

describe('plural', () => {
  it('names many rows as the engine does', () => {
    expect(plural('cost')).toBe('costs');
    expect(plural('activity')).toBe('activities');
    expect(plural('day')).toBe('days');
    expect(plural('box')).toBe('boxes');
    expect(plural('class')).toBe('classes');
    expect(plural('branch')).toBe('branches');
  });
});

describe('capitalise', () => {
  it('raises the first letter and leaves the rest', () => {
    expect(capitalise('cost 2')).toBe('Cost 2');
    expect(capitalise('')).toBe('');
  });
});

describe('totals', () => {
  it('knows which columns are added up', () => {
    const base = { id: 'c_a', label: 'A', required: true };
    expect(isTotalled({ ...base, type: 'currency', currency: 'GBP', total: true })).toBe(true);
    expect(isTotalled({ ...base, type: 'number', wholeNumber: true, total: true })).toBe(true);
    expect(isTotalled({ ...base, type: 'number', wholeNumber: true })).toBe(false);
    expect(isTotalled({ ...base, type: 'short_text' })).toBe(false);
  });

  it('labels a total with its column, in lower case unless it starts with an acronym', () => {
    const column = { id: 'c_a', required: true, type: 'short_text' } as const;
    expect(totalLabel({ ...column, label: 'Cost' })).toBe('Total cost');
    expect(totalLabel({ ...column, label: 'Staff cost' })).toBe('Total staff cost');
    expect(totalLabel({ ...column, label: 'VAT' })).toBe('Total VAT');
  });

  it('writes an amount with the engine format, a number with its figures grouped, and no total as null', () => {
    expect(totalText(money, pounds)).toBe('£12,500');
    expect(totalText(12_500, pounds)).toBe('12,500');
    expect(totalText(0.1 + 0.2, pounds)).toBe('0.3');
    expect(totalText(0, pounds)).toBe('0');
    expect(totalText(null, pounds)).toBeNull();
    expect(totalText(undefined, pounds)).toBeNull();
  });
});
