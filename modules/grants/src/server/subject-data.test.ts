// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Keeps the grants module's column lists for subject access in step with the
// classification map and its subject paths, which a module may not import,
// and fails when a table with a subject path is neither read nor excluded.

import { classification, subjectPaths } from '@pixel-scientists/db/classification';
import { describe, expect, it } from 'vitest';

import { subjectTables, withheld } from './subject-data.ts';

/** Grants tables with a subject path that the contribution leaves out, each with its reason. */
const excluded: Record<string, string> = withheld.tables;

describe('grants subject tables', () => {
  it.each(Object.entries(subjectTables))(
    '%s lists every classified column with its sensitivity, but for the answers and those withheld',
    (table, { columns }) => {
      const mapped = Object.entries(classification[table] ?? {})
        .filter(([column]) => column !== 'answers' && !(`${table}.${column}` in withheld.columns))
        .map(([column, { sensitivity }]) => [column, sensitivity]);
      expect([...columns].sort()).toEqual(mapped.sort());
    },
  );

  it.each(Object.entries(subjectTables))(
    '%s is read by its subject path',
    (table, { column, parent }) => {
      expect(subjectPaths[table]).toEqual(
        parent === undefined ? { kind: 'party', column } : { kind: 'join', column, table: parent },
      );
    },
  );

  it('reads a table after the parent it joins through', () => {
    const order = Object.keys(subjectTables);
    for (const [table, { parent }] of Object.entries(subjectTables)) {
      if (parent !== undefined) {
        expect(order.indexOf(parent), table).toBeGreaterThanOrEqual(0);
        expect(order.indexOf(parent), table).toBeLessThan(order.indexOf(table));
      }
    }
  });

  it('reads or excludes, with a reason, every grants table that has a subject path', () => {
    const left = Object.keys(subjectPaths).filter(
      (table) => table.startsWith('grants.') && !(table in subjectTables) && !(table in excluded),
    );
    expect(left).toEqual([]);
    expect(Object.keys(excluded).every((table) => excluded[table] !== '')).toBe(true);
  });

  it('names, with a plain reason, each table, column and set of rows it leaves out', () => {
    for (const table of Object.keys(withheld.tables)) {
      expect(classification).toHaveProperty([table]);
      expect(subjectTables).not.toHaveProperty([table]);
    }
    for (const id of Object.keys(withheld.columns)) {
      const [, table = '', column = ''] = /^(.+\..+)\.([^.]+)$/.exec(id) ?? [];
      expect(classification[table]).toHaveProperty([column]);
      expect(subjectTables[table]?.columns.map(([name]) => name)).not.toContain(column);
    }
    for (const table of Object.keys(withheld.rows))
      expect(subjectTables[table]?.only).toBeDefined();
    for (const group of Object.values<Record<string, string>>(withheld)) {
      expect(Object.values(group).every((reason) => reason !== '')).toBe(true);
    }
  });

  it('never reads a score, a reviewer or a stage', () => {
    const read = Object.entries(subjectTables).flatMap(([table, { columns }]) =>
      columns.map(([column]) => `${table}.${column}`),
    );
    expect(
      read.filter((id) => /score|reviewer|stage_id/.test(id) && !id.includes('transition')),
    ).toEqual([]);
  });

  it('reads the answers of an application per field', () => {
    expect(classification['grants.application']?.['answers']?.perField).toBeDefined();
  });
});
