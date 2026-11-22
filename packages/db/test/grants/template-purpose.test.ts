// SPDX-License-Identifier: AGPL-3.0-or-later
//
// grants.email_template_version.purpose (migration 0074): an existing
// version reads as transactional with no row updated, the list copies
// S11-58's contract, a new version that names no purpose is transactional,
// an unknown purpose is refused and none is changed.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS_FOLDER } from '../../scripts/migrations.ts';
import { asMigratorRolledBack, withClient } from '../connect.ts';
import {
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  insertStatement,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import { addProgramme, templateRow } from './fixtures.ts';

const TEMPLATES = new URL(
  '../../../../modules/grants/src/contracts/programme/templates.ts',
  import.meta.url,
);
const withoutPurpose = (row: Row): Row =>
  Object.fromEntries(Object.entries(row).filter(([column]) => column !== 'purpose'));
const migration = (file: string) =>
  readFile(join(MIGRATIONS_FOLDER, '0074_grants_template_purpose', file), 'utf8');

let tenant: TestTenant;
let programme: string;
beforeAll(async () => {
  tenant = await createTestTenant();
  programme = await asMigratorIn(tenant.id, (client) => addProgramme(client, tenant));
}, 30_000);

describe('grants.email_template_version.purpose', { timeout: 30_000 }, () => {
  it('reads as transactional for a version saved before it, with no rewrite or update', async () => {
    await asMigratorRolledBack(async (client) => {
      // The down refuses while any marketing version exists, which the
      // marketing send tests leave behind and row-level security hides from
      // migrator. The owner's TRUNCATE is rolled back with the rest, and its
      // lock keeps any new version out until the down has run.
      await client.query('TRUNCATE grants.email_template_version CASCADE');
      await client.query(await migration('down.sql'));
      await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant.id]);
      const id = await insertRow(
        client,
        'grants.email_template_version',
        withoutPurpose(templateRow(tenant, programme, { version: 41 })),
      );
      const filenode = 'SELECT pg_catalog.pg_relation_filenode($1)::text AS node';
      const table = 'grants.email_template_version';
      const before = await client.query<{ node: string }>(filenode, [table]);
      await client.query(await migration('up.sql'));
      const after = await client.query<{ node: string }>(filenode, [table]);
      const { rows } = await client.query<{ purpose: string }>(
        'SELECT purpose FROM grants.email_template_version WHERE id = $1',
        [id],
      );
      expect(rows).toEqual([{ purpose: 'transactional' }]);
      // The table was not rewritten.
      expect(after.rows).toEqual(before.rows);
    });
  });

  it('refuses to roll back while a marketing version exists', async () => {
    await asMigratorRolledBack(async (client) => {
      await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant.id]);
      await insertRow(
        client,
        'grants.email_template_version',
        templateRow(tenant, programme, { version: 45, purpose: 'marketing' }),
      );
      await client.query("SELECT pg_catalog.set_config('app.tenant_id', '', true)");
      await expect(client.query(await migration('down.sql'))).rejects.toThrow(
        /cannot be rolled back while a template version is marketing/,
      );
    });
  });

  it('reads as transactional for a new version that names no purpose', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const { text, values } = insertStatement(
        client,
        'grants.email_template_version',
        withoutPurpose(templateRow(tenant, programme, { version: 44 })),
      );
      const { rows } = await client.query<{ purpose: string }>(`${text} RETURNING purpose`, values);
      expect(rows).toEqual([{ purpose: 'transactional' }]);
    });
  });

  it("copies S11-58's purposes", async () => {
    const { templatePurposes } = (await import(TEMPLATES.href)) as {
      templatePurposes: Readonly<Record<string, string>>;
    };
    const { rows } = await withClient('app_api', (client) =>
      client.query<{ definition: string }>(
        `SELECT pg_catalog.pg_get_constraintdef(oid) AS definition FROM pg_catalog.pg_constraint
          WHERE conrelid = 'grants.email_template_version'::regclass
            AND conname = 'email_template_version_purpose_check'`,
      ),
    );
    const literals = [...(rows[0]?.definition ?? '').matchAll(/'([a-z_]+)'::text/g)];
    expect(literals.map((match) => match[1])).toEqual(Object.keys(templatePurposes));
  });

  it.each([
    ['accepts marketing', { purpose: 'marketing' }, 'ok'],
    ['accepts transactional', { purpose: 'transactional' }, 'ok'],
    ['refuses an unknown purpose', { purpose: 'newsletter' }, '23514'],
    ['refuses no purpose', { purpose: null }, '23502'],
  ])('%s', async (_, change, expected) => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const { text, values } = insertStatement(
        client,
        'grants.email_template_version',
        templateRow(tenant, programme, { version: 42, ...change }),
      );
      expect(await outcome(client, text, values)).toBe(expected);
    });
  });

  it('is never changed', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const { text, values } = insertStatement(
        client,
        'grants.email_template_version',
        templateRow(tenant, programme, { version: 43 }),
      );
      await client.query(text, values);
      expect(
        await outcome(client, "UPDATE grants.email_template_version SET purpose = 'marketing'"),
      ).toBe('42501');
    });
  });
});
