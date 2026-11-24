// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The column lists in subject-data.ts copy the classification map, which a
// module may not import; this test keeps them in step: every assure table
// with a person on its subject path is listed, with every classified column
// and its sensitivity, and the subject column is the map's.

import { classification, subjectPaths } from '@pixel-scientists/db/classification';
import { describe, expect, it } from 'vitest';

import { subjectTables } from './subject-data.ts';

const personTables = Object.entries(subjectPaths).filter(
  ([table, path]) => table.startsWith('assure.') && path.kind !== 'unlinked',
);

describe('assure subject data', () => {
  it('lists every assure table the map reaches a party through', () => {
    expect(Object.keys(subjectTables).sort()).toEqual(personTables.map(([table]) => table).sort());
  });

  it.each(Object.entries(subjectTables))('%s keeps its columns in step', (table, listed) => {
    const mapped = Object.entries(classification[table] ?? {}).map(
      ([column, { sensitivity }]) => [column, sensitivity] as const,
    );
    expect([...listed.columns].sort()).toEqual([...mapped].sort());
  });

  it.each(Object.entries(subjectTables))(
    '%s reaches the subject as the map says',
    (table, listed) => {
      const path = subjectPaths[table];
      if (path?.kind === 'parties') expect(path.columns).toEqual(listed.column);
      else expect(path).toMatchObject({ column: listed.column });
      if (path?.kind === 'join') expect(path.table).toBe(listed.parent);
    },
  );
});
