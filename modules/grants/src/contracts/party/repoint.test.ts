// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The re-point declaration against the real schema, read through the
// classification map, which the schema lint keeps equal to the database.

import { classification } from '@pixel-scientists/db/classification';
import { countsByTable, mergeConflicts } from '@pixel-scientists/party/contracts';
import { describe, expect, it } from 'vitest';

import {
  grantsPartyKeys,
  grantsPartyKeysExcluded,
  grantsRepointConflicts,
  grantsRepointCountsSchema,
  grantsRepointTables,
} from './repoint.ts';

/** A column named for a person, organisation or party, such as `organisation_snapshot_id`. */
const PARTY_KEY = /(?:^|_)(?:person|organisation|party)(?:_[a-z]+)*_id$/;

const schemaColumns = Object.entries(classification)
  .filter(([table]) => table.startsWith('grants.'))
  .flatMap(([table, columns]) => Object.keys(columns).map((column) => `${table}.${column}`));

const listed = grantsPartyKeys.map(({ table, column }) => `${table}.${column}`);
const excluded = grantsPartyKeysExcluded.map(({ table, column }) => `${table}.${column}`);

describe('grants party keys', () => {
  it('list or exclude every party key column in the grants schema', () => {
    const partyKeys = schemaColumns.filter((path) => PARTY_KEY.test(path.split('.')[2] ?? ''));
    expect(partyKeys.length).toBeGreaterThan(0);
    for (const path of partyKeys) {
      expect([...listed, ...excluded], `${path} is neither listed nor excluded`).toContain(path);
    }
  });

  it('name the task that adds a listed column the schema does not have yet', () => {
    for (const key of grantsPartyKeys) {
      const path = `${key.table}.${key.column}`;
      if (schemaColumns.includes(path)) continue;
      expect('plannedIn' in key ? key.plannedIn : undefined, path).toMatch(/^S\d{2}-\d{2}$/);
    }
  });

  it('never re-point the organisation details as submitted', () => {
    expect(excluded).toEqual(['grants.application.organisation_snapshot_id']);
    expect(schemaColumns).toContain(excluded[0]);
    expect(listed).not.toContain(excluded[0]);
  });

  it('are each listed once, with the kind their name says', () => {
    expect(new Set(listed).size).toBe(listed.length);
    for (const { column, kind } of grantsPartyKeys) {
      expect(column.endsWith(`${kind}_id`), column).toBe(true);
    }
  });
});

describe('grants re-point counts', () => {
  it('are keyed by the listed tables only, each a whole number of rows', () => {
    expect(Object.keys(grantsRepointCountsSchema.shape)).toEqual(grantsRepointTables);
    expect(grantsRepointTables.every((table) => /^grants\.[a-z_]+$/.test(table))).toBe(true);
    const parse = (value: unknown) => grantsRepointCountsSchema.safeParse(value).success;
    expect(parse({ 'grants.application': 2, 'grants.decision_email': 0 })).toBe(true);
    expect(parse({})).toBe(true);
    expect(parse({ 'grants.application': -1 })).toBe(false);
    expect(parse({ 'grants.application': 1.5 })).toBe(false);
    expect(parse({ 'grants.score': 1 })).toBe(false);
  });

  it('carry no status, outcome or amount', () => {
    for (const key of ['status', 'outcome', 'amountMinor', 'award_amount']) {
      expect(Object.keys(grantsRepointCountsSchema.shape).join(' ')).not.toContain(key);
      expect(grantsRepointCountsSchema.safeParse({ [key]: 0 }).success, key).toBe(false);
    }
  });

  it("take the counts party's executor derives from the rows changed", () => {
    const row = (table: string, n: number) => ({
      table,
      rowId: `00000000-0000-4000-8000-00000000000${n}`,
      change: 'repointed' as const,
    });
    const counts = countsByTable([
      row('grants.application', 1),
      row('grants.application', 2),
      row('grants.decision_email', 3),
    ]);
    expect(grantsRepointCountsSchema.parse(counts)).toEqual({
      'grants.application': 2,
      'grants.decision_email': 1,
    });
  });
});

describe('grants re-point conflicts', () => {
  it("come from party's closed list only", () => {
    for (const conflict of Object.values(grantsRepointConflicts)) {
      expect(mergeConflicts).toContain(conflict);
    }
  });

  // Migration 0019's key (tenant_id, organisation_id, organisation_snapshot_id)
  // ties an application with a snapshot to the snapshot's organisation, and
  // the snapshot never changes, so that application cannot be re-pointed.
  // Until a migration loosens the key (a decision for Aaron), grants refuses.
  // Withdrawn applications and decision emails are not listed here on
  // purpose: a refusal would block every person merge after a release, so
  // they wait on the migration repoint.ts names before S12-31. Whoever
  // lands it removes this note; adding conflicts instead changes this list.
  it('refuse an organisation merge whose loser has an application with a snapshot', () => {
    expect(listed).toContain('grants.application.organisation_id');
    expect(schemaColumns).toContain('grants.application.organisation_snapshot_id');
    expect(grantsRepointConflicts).toEqual({
      liveApplicationInRound: 'module_refused',
      submittedApplicationSnapshot: 'module_refused',
    });
  });
});
