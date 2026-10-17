// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.tenant_theme.tokens and app.public_tenant() (migration 0014, ADR 0046):
// isolation, what app_api may write, the column's checks, what the function
// returns, and the down migration's refusal. Migration 0014's down refuses
// while any theme has tokens, and migrations.test.ts runs it on this
// database, so committed rows here hold tokens only inside one test.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS_FOLDER } from '../../scripts/migrations.ts';
import { createDatabase } from '../../src/database.ts';
import { publicTenant } from '../../src/tenant-functions.ts';
import { asMigratorRolledBack, databaseSettings } from '../connect.ts';
import { expectCrossTenantDenial } from '../cross-tenant.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  insertStatement,
  outcome,
  testSlug,
  type TestTenant,
} from '../tenants.ts';

const TOKENS = { light: { colorInk: '#1b1d21' }, radiusMedium: 0.375 };
const MAX_BYTES = 16_384;

/** A JSON object of `bytes` bytes as PostgreSQL writes jsonb: {"a": "..."}. */
const objectOfSize = (bytes: number, character = 'x') =>
  JSON.stringify({ a: character.repeat((bytes - 9) / Buffer.byteLength(character)) });

/** A theme row for `tenant`, as migrator with that tenant set. */
const themeRow = async (client: Parameters<typeof addMember>[0], tenant: TestTenant) => ({
  tenant_id: tenant.id,
  brand_colour: '#0b5394',
  preset: 'rounded',
  updated_by: await addMember(client, tenant),
});

let api: Kysely<unknown>;
let auth: Kysely<unknown>;
let plain: TestTenant;
let themed: TestTenant;
let suspended: TestTenant;
let member: string;

beforeAll(async () => {
  api = createDatabase(databaseSettings('app_api', 1));
  auth = createDatabase(databaseSettings('app_auth', 1));
  [plain, themed, suspended] = await Promise.all([
    createTestTenant(),
    createTestTenant(),
    createTestTenant(),
  ]);
  member = await asMigratorIn(plain.id, (client) => addMember(client, plain));
  for (const tenant of [themed, suspended]) {
    await asMigratorIn(tenant.id, async (client) =>
      insertRow(client, 'app.tenant_theme', await themeRow(client, tenant)),
    );
  }
  await asMigratorIn(suspended.id, (client) =>
    client.query("UPDATE app.tenant SET status = 'suspended' WHERE id = $1", [suspended.id]),
  );
}, 30_000);

afterAll(async () => {
  await Promise.all([api.destroy(), auth.destroy()]);
});

/** Store `tokens` for each of `tenants` and commit, run `work`, then clear them. */
async function withStoredTokens(tenants: readonly TestTenant[], work: () => Promise<void>) {
  const store = (tenant: TestTenant, tokens: unknown) =>
    asMigratorIn(tenant.id, (client) =>
      client.query('UPDATE app.tenant_theme SET tokens = $1', [tokens]),
    );
  try {
    for (const tenant of tenants) await store(tenant, JSON.stringify(TOKENS));
    await work();
  } finally {
    for (const tenant of tenants) await store(tenant, null);
  }
}

describe('app.tenant_theme.tokens', { timeout: 30_000 }, () => {
  it("keeps each tenant's tokens from every other tenant", async () => {
    // The helper commits its rows, so they hold no tokens.
    await expectCrossTenantDenial('app.tenant_theme', async (client, tenant) => ({
      ...(await themeRow(client, tenant)),
      tokens: null,
    }));
  });

  it.each([
    ['accepts no tokens', null, 'ok'],
    ['accepts an empty object', '{}', 'ok'],
    ['accepts an object of 16 KB as text', objectOfSize(MAX_BYTES), 'ok'],
    ['refuses an object one byte larger', objectOfSize(MAX_BYTES + 1), '23514'],
    ['counts bytes, not characters', objectOfSize(MAX_BYTES + 1, 'é'), '23514'],
    ['refuses an array', '[]', '23514'],
    ['refuses a string', '"tokens"', '23514'],
    ['refuses a number', '1', '23514'],
    ['refuses JSON null', 'null', '23514'],
  ])('%s', async (_, tokens, expected) => {
    await asRoleIn('app_api', plain.id, async (client) => {
      const { text, values } = insertStatement(client, 'app.tenant_theme', {
        tenant_id: plain.id,
        brand_colour: '#1f4bb8',
        preset: 'standard',
        updated_by: member,
        tokens,
      });
      expect(await outcome(client, text, values)).toBe(expected);
    });
  });

  it('lets app_api change the tokens of its own theme', async () => {
    await asRoleIn('app_api', themed.id, async (client) => {
      const { rows } = await client.query(
        'UPDATE app.tenant_theme SET tokens = $1 RETURNING tokens',
        [JSON.stringify(TOKENS)],
      );
      expect(rows).toEqual([{ tokens: TOKENS }]);
    });
  });
});

describe('app.public_tenant() with tokens', { timeout: 30_000 }, () => {
  it("returns an active tenant's tokens as stored, for app_api and app_auth, and nothing for a suspended or unknown slug", async () => {
    await withStoredTokens([themed, suspended], async () => {
      const expected = {
        id: themed.id,
        name: 'Test tenant',
        theme: { brandColour: '#0b5394', preset: 'rounded', hasLogo: false },
        tokens: TOKENS,
      };
      expect(await publicTenant(api, themed.slug)).toEqual(expected);
      expect(await publicTenant(auth, themed.slug)).toEqual(expected);
      expect(await publicTenant(api, suspended.slug)).toBeUndefined();
      expect(await publicTenant(api, testSlug())).toBeUndefined();
    });
  });

  it('returns ink and no tokens for a tenant with no theme row', async () => {
    expect(await publicTenant(api, plain.slug)).toEqual({
      id: plain.id,
      name: 'Test tenant',
      theme: { brandColour: '#1b1d21', preset: 'standard', hasLogo: false },
      tokens: null,
    });
  });

  it('lets its owner read the tokens and change nothing', async () => {
    await asMigratorRolledBack(async (client) => {
      await client.query('SET LOCAL ROLE owner_app_public_tenant');
      expect(await outcome(client, 'SELECT tokens FROM app.tenant_theme')).toBe('ok');
      expect(await outcome(client, 'UPDATE app.tenant_theme SET tokens = NULL')).toBe('42501');
    });
  });
});

describe('migration 0014 down', { timeout: 30_000 }, () => {
  it('refuses while any theme has tokens, even one hidden from migrator, naming the rollback', async () => {
    const down = await readFile(
      join(MIGRATIONS_FOLDER, '0014_app_theme_tokens', 'down.sql'),
      'utf8',
    );
    const tenant = await createTestTenant();
    await asMigratorRolledBack(async (client) => {
      await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant.id]);
      await insertRow(client, 'app.tenant_theme', {
        ...(await themeRow(client, tenant)),
        tokens: JSON.stringify(TOKENS),
      });
      await client.query("SELECT pg_catalog.set_config('app.tenant_id', '', true)");
      await expect(client.query(down)).rejects.toMatchObject({
        code: 'P0001',
        message: expect.stringContaining(
          'cannot be rolled back while a theme has tokens',
        ) as string,
        hint: expect.stringContaining('Restore the database backup') as string,
      });
    });
  });
});
