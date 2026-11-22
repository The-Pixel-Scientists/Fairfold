// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The privacy schema's rights and queue (migrations 0089 to 0092): every right an app
// role holds in the schema is exactly PRIVACY_RIGHTS, so app_auth, app_queue
// and PUBLIC hold none and no role may write id or a time the database sets;
// and the deadline reminder's queue is registered with its kind.

import { describe, expect, it } from 'vitest';

import { PRIVACY_RIGHTS } from '../catalogue/privacy.ts';
import { APP_ROLES, withClient } from '../connect.ts';
import { heldRights } from '../privilege-lint.ts';

const DATABASE_SET = [
  'id',
  'created_at',
  'updated_at',
  'completed_at',
  'ico_recorded_at',
  'subjects_recorded_at',
  'signed_off_at',
  'archived_at',
];

describe('the privacy schema', () => {
  it('grants each app role exactly its listed rights, and no other', () =>
    withClient('migrator', async (client) => {
      const held = (await heldRights(client, [...APP_ROLES, 'app_operator'])).filter(
        ({ schema }) => schema === 'privacy',
      );
      for (const role of APP_ROLES) {
        const actual = held
          .filter((right) => right.role === role)
          .map(({ privilege, object }) => `${privilege} on ${object}`);
        expect(actual.sort(), role).toEqual([...PRIVACY_RIGHTS[role]].sort());
      }
      expect(held.filter(({ role }) => role === 'app_operator')).toEqual([]);
    }));

  it('lets no app role insert a column the database sets, nor update one but an archive', () => {
    const writes = Object.values(PRIVACY_RIGHTS)
      .flat()
      .filter((right) => /^(INSERT|UPDATE) on column /.test(right));
    for (const right of writes) {
      const column = right.split('.').at(-1) ?? '';
      const allowed = right.startsWith('UPDATE') && column === 'archived_at';
      expect(DATABASE_SET.includes(column) && !allowed, right).toBe(false);
    }
  });

  it('is owned by migrator, and PUBLIC cannot use it', () =>
    withClient('migrator', async (client) => {
      const { rows } = await client.query<{ owner: string; usable: boolean }>(
        `SELECT pg_catalog.pg_get_userbyid(n.nspowner) AS owner,
                pg_catalog.has_schema_privilege('public', n.oid, 'USAGE') AS usable
           FROM pg_catalog.pg_namespace n WHERE n.nspname = 'privacy'`,
      );
      expect(rows).toEqual([{ owner: 'migrator', usable: false }]);
    }));

  it('registers the deadline reminder, with a dead-letter queue of its kind', () =>
    withClient('migrator', async (client) => {
      const { rows } = await client.query<{ name: string; kind: string; dead_letter: string }>(
        `SELECT r.name, r.kind, q.dead_letter
           FROM app.job_queue r JOIN pgboss.queue q ON q.name = r.name
          WHERE r.name LIKE 'privacy.%' ORDER BY r.name`,
      );
      expect(rows).toEqual([
        {
          name: 'privacy.deadline_reminder',
          kind: 'tenant',
          dead_letter: 'privacy.deadline_reminder.dead',
        },
        { name: 'privacy.deadline_reminder.dead', kind: 'tenant', dead_letter: null },
      ]);
    }));
});
