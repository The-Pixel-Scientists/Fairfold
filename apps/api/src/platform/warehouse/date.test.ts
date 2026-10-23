// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { dateRows } from './date.ts';

describe('dateRows', () => {
  it('is empty without a commitment', () => {
    expect(dateRows([], { fiscalYearStartMonth: 4 })).toEqual([]);
  });

  it('lists every day from the first to the last, whatever the order given', () => {
    const rows = dateRows(['2026-03-02', '2026-02-27', '2026-03-01'], { fiscalYearStartMonth: 1 });
    expect(rows.map((row) => row.date)).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
  });

  it('gives a day its calendar year, quarter and month', () => {
    expect(dateRows(['2028-02-29'], { fiscalYearStartMonth: 1 })).toEqual([
      {
        date: '2028-02-29',
        year: 2028,
        quarter: 1,
        month: 2,
        fiscal_year: 2028,
        fiscal_quarter: 1,
      },
    ]);
  });

  it('numbers fiscal years by the calendar year they start in', () => {
    const fiscal = (day: string, start: number) => {
      const [row] = dateRows([day], { fiscalYearStartMonth: start });
      return [row?.fiscal_year, row?.fiscal_quarter];
    };
    expect(fiscal('2026-03-31', 4)).toEqual([2025, 4]);
    expect(fiscal('2026-04-01', 4)).toEqual([2026, 1]);
    expect(fiscal('2026-06-30', 4)).toEqual([2026, 1]);
    expect(fiscal('2026-07-01', 4)).toEqual([2026, 2]);
    expect(fiscal('2026-12-31', 4)).toEqual([2026, 3]);
    expect(fiscal('2026-01-01', 4)).toEqual([2025, 4]);
    expect(fiscal('2026-12-31', 12)).toEqual([2026, 1]);
    expect(fiscal('2026-11-30', 12)).toEqual([2025, 4]);
  });
});
