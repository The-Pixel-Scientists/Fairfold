// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The warehouse's `date` table (ADR 0016), which the platform builds: every
// calendar day from the first commitment's day to the last, with the
// tenant's fiscal year.

import type { WarehouseRow, WarehouseTenant } from '@pixel-scientists/domain/warehouse';

const DAY_MS = 86_400_000;

/** The days from the earliest to the latest of `days` (`YYYY-MM-DD`), or none if there are none. */
export function dateRows(
  days: readonly string[],
  { fiscalYearStartMonth }: Pick<WarehouseTenant, 'fiscalYearStartMonth'>,
): WarehouseRow<'date'>[] {
  if (days.length === 0) return [];
  const sorted = [...days].sort();
  const last = Date.parse(`${sorted.at(-1)}T00:00:00Z`);
  const rows: WarehouseRow<'date'>[] = [];
  for (let time = Date.parse(`${sorted[0]}T00:00:00Z`); time <= last; time += DAY_MS) {
    const day = new Date(time);
    const year = day.getUTCFullYear();
    const month = day.getUTCMonth() + 1;
    rows.push({
      date: day.toISOString().slice(0, 10),
      year,
      quarter: Math.ceil(month / 3),
      month,
      fiscal_year: month >= fiscalYearStartMonth ? year : year - 1,
      fiscal_quarter: Math.floor(((month - fiscalYearStartMonth + 12) % 12) / 3) + 1,
    });
  }
  return rows;
}
