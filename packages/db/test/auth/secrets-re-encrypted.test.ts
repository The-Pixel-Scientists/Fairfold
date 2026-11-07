// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The secrets_re_encrypted event (migration 0035, ADR 0010): it carries the
// key version and its three counts, an empty or incomplete reason, and no
// user, tenant, identifier or address; no other event carries a version or
// count; app_auth alone may insert them; and down.sql refuses, changing
// nothing, while such an event exists.

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS_FOLDER } from '../../scripts/migrations.ts';
import { APP_ROLES, asMigratorRolledBack, withClient } from '../connect.ts';
import { createTestTenant, outcome, type TestTenant } from '../tenants.ts';
import { asRoleRolledBack } from './fixtures.ts';

const COUNTS = ['key_version', 'totp_count', 'sso_count', 'backup_notice_count'];

let tenant: TestTenant;
beforeAll(async () => {
  tenant = await createTestTenant();
});

describe('the secrets_re_encrypted event', { timeout: 30_000 }, () => {
  it('carries the version and counts and nothing that names anyone', async () => {
    await asRoleRolledBack('app_auth', async (client) => {
      const insert = (code: string, columns: string, values: string) =>
        outcome(
          client,
          `INSERT INTO auth.audit_event (request_id, code, ${columns}) VALUES ($1, '${code}', ${values})`,
          [randomUUID()],
        );
      const full = 'key_version, totp_count, sso_count, backup_notice_count';
      expect(await insert('secrets_re_encrypted', full, '2, 3, 1, 0')).toBe('ok');
      expect(
        await insert('secrets_re_encrypted', `${full}, reason`, "2, 0, 0, 0, 'incomplete'"),
      ).toBe('ok');
      for (const [columns, values] of [
        ['key_version, totp_count, sso_count', '2, 3, 1'],
        [full, '0, 0, 0, 0'],
        [full, '2, -1, 0, 0'],
        [`${full}, reason`, "2, 0, 0, 0, 'failed'"],
        [`${full}, tenant_id`, `2, 0, 0, 0, '${tenant.id}'`],
        [`${full}, identifier`, "2, 0, 0, 0, 'someone@example.test'"],
        [`${full}, ip_address`, "2, 0, 0, 0, '203.0.113.9'"],
      ] as const) {
        expect(await insert('secrets_re_encrypted', columns, values), columns).toBe('23514');
      }
      for (const column of COUNTS) {
        expect(await insert('signed_out', column, '1'), column).toBe('23514');
      }
    });
  });

  it('lets app_auth alone insert the counts, and no role update them', async () => {
    const { rows } = await withClient('app_auth', (client) =>
      client.query<{ right: string }>(
        `SELECT r.name || ' ' || p.privilege || ' ' || c.name AS right
           FROM pg_catalog.unnest($1::text[]) AS r(name)
          CROSS JOIN pg_catalog.unnest($2::text[]) AS c(name)
          CROSS JOIN (VALUES ('INSERT'), ('UPDATE')) AS p(privilege)
          WHERE pg_catalog.has_column_privilege(r.name, 'auth.audit_event', c.name, p.privilege)
          ORDER BY 1`,
        [APP_ROLES, COUNTS],
      ),
    );
    expect(rows.map(({ right }) => right)).toEqual(
      [...COUNTS].sort().map((column) => `app_auth INSERT ${column}`),
    );
  });

  it('cannot be rolled back while such an event exists', async () => {
    const down = await readFile(
      join(MIGRATIONS_FOLDER, '0035_auth_secrets_re_encrypted', 'down.sql'),
      'utf8',
    );
    await asMigratorRolledBack(async (client) => {
      await client.query(
        `INSERT INTO auth.audit_event
           (request_id, code, key_version, totp_count, sso_count, backup_notice_count)
         VALUES ($1, 'secrets_re_encrypted', 2, 0, 0, 0)`,
        [randomUUID()],
      );
      await expect(client.query(down)).rejects.toThrow(/cannot be rolled back/);
    });
  });
});
