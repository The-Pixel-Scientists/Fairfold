// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.delete_swept_file() and app.erase_file() (migration 0042, ADR 0030):
// only app_worker may call them, in a tenant, on that tenant's files. The
// sweep removes a released row, or a refused row no record links once 12
// months have passed since its scan, and nothing else. Erasure needs a
// running erasure request whose party is erased.

import { beforeAll, describe, expect, it } from 'vitest';

import { addErasureRequest, callAs, erase } from '../erasure/fixtures.ts';
import { addApplication, addFile } from '../grants/application-fixtures.ts';
import { withClient } from '../connect.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  insertRow,
  type TestTenant,
} from '../tenants.ts';

const SWEEP = 'SELECT app.delete_swept_file($1) AS deleted';
const ERASE_FILE = 'SELECT app.erase_file($1, $2) AS erased';

let tenant: TestTenant;
let other: TestTenant;
let member: string;
let draft: string;
let person: string;
let request: string;
let otherFile: string;
beforeAll(async () => {
  tenant = await createTestTenant();
  other = await createTestTenant();
  await asMigratorIn(tenant.id, async (client) => {
    const { id, parts } = await addApplication(client, tenant);
    draft = id;
    member = parts.member;
    person = parts.person;
    request = await addErasureRequest(client, tenant, await addMember(client, tenant), person);
  });
  otherFile = await asMigratorIn(other.id, async (client) => {
    const { parts } = await addApplication(client, other);
    return addFile(client, other, parts.member, 'infected');
  });
}, 60_000);

/** A clean file linked to the draft, then released by removing its link. */
function releasedFile(): Promise<string> {
  return asMigratorIn(tenant.id, async (client) => {
    const file = await addFile(client, tenant, member);
    const link = await insertRow(client, 'grants.application_file', {
      tenant_id: tenant.id,
      application_id: draft,
      file_id: file,
      field_id: 'f_accounts',
      created_by: member,
    });
    await client.query('DELETE FROM grants.application_file WHERE id = $1', [link]);
    return file;
  });
}

/** An infected file scanned `months` ago, with the scan trigger off for the backdating. */
async function refusedFile(months: number): Promise<string> {
  const file = await asMigratorIn(tenant.id, (client) =>
    addFile(client, tenant, member, 'infected'),
  );
  await withClient('migrator', async (client) => {
    await client.query('BEGIN');
    await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant.id]);
    await client.query('ALTER TABLE app.file DISABLE TRIGGER record_file_scan');
    await client.query(
      'UPDATE app.file SET scanned_at = now() - make_interval(months => $2) WHERE id = $1',
      [file, months],
    );
    await client.query('ALTER TABLE app.file ENABLE TRIGGER record_file_scan');
    await client.query('COMMIT');
  });
  return file;
}

const sweep = (on: TestTenant | undefined, file: string) => callAs('app_worker', on, SWEEP, [file]);

describe('app.delete_swept_file', { timeout: 30_000 }, () => {
  it.each(['app_api', 'app_auth', 'app_queue'] as const)('cannot be called by %s', async (role) => {
    expect((await callAs(role, tenant, SWEEP, [otherFile])).code).toBe('42501');
  });

  it('needs a tenant', async () => {
    expect((await sweep(undefined, otherFile)).code).toBe('55000');
  });

  it("removes a released row, once, and never another tenant's", async () => {
    const file = await releasedFile();
    expect((await sweep(other, file)).row).toEqual({ deleted: false });
    expect((await sweep(tenant, file)).row).toEqual({ deleted: true });
    expect((await sweep(tenant, file)).row).toEqual({ deleted: false });
  });

  it('removes a refused, unlinked row only 12 months after its scan', async () => {
    expect((await sweep(tenant, await refusedFile(11))).row).toEqual({ deleted: false });
    expect((await sweep(tenant, await refusedFile(13))).row).toEqual({ deleted: true });
    expect((await sweep(other, otherFile)).row).toEqual({ deleted: false });
  });

  it('keeps a clean file, linked or not', async () => {
    const loose = await asMigratorIn(tenant.id, (client) => addFile(client, tenant, member));
    expect((await sweep(tenant, loose)).row).toEqual({ deleted: false });
  });
});

describe('app.erase_file', { timeout: 30_000 }, () => {
  it.each(['app_api', 'app_auth', 'app_queue'] as const)('cannot be called by %s', async (role) => {
    expect((await callAs(role, tenant, ERASE_FILE, [otherFile, request])).code).toBe('42501');
  });

  it('erases only under a running request whose party is erased, once', async () => {
    const file = await asMigratorIn(tenant.id, (client) => addFile(client, tenant, member));
    expect((await callAs('app_worker', tenant, ERASE_FILE, [file, request])).code).toBe('42501');
    expect((await erase(tenant, person, request)).code).toBeUndefined();
    const erasing = (on: TestTenant) => callAs('app_worker', on, ERASE_FILE, [file, request]);
    expect((await erasing(other)).code).toBe('42501');
    expect((await erasing(tenant)).row).toEqual({ erased: true });
    expect((await erasing(tenant)).row).toEqual({ erased: false });
    const stored = await asMigratorIn(tenant.id, async (client) => {
      const { rows } = await client.query<Record<string, unknown>>(
        'SELECT name, sha256, storage_key FROM app.file WHERE id = $1',
        [file],
      );
      return rows[0];
    });
    expect(stored).toEqual({ name: 'Erased file', sha256: null, storage_key: null });
  });
});
