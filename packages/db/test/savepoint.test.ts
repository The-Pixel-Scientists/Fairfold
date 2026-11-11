// SPDX-License-Identifier: AGPL-3.0-or-later
//
// attempt() against the test database, connected as app_worker, the role whose
// jobs use it. Each transaction commits, so the rows read afterwards prove
// which writes survived.

import { randomUUID } from 'node:crypto';

import { sql, type Kysely, type Transaction } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { insertAuditEvent } from '../src/audit.ts';
import { createDatabase } from '../src/database.ts';
import { attempt } from '../src/savepoint.ts';
import { trustedTenantId, withTenant, type TenantId } from '../src/tenant-context.ts';
import { databaseSettings } from './connect.ts';
import { createTestTenant } from './tenants.ts';

const write = (trx: Transaction<unknown>, entityId: string) =>
  insertAuditEvent(trx, {
    requestId: randomUUID(),
    actorKind: 'system',
    actorId: null,
    action: 'platform.tenant.updated',
    entityType: 'platform.tenant',
    entityId,
    changes: {},
  });

async function written(db: Kysely<unknown>, tenant: TenantId, ids: readonly string[]) {
  return withTenant(db, tenant, async (trx) => {
    const { rows } = await sql<{ entity_id: string }>`
      SELECT entity_id FROM app.audit_event WHERE entity_id = ANY(${[...ids]}::uuid[])
    `.execute(trx);
    return rows.map((row) => row.entity_id).sort();
  });
}

describe('attempt()', { timeout: 30_000 }, () => {
  let db: Kysely<unknown>;
  let tenant: TenantId;

  beforeAll(async () => {
    db = createDatabase(databaseSettings('app_worker', 1));
    tenant = trustedTenantId((await createTestTenant()).id);
  });
  afterAll(() => db.destroy());

  it('keeps the changes of work that finishes', async () => {
    const id = randomUUID();
    const finished = await withTenant(db, tenant, (trx) => attempt(trx, () => write(trx, id)));

    expect(finished).toBe(true);
    expect(await written(db, tenant, [id])).toEqual([id]);
  });

  const failures: readonly [string, (trx: Transaction<unknown>) => Promise<unknown>][] = [
    ['throws', () => Promise.reject(new Error('The work failed.'))],
    ['fails a statement', (trx) => sql`SELECT 1 / 0`.execute(trx)],
  ];

  it.each(failures)('undoes only the work when it %s', async (_name, fail) => {
    const before = randomUUID();
    const undone = randomUUID();
    const after = randomUUID();

    const finished = await withTenant(db, tenant, async (trx) => {
      await write(trx, before);
      const result = await attempt(trx, async () => {
        await write(trx, undone);
        await fail(trx);
      });
      await write(trx, after);
      return result;
    });

    expect(finished).toBe(false);
    expect(await written(db, tenant, [before, undone, after])).toEqual([before, after].sort());
  });

  it('undoes an inner attempt that finished when the outer work fails', async () => {
    const [outer, inner, after] = [randomUUID(), randomUUID(), randomUUID()];

    const results = await withTenant(db, tenant, async (trx) => {
      let innerResult: boolean | undefined;
      const outerResult = await attempt(trx, async () => {
        await write(trx, outer);
        innerResult = await attempt(trx, () => write(trx, inner));
        throw new Error('A later step failed.');
      });
      await write(trx, after);
      return { innerResult, outerResult };
    });

    expect(results).toEqual({ innerResult: true, outerResult: false });
    expect(await written(db, tenant, [outer, inner, after])).toEqual([after]);
  });

  it('keeps the outer work when an inner attempt fails', async () => {
    const [before, inner, after] = [randomUUID(), randomUUID(), randomUUID()];

    const results = await withTenant(db, tenant, async (trx) => {
      let innerResult: boolean | undefined;
      const outerResult = await attempt(trx, async () => {
        await write(trx, before);
        innerResult = await attempt(trx, async () => {
          await write(trx, inner);
          await sql`SELECT 1 / 0`.execute(trx);
        });
        await write(trx, after);
      });
      return { innerResult, outerResult };
    });

    expect(results).toEqual({ innerResult: false, outerResult: true });
    expect(await written(db, tenant, [before, inner, after])).toEqual([before, after].sort());
  });

  it('throws when the connection breaks during the work', async () => {
    const own = createDatabase(databaseSettings('app_worker', 1));
    try {
      await expect(
        withTenant(own, tenant, (trx) =>
          attempt(trx, async () => {
            await sql`SELECT pg_catalog.pg_terminate_backend(pg_catalog.pg_backend_pid())`.execute(
              trx,
            );
          }),
        ),
      ).rejects.toThrow();
    } finally {
      await own.destroy();
    }
  });
});
