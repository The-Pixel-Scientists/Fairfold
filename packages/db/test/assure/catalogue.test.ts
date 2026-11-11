// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The assure schema's rights and queues (migrations 0053 to 0058): every
// right an app role holds in the schema is exactly ASSURE_RIGHTS, PUBLIC
// holds none, and the module's queues are registered with their kinds.

import { describe, expect, it } from 'vitest';

import { ASSURE_RIGHTS } from '../catalogue/assure.ts';
import { APP_ROLES, withClient } from '../connect.ts';
import { heldRights } from '../privilege-lint.ts';

describe('the assure schema', () => {
  it('grants each app role exactly its listed rights, and no other', () =>
    withClient('migrator', async (client) => {
      const held = (await heldRights(client, [...APP_ROLES, 'app_operator'])).filter(
        ({ schema }) => schema === 'assure',
      );
      for (const role of APP_ROLES) {
        const actual = held
          .filter((right) => right.role === role)
          .map(({ privilege, object }) => `${privilege} on ${object}`);
        expect(actual.sort(), role).toEqual([...ASSURE_RIGHTS[role]].sort());
      }
      expect(held.filter(({ role }) => role === 'app_operator')).toEqual([]);
    }));

  it('is owned by migrator, and PUBLIC cannot use it', () =>
    withClient('migrator', async (client) => {
      const { rows } = await client.query<{ owner: string; usable: boolean }>(
        `SELECT pg_catalog.pg_get_userbyid(n.nspowner) AS owner,
                pg_catalog.has_schema_privilege('public', n.oid, 'USAGE') AS usable
           FROM pg_catalog.pg_namespace n WHERE n.nspname = 'assure'`,
      );
      expect(rows).toEqual([{ owner: 'migrator', usable: false }]);
    }));

  it('registers its queues, each with a dead-letter queue of its kind', () =>
    withClient('migrator', async (client) => {
      const { rows } = await client.query<{ name: string; kind: string; dead_letter: string }>(
        `SELECT r.name, r.kind, q.dead_letter
           FROM app.job_queue r JOIN pgboss.queue q ON q.name = r.name
          WHERE r.name LIKE 'assure.%'`,
      );
      const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : 1);
      expect(rows.sort(byName)).toEqual([
        {
          name: 'assure.registry_refresh',
          kind: 'tenant',
          dead_letter: 'assure.registry_refresh.dead',
        },
        { name: 'assure.registry_refresh.dead', kind: 'tenant', dead_letter: null },
        {
          name: 'assure.sanctions_list_refresh',
          kind: 'platform',
          dead_letter: 'assure.sanctions_list_refresh.dead',
        },
        { name: 'assure.sanctions_list_refresh.dead', kind: 'platform', dead_letter: null },
        { name: 'assure.screening', kind: 'tenant', dead_letter: 'assure.screening.dead' },
        { name: 'assure.screening.dead', kind: 'tenant', dead_letter: null },
      ]);
    }));
});
