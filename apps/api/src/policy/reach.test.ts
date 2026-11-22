// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { kyselyOn } from '../../../../packages/db/src/database.ts';
import {
  listRoutes,
  reachDescriptor,
  reachFilter,
  reachFilterUsed,
  reachResolvers,
  type ReachDescriptor,
} from './reach.ts';

const cases: ReachDescriptor = {
  record: 'cases.case',
  table: 'cases.case',
  access: { table: 'cases.case_access', recordColumn: 'case_id' },
  param: 'caseId',
  creates: ['POST /console/cases'],
};

const contract = (method: string, path: string, scope: string, record?: string) => ({
  contract: { method, path, scope, record, audience: 'console' } as never,
});

describe('reachDescriptor', () => {
  it('accepts identifiers and refuses anything else, since they are put into queries', () => {
    expect(reachDescriptor(cases)).toBe(cases);
    for (const bad of [
      { table: 'cases.case; DROP TABLE app.tenant' },
      { table: 'case' },
      { access: { table: 'cases.case_access', recordColumn: 'case id' } },
      { access: { table: 'cases."case_access"', recordColumn: 'case_id' } },
      { param: 'Case-Id' },
    ]) {
      expect(() => reachDescriptor({ ...cases, ...bad })).toThrow(/not valid/);
    }
  });
});

describe('reachResolvers', () => {
  it('registers nothing without a descriptor, so a route on a reach rule stops start-up', () => {
    expect(reachResolvers([])).toEqual({});
  });

  it('registers both rules for the descriptors given', () => {
    expect(Object.keys(reachResolvers([cases]))).toEqual(['reachable', 'caseload']);
  });
});

describe('reachFilter', () => {
  const caller = { membership: { id: 'member-1', permissions: new Set<never>() } };
  // Queries are only compiled here, so the connection is never used.
  const db = kyselyOn<Record<string, Record<string, unknown>>>({
    query: () => Promise.reject(new Error('No database in this test.')),
  } as unknown as Parameters<typeof kyselyOn>[0]);

  it('takes the member from the caller, as a bound value and not as text', () => {
    const { sql, parameters } = db
      .selectFrom('cases.case')
      .select('id')
      .where((eb) => reachFilter(eb, caller, cases, 'reachable'))
      .compile();
    expect(sql).toContain('"cases"."case"."restricted"');
    expect(sql).not.toContain('member-1');
    expect(parameters).toContain('member-1');
    expect(reachFilterUsed(caller)).toBe(true);
  });

  it('leaves break-glass out of a list', () => {
    const { sql } = db
      .selectFrom('cases.case')
      .select('id')
      .where((eb) => reachFilter(eb, caller, cases, 'reachable'))
      .compile();
    expect(sql).not.toContain('break_glass');
  });

  it('reports a caller that never asked for it', () => {
    expect(reachFilterUsed({ membership: { id: 'member-2', permissions: new Set<never>() } })).toBe(
      false,
    );
  });
});

describe('listRoutes', () => {
  const routes = [
    contract('GET', '/console/cases', 'reachable', 'cases.case'),
    contract('POST', '/console/cases', 'reachable', 'cases.case'),
    contract('GET', '/console/cases/:caseId', 'reachable', 'cases.case'),
    contract('POST', '/console/cases/:caseId/notes', 'reachable', 'cases.case'),
    contract('GET', '/console/cases/export', 'caseload', 'cases.case'),
    contract('GET', '/console/team', 'tenant'),
  ];

  it('finds the routes that list, search, count or export, and leaves detail and create routes', () => {
    const found = listRoutes(routes, [cases]).map(({ contract: c }) => `${c.method} ${c.path}`);
    expect(found).toEqual(['GET /console/cases', 'GET /console/cases/export']);
  });

  it('stops for a route that names a record with no descriptor', () => {
    expect(() => listRoutes(routes, [])).toThrow(/no descriptor/);
  });
});
