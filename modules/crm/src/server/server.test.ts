// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What crm's server entry point promises without a database: which routes it
// answers, that each needs a crm permission the reviewer role lacks and that
// the merge routes need step-up, that nothing but a route reaches the merge
// executor (architecture rule 9), and that its subject access columns stay in
// step with the classification map, which a module may not import.

import { readdirSync, readFileSync } from 'node:fs';

import { permissionsFor } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';

import { classification, subjectPaths } from '../../../../packages/db/classification.ts';
import { crmRoutes, segmentFields } from '../contracts/index.ts';
import * as server from './index.ts';
import { subjectTables } from './subject-data.ts';

const handlers = server.crmHandlers({} as server.CrmDependencies);

/** Routes another task owns, or that wait for a schema or a decision. */
const notBuilt = [
  'reverseMerge',
  'dismissDuplicate',
  'getTimeline',
  'recordInteraction',
  'listExternalReferences',
  'addExternalReference',
  'removeExternalReference',
  'startImport',
  'getImport',
  'listImportRows',
  'confirmImport',
];

describe('crm routes', () => {
  const built = Object.entries(crmRoutes).filter(([name]) => !notBuilt.includes(name));

  it('answers every route this task builds, and none by accident', () => {
    expect(Object.keys(handlers).sort()).toEqual(built.map(([name]) => name).sort());
  });

  it.each(built)('%s needs a crm permission that a reviewer does not hold', (_name, route) => {
    expect(route.module).toBe('crm');
    expect(permissionsFor(['reviewer'], 'console')).not.toContain(route.permission);
    expect(permissionsFor(['programme_manager'], 'console')).toContain(route.permission);
  });

  it('asks for step-up on the merge routes and on no other', () => {
    const stepUp = built.filter(([, route]) => 'stepUp' in route).map(([name]) => name);
    expect(stepUp.sort()).toEqual(['confirmMerge', 'previewMerge']);
  });

  it('has no job, handler list or timer for a merge to hide in', () => {
    expect(Object.keys(server).sort()).toEqual([
      'crmErasure',
      'crmHandlers',
      'crmRepoint',
      'crmSubjectData',
    ]);
  });
});

describe('crm segment filters', () => {
  it('stay on fields the classification map calls public or internal', () => {
    const levels: string[] = Object.values(segmentFields).map(({ sensitivity }) => sensitivity);
    expect(levels.every((level) => level === 'public' || level === 'internal')).toBe(true);
  });
});

describe('crm subject tables', () => {
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

  it('reads party only through its server contract, never from a party table (ADR 0016)', () => {
    const files = readdirSync(import.meta.dirname).filter(
      (name) => name.endsWith('.ts') && !name.includes('.test.'),
    );
    expect(files).toContain('search.ts');
    for (const name of files) {
      const source = readFileSync(`${import.meta.dirname}/${name}`, 'utf8');
      expect(source, name).not.toMatch(/['"`]party\.[a-z_]+/);
    }
  });
});
