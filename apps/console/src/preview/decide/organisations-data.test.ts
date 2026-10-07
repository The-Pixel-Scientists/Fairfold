// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { organisationRows } from './organisations-data.ts';

describe('the organisations list', () => {
  it('gives every organisation the area it applied from', () => {
    expect(organisationRows.every((row) => row.area !== '')).toBe(true);
  });

  it('counts Northfield Community Trust’s three applications and its one grant', () => {
    expect(organisationRows.find((row) => row.name === 'Northfield Community Trust')).toMatchObject(
      {
        area: 'Northfield Central',
        applications: 3,
        grants: 1,
        awarded: 8_000,
        record: '/organisations/northfield-community-trust',
      },
    );
  });

  it('counts no grant for Spring 2027 applications, whose decisions are still private', () => {
    expect(organisationRows.filter((row) => row.grants > 0)).toHaveLength(1);
  });
});
