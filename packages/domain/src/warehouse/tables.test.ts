// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, expectTypeOf, it } from 'vitest';

import type { WarehouseColumn, WarehouseTable } from './model.ts';
import {
  warehouseColumns,
  warehouseTableNames,
  warehouseTables,
  type ClassificationLookup,
  type WarehouseRow,
  type WarehouseTableOf,
} from './tables.ts';

const tables = Object.entries(warehouseTables) as [string, WarehouseTable][];

function columnsOf(table: WarehouseTable): [string, WarehouseColumn][] {
  return Object.entries(table.columns);
}

/** Every source the model names, at the level given, unless `levels` says otherwise. */
function classify(level: string, levels: Record<string, string> = {}): ClassificationLookup {
  const map: Record<string, Record<string, { sensitivity: string }>> = {};
  for (const [, table] of tables) {
    for (const [, { from }] of columnsOf(table)) {
      if (from === 'module') continue;
      for (const source of from) {
        const dot = source.lastIndexOf('.');
        (map[source.slice(0, dot)] ??= {})[source.slice(dot + 1)] = {
          sensitivity: levels[source] ?? level,
        };
      }
    }
  }
  return map;
}

describe('the warehouse model', () => {
  it('has the shared tables, then the grants tables, and no payment table yet', () => {
    expect(warehouseTableNames).toEqual([
      'organisation',
      'person',
      'programme',
      'commitment',
      'date',
      'grants_round',
      'grants_application',
      'grants_score',
    ]);
  });

  it('names tables and columns as plain SQL identifiers, and keys each table by a column', () => {
    const identifier = /^[a-z][a-z0-9_]{0,62}$/;
    for (const [name, table] of tables) {
      expect(name).toMatch(identifier);
      expect(Object.keys(table.columns)).toContain(table.key);
      expect(table.rows).not.toBe('');
      for (const [column] of columnsOf(table)) expect(column, name).toMatch(identifier);
    }
  });

  it('names a source column, as schema.table.column, for every column', () => {
    for (const [name, table] of tables) {
      for (const [column, { from }] of columnsOf(table)) {
        if (from === 'module') continue;
        expect(from.length, `${name}.${column}`).toBeGreaterThan(0);
        for (const source of from)
          expect(source).toMatch(/^(?:app|party|grants)\.[a-z_]+\.[a-z_]+$/);
      }
    }
  });

  it('takes organisations and people from the party module only, keyed by the source id', () => {
    expect(warehouseTables.organisation.module).toBe('party');
    expect(warehouseTables.person.module).toBe('party');
    expect(warehouseTables.organisation.columns.id.from).toEqual(['party.organisation.id']);
    expect(warehouseTables.person.columns.id.from).toEqual(['party.person.id']);
  });

  it('gives source_module to the shared tables any module may feed, and to no other', () => {
    const withSourceModule = tables
      .filter(([, table]) => columnsOf(table).some(([, { from }]) => from === 'module'))
      .map(([name]) => name);
    expect(withSourceModule).toEqual(['programme', 'commitment']);
    expect(warehouseTables.programme.columns.source_module.type).toBe('text');
  });

  it('holds a commitment as an amount in minor units with a currency code', () => {
    const { amount_minor, currency } = warehouseTables.commitment.columns;
    expect(amount_minor).toMatchObject({ type: 'bigint', nullable: false });
    expect(currency).toMatchObject({ type: 'text', nullable: false });
  });

  it('shows a decision only once released', () => {
    // Commitments are released awards only, so each row is one.
    expect(warehouseTables.commitment.rows).toMatch(/^Released awards only/);
    // Anywhere else, every column from a decision depends on its release.
    for (const [name, table] of tables.filter(([other]) => other !== 'commitment')) {
      for (const [column, { from }] of columnsOf(table)) {
        if (from === 'module' || !from.some((source) => source.startsWith('grants.decision.'))) {
          continue;
        }
        expect(from, `${name}.${column}`).toContain('grants.decision.released_at');
      }
    }
  });

  it('leaves out drafts, which never reach the console, so every application was submitted', () => {
    const { rows, columns } = warehouseTables.grants_application;
    expect(rows).toBe(
      'Every submitted or withdrawn application, without its answers; drafts are left out.',
    );
    expect(columns.submitted_at.nullable).toBe(false);
  });

  it('leaves out application answers and review comments', () => {
    const sources = tables.flatMap(([, table]) =>
      columnsOf(table).flatMap(([, { from }]) => (from === 'module' ? [] : from)),
    );
    expect(sources).not.toContain('grants.application.answers');
    expect(sources).not.toContain('grants.score.comment');
  });

  it('types each row by its columns, without source_module', () => {
    expectTypeOf<WarehouseRow<'commitment'>>().toEqualTypeOf<{
      readonly id: string;
      readonly programme_id: string;
      readonly organisation_id: string;
      readonly amount_minor: number;
      readonly currency: string;
      readonly committed_on: string;
    }>();
    expectTypeOf<WarehouseRow<'organisation'>['org_id_verified']>().toEqualTypeOf<boolean | null>();
    expectTypeOf<WarehouseTableOf<'party'>>().toEqualTypeOf<'organisation' | 'person'>();
    expectTypeOf<WarehouseTableOf<'grants'>>().toEqualTypeOf<
      'programme' | 'commitment' | 'grants_round' | 'grants_application' | 'grants_score'
    >();
  });
});

describe('warehouseColumns', () => {
  it('lets every column through when its sources are public or internal', () => {
    for (const name of warehouseTableNames) {
      expect(warehouseColumns(name, classify('internal'))).toEqual(
        Object.keys(warehouseTables[name].columns),
      );
      expect(warehouseColumns(name, classify('public'))).toEqual(
        Object.keys(warehouseTables[name].columns),
      );
    }
  });

  it('leaves out a column with any personal or special category source', () => {
    for (const level of ['personal', 'special_category', 'secret']) {
      const map = classify('internal', { 'party.organisation_identifier.verified_at': level });
      expect(warehouseColumns('organisation', map)).toEqual([
        'id',
        'status',
        'name',
        'legal_form',
        'website',
        'org_id',
        'created_at',
      ]);
      const name = classify('internal', { 'party.organisation.name': level });
      expect(warehouseColumns('organisation', name)).not.toContain('name');
    }
  });

  it('fails for a column whose source the classification map does not list', () => {
    const map = classify('internal');
    const { score, ...rest } = map['grants.score'] ?? {};
    expect(score).toBeDefined();
    expect(() => warehouseColumns('grants_score', { ...map, 'grants.score': rest })).toThrow(
      'grants_score.score comes from grants.score.score, which the classification map does not list.',
    );
    const { 'grants.round': round, ...withoutRound } = map;
    expect(round).toBeDefined();
    expect(() => warehouseColumns('grants_round', withoutRound)).toThrow(/does not list/);
  });

  it('reads only the map’s own entries', () => {
    const map = classify('internal');
    const inherited = Object.create(map['party.organisation'] ?? null) as Record<
      string,
      { sensitivity: string }
    >;
    expect(() =>
      warehouseColumns('organisation', { ...map, 'party.organisation': inherited }),
    ).toThrow(/does not list/);
  });

  it('fails rather than leave out a table’s key', () => {
    const map = classify('internal', { 'party.person.id': 'personal' });
    expect(() => warehouseColumns('person', map)).toThrow(
      'The key person.id has a source that is neither public nor internal.',
    );
  });
});
