// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `--modules` and the grants backfill against the test database, as
// app_worker: rows, configuration versions and events written together, an
// explicit off left alone, a second run writing nothing, and one tenant's
// transaction unable to touch another's.

import { randomUUID } from 'node:crypto';

import { createDatabase, withTenant, type TenantId } from '@pixel-scientists/db';
import { afterAll, describe, expect, it } from 'vitest';

import { connectionSettings } from '../../../../packages/db/test/connect.ts';
import { asMigratorIn, createTestTenant, testSlug } from '../../../../packages/db/test/tenants.ts';
import { smtpTestSettings } from '../../test/support.ts';
import { switchModule } from '../../test/modules-on.ts';
import type { Sender } from '../email/sender.ts';
import { runBackfillGrants } from './backfill-command.ts';
import { runCreateTenant } from './command.ts';
import { parseModules, switchModulesOn } from './switch-on.ts';

const creds = connectionSettings('app_worker');
const worker = createDatabase<unknown>({
  host: creds.host,
  port: creds.port,
  database: creds.database,
  role: 'app_worker',
  password: creds.password,
  maxConnections: 1,
  applicationName: 'tps-db-tests',
});
afterAll(() => worker.destroy());

const env = {
  ...smtpTestSettings,
  TPS_DEV: '1',
  TPS_DB_HOST: creds.host,
  TPS_DB_PORT: String(creds.port),
  TPS_DB_NAME: creds.database,
  TPS_DB_APP_WORKER_PASSWORD: creds.password,
  TPS_CONSOLE_ORIGIN: 'https://console.example.org',
};
const sender: Sender = { send: () => Promise.resolve({ sent: true }) };

const rowsIn = (tenantId: string, query: string) =>
  asMigratorIn(
    tenantId,
    async (client) => (await client.query(query)).rows as Record<string, unknown>[],
  );

const create = async (args: string[]) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCreateTenant(
    [
      '--slug',
      testSlug(),
      '--name',
      'Northfield Trust',
      '--admin-email',
      'a@example.test',
      ...args,
    ],
    env,
    { out: (t) => out.push(t), err: (t) => err.push(t) },
    sender,
  );
  return { code, out: out.join('\n'), err: err.join('\n') };
};

const idOf = (out: string) => /\(([0-9a-f-]{36})\)/.exec(out)?.[1] ?? '';
const modulesOf = (id: string) =>
  rowsIn(
    id,
    'SELECT module, enabled, updated_by_kind, updated_by FROM app.tenant_module ORDER BY module',
  );

describe('parseModules', () => {
  it('reads known ids and refuses unknown or repeated ones', () => {
    expect(parseModules(undefined)).toEqual([]);
    expect(parseModules('grants, crm')).toEqual(['grants', 'crm']);
    expect(parseModules('grants,nope')).toContain('unknown module');
    expect(parseModules('grants,grants')).toContain('twice');
    expect(parseModules('platform')).toContain('unknown module');
  });
});

describe('tenant:create --modules', { timeout: 60_000 }, () => {
  it('switches the listed tools on with an event and a version each, in the operator name', async () => {
    const result = await create(['--modules', 'grants,crm']);
    expect(result.code, result.err).toBe(0);
    const id = idOf(result.out);
    const rows = await modulesOf(id);
    expect(rows.map((r) => r.module)).toEqual(['crm', 'grants']);
    for (const row of rows) {
      expect(row).toMatchObject({ enabled: true, updated_by_kind: 'operator', updated_by: null });
    }
    const events = await rowsIn(
      id,
      "SELECT actor_kind, actor_id FROM app.audit_event WHERE action = 'platform.module.switched_on'",
    );
    expect(events).toEqual([
      { actor_kind: 'operator', actor_id: null },
      { actor_kind: 'operator', actor_id: null },
    ]);
    const all = await rowsIn(
      id,
      "SELECT count(*)::int AS n FROM app.audit_event WHERE action LIKE 'platform.module.%'",
    );
    expect(all).toEqual([{ n: 2 }]);
    const versions = await rowsIn(
      id,
      "SELECT author_kind, author_id, version FROM app.config_version WHERE entity_type = 'platform.module'",
    );
    expect(versions).toHaveLength(2);
    expect(versions.every((v) => v.author_kind === 'operator' && v.version === 1)).toBe(true);
  });

  it('writes no rows without the flag, so every tool is off', async () => {
    const result = await create([]);
    expect(result.code, result.err).toBe(0);
    expect(await modulesOf(idOf(result.out))).toEqual([]);
  });

  it('refuses an unknown or repeated id and writes nothing', async () => {
    for (const modules of ['grants,nope', 'grants,grants', 'platform']) {
      const result = await create(['--modules', modules]);
      expect(result.code, modules).toBe(2);
      expect(result.err).toContain('Modules:');
      expect(result.out).toBe('');
    }
  });
});

describe('grants backfill', { timeout: 120_000 }, () => {
  it('adds grants once, leaves an explicit off, and prints counts only', async () => {
    const fresh = await createTestTenant();
    const off = await createTestTenant();
    await switchModule(off, 'grants', false);

    const run = async () => {
      const out: string[] = [];
      const err: string[] = [];
      const code = await runBackfillGrants([], env, {
        out: (t) => out.push(t),
        err: (t) => err.push(t),
      });
      return { code, out: out.join('\n'), err: err.join('\n') };
    };
    const first = await run();
    expect(first.code, first.err).toBe(0);
    expect(first.out).toMatch(/^Checked \d+ tenants\. Switched grants on for \d+\.$/);
    expect(first.out).not.toContain(fresh.slug);

    expect(await modulesOf(fresh.id)).toEqual([
      { module: 'grants', enabled: true, updated_by_kind: 'operator', updated_by: null },
    ]);
    expect((await modulesOf(off.id))[0]?.enabled).toBe(false);
    const versions = await rowsIn(
      fresh.id,
      "SELECT author_kind FROM app.config_version WHERE entity_type = 'platform.module'",
    );
    expect(versions).toEqual([{ author_kind: 'operator' }]);
    const events = await rowsIn(
      fresh.id,
      "SELECT actor_kind FROM app.audit_event WHERE action = 'platform.module.switched_on'",
    );
    expect(events).toEqual([{ actor_kind: 'operator' }]);

    const second = await run();
    expect(second.out).toMatch(/Switched grants on for 0\.$/);
    expect(await modulesOf(fresh.id)).toHaveLength(1);
  });

  it("writes only the set tenant's rows, and sees no other tenant's", async () => {
    const a = await createTestTenant();
    const b = await createTestTenant();
    await withTenant(worker, a.id as TenantId, (trx) =>
      switchModulesOn(trx, randomUUID(), ['grants']),
    );
    expect(await modulesOf(b.id)).toEqual([]);

    const seen = await withTenant(worker, b.id as TenantId, async (trx) => {
      const { rows } = await trx
        .$extendTables<{ 'app.tenant_module': { module: string } }>()
        .selectFrom('app.tenant_module')
        .select('module')
        .execute()
        .then((rows) => ({ rows }));
      return rows;
    });
    expect(seen).toEqual([]);
  });
});
