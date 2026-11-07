// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The audit-copy replay and its metric against the test database. Each
// test starts with no pending copy: beforeEach replays any that another
// test file left. A copy lands only in the tenant recorded on its event,
// once, however often the replay runs; each copy records
// audit_copy_replayed, whose own copy names the operator in that tenant
// only, and stays pending until written; a tenantless event is cleared with no copy; a dry
// run writes nothing; the batch limit holds; a failure leaves its pending
// row; the tenant setting is empty after each event; and the command
// prints counts only.

import { randomUUID } from 'node:crypto';

import { createDatabase, type TenantId } from '@pixel-scientists/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { connectionSettings, withClient } from '../../../../../packages/db/test/connect.ts';
import {
  asMigratorIn,
  createTestTenant,
  createTestUser,
  insertRow,
  outcome,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import { asRoleRolledBack } from '../../../../../packages/db/test/auth/fixtures.ts';
import { smtpTestSettings } from '../../../test/support.ts';
import { createLogger } from '../../logger.ts';
import { copyAuthEvent, recordAuthEvent, writeAuthCopy, type AuthEvent } from '../events.ts';
import type { AuthTables } from '../tables.ts';
import { runAuditCopyReplay } from './command.ts';
import { oldestPendingCopy } from './oldest.ts';
import { MAX_LIMIT, replayAuthCopies, type ReplayCounts } from './replay.ts';

const apiSettings = connectionSettings('app_api');
const authSettings = connectionSettings('app_auth');
const connect = (role: 'app_api' | 'app_auth', password: string) =>
  createDatabase<unknown>({
    host: apiSettings.host,
    port: apiSettings.port,
    database: apiSettings.database,
    role,
    password,
    applicationName: 'tps-db-tests',
    maxConnections: 1,
  });
const api = connect('app_api', apiSettings.password);
const auth = connect('app_auth', authSettings.password);
const log = createLogger({ level: 'silent' });
afterAll(() => Promise.all([api.destroy(), auth.destroy()]));

const replay = (options: { limit?: number; dryRun?: boolean } = {}) =>
  replayAuthCopies(
    { api, auth },
    { limit: options.limit ?? MAX_LIMIT, dryRun: options.dryRun ?? false, requestId: randomUUID() },
  );
const total = (counts: ReplayCounts) => Object.values(counts).reduce((sum, n) => sum + n, 0);

// The first run may replay many copies that other test files left.
beforeEach(async () => {
  while (total(await replay()) === MAX_LIMIT);
}, 300_000);

interface Member {
  tenant: TestTenant;
  userId: string;
  membershipId: string;
}

async function addMember(tenant?: TestTenant): Promise<Member> {
  const home = tenant ?? (await createTestTenant());
  const userId = await createTestUser();
  const membershipId = await asMigratorIn(home.id, (client) =>
    insertRow(client, 'app.membership', {
      tenant_id: home.id,
      user_id: userId,
      roles: ['tenant_admin'],
    }),
  );
  return { tenant: home, userId, membershipId };
}

/** Record a committed event with its pending copy, as the live path does. */
function recordEvent(member: Member): Promise<AuthEvent> {
  return auth.transaction().execute((trx) =>
    recordAuthEvent(trx, 'sessions_revoked', {
      requestId: randomUUID(),
      userId: member.userId,
      tenant: member.tenant.id,
      ip: '203.0.113.77',
    }),
  );
}

async function copies(tenant: TestTenant, eventId: string): Promise<number> {
  const rows = await asMigratorIn(tenant.id, async (client) => {
    const result = await client.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM app.audit_event WHERE entity_id = $1',
      [eventId],
    );
    return result.rows;
  });
  return rows[0]?.n ?? 0;
}

const pending = (eventId: string) =>
  withClient('migrator', async (client) => {
    const { rowCount } = await client.query(
      'SELECT 1 FROM auth.audit_copy_pending WHERE auth_event_id = $1',
      [eventId],
    );
    return rowCount;
  });

const replayEvents = (eventId: string) =>
  withClient('migrator', async (client) => {
    const { rows } = await client.query<Record<string, unknown>>(
      `SELECT tenant_id, user_id, identifier, ip_address, reason
         FROM auth.audit_event
        WHERE code = 'audit_copy_replayed' AND replayed_event_id = $1`,
      [eventId],
    );
    return rows;
  });

/** The tenant's copies of the replay of `eventId`, as the tenant's log holds them. */
async function replayCopies(tenant: TestTenant, eventId: string) {
  return asMigratorIn(tenant.id, async (client) => {
    const result = await client.query<Record<string, unknown>>(
      `SELECT tenant_id, request_id, actor_kind, actor_id, entity_type, entity_id, changes
         FROM app.audit_event
        WHERE action = 'platform.auth.audit_copy_replayed'
          AND changes -> 'auth.audit_event.replayed_event_id' ->> 'after' = $1`,
      [eventId],
    );
    return result.rows;
  });
}

const replayEventId = (eventId: string) =>
  withClient('migrator', async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM auth.audit_event
        WHERE code = 'audit_copy_replayed' AND replayed_event_id = $1`,
      [eventId],
    );
    return rows.map(({ id }) => id);
  });

/** Leave the pending copy, as a live copy whose database call failed does. */
async function failLiveCopy(event: AuthEvent, member: Member): Promise<void> {
  const closed = connect('app_api', apiSettings.password);
  await closed.destroy();
  await copyAuthEvent({ api: closed, auth, log }, event, member.tenant.id as TenantId);
}

describe('the oldest pending audit copy', { timeout: 30_000 }, () => {
  it('reads 0 with none pending, and the oldest age in seconds with several', async () => {
    const read = oldestPendingCopy(auth, log);
    expect(await read()).toBe(0);

    const member = await addMember();
    const [older] = await Promise.all([recordEvent(member), recordEvent(member)]);
    // The table refuses updates, so the older row is put back with its time.
    await withClient('migrator', async (client) => {
      await client.query('DELETE FROM auth.audit_copy_pending WHERE auth_event_id = $1', [
        older.id,
      ]);
      await client.query(
        `INSERT INTO auth.audit_copy_pending (auth_event_id, created_at)
         VALUES ($1, now() - interval '90 seconds')`,
        [older.id],
      );
    });
    const seconds = await read();
    expect(seconds).toBeGreaterThanOrEqual(90);
    expect(seconds).toBeLessThan(120);
  });
});

describe('the audit-copy replay', { timeout: 60_000 }, () => {
  it('writes a failed copy once, in its own tenant only, and records the replay', async () => {
    const member = await addMember();
    const other = await addMember();
    const event = await recordEvent(member);
    await failLiveCopy(event, member);
    expect(await pending(event.id)).toBe(1);

    expect(await replay()).toMatchObject({ copied: 1, found: 0, cleared: 0 });
    expect(await copies(member.tenant, event.id)).toBe(1);
    expect(await copies(other.tenant, event.id)).toBe(0);
    expect(await pending(event.id)).toBe(0);
    expect(await replayEvents(event.id)).toEqual([
      {
        tenant_id: member.tenant.id,
        user_id: null,
        identifier: null,
        ip_address: null,
        reason: null,
      },
    ]);

    expect(total(await replay())).toBe(0);
    expect(await copies(member.tenant, event.id)).toBe(1);
    expect(await replayEvents(event.id)).toHaveLength(1);
  });

  it("copies the replay to its event's tenant only, by the operator", async () => {
    const member = await addMember();
    const other = await addMember();
    const event = await recordEvent(member);
    await failLiveCopy(event, member);
    const requestId = randomUUID();

    const counts = await replayAuthCopies(
      { api, auth },
      { limit: MAX_LIMIT, dryRun: false, requestId },
    );
    expect(counts).toMatchObject({ copied: 1 });
    const [replayId] = await replayEventId(event.id);
    expect(await replayCopies(member.tenant, event.id)).toEqual([
      {
        tenant_id: member.tenant.id,
        request_id: requestId,
        actor_kind: 'operator',
        actor_id: null,
        entity_type: 'platform.auth',
        entity_id: replayId,
        changes: { 'auth.audit_event.replayed_event_id': { after: event.id } },
      },
    ]);
    expect(await replayCopies(other.tenant, event.id)).toEqual([]);
    expect(await pending(replayId ?? '')).toBe(0);
  });

  it('keeps a replay event pending until its copy is written, and replays it no further', async () => {
    const member = await addMember();
    const other = await addMember();
    const replayed = randomUUID();
    // As the run leaves it when its own copy fails: recorded, with its pending row.
    const event = await auth.transaction().execute((trx) =>
      recordAuthEvent(trx, 'audit_copy_replayed', {
        requestId: randomUUID(),
        tenant: member.tenant.id,
        replayedEventId: replayed,
      }),
    );
    expect(await pending(event.id)).toBe(1);
    expect(await replayCopies(member.tenant, replayed)).toEqual([]);

    expect(await replay({ dryRun: true })).toMatchObject({ due: 1 });
    expect(await replay()).toMatchObject({ copied: 1 });
    expect(await pending(event.id)).toBe(0);
    expect(await replayCopies(member.tenant, replayed)).toMatchObject([
      { actor_kind: 'operator', actor_id: null, entity_id: event.id },
    ]);
    expect(await replayCopies(other.tenant, replayed)).toEqual([]);
    expect(await replayEvents(event.id)).toEqual([]);

    expect(total(await replay())).toBe(0);
    expect(await replayCopies(member.tenant, replayed)).toHaveLength(1);
  });

  it('finds a copy already written and only clears the pending row', async () => {
    const member = await addMember();
    const event = await recordEvent(member);
    await writeAuthCopy(api, event, member.tenant.id as TenantId);
    expect(await pending(event.id)).toBe(1);

    expect(await replay()).toMatchObject({ copied: 0, found: 1 });
    expect(await copies(member.tenant, event.id)).toBe(1);
    expect(await pending(event.id)).toBe(0);
  });

  it('clears an event with no tenant, or no membership, with no copy', async () => {
    const member = await addMember();
    const tenantless = await auth.transaction().execute(async (trx) => {
      const recorded = await recordAuthEvent(trx, 'sign_in_failed', {
        requestId: randomUUID(),
        userId: member.userId,
        reason: 'bad_password',
      });
      await trx
        .$extendTables<AuthTables>()
        .insertInto('auth.audit_copy_pending')
        .values({ auth_event_id: recorded.id })
        .execute();
      return recorded;
    });
    const stranger = { ...member, tenant: await createTestTenant() };
    const notMember = await recordEvent(stranger);

    expect(await replay()).toMatchObject({ copied: 0, found: 0, cleared: 2 });
    for (const event of [tenantless, notMember]) {
      expect(await pending(event.id)).toBe(0);
      expect(await replayEvents(event.id)).toEqual([]);
    }
    expect(await copies(member.tenant, tenantless.id)).toBe(0);
    expect(await copies(stranger.tenant, notMember.id)).toBe(0);
  });

  it('writes nothing in a dry run, and takes no more than the batch limit', async () => {
    const member = await addMember();
    const events = [];
    for (let i = 0; i < 3; i += 1) events.push(await recordEvent(member));

    expect(await replay({ dryRun: true })).toMatchObject({ due: 3, copied: 0 });
    for (const event of events) {
      expect(await pending(event.id)).toBe(1);
      expect(await copies(member.tenant, event.id)).toBe(0);
    }

    expect(await replay({ limit: 2 })).toMatchObject({ copied: 2 });
    expect(await pending(events[2]?.id ?? '')).toBe(1);
    expect(await replay({ limit: 2 })).toMatchObject({ copied: 1 });
  });

  it('counts each failure, keeps its pending row and goes on', async () => {
    const member = await addMember();
    const events = [await recordEvent(member), await recordEvent(member)];
    const closed = connect('app_api', apiSettings.password);
    await closed.destroy();

    const counts = await replayAuthCopies(
      { api: closed, auth },
      { limit: MAX_LIMIT, dryRun: false, requestId: randomUUID() },
    );
    expect(counts).toMatchObject({ copied: 0, failed_other: 2 });
    for (const event of events) expect(await pending(event.id)).toBe(1);
  });

  it('leaves the connection with no tenant set after each event', async () => {
    const member = await addMember();
    await recordEvent(member);
    expect(await replay()).toMatchObject({ copied: 1 });
    const setting = await api
      .selectNoFrom((eb) =>
        eb
          .fn<string | null>('current_setting', [eb.val('app.tenant_id'), eb.val(true)])
          .as('tenant'),
      )
      .executeTakeFirstOrThrow();
    expect(setting.tenant ?? '').toBe('');
  });

  it('is beyond app_api, which reads neither pending copies nor auth events', async () => {
    await asRoleRolledBack('app_api', async (client) => {
      for (const table of ['auth.audit_copy_pending', 'auth.audit_event']) {
        expect(await outcome(client, `SELECT 1 FROM ${table}`), table).toBe('42501');
      }
    });
  });
});

describe('the audit-copy replay command', { timeout: 60_000 }, () => {
  const env = {
    ...smtpTestSettings,
    TPS_DEV: '1',
    TPS_DB_HOST: apiSettings.host,
    TPS_DB_PORT: String(apiSettings.port),
    TPS_DB_NAME: apiSettings.database,
    TPS_DB_APP_API_PASSWORD: apiSettings.password,
    TPS_DB_APP_AUTH_PASSWORD: authSettings.password,
    TPS_AUTH_SECRET: randomUUID(),
    TPS_CONSOLE_ORIGIN: 'https://console.example.org',
    TPS_PORTAL_ORIGIN: 'https://apply.example.org',
  };

  async function run(argv: string[]) {
    const lines: string[] = [];
    const code = await runAuditCopyReplay(argv, env, {
      out: (text) => lines.push(text),
      err: (text) => lines.push(text),
    });
    return { code, text: lines.join('\n') };
  }

  it('prints counts only: no id, address or error text', async () => {
    const member = await addMember();
    const event = await recordEvent(member);

    const dry = await run(['--dry-run']);
    expect(dry.code).toBe(0);
    expect(dry.text).toMatch(/^Dry run: nothing was written\.\n1 pending copies are due/);
    expect(await pending(event.id)).toBe(1);

    const done = await run(['--limit', '10']);
    expect(done.code).toBe(0);
    expect(done.text).toMatch(/^Copied 1 auth events/);
    for (const { text } of [dry, done]) {
      for (const value of [event.id, member.tenant.id, member.userId, '203.0.113.77']) {
        expect(text).not.toContain(value);
      }
      expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-|error|constraint "/i);
    }
    expect(await copies(member.tenant, event.id)).toBe(1);
  });
});
