// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The audit_copy_replayed event (migration 0038, ADR 0010): it carries the
// replayed event's id and a tenant, and no user, identifier, address or
// reason; no other event carries a replayed event id; app_auth alone may
// insert it; the pending copies are indexed by time; and down.sql refuses,
// changing nothing, while such an event exists.

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS_FOLDER } from '../../scripts/migrations.ts';
import { APP_ROLES, asMigratorRolledBack, withClient } from '../connect.ts';
import { createTestTenant, outcome, type TestTenant } from '../tenants.ts';
import { asRoleRolledBack } from './fixtures.ts';

let tenant: TestTenant;
beforeAll(async () => {
  tenant = await createTestTenant();
});

describe('the audit_copy_replayed event', { timeout: 30_000 }, () => {
  it('carries the replayed event and its tenant, and nothing that names anyone', async () => {
    await asRoleRolledBack('app_auth', async (client) => {
      const insert = (code: string, columns: string, values: string) =>
        outcome(
          client,
          `INSERT INTO auth.audit_event (request_id, code, ${columns}) VALUES ($1, '${code}', ${values})`,
          [randomUUID()],
        );
      const full = 'replayed_event_id, tenant_id';
      const ids = `'${randomUUID()}', '${tenant.id}'`;
      expect(await insert('audit_copy_replayed', full, ids)).toBe('ok');
      for (const [columns, values] of [
        ['replayed_event_id', `'${randomUUID()}'`],
        ['tenant_id', `'${tenant.id}'`],
        [`${full}, user_id`, `${ids}, '${randomUUID()}'`],
        [`${full}, identifier`, `${ids}, 'someone@example.test'`],
        [`${full}, ip_address`, `${ids}, '203.0.113.9'`],
        [`${full}, reason`, `${ids}, 'replayed'`],
      ] as const) {
        expect(await insert('audit_copy_replayed', columns, values), columns).toBe('23514');
      }
      expect(await insert('signed_out', 'replayed_event_id', `'${randomUUID()}'`)).toBe('23514');
    });
  });

  it('lets app_auth alone insert the replayed event id, and no role update it', async () => {
    const { rows } = await withClient('app_auth', (client) =>
      client.query<{ right: string }>(
        `SELECT r.name || ' ' || p.privilege AS right
           FROM pg_catalog.unnest($1::text[]) AS r(name)
          CROSS JOIN (VALUES ('INSERT'), ('UPDATE')) AS p(privilege)
          WHERE pg_catalog.has_column_privilege(
                  r.name, 'auth.audit_event', 'replayed_event_id', p.privilege)
          ORDER BY 1`,
        [APP_ROLES],
      ),
    );
    expect(rows.map(({ right }) => right)).toEqual(['app_auth INSERT']);
  });

  it('indexes the pending copies by time', async () => {
    const { rows } = await withClient('app_auth', (client) =>
      client.query<{ definition: string }>(
        `SELECT pg_catalog.pg_get_indexdef(i.indexrelid) AS definition
           FROM pg_catalog.pg_index i
          WHERE i.indexrelid = 'auth.audit_copy_pending_created_at'::regclass`,
      ),
    );
    expect(rows).toEqual([
      {
        definition:
          'CREATE INDEX audit_copy_pending_created_at ON auth.audit_copy_pending USING btree (created_at)',
      },
    ]);
  });

  it('cannot be rolled back while such an event exists', async () => {
    const down = await readFile(
      join(MIGRATIONS_FOLDER, '0038_auth_audit_copy_replayed', 'down.sql'),
      'utf8',
    );
    await asMigratorRolledBack(async (client) => {
      await client.query(
        `INSERT INTO auth.audit_event (request_id, code, replayed_event_id, tenant_id)
         VALUES ($1, 'audit_copy_replayed', $2, $3)`,
        [randomUUID(), randomUUID(), tenant.id],
      );
      await expect(client.query(down)).rejects.toThrow(/cannot be rolled back/);
    });
  });
});
