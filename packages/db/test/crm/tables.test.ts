// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Lists, segments, interactions, external references and re-pointing
// (migration 0063): each role writes only what its grants allow, the
// database sets the times, a segment's version follows its changes (rule
// 10), an event-fed interaction is idempotent, and a re-point that would
// duplicate a row fails. No crm right reaches app_auth or app_queue.

import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../connect.ts';
import { addPerson } from '../party/fixtures.ts';
import {
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  outcome,
  type TestTenant,
} from '../tenants.ts';
import {
  addCrmParts,
  eventRow,
  filters,
  insertOutcome,
  listRow,
  noteRow,
  referenceRow,
  segmentRow,
  type CrmParts,
} from './fixtures.ts';

const CRM_TABLES = [
  'crm.list',
  'crm.list_member',
  'crm.segment',
  'crm.interaction',
  'crm.merge_record',
  'crm.import_job',
  'crm.import_row',
  'crm.external_reference',
];

let tenant: TestTenant;
let parts: CrmParts;
let survivor: string;
beforeAll(async () => {
  tenant = await createTestTenant();
  [parts, survivor] = await asMigratorIn(tenant.id, async (client) => [
    await addCrmParts(client, tenant),
    await addPerson(client, tenant),
  ]);
}, 60_000);

const asApi = (text: string, values: readonly unknown[]) =>
  asRoleIn('app_api', tenant.id, (client) => outcome(client, text, values));

describe('crm grants', () => {
  it('give app_auth, app_queue and PUBLIC nothing', async () => {
    const { rows } = await withClient('migrator', (client) =>
      client.query<{ role: string; table: string }>(
        `SELECT r.role, t.name AS table
           FROM pg_catalog.unnest($1::text[]) AS t(name)
          CROSS JOIN pg_catalog.unnest(ARRAY['app_auth', 'app_queue', 'public']) AS r(role)
          WHERE pg_catalog.has_any_column_privilege(r.role, t.name::regclass,
                  'SELECT, INSERT, UPDATE, REFERENCES')
             OR pg_catalog.has_table_privilege(r.role, t.name::regclass, 'DELETE, TRUNCATE, TRIGGER')`,
        [CRM_TABLES],
      ),
    );
    expect(rows).toEqual([]);
  });
});

describe('database-set times', { timeout: 30_000 }, () => {
  it('ignore what migrator supplies and are not granted to app roles', async () => {
    const past = '2000-01-01T00:00:00Z';
    const stamped = await asMigratorIn(tenant.id, async (client) => {
      const id = await insertRow(
        client,
        'crm.list',
        listRow(tenant, parts.member, { created_at: past, updated_at: past }),
      );
      await client.query('UPDATE crm.list SET archived_at = $2 WHERE id = $1', [id, past]);
      const { rows } = await client.query<Record<string, Date>>(
        'SELECT created_at, updated_at, archived_at FROM crm.list WHERE id = $1',
        [id],
      );
      return rows[0] ?? {};
    });
    for (const time of Object.values(stamped)) expect(time.getFullYear()).toBeGreaterThan(2000);
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'crm.list',
        listRow(tenant, parts.member, { created_at: past }),
      ),
    ).toBe('42501');
  });
});

describe('crm.list', { timeout: 30_000 }, () => {
  it('keeps a name unique among unarchived lists, and an archived list archived', async () => {
    const name = `Synthetic list ${randomUUID()}`;
    const row = listRow(tenant, parts.member, { name });
    const id = await asMigratorIn(tenant.id, (client) => insertRow(client, 'crm.list', row));
    expect(await insertOutcome('app_api', tenant, 'crm.list', row)).toBe('23505');
    await asMigratorIn(tenant.id, (client) =>
      client.query('UPDATE crm.list SET archived_at = now() WHERE id = $1', [id]),
    );
    expect(await insertOutcome('app_api', tenant, 'crm.list', row)).toBe('ok');
    expect(await asApi('UPDATE crm.list SET archived_at = NULL WHERE id = $1', [id])).toBe('23514');
    expect(await asApi('DELETE FROM crm.list WHERE id = $1', [id])).toBe('42501');
  });
});

describe('crm.segment', { timeout: 30_000 }, () => {
  let segment: string;
  beforeAll(async () => {
    segment = await asMigratorIn(tenant.id, (client) =>
      insertRow(client, 'crm.segment', segmentRow(tenant, parts.member)),
    );
  });

  it('takes a change with its next version and config version, in one transaction', () =>
    asRoleIn('app_api', tenant.id, async (client) => {
      await client.query(
        'UPDATE crm.segment SET definition = $2, version = version + 1 WHERE id = $1',
        [segment, filters('status', 'ne', 'archived')],
      );
      const { rows } = await client.query<{ version: number }>(
        `INSERT INTO app.config_version (tenant_id, entity_type, entity_id, version, author_id, diff)
         SELECT tenant_id, 'crm.segment', id, version, $2, '{"changes": []}' FROM crm.segment
          WHERE id = $1
         RETURNING version`,
        [segment, parts.member],
      );
      expect(rows).toEqual([{ version: 2 }]);
    }));

  it('refuses a skipped, kept or lone version change', async () => {
    const set = (assignments: string) => `UPDATE crm.segment SET ${assignments} WHERE id = $1`;
    expect(await asApi(set("name = 'Renamed segment'"), [segment])).toBe('23514');
    expect(await asApi(set("name = 'Renamed segment', version = version + 2"), [segment])).toBe(
      '23514',
    );
    expect(await asApi(set('version = version + 1'), [segment])).toBe('23514');
    expect(await asApi(set('archived_at = now()'), [segment])).toBe('ok');
    expect(await asApi('DELETE FROM crm.segment WHERE id = $1', [segment])).toBe('42501');
  });
});

describe('crm.interaction', { timeout: 30_000 }, () => {
  it('takes manual rows from app_api and event-fed rows from app_worker only', async () => {
    const note = noteRow(tenant, parts.person, parts.member);
    const event = eventRow(tenant, parts.person);
    expect(await insertOutcome('app_api', tenant, 'crm.interaction', note)).toBe('ok');
    expect(await insertOutcome('app_api', tenant, 'crm.interaction', event)).toBe('42501');
    expect(await insertOutcome('app_worker', tenant, 'crm.interaction', event)).toBe('ok');
    expect(await insertOutcome('app_worker', tenant, 'crm.interaction', note)).toBe('42501');
  });

  it('checks the source reference, kind and summary together', async () => {
    const worker = (change: Record<string, unknown>) =>
      insertOutcome(
        'app_worker',
        tenant,
        'crm.interaction',
        eventRow(tenant, parts.person, change),
      );
    expect(await worker({ source_module: 'crm' })).toBe('23514');
    expect(await worker({ source_module: 'assure' })).toBe('23514');
    expect(await worker({ source_entity_type: 'grants.score' })).toBe('23514');
    expect(await worker({ source_entity_id: null })).toBe('23514');
    expect(await worker({ kind: 'note' })).toBe('23514');
    const api = (change: Record<string, unknown>) =>
      insertOutcome(
        'app_api',
        tenant,
        'crm.interaction',
        noteRow(tenant, parts.person, parts.member, change),
      );
    expect(await api({ summary: null })).toBe('23514');
    expect(await api({ summary: ' padded' })).toBe('23514');
    expect(await api({ kind: 'decision_released' })).toBe('23514');
  });

  it('inserts a replayed event once', () =>
    withClient('app_worker', async (client) => {
      const event = eventRow(tenant, parts.person);
      const columns = Object.keys(event).join(', ');
      const values = Object.values(event);
      const insert = `INSERT INTO crm.interaction (${columns})
                      VALUES (${values.map((_, index) => `$${String(index + 1)}`).join(', ')})`;
      await client.query('BEGIN');
      try {
        await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant.id]);
        expect((await client.query(`${insert} ON CONFLICT DO NOTHING`, values)).rowCount).toBe(1);
        expect((await client.query(`${insert} ON CONFLICT DO NOTHING`, values)).rowCount).toBe(0);
        expect(await outcome(client, insert, values)).toBe('23505');
      } finally {
        await client.query('ROLLBACK');
      }
    }));
});

describe('crm.external_reference', { timeout: 30_000 }, () => {
  it('holds a system and id once, takes only https addresses, and can be removed', async () => {
    const row = referenceRow(tenant, parts.person, parts.member);
    const id = await asMigratorIn(tenant.id, (client) =>
      insertRow(client, 'crm.external_reference', row),
    );
    const add = (change: Record<string, unknown>) =>
      insertOutcome('app_api', tenant, 'crm.external_reference', { ...row, ...change });
    expect(await add({ party_id: survivor })).toBe('23505');
    expect(await add({ external_id: 'other', url: 'http://crm.example.test/1' })).toBe('23514');
    expect(await add({ external_id: 'other', url: 'https://user@crm.example.test/1' })).toBe(
      '23514',
    );
    expect(await add({ external_id: '-starts-with-a-hyphen' })).toBe('23514');
    expect(await asApi('DELETE FROM crm.external_reference WHERE id = $1', [id])).toBe('ok');
  });
});

describe('re-pointing', { timeout: 30_000 }, () => {
  it('lets app_api move party_id alone, and fails where it would duplicate a row', async () => {
    const [list, note, event] = await asMigratorIn(tenant.id, async (client) => {
      const listId = await insertRow(client, 'crm.list', listRow(tenant, parts.member));
      for (const party of [parts.person, survivor]) {
        await insertRow(client, 'crm.list_member', {
          tenant_id: tenant.id,
          list_id: listId,
          party_id: party,
          added_by: parts.member,
        });
      }
      const event = eventRow(tenant, parts.person);
      await insertRow(client, 'crm.interaction', { ...event, party_id: survivor });
      return [
        listId,
        await insertRow(client, 'crm.interaction', noteRow(tenant, parts.person, parts.member)),
        await insertRow(client, 'crm.interaction', event),
      ];
    });
    const repoint = (table: string, where: string, values: unknown[]) =>
      asApi(`UPDATE ${table} SET party_id = $1 WHERE ${where}`, [survivor, ...values]);
    expect(await repoint('crm.interaction', 'id = $2', [note])).toBe('ok');
    expect(await repoint('crm.interaction', 'id = $2', [event])).toBe('23505');
    expect(
      await repoint('crm.list_member', 'list_id = $2 AND party_id = $3', [list, parts.person]),
    ).toBe('23505');
    expect(await asApi("UPDATE crm.interaction SET summary = 'x' WHERE id = $1", [note])).toBe(
      '42501',
    );
    expect(
      await asRoleIn('app_worker', tenant.id, (client) =>
        outcome(client, 'UPDATE crm.interaction SET party_id = $1 WHERE id = $2', [survivor, note]),
      ),
    ).toBe('42501');
  });
});
