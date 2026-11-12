// SPDX-License-Identifier: AGPL-3.0-or-later
//
// assure.reference_list and assure.sanctions_entry (migration 0053, ADR
// 0031): the named exception to rule 2. app_api and app_worker read them;
// no app role writes, changes or removes a row, and app_auth and app_queue
// cannot read them. Only listed individuals carry personal details, and the
// trigram index serves a similarity search.

import { beforeAll, describe, expect, it } from 'vitest';

import { RIGHTS_ROLES, withClient, withRoleClient } from '../connect.ts';
import { asMigratorIn, createTestTenant, outcome, type TestTenant } from '../tenants.ts';
import { addEntry, addList, entryRow } from './fixtures.ts';

let tenant: TestTenant;
let list: string;
let entry: string;

beforeAll(async () => {
  tenant = await createTestTenant();
  ({ list, entry } = await asMigratorIn(tenant.id, async (client) => {
    const id = await addList(client);
    return { list: id, entry: await addEntry(client, id) };
  }));
}, 60_000);

/** The SQLSTATE of `statement` as `role`, with a tenant set, always undone. */
function as(role: (typeof RIGHTS_ROLES)[number], statement: string, values: unknown[] = []) {
  return withRoleClient(role, async (client) => {
    await client.query('BEGIN');
    try {
      await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant.id]);
      return await outcome(client, statement, values);
    } finally {
      await client.query('ROLLBACK');
    }
  });
}

for (const table of ['assure.reference_list', 'assure.sanctions_entry']) {
  const id = () => (table === 'assure.reference_list' ? list : entry);

  describe(table, { timeout: 30_000 }, () => {
    it('is read by app_api and app_worker only', async () => {
      for (const role of RIGHTS_ROLES) {
        const expected = ['app_api', 'app_worker'].includes(role) ? 'ok' : '42501';
        expect(await as(role, `SELECT id FROM ${table} WHERE id = $1`, [id()]), role).toBe(
          expected,
        );
      }
    });

    it('is written, changed and removed by no app role, whatever tenant is set', async () => {
      for (const role of RIGHTS_ROLES) {
        for (const statement of [
          `UPDATE ${table} SET id = id WHERE id = $1`,
          `DELETE FROM ${table} WHERE id = $1`,
        ]) {
          expect(await as(role, statement, [id()]), `${role}: ${statement}`).toBe('42501');
        }
        expect(
          await as(role, `INSERT INTO ${table} (id) VALUES (gen_random_uuid())`),
          `${role} inserts`,
        ).toBe('42501');
      }
    });
  });
}

describe('assure.sanctions_entry', { timeout: 30_000 }, () => {
  /** The SQLSTATE of adding an entry with `change`, as migrator, always undone. */
  const added = (change: Record<string, unknown>) =>
    withClient('migrator', async (client) => {
      await client.query('BEGIN');
      try {
        await client.query('ALTER TABLE assure.sanctions_entry NO FORCE ROW LEVEL SECURITY');
        const row = entryRow(list, change);
        const names = Object.keys(row);
        return await outcome(
          client,
          `INSERT INTO assure.sanctions_entry (${names.join(', ')})
           VALUES (${names.map((_, index) => `$${String(index + 1)}`).join(', ')})`,
          Object.values(row),
        );
      } finally {
        await client.query('ROLLBACK');
      }
    });

  it('holds personal details for individuals only', async () => {
    expect(await added({})).toBe('ok');
    expect(await added({ entry_kind: 'entity' })).toBe('23514');
    expect(await added({ entry_kind: 'ship', dates_of_birth: [], nationalities: [] })).toBe('ok');
  });

  it.each([
    ['a date of birth that is not a published partial date', { dates_of_birth: ['1 May 1970'] }],
    ['a missing date of birth', { dates_of_birth: [null] }],
    ['an unknown kind', { entry_kind: 'vessel' }],
    ['a blank name', { name: '' }],
    ['a name with a control character', { name: 'Invented\tName' }],
  ])('refuses %s', async (_name, change) => {
    expect(await added(change)).toBe('23514');
  });

  it('has no column for PEP, adverse-media or other free text', async () => {
    const { rows } = await withClient('migrator', (client) =>
      client.query<{ name: string }>(
        `SELECT attname AS name FROM pg_catalog.pg_attribute
          WHERE attrelid = 'assure.sanctions_entry'::regclass AND attnum > 0 AND NOT attisdropped
          ORDER BY attnum`,
      ),
    );
    expect(rows.map(({ name }) => name)).toEqual([
      'id',
      'list_id',
      'designation_id',
      'entry_kind',
      'name_type',
      'name',
      'normalised_name',
      'regime',
      'designated_on',
      'dates_of_birth',
      'nationalities',
      'country',
      'superseded_at',
    ]);
  });

  it('searches the normalised name through its trigram index', async () => {
    const plan = await withRoleClient('app_worker', async (client) => {
      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL enable_seqscan = off');
        const { rows } = await client.query<{ 'QUERY PLAN': string }>(
          `EXPLAIN SELECT id FROM assure.sanctions_entry
            WHERE normalised_name OPERATOR(ext.%) 'invented listd person'`,
        );
        return rows.map((row) => row['QUERY PLAN']).join('\n');
      } finally {
        await client.query('ROLLBACK');
      }
    });
    expect(plan).toContain('sanctions_entry_normalised_name_trgm');
  });
});
