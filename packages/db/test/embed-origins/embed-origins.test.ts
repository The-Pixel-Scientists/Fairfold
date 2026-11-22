// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.embed_origin and app.embed_origins() (migration 0070, ADR 0035): the
// table is denied across tenants, checks each origin as embedOriginPattern
// does, holds each once and at most 20 per tenant, and is never changed in
// place; the function returns an active tenant's origins only when forms is
// switched on, to app_api alone, whatever tenant or search_path the caller
// sets.

import { embedOriginPattern } from '@pixel-scientists/domain/platform/settings';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { asMigratorRolledBack, withClient } from '../connect.ts';
import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { insertOutcome } from '../notes/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';

const TABLE = 'app.embed_origin';
const SIGNATURE = 'app.embed_origins(text)';
const OWNER = 'owner_app_embed_origins';

interface EmbedTenant extends TestTenant {
  readonly member: string;
}

let next = 0;
const uniqueOrigin = () => `https://site-${String((next += 1))}.example.org`;

const originRow = (tenant: EmbedTenant, origin = uniqueOrigin()): Row => ({
  tenant_id: tenant.id,
  origin,
  created_by: tenant.member,
});

/** A tenant with a member, and the modules in `modules` switched on (or off, if false). */
async function createEmbedTenant(modules: Readonly<Record<string, boolean>> = { forms: true }) {
  const tenant = await createTestTenant();
  const member = await asMigratorIn(tenant.id, async (client) => {
    const id = await addMember(client, tenant);
    for (const [module, enabled] of Object.entries(modules)) {
      await insertRow(client, 'app.tenant_module', {
        tenant_id: tenant.id,
        module,
        enabled,
        updated_by: id,
      });
    }
    return id;
  });
  return { ...tenant, member };
}

function addOrigins(tenant: EmbedTenant, origins: readonly string[]): Promise<void> {
  return asMigratorIn(tenant.id, async (client) => {
    for (const origin of origins) await insertRow(client, TABLE, originRow(tenant, origin));
  });
}

/** The function's origins for `slug` as app_api, with `context` set as the tenant if given. */
function embedOrigins(slug: string | null, context?: string): Promise<unknown[]> {
  return withClient('app_api', async (client) => {
    await client.query('BEGIN');
    try {
      if (context) {
        await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [context]);
      }
      const { rows } = await client.query<Row>('SELECT * FROM app.embed_origins($1)', [slug]);
      return rows.map((row) => row['origin']);
    } finally {
      await client.query('ROLLBACK');
    }
  });
}

let a: EmbedTenant;
let b: EmbedTenant;
const ORIGINS_A = ['https://www.example.org', 'https://apply.example.org:8443'];
const ORIGINS_B = ['https://funder-b.example.net'];

beforeAll(async () => {
  [a, b] = await Promise.all([createEmbedTenant(), createEmbedTenant()]);
  await Promise.all([addOrigins(a, ORIGINS_A), addOrigins(b, ORIGINS_B)]);
}, 60_000);

describe(TABLE, { timeout: 60_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial(TABLE, async (client, tenant) => ({
      tenant_id: tenant.id,
      origin: uniqueOrigin(),
      created_by: await addMember(client, tenant),
    })));

  it.each([
    'https://example.org',
    'https://a.b.example.co.uk:1',
    'https://xn--bcher-kva.example:65535',
    'https://x1.example',
    'http://example.org',
    'https://example.org/',
    'https://example.org/path',
    'https://example.org?q',
    'https://user@example.org',
    'https://*.example.org',
    'https://Example.org',
    'https://192.168.0.1',
    'https://localhost',
    'https://-bad.example.org',
    'https://example.org:0',
    'https://example.org:65536',
    'https://example.org:99999',
    ` https://example.org`,
    `https://${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.org`,
    `https://e.${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.org`,
  ])('checks %s as embedOriginPattern and the port limit do', async (origin) => {
    const port = Number(/:(\d+)$/.exec(origin)?.[1] ?? 443);
    const valid = embedOriginPattern.test(origin) && port <= 65_535 && origin.length <= 267;
    expect(await insertOutcome('app_api', a, TABLE, originRow(a, origin))).toBe(
      valid ? 'ok' : '23514',
    );
  });

  it('holds an origin once per tenant, and in more than one tenant', async () => {
    expect(await insertOutcome('app_api', a, TABLE, originRow(a, ORIGINS_A[0]))).toBe('23505');
    expect(await insertOutcome('app_api', b, TABLE, originRow(b, ORIGINS_A[0]))).toBe('ok');
  });

  it("refuses another tenant's member as its author", async () => {
    expect(
      await insertOutcome('app_api', a, TABLE, { ...originRow(a), created_by: b.member }),
    ).toBe('23503');
  });

  it('refuses a 21st origin', async () => {
    const own = await createEmbedTenant();
    await addOrigins(
      own,
      Array.from({ length: 19 }, () => uniqueOrigin()),
    );
    expect(await insertOutcome('app_api', own, TABLE, originRow(own))).toBe('ok');
    await addOrigins(own, [uniqueOrigin()]);
    expect(await insertOutcome('app_api', own, TABLE, originRow(own))).toBe('23514');
  });

  it('sets its own creation time, and app_api may delete but never update', () =>
    asRoleIn('app_api', a.id, async (client: pg.Client) => {
      const { rows } = await client.query<{ id: string; created_at: Date }>(
        `INSERT INTO ${TABLE} (tenant_id, origin, created_by) VALUES ($1, $2, $3)
         RETURNING id, created_at`,
        [a.id, uniqueOrigin(), a.member],
      );
      const [row] = rows;
      expect(row?.created_at.getTime()).toBeGreaterThan(Date.now() - 600_000);
      expect(await outcome(client, `UPDATE ${TABLE} SET origin = $1`, [uniqueOrigin()])).toBe(
        '42501',
      );
      expect(await outcome(client, `DELETE FROM ${TABLE} WHERE id = $1`, [row?.id])).toBe('ok');
    }));

  it('grants nothing to the other app roles', async () => {
    for (const role of ['app_worker', 'app_auth', 'app_queue'] as const) {
      expect(
        await asRoleIn(role, a.id, (client) => outcome(client, `SELECT origin FROM ${TABLE}`)),
        role,
      ).toBe('42501');
    }
  });
});

describe('app.embed_origins()', { timeout: 60_000 }, () => {
  it("returns only the slug's tenant's origins, sorted, whatever tenant is set", async () => {
    expect(await embedOrigins(a.slug)).toEqual([...ORIGINS_A].sort());
    expect(await embedOrigins(b.slug)).toEqual(ORIGINS_B);
    expect(await embedOrigins(a.slug, b.id)).toEqual([...ORIGINS_A].sort());
    expect(await embedOrigins(b.slug, a.id)).toEqual(ORIGINS_B);
  });

  it.each([
    ['an unknown slug', () => 'test-no-such-tenant'],
    ['a misspelt slug', () => `${a.slug.slice(0, -1)}x`],
    ['a differently cased slug', () => a.slug.toUpperCase()],
    ['a padded slug', () => `${a.slug} `],
    ['no slug', () => null],
  ])('returns nothing for %s', async (_, slug) => {
    expect(await embedOrigins(slug())).toEqual([]);
  });

  it.each([
    ['forms switched off', { forms: false }],
    ['forms never switched on', {}],
    ['only grants switched on', { grants: true }],
  ])('returns nothing with %s', async (_, modules) => {
    const own = await createEmbedTenant(modules);
    await addOrigins(own, [uniqueOrigin()]);
    expect(await embedOrigins(own.slug)).toEqual([]);
  });

  it('returns nothing for a suspended tenant', async () => {
    const own = await createEmbedTenant();
    const origin = uniqueOrigin();
    await addOrigins(own, [origin]);
    expect(await embedOrigins(own.slug)).toEqual([origin]);
    await asMigratorIn(own.id, (client) =>
      client.query("UPDATE app.tenant SET status = 'suspended'"),
    );
    expect(await embedOrigins(own.slug)).toEqual([]);
  });

  it('returns the origin column alone, to app_api alone', async () => {
    const columns = await withClient('app_api', async (client) => {
      const { rows } = await client.query<{ result: string }>(
        'SELECT pg_catalog.pg_get_function_result($1::regprocedure) AS result',
        [SIGNATURE],
      );
      return rows[0]?.result;
    });
    expect(columns).toBe('TABLE(origin text)');
    const outcomes: Record<string, string> = {};
    for (const role of ['app_api', 'app_auth', 'app_worker', 'app_queue'] as const) {
      outcomes[role] = await withClient(role, async (client) => {
        await client.query('BEGIN');
        try {
          return await outcome(client, 'SELECT * FROM app.embed_origins($1)', [a.slug]);
        } finally {
          await client.query('ROLLBACK');
        }
      });
    }
    expect(outcomes).toEqual({
      app_api: 'ok',
      app_auth: '42501',
      app_worker: '42501',
      app_queue: '42501',
    });
  });

  it('gives the same answer when the caller puts shadowing objects first on its search_path', () =>
    asMigratorRolledBack(async (client) => {
      await client.query('CREATE SCHEMA shadow');
      await client.query('CREATE TABLE shadow.embed_origin (tenant_id uuid, origin text)');
      await client.query("INSERT INTO shadow.embed_origin VALUES ($1, 'https://evil.example')", [
        a.id,
      ]);
      await client.query(`SET LOCAL ROLE ${OWNER}`);
      await client.query(`GRANT EXECUTE ON FUNCTION ${SIGNATURE} TO migrator`);
      await client.query('RESET ROLE');
      await client.query('SET LOCAL search_path = shadow, pg_catalog, app');
      const { rows } = await client.query<Row>('SELECT origin FROM app.embed_origins($1)', [
        a.slug,
      ]);
      expect(rows.map((row) => row['origin'])).toEqual([...ORIGINS_A].sort());
    }));
});
