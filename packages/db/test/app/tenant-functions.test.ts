// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.public_tenant(), app.public_tenant_logo() and app.create_tenant()
// (migration 0006, ADR 0019), through their wrappers where they succeed:
// what each returns, who may call it, what its owner may reach, and the
// backstop check on tenant names.

import { randomUUID } from 'node:crypto';

import { defaultTheme } from '@pixel-scientists/domain/platform';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest';

import { insertAuditEvent } from '../../src/audit.ts';
import { createDatabase } from '../../src/database.ts';
import { withTenant, type TenantId } from '../../src/tenant-context.ts';
import { createTenant, publicTenant, publicTenantLogo } from '../../src/tenant-functions.ts';
import { asMigratorRolledBack, databaseSettings, withClient } from '../connect.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  outcome,
  testSlug,
  type Row,
  type TestTenant,
} from '../tenants.ts';

const LOGO = Buffer.from('89504e470d0a1a0a', 'hex');

let api: Kysely<unknown>;
let auth: Kysely<unknown>;
let worker: Kysely<unknown>;
let plain: TestTenant;
let themed: TestTenant;
let suspended: TestTenant;

beforeAll(async () => {
  api = createDatabase(databaseSettings('app_api', 1));
  auth = createDatabase(databaseSettings('app_auth', 1));
  worker = createDatabase(databaseSettings('app_worker', 1));
  [plain, themed, suspended] = await Promise.all([
    createTestTenant(),
    createTestTenant(),
    createTestTenant(),
  ]);
  for (const tenant of [themed, suspended]) {
    await asMigratorIn(tenant.id, async (client) => {
      await insertRow(client, 'app.tenant_theme', {
        tenant_id: tenant.id,
        brand_colour: '#0b5394',
        preset: 'rounded',
        logo: LOGO,
        logo_type: 'image/png',
        updated_by: await addMember(client, tenant),
      });
    });
  }
  await asMigratorIn(suspended.id, (client) =>
    client.query("UPDATE app.tenant SET status = 'suspended' WHERE id = $1", [suspended.id]),
  );
});

afterAll(async () => {
  await Promise.all([api.destroy(), auth.destroy(), worker.destroy()]);
});

const MISSING = ['an unknown', 'a suspended', 'a malformed', 'an empty', 'a quoted'] as const;
function missingSlug(kind: (typeof MISSING)[number]): string {
  return {
    'an unknown': testSlug(),
    'a suspended': suspended.slug,
    'a malformed': themed.slug.toUpperCase(),
    'an empty': '',
    'a quoted': `${themed.slug}' OR true --`,
  }[kind];
}

/** Each role's SQLSTATE, or ok, for `text` with no tenant set. */
async function callers(text: string, values: unknown[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const role of ['app_api', 'app_auth', 'app_worker', 'app_queue'] as const) {
    result[role] = await withClient(role, async (client) => {
      await client.query('BEGIN');
      try {
        return await outcome(client, text, values);
      } finally {
        await client.query('ROLLBACK');
      }
    });
  }
  return result;
}

describe('app.public_tenant()', { timeout: 30_000 }, () => {
  it('returns an active tenant with the default theme when it has none, for app_api and app_auth', async () => {
    const expected = {
      id: plain.id,
      name: 'Test tenant',
      theme: { brandColour: defaultTheme.brandColour, preset: defaultTheme.preset, hasLogo: false },
    };
    expect(await publicTenant(api, plain.slug)).toEqual(expected);
    expect(await publicTenant(auth, plain.slug)).toEqual(expected);
  });

  it("returns an active tenant's own theme and whether it has a logo", async () => {
    expect(await publicTenant(api, themed.slug)).toEqual({
      id: themed.id,
      name: 'Test tenant',
      theme: { brandColour: '#0b5394', preset: 'rounded', hasLogo: true },
    });
  });

  it.each(MISSING)('returns nothing for %s slug', async (kind) => {
    expect(await publicTenant(api, missingSlug(kind))).toBeUndefined();
  });

  it('is callable by app_api and app_auth alone', async () => {
    expect(await callers('SELECT * FROM app.public_tenant($1)', [plain.slug])).toEqual({
      app_api: 'ok',
      app_auth: 'ok',
      app_worker: '42501',
      app_queue: '42501',
    });
  });
});

describe('app.public_tenant_logo()', { timeout: 30_000 }, () => {
  it("returns an active tenant's logo and its type", async () => {
    expect(await publicTenantLogo(api, themed.slug)).toEqual({ logo: LOGO, logoType: 'image/png' });
  });

  it.each([...MISSING, 'a logo-less'] as const)('returns nothing for %s slug', async (kind) => {
    const slug = kind === 'a logo-less' ? plain.slug : missingSlug(kind);
    expect(await publicTenantLogo(api, slug)).toBeUndefined();
  });

  it('is callable by app_api alone', async () => {
    expect(await callers('SELECT * FROM app.public_tenant_logo($1)', [themed.slug])).toEqual({
      app_api: 'ok',
      app_auth: '42501',
      app_worker: '42501',
      app_queue: '42501',
    });
  });
});

describe('app.create_tenant()', { timeout: 30_000 }, () => {
  it('creates an active tenant with a trimmed name, and lets app_worker audit it there', async () => {
    const slug = testSlug();
    const id = await createTenant(worker, { slug, name: '  Northfield Trust ' });
    expectTypeOf(id).toEqualTypeOf<TenantId>();
    await withTenant(worker, id, (trx) =>
      insertAuditEvent(trx, {
        requestId: randomUUID(),
        actorKind: 'operator',
        actorId: null,
        action: 'platform.tenant.created',
        entityType: 'platform.tenant',
        entityId: id,
        changes: { 'app.tenant.slug': { after: slug } },
      }),
    );

    const rows = await asRoleIn('app_api', id, async (client) => [
      ...(await client.query<Row>('SELECT id, slug, name, status FROM app.tenant')).rows,
      ...(await client.query<Row>('SELECT actor_kind, entity_id FROM app.audit_event')).rows,
    ]);
    expect(rows).toEqual([
      { id, slug, name: 'Northfield Trust', status: 'active' },
      { actor_kind: 'operator', entity_id: id },
    ]);
  });

  it('refuses a name that tenantNameSchema refuses before calling the database', async () => {
    const slug = testSlug();
    await expect(createTenant(worker, { slug, name: 'North\u200bfield' })).rejects.toThrow();
    expect(await publicTenant(api, slug)).toBeUndefined();
  });

  it.each([
    ['a taken slug', () => plain.slug, '23505'],
    ['a reserved slug', () => 'portal', '23514'],
    ['a malformed slug', () => 'North field', '23514'],
    ['no slug', () => null, '23502'],
  ])('refuses %s', async (_, slug, expected) => {
    await withClient('app_worker', async (client) => {
      await client.query('BEGIN');
      try {
        expect(await outcome(client, "SELECT app.create_tenant($1, 'Copy')", [slug()])).toBe(
          expected,
        );
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });

  it('is callable by app_worker alone', async () => {
    expect(await callers("SELECT app.create_tenant($1, 'New')", [testSlug()])).toEqual({
      app_api: '42501',
      app_auth: '42501',
      app_worker: 'ok',
      app_queue: '42501',
    });
  });
});

describe('the function owners and app roles', { timeout: 30_000 }, () => {
  it.each([
    [
      'owner_app_public_tenant',
      [
        'SELECT timezone FROM app.tenant',
        'SELECT logo FROM app.tenant_theme',
        'SELECT updated_by FROM app.tenant_theme',
        'SELECT id FROM app.membership',
        'SELECT id FROM app.audit_event',
        "UPDATE app.tenant SET name = 'x'",
        'DELETE FROM app.tenant',
      ],
    ],
    [
      'owner_app_public_tenant_logo',
      [
        'SELECT name FROM app.tenant',
        'SELECT brand_colour FROM app.tenant_theme',
        'SELECT id FROM app.membership',
        'UPDATE app.tenant_theme SET logo = NULL',
      ],
    ],
    [
      'owner_app_create_tenant',
      [
        'SELECT id FROM app.tenant',
        "INSERT INTO app.tenant (id, slug, name, status) VALUES (gen_random_uuid(), 'abc', 'x', 'suspended')",
        "UPDATE app.tenant SET name = 'x'",
        'SELECT id FROM app.tenant_theme',
      ],
    ],
  ])('lets %s reach no other column or table', async (owner, statements) => {
    await asMigratorRolledBack(async (client) => {
      await client.query(`SET LOCAL ROLE ${owner}`);
      for (const statement of statements) {
        expect(await outcome(client, statement), statement).toBe('42501');
      }
    });
  });

  it('still shows app roles no tenant row without a tenant set', async () => {
    for (const table of ['app.tenant', 'app.tenant_theme', 'app.membership']) {
      const { rows } = await withClient('app_api', (client) =>
        client.query<{ count: string }>(`SELECT count(*) FROM ${table}`),
      );
      expect(rows, table).toEqual([{ count: '0' }]);
    }
    expect(await callers('SELECT 1 FROM app.tenant', [])).toEqual({
      app_api: 'ok',
      app_auth: '42501',
      app_worker: '42501',
      app_queue: '42501',
    });
  });
});

describe('the tenant name check', { timeout: 30_000 }, () => {
  it.each([
    ['accepts 100 characters', 'n'.repeat(100), 'ok'],
    ['accepts accents and symbols', 'Fondation Caf\u00e9 & Trust \u{1f331}', 'ok'],
    ['refuses 101 characters', 'n'.repeat(101), '23514'],
    ['refuses a blank name', '   ', '23514'],
    ['refuses a tab', 'North\tfield', '23514'],
    ['refuses a line feed', 'North\nfield', '23514'],
    ['refuses delete', 'North\u007ffield', '23514'],
    ['refuses a C1 control', 'North\u0085field', '23514'],
    ['refuses a zero-width space', 'North\u200bfield', '23514'],
    ['refuses a zero-width joiner', 'North\u200dfield', '23514'],
    ['refuses a word joiner', 'North\u2060field', '23514'],
    ['refuses a right-to-left mark', 'North\u200ffield', '23514'],
    ['refuses a bidi override', 'North\u202efield', '23514'],
    ['refuses a bidi isolate', 'North\u2067field', '23514'],
    ['refuses an Arabic letter mark', 'North\u061cfield', '23514'],
    ['refuses a line separator', 'North\u2028field', '23514'],
    ['refuses a paragraph separator', 'North\u2029field', '23514'],
    ['refuses a byte order mark', '\ufeffNorthfield', '23514'],
  ])('%s', async (_, name, expected) => {
    const id = randomUUID();
    await asRoleIn('migrator', id, async (client) => {
      expect(
        await outcome(client, 'INSERT INTO app.tenant (id, slug, name) VALUES ($1, $2, $3)', [
          id,
          testSlug(),
          name,
        ]),
      ).toBe(expected);
    });
  });
});
