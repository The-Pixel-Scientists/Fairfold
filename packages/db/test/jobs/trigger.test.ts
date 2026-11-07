// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.check_job(), the tenant trigger on every job table (migration 0024,
// ADR 0009 "Tenant checks"): one refusal per rule, each test breaking
// exactly that rule beside an insert that passes, plus the per-state
// refusals and the cross-tenant tests. Every transaction is rolled back.
//
// The per-state refusals run as migrator, which owns the job tables and so
// may insert every column: the trigger refuses, not a column grant. The db
// test project has no credentials that can create a throwaway role.

import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asMigratorRolledBack, withClient } from '../connect.ts';
import {
  createTestTenant,
  insertStatement,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import {
  asRoleRolledBack,
  createQueue,
  createTestQueues,
  dropTestQueues,
  REFUSED,
  setTenant,
  tryInsertJob,
  type TestQueues,
} from './fixtures.ts';

let queues: TestQueues;
let tenant: TestTenant;
let other: TestTenant;
beforeAll(async () => {
  queues = await createTestQueues();
  [tenant, other] = [await createTestTenant(), await createTestTenant()];
}, 30_000);
afterAll(() => dropTestQueues(queues));

/** Insert `values` into pgboss.job, failing the test on any refusal. */
async function insertJob(client: pg.ClientBase, values: Row): Promise<void> {
  const { text, values: parameters } = insertStatement(client, 'pgboss.job', values);
  await client.query(text, parameters);
}

/** A tenant job's payload. */
const payload = (owner: TestTenant) => ({ tenantId: owner.id, entityId: randomUUID() });

/** A new job on `queues.source`, with its queue's dead-letter queue as pg-boss's send sets it. */
const sourceJob = (data: unknown): Row => ({ name: queues.source, dead_letter: queues.dead, data });

describe('rule 1: the queue is registered', () => {
  it('refuses a job on a queue missing from app.job_queue', () =>
    asMigratorRolledBack(async (client) => {
      await client.query(
        'SELECT pgboss.create_queue(\'test_jobs_unregistered\', \'{"policy": "standard"}\')',
      );
      await setTenant(client, tenant.id);
      const job = sourceJob(payload(tenant));
      expect(await tryInsertJob(client, { ...job, name: 'test_jobs_unregistered' })).toBe(REFUSED);
      expect(await tryInsertJob(client, job)).toBe('ok');
    }));
});

describe('rule 2: a new tenant job carries the current tenant', () => {
  it("accepts the tenant's own job from app_api and app_worker", async () => {
    for (const role of ['app_api', 'app_worker'] as const) {
      await asRoleRolledBack(role, async (client) => {
        await setTenant(client, tenant.id);
        expect(await tryInsertJob(client, sourceJob(payload(tenant)))).toBe('ok');
      });
    }
  });

  it("refuses another tenant's id, a missing id and no current tenant", () =>
    asRoleRolledBack('app_api', async (client) => {
      const job = sourceJob(payload(other));
      expect(await tryInsertJob(client, job), 'no tenant set').toBe(REFUSED);
      await setTenant(client, tenant.id);
      expect(await tryInsertJob(client, job), "the other tenant's id").toBe(REFUSED);
      expect(await tryInsertJob(client, sourceJob({ entityId: randomUUID() }))).toBe(REFUSED);
      expect(await tryInsertJob(client, sourceJob(null))).toBe(REFUSED);
    }));
});

describe('rule 3: a new platform job carries no tenant and comes only from app_queue', () => {
  it('accepts one from app_queue', () =>
    asRoleRolledBack('app_queue', async (client) => {
      expect(await tryInsertJob(client, { name: queues.platform, data: {} })).toBe('ok');
      expect(await tryInsertJob(client, { name: queues.platform, data: null })).toBe('ok');
    }));

  it('refuses one carrying a tenantId', () =>
    asRoleRolledBack('app_queue', async (client) => {
      expect(await tryInsertJob(client, { name: queues.platform, data: payload(tenant) })).toBe(
        REFUSED,
      );
    }));

  it('refuses one from app_api or app_worker, with or without a tenant set', async () => {
    for (const role of ['app_api', 'app_worker'] as const) {
      await asRoleRolledBack(role, async (client) => {
        expect(await tryInsertJob(client, { name: queues.platform, data: {} })).toBe(REFUSED);
        await setTenant(client, tenant.id);
        expect(await tryInsertJob(client, { name: queues.platform, data: {} })).toBe(REFUSED);
      });
    }
  });
});

describe("rules 2 and 3: a new job keeps its queue's dead-letter queue", () => {
  /** The message of the refusal `values` meets as `client`, in a savepoint that is undone. */
  async function refusal(client: pg.ClientBase, values: Row): Promise<string | undefined> {
    const { text, values: parameters } = insertStatement(client, 'pgboss.job', values);
    await client.query('SAVEPOINT refusal');
    try {
      await client.query(text, parameters);
      return undefined;
    } catch (error) {
      const { code, message } = error as { code?: string; message: string };
      return `${code ?? ''} ${message}`;
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT refusal');
    }
  }

  it('refuses a tenant job whose dead letter is a platform queue, another tenant queue or none', async () => {
    for (const role of ['app_api', 'app_worker'] as const) {
      await asRoleRolledBack(role, async (client) => {
        await setTenant(client, tenant.id);
        const job = sourceJob(payload(tenant));
        const rule2 = /^JB001 Job refused by ADR 0009 rule 2: .*dead_letter/;
        expect(await refusal(client, { ...job, dead_letter: queues.platform }), role).toMatch(
          rule2,
        );
        expect(await refusal(client, { ...job, dead_letter: null }), role).toMatch(rule2);
        expect(
          await refusal(client, { ...job, name: queues.dead, dead_letter: queues.source }),
          role,
        ).toMatch(rule2);
        expect(await refusal(client, job), role).toBeUndefined();
      });
    }
  });

  it('refuses a platform job given a dead letter its queue does not have', () =>
    asRoleRolledBack('app_queue', async (client) => {
      const job = { name: queues.platform, data: {} };
      expect(await refusal(client, { ...job, dead_letter: queues.dead })).toMatch(
        /^JB001 Job refused by ADR 0009 rule 3: .*dead_letter/,
      );
      expect(await refusal(client, job)).toBeUndefined();
    }));
});

describe('rule 4: a retried or failed re-insert comes only from app_queue with no tenant', () => {
  it.each(['retry', 'failed'])('accepts app_queue re-inserting a job in state %s', (state) =>
    asRoleRolledBack('app_queue', async (client) => {
      expect(
        await tryInsertJob(client, { name: queues.source, state, data: payload(tenant) }),
      ).toBe('ok');
      expect(await tryInsertJob(client, { name: queues.platform, state, data: {} })).toBe('ok');
    }),
  );

  it.each(['retry', 'failed'])('refuses state %s with a tenant set', (state) =>
    asRoleRolledBack('app_queue', async (client) => {
      await setTenant(client, tenant.id);
      expect(
        await tryInsertJob(client, { name: queues.source, state, data: payload(tenant) }),
      ).toBe(REFUSED);
    }),
  );

  it.each(['retry', 'failed'])('refuses state %s on a tenant queue without a tenantId', (state) =>
    asRoleRolledBack('app_queue', async (client) => {
      expect(await tryInsertJob(client, { name: queues.source, state, data: {} })).toBe(REFUSED);
    }),
  );
});

describe('rule 5: a dead-letter copy needs its failed source job', () => {
  /** Insert a failed job on `queues.source` through `client`, and return a copy's source columns. */
  async function failedSource(client: pg.ClientBase) {
    const id = randomUUID();
    const data = payload(tenant);
    await insertJob(client, { id, name: queues.source, state: 'failed', data });
    return { source_id: id, source_name: queues.source, data };
  }

  it('accepts a copy with the same data on a queue of the same kind', () =>
    asRoleRolledBack('app_queue', async (client) => {
      const copy = await failedSource(client);
      expect(await tryInsertJob(client, { name: queues.dead, ...copy })).toBe('ok');
    }));

  it('refuses a copy whose source is missing, not failed or holds other data', () =>
    asRoleRolledBack('app_queue', async (client) => {
      const copy = await failedSource(client);
      expect(
        await tryInsertJob(client, { name: queues.dead, ...copy, source_id: randomUUID() }),
      ).toBe(REFUSED);
      expect(await tryInsertJob(client, { name: queues.dead, ...copy, data: payload(other) })).toBe(
        REFUSED,
      );
      const retried = randomUUID();
      await insertJob(client, {
        id: retried,
        name: queues.source,
        state: 'retry',
        data: copy.data,
      });
      expect(await tryInsertJob(client, { name: queues.dead, ...copy, source_id: retried })).toBe(
        REFUSED,
      );
    }));

  it('refuses a copy onto a queue of another kind', () =>
    asRoleRolledBack('app_queue', async (client) => {
      const copy = await failedSource(client);
      expect(await tryInsertJob(client, { name: queues.platform, ...copy })).toBe(REFUSED);
    }));

  it('refuses a copy made with a tenant set, or by any role but app_queue', async () => {
    await asRoleRolledBack('app_queue', async (client) => {
      const copy = await failedSource(client);
      await setTenant(client, tenant.id);
      expect(await tryInsertJob(client, { name: queues.dead, ...copy })).toBe(REFUSED);
    });
    await asMigratorRolledBack(async (client) => {
      // migrator may not insert a failed job either (rule 4), so the source
      // goes in with the trigger off, in this rolled-back transaction only.
      await client.query('ALTER TABLE pgboss.job DISABLE TRIGGER check_job');
      const copy = await failedSource(client);
      await client.query('ALTER TABLE pgboss.job ENABLE TRIGGER check_job');
      expect(await tryInsertJob(client, { name: queues.dead, ...copy })).toBe(REFUSED);
    });
  });
});

describe('rule 6: an update keeps data, name, singleton key and dead letter', () => {
  it.each([
    ['data', { tenantId: randomUUID() }],
    ['name', 'test_jobs_elsewhere'],
    ['singleton_key', 'changed'],
    ['dead_letter', 'test_jobs_elsewhere'],
  ])('refuses an update of %s, and allows one of state', (column, value) =>
    asRoleRolledBack('app_queue', async (client) => {
      const id = randomUUID();
      await insertJob(client, { id, name: queues.source, state: 'retry', data: payload(tenant) });
      const update = `UPDATE pgboss.job SET ${client.escapeIdentifier(column)} = $2 WHERE id = $1`;
      expect(await outcome(client, update, [id, value])).toBe(REFUSED);
      expect(
        await outcome(client, "UPDATE pgboss.job SET state = 'active' WHERE id = $1", [id]),
      ).toBe('ok');
    }),
  );
});

describe('inserting a job in any other state', () => {
  it.each(['active', 'completed', 'cancelled', 'retry', 'failed'])(
    'refuses state %s from a role with INSERT on every column',
    (state) =>
      asMigratorRolledBack(async (client) => {
        await setTenant(client, tenant.id);
        const job = sourceJob(payload(tenant));
        expect(await tryInsertJob(client, job)).toBe('ok');
        expect(await tryInsertJob(client, { ...job, state })).toBe(REFUSED);
      }),
  );

  it.each(['active', 'completed', 'cancelled'])('refuses state %s from app_queue', (state) =>
    asRoleRolledBack('app_queue', async (client) => {
      expect(await tryInsertJob(client, { name: queues.platform, state, data: {} })).toBe(REFUSED);
      expect(
        await tryInsertJob(client, { name: queues.source, state, data: payload(tenant) }),
      ).toBe(REFUSED);
    }),
  );

  it('leaves app_api no column to set a state, an output or a source with', () =>
    asRoleRolledBack('app_api', async (client) => {
      await setTenant(client, tenant.id);
      const job = sourceJob(payload(tenant));
      for (const column of ['state', 'output', 'source_id', 'retry_count', 'started_on']) {
        const value = column === 'state' ? 'created' : column === 'output' ? {} : null;
        expect(await tryInsertJob(client, { ...job, [column]: value }), column).toBe('42501');
      }
      expect(
        await outcome(client, 'UPDATE pgboss.job SET priority = 1 WHERE false'),
        'UPDATE',
      ).toBe('42501');
      expect(await outcome(client, 'DELETE FROM pgboss.job WHERE false'), 'DELETE').toBe('42501');
    }));
});

describe('a queue a later migration creates', () => {
  it('has its own table, which the trigger covers', () =>
    asMigratorRolledBack(async (client) => {
      const name = 'test_jobs_later';
      await createQueue(client, name, 'tenant', { partition: true });
      const { rows } = await client.query<{ table: string; triggers: string[] }>(
        `SELECT q.table_name AS table,
                ARRAY(SELECT t.tgname::text FROM pg_catalog.pg_trigger t
                       WHERE t.tgrelid = pg_catalog.format('pgboss.%I', q.table_name)::regclass
                         AND NOT t.tgisinternal)
                  AS triggers
           FROM pgboss.queue q WHERE q.name = $1`,
        [name],
      );
      expect(rows[0]?.table).not.toBe('job_common');
      expect(rows[0]?.triggers).toEqual(['check_job']);

      await setTenant(client, tenant.id);
      const table = `pgboss.${client.escapeIdentifier(rows[0]?.table ?? '')}`;
      const insert = (data: unknown) =>
        outcome(client, `INSERT INTO ${table} (name, data) VALUES ($1, $2)`, [name, data]);
      expect(await insert(payload(tenant))).toBe('ok');
      expect(await insert(payload(other))).toBe(REFUSED);
    }));
});

describe('cross-tenant', () => {
  it("a job sent in tenant A's context cannot name tenant B, as any sender", async () => {
    for (const role of ['app_api', 'app_worker', 'app_queue'] as const) {
      await asRoleRolledBack(role, async (client) => {
        await setTenant(client, tenant.id);
        expect(await tryInsertJob(client, sourceJob(payload(other))), role).toBe(REFUSED);
      });
    }
  });

  it('a refusal never echoes the job data', () =>
    withClient('app_api', async (client) => {
      await client.query('BEGIN');
      try {
        await setTenant(client, tenant.id);
        const secret = randomUUID();
        const error = await client
          .query('INSERT INTO pgboss.job (name, data) VALUES ($1, $2)', [
            queues.source,
            { tenantId: other.id, entityId: secret },
          ])
          .then(
            () => undefined,
            (caught: unknown) => caught as { code?: string; message: string; detail?: string },
          );
        expect(error?.code).toBe(REFUSED);
        expect(error?.message).toMatch(/^Job refused by ADR 0009 rule 2:/);
        expect(JSON.stringify(error)).not.toContain(secret);
        expect(JSON.stringify(error)).not.toContain(other.id);
      } finally {
        await client.query('ROLLBACK');
      }
    }));
});
