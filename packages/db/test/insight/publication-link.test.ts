// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A publication run links its output (migration 0112, ADR 0030): when
// app_worker sets a run's output, the file is linked in the same statement,
// so no other run or record can take it. The worker links through
// app.link_file() with the rights migration 0104 gave it, and holds no
// other write on app.file than migration 0041's.

import { describe, expect, it } from 'vitest';

import { withClient } from '../connect.ts';
import { heldRights } from '../privilege-lint.ts';
import { asMigratorIn, asRoleIn, createTestTenant, insertRow, outcome } from '../tenants.ts';
import { addInsightParts, runRow } from './fixtures.ts';

describe('a publication run', { timeout: 60_000 }, () => {
  it('links its output as app_worker sets it, and no second run takes that file', async () => {
    const tenant = await createTestTenant();
    const { member, file } = await asMigratorIn(tenant.id, (client) =>
      addInsightParts(client, tenant),
    );
    const [first, second] = await asMigratorIn(tenant.id, async (client) => [
      await insertRow(client, 'insight.publication_run', runRow(tenant, member)),
      await insertRow(client, 'insight.publication_run', runRow(tenant, member)),
    ]);
    const prepare =
      "UPDATE insight.publication_run SET state = 'prepared', output_file_id = $2 WHERE id = $1";
    await asRoleIn('app_worker', tenant.id, async (client) => {
      await client.query(prepare, [first, file]);
      const { rows } = await client.query<{ linked_at: Date | null }>(
        'SELECT linked_at FROM app.file WHERE id = $1',
        [file],
      );
      expect(rows[0]?.linked_at).toBeInstanceOf(Date);
      expect(await outcome(client, prepare, [second, file])).toBe('55000');
    });
  });

  it("leaves app_worker no write on app.file but 0041's and 0104's", async () => {
    const rights = await withClient('migrator', (client) => heldRights(client, ['app_worker']));
    const held = rights.map(({ privilege, object }) => `${privilege} on ${object}`);
    const writes = rights
      .filter(({ object }) => object === 'app.file' || object.startsWith('column app.file.'))
      .filter(({ privilege }) => ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'].includes(privilege))
      .map(({ privilege, object }) => `${privilege} on ${object}`);
    expect(writes.sort()).toEqual(
      ['linked_at', 'scan_state', 'scan_version', 'storage_key']
        .map((column) => `UPDATE on column app.file.${column}`)
        .sort(),
    );
    expect(held).toContain('EXECUTE on function app.link_file(uuid)');
    expect(held).not.toContain('EXECUTE on function app.release_file(uuid)');
  });
});
