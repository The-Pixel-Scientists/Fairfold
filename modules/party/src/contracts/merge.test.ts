// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  countsByTable,
  mergeCountsSchema,
  registerRepoints,
  type RepointParty,
  type RepointRow,
} from './merge.ts';

type Module = RepointParty<unknown>['module'];

function repoint(module: Module): RepointParty<unknown> {
  const ok = () => Promise.resolve({ ok: true as const, rows: [] });
  return { module, repoint: ok, restore: ok };
}

describe('registerRepoints', () => {
  it("keeps every module's re-point, party's own included", () => {
    const list = registerRepoints([repoint('party'), repoint('grants')]);
    expect(list.map((item) => item.module)).toEqual(['party', 'grants']);
    expect(Object.isFrozen(list)).toBe(true);
  });

  it('refuses a module twice, a list without party, or an unknown module', () => {
    expect(() => registerRepoints([repoint('party'), repoint('party')])).toThrow();
    expect(() => registerRepoints([repoint('grants')])).toThrow();
    expect(() => registerRepoints([repoint('party'), repoint('nope' as Module)])).toThrow();
  });
});

describe('merge counts', () => {
  it('count changed rows by table', () => {
    const row = (table: string, n: number, change: RepointRow['change']): RepointRow => ({
      table,
      rowId: `${n}c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5`,
      change,
    });
    const rows = [
      row('grants.application', 5, 'repointed'),
      row('grants.application', 6, 'repointed'),
      row('party.relationship', 7, 'link_ended'),
    ];
    expect(countsByTable(rows)).toEqual({ 'grants.application': 2, 'party.relationship': 1 });
  });

  it('name modules and tables only', () => {
    expect(mergeCountsSchema.safeParse({ grants: { 'grants.application': 2 } }).success).toBe(true);
    for (const counts of [
      { grants: { tenant_id: 1 } },
      { nope: { 'a.b': 1 } },
      { grants: { 'grants.application': -1 } },
    ]) {
      expect(mergeCountsSchema.safeParse(counts).success).toBe(false);
    }
  });
});
