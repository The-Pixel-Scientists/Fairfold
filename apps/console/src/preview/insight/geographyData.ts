// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Spring 2027 grants by area. The grants and amounts are counted from the
// accepted applications, so the seven areas add up to the £187,500 awarded and
// the 14 grants.

import { amountOf, grantsIn } from './grantsData.ts';

export interface Area {
  id: string;
  name: string;
  /** Index of Multiple Deprivation decile: 1 is the most deprived tenth of areas. */
  decile: number;
  residents: number;
  grants: number;
  amount: number;
  /** Place on the schematic map. Columns count in halves of a tile. */
  row: number;
  column: number;
}

const places: readonly Omit<Area, 'grants' | 'amount'>[] = [
  {
    id: 'hartley-green',
    name: 'Hartley Green',
    decile: 7,
    residents: 9_800,
    row: 0,
    column: 1,
  },
  {
    id: 'oakmere',
    name: 'Oakmere',
    decile: 9,
    residents: 12_500,
    row: 0,
    column: 3,
  },
  {
    id: 'westfield',
    name: 'Westfield',
    decile: 4,
    residents: 18_200,
    row: 1,
    column: 0,
  },
  {
    id: 'northfield-central',
    name: 'Northfield Central',
    decile: 2,
    residents: 16_500,
    row: 1,
    column: 2,
  },
  {
    id: 'eastbrook',
    name: 'Eastbrook',
    decile: 1,
    residents: 8_900,
    row: 1,
    column: 4,
  },
  {
    id: 'sandford',
    name: 'Sandford',
    decile: 8,
    residents: 14_800,
    row: 2,
    column: 1,
  },
  {
    id: 'millbrook',
    name: 'Millbrook',
    decile: 3,
    residents: 14_100,
    row: 2,
    column: 3,
  },
];

export const areas: readonly Area[] = places.map((place) => {
  const accepted = grantsIn('area', place.name);
  return { ...place, grants: accepted.length, amount: amountOf(accepted) };
});

export const totalAmount = areas.reduce((sum, area) => sum + area.amount, 0);

/** Pounds for every 1,000 residents. */
export const perThousand = (amount: number, residents: number): number =>
  Math.round((amount / residents) * 1000);

/** The shades on the map, from the smallest amounts to the largest. */
export const amountBands = [
  { label: 'Under £15,000', below: 15_000 },
  { label: '£15,000 to £24,999', below: 25_000 },
  { label: '£25,000 to £34,999', below: 35_000 },
  { label: '£35,000 or more', below: Infinity },
] as const;

export const bandOf = (amount: number): number =>
  amountBands.findIndex((band) => amount < band.below);

/** The areas in the two most deprived deciles. */
export const mostDeprived = (area: Area): boolean => area.decile <= 2;
