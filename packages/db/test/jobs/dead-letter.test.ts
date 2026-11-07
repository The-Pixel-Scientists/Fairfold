// SPDX-License-Identifier: AGPL-3.0-or-later
//
// pg-boss itself against migration 0024, with migrate: false as the API and
// worker run it: it starts on the migrated schema and refuses the previous
// migration's; app_api sends a tenant job in its tenant's transaction; and
// a pg-boss instance connected as app_queue fails it with its own pinned
// fail and retry SQL until it reaches its dead-letter queue, which the
// trigger allows only because it sees the failed source job (rule 5).
// pg-boss's redrive, which re-creates jobs with no tenant, is refused by
// rule 2, and so is a send that overrides its queue's dead-letter queue.

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS_FOLDER } from '../../scripts/migrations.ts';
import { asMigratorRolledBack, withClient } from '../connect.ts';
import { committedIn, createTestTenant, type TestTenant } from '../tenants.ts';
import {
  asRoleRolledBack,
  bossAs,
  createTestQueues,
  dropTestQueues,
  onClient,
  REFUSED,
  setTenant,
  type TestQueues,
} from './fixtures.ts';

let queues: TestQueues;
let tenant: TestTenant;
beforeAll(async () => {
  queues = await createTestQueues();
  tenant = await createTestTenant();
}, 30_000);
afterAll(() => dropTestQueues(queues));

describe('pg-boss with migrate: false', () => {
  it('starts against the migrated schema', async () => {
    const boss = bossAs('app_api');
    await boss.start();
    await boss.stop({ graceful: false });
  });

  it("refuses to start against the previous migration's schema", () =>
    asMigratorRolledBack(async (client) => {
      const down = await readFile(join(MIGRATIONS_FOLDER, '0024_app_jobs', 'down.sql'), 'utf8');
      await client.query(down);
      const boss = bossAs('migrator', { db: onClient(client) });
      await expect(boss.start()).rejects.toThrow('pg-boss is not installed');
    }));

  it('refuses to start against an older schema version', () =>
    asMigratorRolledBack(async (client) => {
      await client.query('UPDATE pgboss.version SET version = version - 1');
      const boss = bossAs('migrator', { db: onClient(client) });
      await expect(boss.start()).rejects.toThrow('pg-boss database requires migrations');
    }));
});

describe('a send that overrides the dead-letter queue', () => {
  it('is refused at send time, before a failure could stall the queue', async () => {
    const sender = bossAs('app_api');
    await sender.start();
    try {
      await asRoleRolledBack('app_api', async (client) => {
        await setTenant(client, tenant.id);
        const data = { tenantId: tenant.id, entityId: randomUUID() };
        // A platform queue, then a tenant queue that is not the queue's own.
        for (const [queue, deadLetter] of [
          [queues.source, queues.platform],
          [queues.dead, queues.source],
        ] as const) {
          await client.query('SAVEPOINT send');
          await expect(
            sender.send(queue, data, { db: onClient(client), deadLetter }),
            deadLetter,
          ).rejects.toMatchObject({ code: REFUSED });
          await client.query('ROLLBACK TO SAVEPOINT send');
        }
      });
    } finally {
      await sender.stop({ graceful: false });
    }
  });
});

describe('a tenant job that keeps failing', { timeout: 60_000 }, () => {
  it('reaches its dead-letter queue through pg-boss as app_queue', async () => {
    const data = { tenantId: tenant.id, entityId: randomUUID() };
    const sender = bossAs('app_api');
    await sender.start();
    const id = await withClient('app_api', (client) =>
      committedIn(client, tenant.id, () =>
        sender.send(queues.source, data, { db: onClient(client) }),
      ),
    );
    await sender.stop({ graceful: false });
    expect(id).toEqual(expect.any(String));

    const worker = bossAs('app_queue', { supervise: true });
    const errors: unknown[] = [];
    worker.on('error', (error) => errors.push(error));
    await worker.start();
    try {
      // One retry, then the job fails for good and is copied to its
      // dead-letter queue in the same statement.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const [job] = await worker.fetch(queues.source);
        expect(job?.id, `attempt ${String(attempt + 1)}`).toBe(id);
        await worker.fail(queues.source, job?.id ?? '', { code: 'test_failure' });
      }
      expect(await worker.fetch(queues.source)).toEqual([]);

      // Redrive would re-create the copy as a new job with no tenant set.
      await expect(worker.redrive(queues.dead)).rejects.toMatchObject({ code: REFUSED });

      const [copy] = await worker.fetch<typeof data>(queues.dead);
      expect(copy?.data).toEqual(data);

      // Maintenance, as the worker runs it, needs no right beyond app_queue's.
      await worker.supervise();
    } finally {
      await worker.stop({ graceful: false });
    }
    expect(errors).toEqual([]);

    const rows = await withClient('migrator', async (client) => {
      const result = await client.query<{ name: string; state: string; source_id: string | null }>(
        'SELECT name, state, source_id FROM pgboss.job WHERE id = $1 OR source_id = $1 ORDER BY name',
        [id],
      );
      return result.rows;
    });
    expect(rows).toEqual(
      [
        { name: queues.source, state: 'failed', source_id: null },
        { name: queues.dead, state: 'active', source_id: id },
      ].sort((a, b) => a.name.localeCompare(b.name)),
    );
  });
});
