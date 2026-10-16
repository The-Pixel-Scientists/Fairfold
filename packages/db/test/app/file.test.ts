// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.file (migration 0008): isolation, the columns app_api may write, the
// one-way scan state, the storage key rule and the checks on each column.

import { createHash, randomUUID } from 'node:crypto';

import { MAX_FILE_BYTES } from '@pixel-scientists/domain/files';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial } from '../cross-tenant.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  insertStatement,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';

const PDF = 'application/pdf';
const HASH = createHash('sha256').update('Accounts 2025').digest();

/** A tenant with a member, and another tenant with its own member. */
let tenant: TestTenant;
let other: TestTenant;
let member: string;
let stranger: string;
beforeAll(async () => {
  tenant = await createTestTenant();
  other = await createTestTenant();
  member = await asMigratorIn(tenant.id, (client) => addMember(client, tenant));
  stranger = await asMigratorIn(other.id, (client) => addMember(client, other));
}, 30_000);

function file(change: Row = {}): Row {
  return {
    tenant_id: tenant.id,
    name: 'Accounts 2025.pdf',
    content_type: PDF,
    size_bytes: 1024,
    created_by: member,
    ...change,
  };
}

function keyOf(tenantId: string, id: string): string {
  return `clean/${tenantId}/${id}`;
}

/** Insert a pending file through `client` and return its id. */
function addFile(client: pg.ClientBase, change: Row = {}): Promise<string> {
  return insertRow(client, 'app.file', file(change));
}

/** Record a verdict on file `id`, keeping it if it succeeds: its SQLSTATE, or ok. */
async function scan(
  client: pg.ClientBase,
  id: string,
  state: string,
  hash: unknown,
  key: unknown,
): Promise<string> {
  await client.query('SAVEPOINT scan');
  try {
    await client.query(
      'UPDATE app.file SET scan_state = $2, sha256 = $3, storage_key = $4 WHERE id = $1',
      [id, state, hash, key],
    );
    await client.query('RELEASE SAVEPOINT scan');
    return 'ok';
  } catch (error) {
    const { code } = error as pg.DatabaseError;
    if (!code) throw error;
    await client.query('ROLLBACK TO SAVEPOINT scan');
    return code;
  }
}

interface Stored {
  scan_state: string;
  scanned_now: boolean | null;
  created_now: boolean;
  sha256: Buffer | null;
  storage_key: string | null;
}

async function stored(client: pg.ClientBase, id: string): Promise<Stored | undefined> {
  const { rows } = await client.query<Stored>(
    `SELECT scan_state, scanned_at = now() AS scanned_now, created_at = now() AS created_now,
            sha256, storage_key
       FROM app.file WHERE id = $1`,
    [id],
  );
  return rows[0];
}

describe('app.file', { timeout: 30_000 }, () => {
  it("keeps each tenant's files from every other tenant", async () => {
    await expectCrossTenantDenial('app.file', async (client, owner) => ({
      tenant_id: owner.id,
      name: 'Budget.xlsx',
      content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size_bytes: 2048,
      created_by: await addMember(client, owner),
    }));
  });

  it('lets app_api add a pending file and record a clean verdict once', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const id = randomUUID();
      expect(await addFile(client, { id })).toBe(id);
      expect(await stored(client, id)).toEqual({
        scan_state: 'pending',
        scanned_now: null,
        created_now: true,
        sha256: null,
        storage_key: null,
      });

      expect(await scan(client, id, 'clean', HASH, keyOf(tenant.id, id))).toBe('ok');
      expect(await stored(client, id)).toEqual({
        scan_state: 'clean',
        scanned_now: true,
        created_now: true,
        sha256: HASH,
        storage_key: keyOf(tenant.id, id),
      });

      expect(await scan(client, id, 'error', null, null)).toBe('55000');
      expect(await outcome(client, 'UPDATE app.file SET scan_state = scan_state')).toBe('55000');
    });
  });

  it.each(['infected', 'error'])('records %s with a scan time only, once', async (state) => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const id = await addFile(client);
      expect(await scan(client, id, state, HASH, null)).toBe('23514');
      expect(await scan(client, id, state, null, keyOf(tenant.id, id))).toBe('23514');
      expect(await scan(client, id, state, null, null)).toBe('ok');
      expect((await stored(client, id))?.scanned_now).toBe(true);
      expect(await scan(client, id, 'clean', HASH, keyOf(tenant.id, id))).toBe('55000');
    });
  });

  it('refuses a clean file without its hash, its key or its own key', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const id = await addFile(client);
      const otherId = await addFile(client);
      for (const [hash, key] of [
        [HASH, null],
        [null, keyOf(tenant.id, id)],
        [HASH.subarray(1), keyOf(tenant.id, id)],
        [Buffer.concat([HASH, Buffer.from([0])]), keyOf(tenant.id, id)],
        [HASH, keyOf(other.id, id)],
        [HASH, keyOf(tenant.id, otherId)],
        [HASH, `${keyOf(tenant.id, id)}/`],
        [HASH, keyOf(tenant.id, id).toUpperCase()],
        [HASH, `quarantine/${tenant.id}/${id}`],
      ]) {
        expect(await scan(client, id, 'clean', hash, key), String(key)).toBe('23514');
      }
      expect(await scan(client, id, 'pending', HASH, null)).toBe('23514');
      expect(await scan(client, id, 'quarantined', null, null)).toBe('23514');
      expect(await scan(client, id, 'pending', null, null)).toBe('ok');
      expect((await stored(client, id))?.scan_state).toBe('pending');
    });
  });

  it('refuses every other write by app_api, and any delete', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const id = await addFile(client);
      for (const column of ['scan_state', 'scanned_at', 'created_at', 'sha256', 'storage_key']) {
        const value =
          { scan_state: 'clean', sha256: HASH, storage_key: 'x' }[column] ?? new Date(0);
        const { text, values } = insertStatement(client, 'app.file', file({ [column]: value }));
        expect(await outcome(client, text, values), column).toBe('42501');
      }
      for (const change of [
        "name = 'Renamed.pdf'",
        'content_type = content_type',
        'size_bytes = 1',
        'created_by = created_by',
        'scanned_at = now()',
        'created_at = now()',
        'tenant_id = tenant_id',
        'id = id',
      ]) {
        expect(await outcome(client, `UPDATE app.file SET ${change}`), change).toBe('42501');
      }
      expect(await outcome(client, 'DELETE FROM app.file WHERE id = $1', [id])).toBe('42501');
    });
  });

  it('sets the scan columns and times itself, whatever any role supplies', async () => {
    await asRoleIn('migrator', tenant.id, async (client) => {
      const id = await addFile(client, {
        scan_state: 'clean',
        scanned_at: new Date(0),
        created_at: new Date(0),
        sha256: HASH,
        storage_key: keyOf(tenant.id, randomUUID()),
      });
      expect(await stored(client, id)).toEqual({
        scan_state: 'pending',
        scanned_now: null,
        created_now: true,
        sha256: null,
        storage_key: null,
      });

      expect(await outcome(client, "UPDATE app.file SET name = 'Renamed.pdf'")).toBe('23514');
      expect(await outcome(client, "UPDATE app.file SET created_at = 'epoch'")).toBe('23514');
      await client.query(
        "UPDATE app.file SET scan_state = 'infected', scanned_at = 'epoch' WHERE id = $1",
        [id],
      );
      expect((await stored(client, id))?.scanned_now).toBe(true);
      expect(await outcome(client, "UPDATE app.file SET name = 'Renamed.pdf'")).toBe('55000');
    });
  });

  it.each([
    [
      'takes a Word document',
      { content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      'ok',
    ],
    ['refuses an SVG image', { content_type: 'image/svg+xml' }, '23514'],
    ['refuses an HTML page', { content_type: 'text/html' }, '23514'],
    ['refuses a type in capitals', { content_type: 'APPLICATION/PDF' }, '23514'],
    ['takes a file of MAX_FILE_BYTES', { size_bytes: MAX_FILE_BYTES }, 'ok'],
    ['refuses an empty file', { size_bytes: 0 }, '23514'],
    ['refuses a file over MAX_FILE_BYTES', { size_bytes: MAX_FILE_BYTES + 1 }, '23514'],
    ['takes a name of 200 characters', { name: '🌱'.repeat(200) }, 'ok'],
    ['takes accents, brackets and symbols', { name: 'Café plan (draft) #2.docx' }, 'ok'],
    ['refuses an empty name', { name: '' }, '23514'],
    ['refuses a name of 201 characters', { name: 'a'.repeat(201) }, '23514'],
    ['refuses a slash', { name: 'a/b.pdf' }, '23514'],
    ['refuses a backslash', { name: '..\\b.pdf' }, '23514'],
    ['refuses a tab', { name: 'tab\there.pdf' }, '23514'],
    ['refuses a right-to-left override', { name: 'invoice\u202Efdp.exe' }, '23514'],
    ['refuses a zero-width space', { name: 'zero\u200Bwidth.pdf' }, '23514'],
    ['refuses a line separator', { name: 'line\u2028separator.pdf' }, '23514'],
    ['refuses a leading space', { name: ' Accounts.pdf' }, '23514'],
    ['refuses a trailing no-break space', { name: 'Accounts.pdf\u00A0' }, '23514'],
    ['refuses a creator from another tenant', { created_by: 'stranger' }, '23503'],
  ])('%s', async (_, change: Row, expected) => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const fixed = { ...change, ...(change.created_by ? { created_by: stranger } : {}) };
      const { text, values } = insertStatement(client, 'app.file', file(fixed));
      expect(await outcome(client, text, values)).toBe(expected);
    });
  });
});
