// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.file after its verdict (migration 0041, ADR 0030): later scans,
// withholding, restoring and staff deletion, each by its own role; the hash
// that never changes; one link and one release, only through a link's
// triggers; and an erased file that changes no more but for its release.

import { createHash } from 'node:crypto';

import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { addApplication, addFile } from '../grants/application-fixtures.ts';
import {
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  outcome,
  type TestTenant,
} from '../tenants.ts';

const OTHER_HASH = createHash('sha256').update('changed').digest();

let tenant: TestTenant;
let member: string;
let draft: string;
beforeAll(async () => {
  tenant = await createTestTenant();
  ({ id: draft, member } = await asMigratorIn(tenant.id, async (client) => {
    const { id, parts } = await addApplication(client, tenant);
    return { id, member: parts.member };
  }));
}, 60_000);

const clean = (id: string) => `clean/${tenant.id}/${id}`;
const withheld = (id: string) => `withheld/${tenant.id}/${id}`;

/** Change file `id` with `set` ($2 onwards are `values`): its SQLSTATE, or ok. */
function change(client: pg.ClientBase, id: string, set: string, values: unknown[] = []) {
  return outcome(client, `UPDATE app.file SET ${set} WHERE id = $1`, [id, ...values]);
}

/** Change file `id`, read `read` inside the same transaction, then undo the change. */
async function readAfter<T>(
  client: pg.ClientBase,
  id: string,
  set: string,
  values: unknown[] = [],
  read: (client: pg.ClientBase) => Promise<T> = (inside) => row(inside, id) as Promise<T>,
): Promise<T> {
  await client.query('SAVEPOINT read_after');
  try {
    await client.query(`UPDATE app.file SET ${set} WHERE id = $1`, [id, ...values]);
    return await read(client);
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT read_after');
  }
}

/** Change file `id` and keep the change for what follows. */
async function keep(client: pg.ClientBase, id: string, set: string, values: unknown[] = []) {
  await client.query(`UPDATE app.file SET ${set} WHERE id = $1`, [id, ...values]);
}

const WITHHOLD = "scan_state = 'withheld', storage_key = $2, scan_version = 2";
const RESTORE = "scan_state = 'clean', storage_key = $2, scan_version = 3";
const DELETE_WITHHELD = "scan_state = 'infected', sha256 = NULL, storage_key = NULL";

/** A clean file, and one withheld at version 2, committed as migrator. */
async function cleanAndWithheld(): Promise<[string, string]> {
  return asMigratorIn(tenant.id, async (client) => {
    const kept = await addFile(client, tenant, member);
    const held = await addFile(client, tenant, member);
    await client.query(`UPDATE app.file SET ${WITHHOLD} WHERE id = $1`, [held, withheld(held)]);
    return [kept, held];
  });
}

async function row(client: pg.ClientBase, id: string) {
  const { rows } = await client.query<Record<string, unknown>>(
    `SELECT scan_state, sha256, storage_key, scan_version, scanned_at = now() AS scanned_now,
            linked_at IS NOT NULL AS linked, released_at IS NOT NULL AS released,
            erased_at IS NOT NULL AS erased
       FROM app.file WHERE id = $1`,
    [id],
  );
  return rows[0];
}

describe('app.file after its verdict', { timeout: 30_000 }, () => {
  it('lets app_api record a later scan and withhold a clean file under its own key', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const id = await addFile(client, tenant, member);
      expect(await change(client, id, 'scan_version = 1, updated_by = $2', [member])).toBe('ok');
      expect(
        await readAfter(client, id, 'scan_version = 1, updated_by = $2', [member]),
      ).toMatchObject({ scan_version: 1, scanned_now: true });
      expect(await change(client, id, WITHHOLD, [clean(id)])).toBe('23514');
      expect(
        await change(client, id, WITHHOLD.replace(', scan_version = 2', ', scan_version = NULL'), [
          withheld(id),
        ]),
      ).toBe('23514');
      expect(await change(client, id, WITHHOLD, [withheld(id)])).toBe('ok');
      expect(await readAfter(client, id, WITHHOLD, [withheld(id)])).toMatchObject({
        scan_state: 'withheld',
        storage_key: withheld(id),
        scan_version: 2,
      });
      const updatedBy = await readAfter(client, id, 'scan_version = 1', [], async (inside) => {
        const { rows } = await inside.query<{ updated_by: string }>(
          'SELECT updated_by FROM app.file WHERE id = $1',
          [id],
        );
        return rows[0];
      });
      expect(updatedBy).toEqual({ updated_by: member });
    });
  });

  it('never changes a hash once set, nor takes a file back to pending', async () => {
    const [kept, held] = await cleanAndWithheld();
    await asRoleIn('app_api', tenant.id, async (client) => {
      for (const id of [kept, held]) {
        expect(await change(client, id, 'sha256 = $2', [OTHER_HASH])).toBe('55000');
        expect(
          await change(client, id, "scan_state = 'pending', sha256 = NULL, storage_key = NULL"),
        ).toBe('55000');
      }
    });
  });

  it('lets app_api delete a withheld file only, clearing its hash and key', async () => {
    const [kept, held] = await cleanAndWithheld();
    await asRoleIn('app_api', tenant.id, async (client) => {
      expect(await change(client, kept, DELETE_WITHHELD)).toBe('55000');
      expect(await change(client, held, "scan_state = 'infected'")).toBe('23514');
      expect(await change(client, held, RESTORE, [clean(held)])).toBe('55000');
      expect(await change(client, held, DELETE_WITHHELD)).toBe('ok');
      expect(await readAfter(client, held, DELETE_WITHHELD)).toMatchObject({
        scan_state: 'infected',
        sha256: null,
        storage_key: null,
        scanned_now: false,
      });
      await keep(client, held, DELETE_WITHHELD);
      expect(await change(client, held, "scan_state = 'error'")).toBe('55000');
    });
  });

  it('lets app_worker only record scans of and restore withheld files', async () => {
    const [kept, held] = await cleanAndWithheld();
    await asRoleIn('app_worker', tenant.id, async (client) => {
      expect(await change(client, kept, WITHHOLD, [withheld(kept)])).toBe('55000');
      expect(await change(client, kept, 'scan_version = 5')).toBe('55000');
      expect(await change(client, held, "scan_state = 'infected', storage_key = NULL")).toBe(
        '55000',
      );
      expect(await change(client, held, 'scan_version = 3')).toBe('ok');
      expect(await change(client, held, RESTORE, [clean(held)])).toBe('ok');
      expect(await readAfter(client, held, RESTORE, [clean(held)])).toMatchObject({
        scan_state: 'clean',
        storage_key: clean(held),
        scan_version: 3,
        scanned_now: true,
      });
      expect(
        await outcome(client, 'SELECT id FROM app.file WHERE id = $1 FOR UPDATE', [held]),
      ).toBe('ok');
    });
  });

  // The subject access export reads these (migration 0044), but no job changes them.
  it.each(['name', 'created_by', 'updated_by'])(
    'never lets app_worker change a file %s',
    async (column) => {
      await asRoleIn('app_worker', tenant.id, async (client) => {
        expect(await outcome(client, `SELECT ${column} FROM app.file`)).toBe('ok');
        expect(await outcome(client, `UPDATE app.file SET ${column} = ${column}`)).toBe('42501');
      });
    },
  );

  it("links a file once and releases it once, only through a link's triggers", async () => {
    const file = await asMigratorIn(tenant.id, (client) => addFile(client, tenant, member));
    await asRoleIn('app_api', tenant.id, async (client) => {
      expect(await outcome(client, 'SELECT app.link_file($1)', [file])).toBe('55000');
      expect(await change(client, file, 'linked_at = now()')).toBe('55000');
      const link = await insertRow(client, 'grants.application_file', {
        tenant_id: tenant.id,
        application_id: draft,
        file_id: file,
        field_id: 'f_accounts',
        created_by: member,
      });
      expect(await row(client, file)).toMatchObject({ linked: true, released: false });
      expect(await outcome(client, 'SELECT app.release_file($1)', [file])).toBe('55000');
      await client.query('DELETE FROM grants.application_file WHERE id = $1', [link]);
      expect(await row(client, file)).toMatchObject({ linked: true, released: true });
      expect(await change(client, file, 'released_at = NULL')).toBe('55000');
    });
  });

  it('erases a file: no name, hash, key or withheld state, and then no change but its release', async () => {
    const [, held] = await cleanAndWithheld();
    await asRoleIn('migrator', tenant.id, async (client) => {
      expect(await change(client, held, 'erased_at = now(), scan_version = 9')).toBe('55000');
      expect(await change(client, held, 'erased_at = now()')).toBe('ok');
      await keep(client, held, 'erased_at = now()');
      const { rows } = await client.query('SELECT name FROM app.file WHERE id = $1', [held]);
      expect(rows[0]).toEqual({ name: 'Erased file' });
      expect(await row(client, held)).toMatchObject({
        scan_state: 'infected',
        sha256: null,
        storage_key: null,
        erased: true,
      });
      for (const set of [
        'scan_version = 3',
        "scan_state = 'clean'",
        "scan_state = 'withheld'",
        'sha256 = $2',
        'erased_at = NULL',
        "name = 'Again.pdf'",
      ]) {
        const values = set.includes('$2') ? [OTHER_HASH] : [];
        expect(await change(client, held, set, values), set).toBe('55000');
      }
    });
  });

  it('releases an erased file once, when its link is removed', async () => {
    const file = await asMigratorIn(tenant.id, async (client) => {
      const id = await addFile(client, tenant, member);
      await insertRow(client, 'grants.application_file', {
        tenant_id: tenant.id,
        application_id: draft,
        file_id: id,
        field_id: 'f_erased',
        created_by: member,
      });
      await client.query('UPDATE app.file SET erased_at = now() WHERE id = $1', [id]);
      return id;
    });
    await asRoleIn('app_api', tenant.id, async (client) => {
      await client.query('DELETE FROM grants.application_file WHERE file_id = $1', [file]);
      expect(await row(client, file)).toMatchObject({ erased: true, released: true });
    });
  });
});
