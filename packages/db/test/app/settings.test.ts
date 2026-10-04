// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.tenant_module and app.tenant_theme (migration 0002): isolation, what
// app_api may write, and the checks on each column.

import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial } from '../cross-tenant.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertStatement,
  outcome,
  type Row,
} from '../tenants.ts';

const LOGO_MAX_BYTES = 204_800;

/** A tenant, one of its members, and one member of another tenant. Tests roll back their rows. */
async function setUp() {
  const tenant = await createTestTenant();
  const other = await createTestTenant();
  const member = await asMigratorIn(tenant.id, (client) => addMember(client, tenant));
  const stranger = await asMigratorIn(other.id, (client) => addMember(client, other));
  return { tenant, member, stranger };
}

let fixtures: Awaited<ReturnType<typeof setUp>>;
beforeAll(async () => {
  fixtures = await setUp();
}, 30_000);

describe('app.tenant_module', { timeout: 30_000 }, () => {
  it("keeps each tenant's module switches from every other tenant", async () => {
    await expectCrossTenantDenial('app.tenant_module', async (client, tenant) => ({
      tenant_id: tenant.id,
      module: 'grants',
      enabled: false,
      updated_by: await addMember(client, tenant),
    }));
  });

  it('lets app_api switch a module, once per tenant, by its own members, and never delete', async () => {
    const { tenant, member, stranger } = fixtures;
    await asRoleIn('app_api', tenant.id, async (client) => {
      const add = (module: string, by: string) =>
        insertStatement(client, 'app.tenant_module', {
          tenant_id: tenant.id,
          module,
          enabled: false,
          updated_by: by,
        });
      for (const [module, by, expected] of [
        ['party', member, '23514'],
        ['crm', member, '23514'],
        ['grants', stranger, '23503'],
      ] as const) {
        const { text, values } = add(module, by);
        expect(await outcome(client, text, values), `${module} by ${by}`).toBe(expected);
      }
      const { text, values } = add('grants', member);
      await client.query(text, values);
      expect(await outcome(client, text, values)).toBe('23505');

      const switched = await client.query(
        'UPDATE app.tenant_module SET enabled = true, updated_by = $1 RETURNING enabled',
        [member],
      );
      expect(switched.rows).toEqual([{ enabled: true }]);
      expect(await outcome(client, `UPDATE app.tenant_module SET module = 'grants'`)).toBe('42501');
      expect(await outcome(client, 'DELETE FROM app.tenant_module')).toBe('42501');
    });
  });
});

describe('app.tenant_theme', { timeout: 30_000 }, () => {
  it("keeps each tenant's theme from every other tenant", async () => {
    await expectCrossTenantDenial('app.tenant_theme', async (client, tenant) => ({
      tenant_id: tenant.id,
      brand_colour: '#1f4bb8',
      preset: 'standard',
      updated_by: await addMember(client, tenant),
    }));
  });

  it.each([
    [
      'accepts a PNG logo of the largest size',
      { logo: Buffer.alloc(LOGO_MAX_BYTES), logo_type: 'image/png' },
      'ok',
    ],
    ['accepts a WebP logo', { logo: Buffer.alloc(10), logo_type: 'image/webp' }, 'ok'],
    [
      'refuses a logo one byte too large',
      { logo: Buffer.alloc(LOGO_MAX_BYTES + 1), logo_type: 'image/png' },
      '23514',
    ],
    ['refuses an empty logo', { logo: Buffer.alloc(0), logo_type: 'image/png' }, '23514'],
    ['refuses an SVG logo', { logo: Buffer.alloc(10), logo_type: 'image/svg+xml' }, '23514'],
    ['refuses a logo without its type', { logo: Buffer.alloc(10) }, '23514'],
    ['refuses a type without a logo', { logo_type: 'image/png' }, '23514'],
    ['refuses a colour in capitals', { brand_colour: '#1F4BB8' }, '23514'],
    ['refuses a short colour', { brand_colour: '#1f4bb' }, '23514'],
    ['refuses a colour name', { brand_colour: 'navy' }, '23514'],
    ['refuses an unknown preset', { preset: 'glass' }, '23514'],
  ])('%s', async (_, change: Row, expected) => {
    const { tenant, member } = fixtures;
    await asRoleIn('app_api', tenant.id, async (client) => {
      const { text, values } = insertStatement(client, 'app.tenant_theme', {
        tenant_id: tenant.id,
        brand_colour: '#1f4bb8',
        preset: 'rounded',
        updated_by: member,
        ...change,
      });
      expect(await outcome(client, text, values)).toBe(expected);
    });
  });

  it('holds one theme per tenant, changed by its own members, and never deleted', async () => {
    const { tenant, member, stranger } = fixtures;
    await asRoleIn('app_api', tenant.id, async (client) => {
      const add = (by: string) =>
        insertStatement(client, 'app.tenant_theme', {
          tenant_id: tenant.id,
          brand_colour: '#1f4bb8',
          preset: 'square',
          updated_by: by,
        });
      const byStranger = add(stranger);
      expect(await outcome(client, byStranger.text, byStranger.values)).toBe('23503');
      const { text, values } = add(member);
      await client.query(text, values);
      expect(await outcome(client, text, values)).toBe('23505');

      const changed = await client.query(
        `UPDATE app.tenant_theme SET brand_colour = '#0b3d2e', logo = $1, logo_type = 'image/png'
          RETURNING brand_colour`,
        [Buffer.from([1, 2, 3])],
      );
      expect(changed.rows).toEqual([{ brand_colour: '#0b3d2e' }]);
      expect(await outcome(client, 'UPDATE app.tenant_theme SET tenant_id = tenant_id')).toBe(
        '42501',
      );
      expect(await outcome(client, 'DELETE FROM app.tenant_theme')).toBe('42501');
    });
  });
});
