// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The catalogue checks for ADR 0009's exception: every right an app role
// holds in pgboss or on app.job_queue is exactly JOB_RIGHTS, on every job
// table (pgboss.job and each partition of it), and every queue is
// registered with a kind its dead-letter queue shares.

import { describe, expect, it } from 'vitest';

import { APP_ROLES, withClient } from '../connect.ts';
import { heldRights } from '../privilege-lint.ts';
import { JOB_RIGHTS } from './index.ts';

describe('the pgboss catalogue', () => {
  it('lists every app role right in pgboss and on app.job_queue, and no other', () =>
    withClient('migrator', async (client) => {
      const { rows } = await client.query<{ table: string }>(
        `SELECT 'pgboss.' || c.relname AS table
           FROM pg_catalog.pg_class c
          WHERE c.oid = 'pgboss.job'::regclass
             OR c.oid IN (SELECT i.inhrelid FROM pg_catalog.pg_inherits i
                           WHERE i.inhparent = 'pgboss.job'::regclass)
          ORDER BY 1`,
      );
      const jobTables = rows.map((row) => row.table);
      expect(jobTables).toContain('pgboss.job_common');

      const held = (await heldRights(client, APP_ROLES)).filter(
        ({ schema, object }) => schema === 'pgboss' || /^(column )?app\.job_queue\b/.test(object),
      );
      for (const role of APP_ROLES) {
        const { schema, table } = JOB_RIGHTS[role];
        const expected = [
          ...schema,
          ...jobTables.flatMap((name) => table.map((right) => right.replaceAll('%', name))),
        ];
        const actual = held
          .filter((right) => right.role === role)
          .map(({ privilege, object }) => `${privilege} on ${object}`);
        expect(actual.sort(), role).toEqual(expected.sort());
      }
    }));

  it('registers every queue, each dead-letter queue with its source kind', () =>
    withClient('migrator', async (client) => {
      const { rows } = await client.query<{ problem: string }>(
        `SELECT 'Queue ' || q.name || ' is not in app.job_queue.' AS problem
           FROM pgboss.queue q LEFT JOIN app.job_queue r ON r.name = q.name
          WHERE r.name IS NULL
         UNION ALL
         SELECT 'Queue ' || q.name || ' and its dead-letter queue differ in kind.'
           FROM pgboss.queue q
           JOIN app.job_queue s ON s.name = q.name
           JOIN app.job_queue d ON d.name = q.dead_letter
          WHERE s.kind <> d.kind`,
      );
      expect(rows.map((row) => row.problem)).toEqual([]);
    }));
});
