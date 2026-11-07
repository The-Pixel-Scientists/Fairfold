// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Every table outside the party schema whose subject path reaches a party
// carries the erasure guards (ADR 0027, "erased is final"), read from the
// classification map as the schema lint will read it: a path that starts at
// a party column has party.refuse_erased_party on that column, on insert
// and on its update; and each personal or special category column has a
// row trigger, before insert and before its update, that calls
// party.is_erased. app.audit_event is the named exception: it records the
// erasure itself.

import { beforeAll, describe, expect, it } from 'vitest';

import { classification, subjectPaths } from '../../classification.ts';
import { withClient } from '../connect.ts';

const EXCEPTIONS = new Set(['app.audit_event']);

/** Whether `table`'s subject path ends at a party, following its joins. */
function reachesParty(table: string, seen: ReadonlySet<string> = new Set()): boolean {
  const path = subjectPaths[table];
  if (!path || seen.has(table)) return false;
  if (path.kind === 'party') return true;
  return path.kind === 'join' && reachesParty(path.table, new Set([...seen, table]));
}

const GUARDED = Object.keys(subjectPaths)
  .filter((table) => !table.startsWith('party.') && !EXCEPTIONS.has(table))
  .filter((table) => reachesParty(table))
  .sort();

/** A row trigger that fires before an insert or an update. */
interface Guard {
  readonly fn: string;
  readonly calls: boolean;
  readonly insert: boolean;
  readonly update: boolean;
  readonly columns: readonly string[];
  readonly args: readonly string[];
}

const triggers = new Map<string, readonly Guard[]>();

beforeAll(async () => {
  await withClient('migrator', async (client) => {
    for (const table of GUARDED) {
      const { rows } = await client.query<Guard>(
        `SELECT p.oid::pg_catalog.regproc::text AS fn,
                p.prosrc LIKE '%party.is_erased(%' AS calls,
                (t.tgtype & 4) <> 0 AS insert, (t.tgtype & 16) <> 0 AS update,
                ARRAY(SELECT a.attname::text FROM pg_catalog.pg_attribute a
                       WHERE a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr)) AS columns,
                pg_catalog.string_to_array(pg_catalog.encode(t.tgargs, 'escape'), '\\000') AS args
           FROM pg_catalog.pg_trigger t
           JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
          WHERE t.tgrelid = $1::pg_catalog.regclass AND NOT t.tgisinternal
            AND t.tgenabled <> 'D' AND (t.tgtype & 3) = 3`,
        [table],
      );
      triggers.set(table, rows);
    }
  });
});

/** Whether `guard` fires on an update of `column`. */
const onUpdateOf = (guard: Guard, column: string) =>
  guard.update && (guard.columns.length === 0 || guard.columns.includes(column));

describe('the erasure guards', () => {
  it('cover the tables whose path reaches a party', () => {
    expect(GUARDED).toEqual(
      expect.arrayContaining([
        'app.subject_key',
        'grants.application',
        'grants.decision_email',
        'grants.score',
      ]),
    );
  });

  it.each(GUARDED)('guard %s', (table) => {
    const guards = (triggers.get(table) ?? []).filter((guard) => guard.calls);
    const path = subjectPaths[table];
    if (path?.kind === 'party') {
      const column = path.column;
      const refuses = guards.filter(
        (guard) => guard.fn === 'party.refuse_erased_party' && guard.args.includes(column),
      );
      expect(
        refuses.some((guard) => guard.insert),
        `insert naming ${column}`,
      ).toBe(true);
      expect(
        refuses.some((guard) => onUpdateOf(guard, column)),
        `update of ${column}`,
      ).toBe(true);
    }
    const personal = Object.entries(classification[table] ?? {})
      .filter(
        ([, field]) => field.sensitivity === 'personal' || field.sensitivity === 'special_category',
      )
      .map(([column]) => column);
    for (const column of personal) {
      expect(
        guards.some((guard) => guard.insert),
        `insert setting ${column}`,
      ).toBe(true);
      expect(
        guards.some((guard) => onUpdateOf(guard, column)),
        `update of ${column}`,
      ).toBe(true);
    }
  });
});
