// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Keeps the party module's column lists for subject access in step with the
// classification map and its subject paths, which a module may not import.

import { classification, subjectPaths } from '@pixel-scientists/db/classification';
import { describe, expect, it } from 'vitest';

import { subjectTables } from './subject-data.ts';

describe('party subject tables', () => {
  it.each(Object.entries(subjectTables))(
    '%s lists every classified column with its sensitivity',
    (table, { columns }) => {
      const mapped = Object.entries(classification[table] ?? {}).map(
        ([column, { sensitivity }]) => [column, sensitivity],
      );
      expect([...columns].sort()).toEqual(mapped.sort());
    },
  );

  it.each(Object.entries(subjectTables))(
    '%s is read by its party subject path',
    (table, { subjectColumn }) => {
      expect(subjectPaths[table]).toEqual(
        typeof subjectColumn === 'string'
          ? { kind: 'party', column: subjectColumn }
          : { kind: 'parties', columns: subjectColumn },
      );
    },
  );

  it('leaves out only the tables an organisation owns', () => {
    const left = Object.entries(subjectPaths).filter(
      ([table, path]) =>
        table.startsWith('party.') && path.kind === 'party' && !(table in subjectTables),
    );
    expect(left.map(([table]) => table).sort()).toEqual([
      'party.organisation',
      'party.organisation_identifier',
      'party.organisation_snapshot',
    ]);
  });
});
