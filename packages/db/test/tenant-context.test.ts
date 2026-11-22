// SPDX-License-Identifier: AGPL-3.0-or-later
//
// withTenant() against the test database, connected as app_api. Most tests
// use a pool of one connection, so every call reuses the same connection and
// any setting left behind would show.

import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, internalsOf } from '../src/database.ts';
import {
  TenantLeakError,
  trustedJobRequest,
  trustedSessionUser,
  trustedTenantId,
  withTenant,
  type MemberSource,
  type TenantId,
} from '../src/tenant-context.ts';
import { databaseSettings } from './connect.ts';
import { asMigratorIn, createTestTenant, createTestUser, insertRow } from './tenants.ts';

const tenantA = trustedTenantId('7d0f3f5e-0c1b-4a57-9d43-6c2b1f0a9e01');
const tenantB = trustedTenantId('7d0f3f5e-0c1b-4a57-9d43-6c2b1f0a9e02');

interface SessionState {
  pid: number;
  setting: string | null;
  tenant: string | null;
}

async function sessionState(db: Kysely<unknown>): Promise<SessionState> {
  const { rows } = await sql<SessionState>`
    SELECT pg_catalog.pg_backend_pid() AS pid,
           pg_catalog.current_setting('app.tenant_id', true) AS setting,
           app.current_tenant_id() AS tenant
  `.execute(db);
  const [state] = rows;
  if (!state) throw new Error('The session state query returned no row.');
  return state;
}

/** The setting is unset (NULL) on a new connection, and empty after use. */
function expectNoTenant(state: SessionState): void {
  expect(state.setting ?? '').toBe('');
  expect(state.tenant).toBeNull();
}

/**
 * Simulate a leak: set the tenant for the whole session on a pooled
 * connection, past both withTenant() and the reset the client's own queries
 * get.
 */
async function leakTenant(db: Kysely<unknown>, tenant: TenantId): Promise<void> {
  const client = await internalsOf(db).pool.connect();
  try {
    await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, false)", [tenant]);
  } finally {
    client.release();
  }
}

describe('withTenant', () => {
  let db: Kysely<unknown>;
  const logged: string[] = [];

  beforeAll(() => {
    db = createDatabase({
      ...databaseSettings('app_api', 1),
      log: (message) => {
        logged.push(message);
      },
    });
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('sets the tenant for every statement in its transaction', async () => {
    expectNoTenant(await sessionState(db));

    const seen = await withTenant(db, tenantA, async (trx) => {
      const first = await sql<{ tenant: string; xid: string }>`
        SELECT app.current_tenant_id() AS tenant, pg_catalog.pg_current_xact_id()::text AS xid
      `.execute(trx);
      const second = await sql<{ tenant: string; xid: string }>`
        SELECT app.current_tenant_id() AS tenant, pg_catalog.pg_current_xact_id()::text AS xid
      `.execute(trx);
      return [first.rows[0], second.rows[0]];
    });

    expect(seen[0]?.tenant).toBe(tenantA);
    expect(seen[1]).toEqual(seen[0]);
  });

  it('leaves no tenant on the connection after the transaction commits', async () => {
    const inside = await withTenant(db, tenantA, (trx) => sessionState(trx));
    expect(inside.tenant).toBe(tenantA);

    const after = await sessionState(db);
    expect(after.pid).toBe(inside.pid);
    expectNoTenant(after);
  });

  it('leaves no tenant on the connection after work throws and the transaction rolls back', async () => {
    let pid = 0;
    await expect(
      withTenant(db, tenantA, async (trx) => {
        pid = (await sessionState(trx)).pid;
        throw new Error('work failed');
      }),
    ).rejects.toThrow('work failed');

    const after = await sessionState(db);
    expect(after.pid).toBe(pid);
    expectNoTenant(after);
  });

  it('clears a session-wide setting made inside the transaction', async () => {
    const inside = await withTenant(db, tenantA, async (trx) => {
      await sql`SELECT pg_catalog.set_config('app.tenant_id', ${tenantB}, false)`.execute(trx);
      return sessionState(trx);
    });
    expect(inside.tenant).toBe(tenantB);

    const after = await sessionState(db);
    expect(after.pid).toBe(inside.pid);
    expectNoTenant(after);
  });

  it('refuses and logs a connection that already has a tenant, and clears it', async () => {
    await leakTenant(db, tenantB);

    let ran = false;
    const refused = withTenant(db, tenantA, () => {
      ran = true;
      return Promise.resolve();
    });
    await expect(refused).rejects.toBeInstanceOf(TenantLeakError);
    await expect(refused).rejects.toThrow(
      'The database connection already has a tenant or member set. Refusing to use it.',
    );

    expect(ran).toBe(false);
    expect(logged).toContain('A tenant or member was already set on a pooled database connection.');
    expectNoTenant(await sessionState(db));
  });

  it('cannot be nested inside another transaction', async () => {
    await expect(
      withTenant(db, tenantA, (trx) => withTenant(trx, tenantB, () => Promise.resolve())),
    ).rejects.toThrow('Use a client from createDatabase(), not a transaction or another client.');
    expectNoTenant(await sessionState(db));
  });

  it('releases session advisory locks and closes WITH HOLD cursors before reuse', async () => {
    const pid = await withTenant(db, tenantA, async (trx) => {
      await sql`SELECT pg_catalog.pg_advisory_lock(4242)`.execute(trx);
      await sql`DECLARE leftover CURSOR WITH HOLD FOR SELECT 1`.execute(trx);
      return (await sessionState(trx)).pid;
    });

    const left = await withTenant(db, tenantB, async (trx) => {
      const { rows } = await sql<{ pid: number; locks: number; cursors: number }>`
        SELECT pg_catalog.pg_backend_pid() AS pid,
               (SELECT count(*)::integer FROM pg_catalog.pg_locks
                 WHERE locktype = 'advisory' AND pid = pg_catalog.pg_backend_pid()) AS locks,
               (SELECT count(*)::integer FROM pg_catalog.pg_cursors
                 WHERE name = 'leftover') AS cursors
      `.execute(trx);
      return rows[0];
    });

    expect(left).toEqual({ pid, locks: 0, cursors: 0 });
  });

  it('keeps the timeouts set at connection after resetting the session', async () => {
    await withTenant(db, tenantA, async (trx) => {
      await sql`SET statement_timeout = '5min'`.execute(trx);
      await sql`SET idle_in_transaction_session_timeout = '5min'`.execute(trx);
    });

    const timeouts = await withTenant(db, tenantB, async (trx) => {
      const { rows } = await sql<{ statement: string; idle: string }>`
        SELECT pg_catalog.current_setting('statement_timeout') AS statement,
               pg_catalog.current_setting('idle_in_transaction_session_timeout') AS idle
      `.execute(trx);
      return rows[0];
    });

    expect(timeouts).toEqual({ statement: '30s', idle: '1min' });
  });

  it('closes a connection it cannot reset, and keeps the error from work', async () => {
    const logged: string[] = [];
    const own = createDatabase({
      ...databaseSettings('app_api', 1),
      log: (message) => {
        logged.push(message);
      },
    });
    try {
      let pid = 0;
      // Ending its own session breaks the connection, so the reset fails too.
      const failed = withTenant(own, tenantA, async (trx) => {
        pid = (await sessionState(trx)).pid;
        await sql`SELECT pg_catalog.pg_terminate_backend(pg_catalog.pg_backend_pid())`.execute(trx);
      });
      await expect(failed).rejects.toThrow();
      expect(logged).toContain(
        'A database connection could not be reset after a transaction, so it was closed.',
      );

      // The broken connection was closed rather than reused.
      const after = await sessionState(own);
      expect(after.pid).not.toBe(pid);
      expectNoTenant(after);
    } finally {
      await own.destroy();
    }
  });

  it('releases the connection and keeps the outcome when the logger throws', async () => {
    const own = createDatabase({
      ...databaseSettings('app_api', 1),
      // A leaked pool slot would make the next query wait this long, then fail.
      connectionTimeoutMillis: 2_000,
      log: () => {
        throw new Error('The logger failed.');
      },
    });
    try {
      // A failed reset is logged, and the per-connection error listener
      // reports the broken connection through the same logger.
      const failed = withTenant(own, tenantA, async (trx) => {
        await sql`SELECT pg_catalog.pg_terminate_backend(pg_catalog.pg_backend_pid())`.execute(trx);
      });
      await expect(failed).rejects.toThrow();
      await expect(failed).rejects.not.toThrow('The logger failed.');
      expectNoTenant(await sessionState(own));

      // A leak is logged too.
      await leakTenant(own, tenantB);
      await expect(withTenant(own, tenantA, () => Promise.resolve())).rejects.toBeInstanceOf(
        TenantLeakError,
      );
      expectNoTenant(await sessionState(own));
    } finally {
      await own.destroy();
    }
  });

  it('keeps concurrent transactions on separate connections apart', async () => {
    const pool = createDatabase(databaseSettings('app_api', 2));
    try {
      const read = (tenant: TenantId) =>
        withTenant(pool, tenant, async (trx) => {
          // Both transactions are open at once while they sleep.
          await sql`SELECT pg_catalog.pg_sleep(0.2)`.execute(trx);
          return sessionState(trx);
        });
      const [a, b] = await Promise.all([read(tenantA), read(tenantB)]);

      expect(a.pid).not.toBe(b.pid);
      expect(a.tenant).toBe(tenantA);
      expect(b.tenant).toBe(tenantB);
    } finally {
      await pool.destroy();
    }
  });
});

describe('trustedTenantId', () => {
  it.each([
    ['an empty string', ''],
    ['text', 'tenant-a'],
    ['a uuid in upper case', '7D0F3F5E-0C1B-4A57-9D43-6C2B1F0A9E01'],
    ['a uuid with SQL after it', "7d0f3f5e-0c1b-4a57-9d43-6c2b1f0a9e01'; RESET ALL; --"],
  ])('refuses %s', (_, value) => {
    expect(() => trustedTenantId(value)).toThrow('A tenant id must be a uuid in lower case.');
  });
});

describe('withTenant with a member', { timeout: 30_000 }, () => {
  let db: Kysely<unknown>;
  let tenant: TenantId;
  let otherTenant: TenantId;
  let user: string;
  let membership: string;
  let suspendedUser: string;
  let suspended: string;
  let strangerUser: string;
  let request: string;
  let suspendedRequest: string;
  let strangerRequest: string;

  /** Add an account as a member with `status`, and return both ids. */
  const addAccount = async (inTenant: TenantId, status = 'active') => {
    const account = await createTestUser();
    const member = await asMigratorIn(inTenant, (client) =>
      insertRow(client, 'app.membership', {
        tenant_id: inTenant,
        user_id: account,
        roles: ['tenant_admin'],
        status,
      }),
    );
    return { account, member };
  };

  const addRequest = (inTenant: TenantId, requestedBy: string) =>
    asMigratorIn(inTenant, (client) =>
      insertRow(client, 'app.job_request', {
        tenant_id: inTenant,
        kind: 'audit_log_export',
        requested_by: requestedBy,
        permission: 'platform.audit.export',
        filters: {},
        field_ids: ['app.audit_event.action'],
        output_sensitivity: 'internal',
        request_id: '00000000-0000-4000-8000-000000000001',
      }),
    );

  /** What withTenant() handed `work`, and the setting and tenant it saw. */
  const run = (member?: MemberSource, on = db, inTenant = tenant) =>
    withTenant(
      on,
      inTenant,
      async (trx, given) => {
        const { rows } = await sql<{ setting: string | null }>`
          SELECT pg_catalog.current_setting('app.membership_id', true) AS setting
        `.execute(trx);
        return { given, setting: rows[0]?.setting ?? null };
      },
      member,
    );

  beforeAll(async () => {
    db = createDatabase(databaseSettings('app_api', 1));
    tenant = trustedTenantId((await createTestTenant()).id);
    otherTenant = trustedTenantId((await createTestTenant()).id);
    ({ account: user, member: membership } = await addAccount(tenant));
    ({ account: suspendedUser, member: suspended } = await addAccount(tenant, 'suspended'));
    const stranger = await addAccount(otherTenant);
    strangerUser = stranger.account;
    request = await addRequest(tenant, membership);
    suspendedRequest = await addRequest(tenant, suspended);
    strangerRequest = await addRequest(otherTenant, stranger.member);
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
  });

  it("sets the session user's active membership, and clears it afterwards", async () => {
    expect(await run(trustedSessionUser(user))).toEqual({ given: membership, setting: membership });
    const { rows } = await sql<{ setting: string | null }>`
      SELECT pg_catalog.current_setting('app.membership_id', true) AS setting
    `.execute(db);
    expect(rows[0]?.setting ?? '').toBe('');
  });

  it('sets no member without a source, or for a suspended member or another tenant', async () => {
    for (const member of [
      undefined,
      trustedSessionUser(suspendedUser),
      trustedSessionUser(strangerUser),
      trustedSessionUser('00000000-0000-4000-8000-000000000000'),
    ]) {
      const seen = await run(member);
      expect(seen.given).toBeNull();
      expect(seen.setting ?? '').toBe('');
    }
  });

  it("sets a job request's requester while active, in the job's tenant only", async () => {
    const worker = createDatabase(databaseSettings('app_worker', 1));
    try {
      expect(await run(trustedJobRequest(request), worker)).toEqual({
        given: membership,
        setting: membership,
      });
      for (const member of [
        trustedJobRequest(suspendedRequest),
        trustedJobRequest(strangerRequest),
      ]) {
        expect((await run(member, worker)).given).toBeNull();
      }
      // A scheduled job names no request, so it runs with no member.
      expect((await run(undefined, worker)).given).toBeNull();
    } finally {
      await worker.destroy();
    }
  });

  it('refuses a connection that already has a member, and clears it', async () => {
    const client = await internalsOf(db).pool.connect();
    try {
      await client.query("SELECT pg_catalog.set_config('app.membership_id', $1, false)", [
        membership,
      ]);
    } finally {
      client.release();
    }
    await expect(run(trustedSessionUser(user))).rejects.toBeInstanceOf(TenantLeakError);
    const after = await run();
    expect(after.given).toBeNull();
    expect(after.setting ?? '').toBe('');
  });

  it.each([
    ['a session user', trustedSessionUser],
    ['a job request', trustedJobRequest],
  ])('refuses %s that is not a uuid in lower case', (_, make) => {
    expect(() => make('7D0F3F5E-0C1B-4A57-9D43-6C2B1F0A9E01')).toThrow(
      'must be a uuid in lower case.',
    );
    expect(() => make("x'; RESET ALL; --")).toThrow('must be a uuid in lower case.');
  });
});
