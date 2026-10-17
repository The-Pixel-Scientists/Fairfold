// SPDX-License-Identifier: AGPL-3.0-or-later
//
// grants.application_file (migration 0011, ADR 0047): isolation, keys to
// the tenant's own applications, files and members, one link per file, and
// links added or removed only on a draft, for clean files only.

import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial } from '../cross-tenant.ts';
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
import { addApplication, addFile, submit, type Parts } from './application-fixtures.ts';

function linkRow(tenant: TestTenant, application: string, file: string, member: string): Row {
  return {
    tenant_id: tenant.id,
    application_id: application,
    file_id: file,
    field_id: 'f_accounts',
    created_by: member,
  };
}

/** A tenant's draft and its parts, and another tenant's draft, member and clean file. */
let tenant: TestTenant;
let draft: string;
let parts: Parts;
let strangers: { application: string; member: string; file: string };
beforeAll(async () => {
  tenant = await createTestTenant();
  const stranger = await createTestTenant();
  ({ id: draft, parts } = await asMigratorIn(tenant.id, (client) =>
    addApplication(client, tenant),
  ));
  strangers = await asMigratorIn(stranger.id, async (client) => {
    const { id, parts: own } = await addApplication(client, stranger);
    return {
      application: id,
      member: own.member,
      file: await addFile(client, stranger, own.member),
    };
  });
}, 60_000);

describe('grants.application_file', { timeout: 30_000 }, () => {
  it("keeps each tenant's file links from every other tenant", async () => {
    await expectCrossTenantDenial('grants.application_file', async (client, owner) => {
      const { id, parts: own } = await addApplication(client, owner);
      return linkRow(owner, id, await addFile(client, owner, own.member), own.member);
    });
  });

  it('links a clean file to a draft once, and unlinks it, but never changes a link', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const file = await addFile(client, tenant, parts.member);
      const row = linkRow(tenant, draft, file, parts.member);
      const id = await insertRow(client, 'grants.application_file', row);
      const again = insertStatement(client, 'grants.application_file', row);
      expect(await outcome(client, again.text, again.values)).toBe('23505');
      for (const set of ["field_id = 'f_other'", 'application_id = application_id']) {
        const update = `UPDATE grants.application_file SET ${set} WHERE id = $1`;
        expect(await outcome(client, update, [id]), set).toBe('42501');
      }
      const removed = await client.query('DELETE FROM grants.application_file WHERE id = $1', [id]);
      expect(removed.rowCount).toBe(1);
    });
  });

  it.each([
    ["refuses another tenant's file", { file_id: '<strangers file>' }, '23503'],
    [
      "refuses another tenant's application",
      { application_id: '<strangers application>' },
      '23503',
    ],
    ['refuses a creator from another tenant', { created_by: '<stranger>' }, '23503'],
    ['refuses no creator', { created_by: null }, '23502'],
    ['refuses a field id in another format', { field_id: 'accounts' }, '23514'],
    ['refuses a creation time from the caller', { created_at: new Date() }, '42501'],
  ])('%s', async (_, change: Row, expected) => {
    const ids: Readonly<Record<string, string>> = {
      '<strangers file>': strangers.file,
      '<strangers application>': strangers.application,
      '<stranger>': strangers.member,
    };
    await asRoleIn('app_api', tenant.id, async (client) => {
      const file = await addFile(client, tenant, parts.member);
      const values = Object.fromEntries(
        Object.entries(change).map(([column, value]) => [
          column,
          typeof value === 'string' ? (ids[value] ?? value) : value,
        ]),
      );
      const statement = insertStatement(client, 'grants.application_file', {
        ...linkRow(tenant, draft, file, parts.member),
        ...values,
      });
      expect(await outcome(client, statement.text, statement.values)).toBe(expected);
    });
  });

  it.each(['pending', 'infected', 'error'] as const)('refuses a %s file', async (state) => {
    const file = await asMigratorIn(tenant.id, (client) =>
      addFile(client, tenant, parts.member, state),
    );
    await asRoleIn('app_api', tenant.id, async (client) => {
      const statement = insertStatement(
        client,
        'grants.application_file',
        linkRow(tenant, draft, file, parts.member),
      );
      expect(await outcome(client, statement.text, statement.values)).toBe('55000');
    });
  });

  it('refuses linking to or unlinking from a submitted application', async () => {
    const [submitted, linked, spare] = await asMigratorIn(tenant.id, async (client) => {
      const { id, parts: own } = await addApplication(client, tenant);
      const file = await addFile(client, tenant, own.member);
      await insertRow(client, 'grants.application_file', linkRow(tenant, id, file, own.member));
      await submit(client, id, own.stages[0]);
      return [id, file, await addFile(client, tenant, own.member)];
    });
    await asRoleIn('app_api', tenant.id, async (client) => {
      const statement = insertStatement(
        client,
        'grants.application_file',
        linkRow(tenant, submitted, spare, parts.member),
      );
      expect(await outcome(client, statement.text, statement.values)).toBe('55000');
      const unlink = 'DELETE FROM grants.application_file WHERE file_id = $1';
      expect(await outcome(client, unlink, [linked])).toBe('55000');
    });
  });
});
