// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.tenant (migration 0002): isolation, what app_api may change, and the
// checks on each column.

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { asRoleIn, createTestTenant, outcome, testSlug } from '../tenants.ts';

describe('app.tenant', { timeout: 30_000 }, () => {
  it("keeps each tenant's row from every other tenant", async () => {
    await expectCrossTenantDenial('app.tenant', (_, tenant) => ({
      id: tenant.id,
      slug: testSlug(),
      name: 'Another tenant',
    }));
  });

  it('starts active, in Europe/London, with an April financial year', async () => {
    const tenant = await createTestTenant();
    const { rows } = await asRoleIn('app_api', tenant.id, (client) =>
      client.query(
        `SELECT slug, status, timezone, fiscal_year_start_month, created_at = updated_at AS same
           FROM app.tenant`,
      ),
    );
    expect(rows).toEqual([
      {
        slug: tenant.slug,
        status: 'active',
        timezone: 'Europe/London',
        fiscal_year_start_month: 4,
        same: true,
      },
    ]);
  });

  it('lets app_api change only the name, time zone and financial year', async () => {
    const tenant = await createTestTenant();
    await asRoleIn('app_api', tenant.id, async (client) => {
      const changed = await client.query(
        `UPDATE app.tenant SET name = 'Northfield Trust', timezone = 'Europe/Dublin',
                fiscal_year_start_month = 1
          RETURNING name, updated_at > created_at AS touched`,
      );
      expect(changed.rows).toEqual([{ name: 'Northfield Trust', touched: true }]);

      for (const change of [
        `slug = 'northfield'`,
        `status = 'suspended'`,
        `id = gen_random_uuid()`,
        'created_at = now()',
        'updated_at = now()',
      ]) {
        expect(await outcome(client, `UPDATE app.tenant SET ${change}`), change).toBe('42501');
      }
      expect(await outcome(client, 'DELETE FROM app.tenant')).toBe('42501');
      expect(
        await outcome(client, `INSERT INTO app.tenant (id, slug, name) VALUES ($1, $2, 'New')`, [
          tenant.id,
          testSlug(),
        ]),
      ).toBe('42501');
    });
  });

  it.each([
    ['accepts a slug of 40 characters', { slug: `a${'b'.repeat(39)}` }, 'ok'],
    ['accepts a slug with single hyphens and digits', { slug: 'north-field-2' }, 'ok'],
    ['refuses a slug of two characters', { slug: 'ab' }, '23514'],
    ['refuses a slug of 41 characters', { slug: `a${'b'.repeat(40)}` }, '23514'],
    ['refuses a slug in capitals', { slug: 'Northfield' }, '23514'],
    ['refuses a slug starting with a digit', { slug: '1north' }, '23514'],
    ['refuses a slug with a double hyphen', { slug: 'north--field' }, '23514'],
    ['refuses a slug ending in a hyphen', { slug: 'northfield-' }, '23514'],
    ['refuses a slug with an accent', { slug: 'café' }, '23514'],
    ['refuses a reserved slug', { slug: 'portal' }, '23514'],
    ['refuses a reserved slug with hyphens', { slug: 'how-applying-works' }, '23514'],
    ['refuses a blank name', { name: '   ' }, '23514'],
    ['refuses a name of 201 characters', { name: 'n'.repeat(201) }, '23514'],
    ['refuses an unknown status', { status: 'closed' }, '23514'],
    ['refuses a time zone with a space', { timezone: 'Europe/London; x' }, '23514'],
    ['refuses month 0', { fiscal_year_start_month: 0 }, '23514'],
    ['refuses month 13', { fiscal_year_start_month: 13 }, '23514'],
  ])('%s', async (_, change, expected) => {
    const id = randomUUID();
    const values = { id, slug: testSlug(), name: 'Test tenant', ...change };
    const columns = Object.keys(values);
    await asRoleIn('migrator', id, async (client) => {
      const text = `INSERT INTO app.tenant (${columns.join(', ')})
                    VALUES (${columns.map((_, index) => `$${String(index + 1)}`).join(', ')})`;
      expect(await outcome(client, text, Object.values(values))).toBe(expected);
    });
  });

  it('gives each slug to one tenant', async () => {
    const tenant = await createTestTenant();
    const id = randomUUID();
    await asRoleIn('migrator', id, async (client) => {
      expect(
        await outcome(client, `INSERT INTO app.tenant (id, slug, name) VALUES ($1, $2, 'Copy')`, [
          id,
          tenant.slug,
        ]),
      ).toBe('23505');
    });
  });
});
