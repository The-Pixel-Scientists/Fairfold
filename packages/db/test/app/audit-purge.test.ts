// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.purge_expired_audit() (migration 0031, ADR 0003 "Audit retention"):
// only app_worker may call it; with a tenant set it deletes that tenant's
// expired app.audit_event rows and nothing else, with none set expired
// auth.audit_event rows only; it stops at its cap, never deletes an event
// inside its retention period, and records each call's count in the table
// it purged. The app roles still cannot delete or update either table.
//
// Expired events exist only here: migrator adds them with the retention
// trigger off inside its own transaction, which turns it on again before
// committing. The purge runs as app_worker and commits, which also clears
// what these tests add.

import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { APP_ROLES, withClient } from '../connect.ts';
import {
  addMember,
  asMigratorIn,
  committedIn,
  createTestTenant,
  outcome,
  type TestTenant,
} from '../tenants.ts';

const PURGE = 'SELECT app.purge_expired_audit() AS deleted';
const MAX_ROWS = 10_000;
const OWNER = 'owner_app_purge_expired_audit';

/** Call the purge as app_worker, in `tenant` or with none set, and commit. */
function purge(tenant?: TestTenant): Promise<number | undefined> {
  const call = async (client: pg.ClientBase) =>
    (await client.query<{ deleted: number }>(PURGE)).rows[0]?.deleted;
  return withClient('app_worker', (client) =>
    tenant ? committedIn(client, tenant.id, call) : call(client),
  );
}

/** Run `work` as migrator in `tenant` with `table`'s retention trigger off, and commit. */
function withTriggerOff<T>(
  tenant: TestTenant,
  table: 'app.audit_event' | 'auth.audit_event',
  work: (client: pg.ClientBase) => Promise<T>,
): Promise<T> {
  return asMigratorIn(tenant.id, async (client) => {
    await client.query(`ALTER TABLE ${table} DISABLE TRIGGER set_audit_retention`);
    const result = await work(client);
    await client.query(`ALTER TABLE ${table} ENABLE TRIGGER set_audit_retention`);
    return result;
  });
}

/** Add `count` events to `tenant` that expired a month ago, and return their ids. */
async function addExpiredEvents(tenant: TestTenant, count: number): Promise<string[]> {
  const { rows } = await withTriggerOff(tenant, 'app.audit_event', (client) =>
    client.query<{ id: string }>(
      `INSERT INTO app.audit_event (tenant_id, request_id, actor_kind, action, entity_type,
                                    entity_id, changes, occurred_at, retain_until)
       SELECT $1::uuid, gen_random_uuid(), 'system', 'platform.tenant.updated',
              'platform.tenant', $1::uuid, '{}', o.at, ((o.at AT TIME ZONE 'UTC') + interval '12 months') AT TIME ZONE 'UTC'
         FROM (SELECT now() - interval '13 months' AS at) AS o, generate_series(1, $2)
       RETURNING id`,
      [tenant.id, count],
    ),
  );
  return rows.map((row) => row.id);
}

/** Add an event to `tenant` that the trigger keeps at least 12 months. */
async function addLiveEvent(tenant: TestTenant): Promise<string> {
  const { rows } = await asMigratorIn(tenant.id, (client) =>
    client.query<{ id: string }>(
      `INSERT INTO app.audit_event
         (tenant_id, request_id, actor_kind, action, entity_type, entity_id, changes)
       VALUES ($1, $2, 'system', 'platform.tenant.updated', 'platform.tenant', $1, '{}')
       RETURNING id`,
      [tenant.id, randomUUID()],
    ),
  );
  return rows[0]?.id ?? '';
}

/** Add an auth event that expired a month ago, and return its id. */
async function addExpiredAuthEvent(): Promise<string> {
  const { rows } = await withTriggerOff(anyTenant, 'auth.audit_event', (client) =>
    client.query<{ id: string }>(
      `INSERT INTO auth.audit_event (request_id, code, occurred_at, retain_until)
       SELECT $1::uuid, 'sign_in_failed', o.at,
              ((o.at AT TIME ZONE 'UTC') + interval '12 months') AT TIME ZONE 'UTC'
         FROM (SELECT now() - interval '13 months' AS at) AS o
       RETURNING id`,
      [randomUUID()],
    ),
  );
  return rows[0]?.id ?? '';
}

/** The ids among `ids` that `tenant` still has in app.audit_event. */
async function kept(tenant: TestTenant, ids: readonly string[]): Promise<string[]> {
  const { rows } = await asMigratorIn(tenant.id, (client) =>
    client.query<{ id: string }>('SELECT id FROM app.audit_event WHERE id = ANY ($1) ORDER BY id', [
      ids,
    ]),
  );
  return rows.map((row) => row.id);
}

/** Whether auth.audit_event still has `id`. */
async function authKept(id: string): Promise<boolean> {
  const { rowCount } = await withClient('migrator', (client) =>
    client.query('SELECT 1 FROM auth.audit_event WHERE id = $1', [id]),
  );
  return rowCount === 1;
}

interface PurgeEvent {
  actor_kind: string;
  actor_id: string | null;
  entity_type: string;
  entity_id: string;
  subject_party_id: string | null;
  changes: unknown;
  recent: boolean;
  /** Whether retain_until is exactly `days` (or 12 months, if null) after occurred_at. */
  kept: boolean;
}

/** `tenant`'s purge events, oldest first. */
async function purgeEvents(tenant: TestTenant, days: number | null = null): Promise<PurgeEvent[]> {
  const { rows } = await asMigratorIn(tenant.id, (client) =>
    client.query<PurgeEvent>(
      `SELECT actor_kind, actor_id, entity_type, entity_id, subject_party_id, changes,
              occurred_at > now() - interval '10 minutes' AS recent,
              retain_until = ((occurred_at AT TIME ZONE 'UTC')
                              + COALESCE(make_interval(days => $1), interval '12 months'))
                             AT TIME ZONE 'UTC' AS kept
         FROM app.audit_event
        WHERE action = 'platform.audit_event.purged'
        ORDER BY occurred_at`,
      [days],
    ),
  );
  return rows;
}

/** How many auth purge events there are. */
async function authPurgeEvents(): Promise<number> {
  const { rows } = await withClient('migrator', (client) =>
    client.query<{ n: number }>(
      "SELECT count(*)::integer AS n FROM auth.audit_event WHERE code = 'audit_purged'",
    ),
  );
  return rows[0]?.n ?? 0;
}

let anyTenant: TestTenant;
beforeAll(async () => {
  anyTenant = await createTestTenant();
  // Clear expired auth events an interrupted run left behind.
  let deleted;
  do {
    deleted = await purge();
  } while (deleted === MAX_ROWS);
}, 60_000);

describe('the audit tables', { timeout: 30_000 }, () => {
  it.each(APP_ROLES)('stay append-only for %s', async (role) => {
    await withClient(role, async (client) => {
      await client.query('BEGIN');
      await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [anyTenant.id]);
      for (const table of ['app.audit_event', 'auth.audit_event']) {
        expect(await outcome(client, `DELETE FROM ${table}`), table).toBe('42501');
        expect(await outcome(client, `UPDATE ${table} SET request_id = request_id`), table).toBe(
          '42501',
        );
      }
      await client.query('ROLLBACK');
    });
  });

  it('let the purge alone delete, and only rows past retain_until', async () => {
    const { rows } = await withClient('migrator', async (client) => {
      // So pg_get_expr qualifies every name outside pg_catalog.
      await client.query('SET search_path = pg_catalog');
      return client.query<{ policy: string }>(
        `SELECT p.polrelid::regclass::text || ' ' || p.polname || ' '
                || CASE WHEN p.polpermissive THEN 'permissive ' ELSE 'restrictive ' END
                || p.polroles::regrole[]::text || ' '
                || pg_catalog.pg_get_expr(p.polqual, p.polrelid) AS policy
           FROM pg_catalog.pg_policy p
          WHERE p.polrelid IN ('app.audit_event'::regclass, 'auth.audit_event'::regclass)
            AND p.polcmd IN ('w', 'd')
          ORDER BY 1`,
      );
    });
    const denied = '{app_api,app_worker,app_queue,app_auth} false';
    expect(rows.map((row) => row.policy)).toEqual([
      `app.audit_event deny_delete restrictive ${denied}`,
      `app.audit_event deny_update restrictive ${denied}`,
      `app.audit_event purge_expired_audit_delete permissive {${OWNER}} ((retain_until < now()) AND (tenant_id = app.current_tenant_id()))`,
      `auth.audit_event deny_delete restrictive ${denied}`,
      `auth.audit_event deny_update restrictive ${denied}`,
      `auth.audit_event purge_expired_audit_delete permissive {${OWNER}} (retain_until < now())`,
    ]);
  });

  it('give the purge no insert of a column the database sets', async () => {
    const { rows } = await withClient('migrator', (client) =>
      client.query<{ column: string }>(
        `SELECT a.attrelid::regclass::text || '.' || a.attname AS column
           FROM pg_catalog.pg_attribute a
          WHERE a.attrelid IN ('app.audit_event'::regclass, 'auth.audit_event'::regclass)
            AND a.attname IN ('id', 'occurred_at', 'retain_until', 'actor_member_kind')
            AND pg_catalog.has_column_privilege($1, a.attrelid, a.attnum, 'INSERT')`,
        [OWNER],
      ),
    );
    expect(rows).toEqual([]);
  });
});

describe('app.purge_expired_audit()', { timeout: 60_000 }, () => {
  it('may be called by app_worker alone', async () => {
    for (const role of APP_ROLES.filter((name) => name !== 'app_worker')) {
      await withClient(role, async (client) => {
        await client.query('BEGIN');
        expect(await outcome(client, PURGE), role).toBe('42501');
        await client.query('ROLLBACK');
      });
    }
  });

  it("deletes the tenant's expired events only, and records each call", async () => {
    const [tenant, other] = [await createTestTenant(), await createTestTenant()];
    const expired = await addExpiredEvents(tenant, 3);
    const live = await addLiveEvent(tenant);
    const othersExpired = await addExpiredEvents(other, 2);

    expect(await purge(tenant)).toBe(3);
    expect(await purge(tenant)).toBe(0);

    expect(await kept(tenant, [...expired, live])).toEqual([live]);
    expect(await kept(other, othersExpired), "the other tenant's events").toEqual(
      [...othersExpired].sort(),
    );
    const event = {
      actor_kind: 'system',
      actor_id: null,
      entity_type: 'platform.audit_event',
      entity_id: tenant.id,
      subject_party_id: null,
      recent: true,
      kept: true,
    };
    expect(await purgeEvents(tenant)).toEqual([
      { ...event, changes: { count: 3 } },
      { ...event, changes: { count: 0 } },
    ]);
    expect(await purgeEvents(other)).toEqual([]);
  });

  it('keeps each purge event as long as the tenant rule says', async () => {
    const tenant = await createTestTenant();
    await asMigratorIn(tenant.id, async (client) => {
      const by = await addMember(client, tenant);
      await client.query(
        `INSERT INTO app.retention_policy (tenant_id, policy, days, created_by, updated_by)
         VALUES ($1, 'audit', 400, $2, $2)`,
        [tenant.id, by],
      );
    });
    const live = await addLiveEvent(tenant);
    expect(await purge(tenant)).toBe(0);
    expect(await kept(tenant, [live])).toEqual([live]);
    expect((await purgeEvents(tenant, 400)).map((event) => event.kept)).toEqual([true]);
  });

  it('stops at its cap and returns the count', async () => {
    const tenant = await createTestTenant();
    await addExpiredEvents(tenant, MAX_ROWS + 1);
    expect(await purge(tenant)).toBe(MAX_ROWS);
    expect(await purge(tenant)).toBe(1);
    expect(await purge(tenant)).toBe(0);
    const counts = (await purgeEvents(tenant)).map((event) => event.changes);
    expect(counts).toEqual([{ count: MAX_ROWS }, { count: 1 }, { count: 0 }]);
  });

  it('purges auth events with no tenant set, and only then', async () => {
    const tenant = await createTestTenant();
    const authEvent = await addExpiredAuthEvent();
    const [appEvent = ''] = await addExpiredEvents(tenant, 1);

    expect(await purge(tenant)).toBe(1);
    expect(await authKept(authEvent), 'with a tenant set').toBe(true);

    const [otherEvent = ''] = await addExpiredEvents(tenant, 1);
    const before = await authPurgeEvents();
    expect(await purge()).toBe(1);
    expect(await authKept(authEvent)).toBe(false);
    expect(await kept(tenant, [appEvent, otherEvent]), 'with no tenant set').toEqual([otherEvent]);
    expect(await authPurgeEvents()).toBe(before + 1);

    const { rows } = await withClient('migrator', (client) =>
      client.query<Record<string, unknown>>(
        `SELECT purged_count, user_id, tenant_id, identifier, ip_address, reason,
                retain_until = ((occurred_at AT TIME ZONE 'UTC') + interval '12 months')
                               AT TIME ZONE 'UTC' AS floor
           FROM auth.audit_event WHERE code = 'audit_purged'
          ORDER BY occurred_at DESC LIMIT 1`,
      ),
    );
    expect(rows).toEqual([
      {
        purged_count: 1,
        user_id: null,
        tenant_id: null,
        identifier: null,
        ip_address: null,
        reason: null,
        floor: true,
      },
    ]);
    expect(await purge(tenant)).toBe(1);
  });

  it('fails, deleting nothing and recording nothing, while an expired auth event awaits its copy', async () => {
    const waiting = await addExpiredAuthEvent();
    const done = await addExpiredAuthEvent();
    const pending = (sql: string) =>
      withClient('migrator', (client) => client.query(sql, [waiting]));
    await pending('INSERT INTO auth.audit_copy_pending (auth_event_id) VALUES ($1)');
    try {
      const before = await authPurgeEvents();
      await expect(purge()).rejects.toMatchObject({ code: '23503' });
      expect(await authKept(waiting)).toBe(true);
      expect(await authKept(done)).toBe(true);
      expect(await authPurgeEvents()).toBe(before);
    } finally {
      await pending('DELETE FROM auth.audit_copy_pending WHERE auth_event_id = $1');
    }
    expect(await purge()).toBe(2);
  });
});
