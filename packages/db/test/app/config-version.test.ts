// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.config_version (migration 0002): isolation, append-only for app_api,
// and the checks on each column.

import { randomUUID } from 'node:crypto';

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
  type TestTenant,
} from '../tenants.ts';

/** A tenant with an author, and an author in another tenant. */
let tenant: TestTenant;
let author: string;
let stranger: string;
beforeAll(async () => {
  tenant = await createTestTenant();
  const other = await createTestTenant();
  author = await asMigratorIn(tenant.id, (client) => addMember(client, tenant));
  stranger = await asMigratorIn(other.id, (client) => addMember(client, other));
}, 30_000);

function version(change: Row = {}): Row {
  return {
    tenant_id: tenant.id,
    entity_type: 'platform.theme',
    entity_id: randomUUID(),
    version: 1,
    author_id: author,
    diff: { brandColour: { from: '#1f4bb8', to: '#0b3d2e' } },
    ...change,
  };
}

describe('app.config_version', { timeout: 30_000 }, () => {
  it("keeps each tenant's configuration history from every other tenant", async () => {
    await expectCrossTenantDenial('app.config_version', async (client, owner) => ({
      tenant_id: owner.id,
      entity_type: 'grants.programme',
      entity_id: randomUUID(),
      version: 1,
      author_id: await addMember(client, owner),
      diff: {},
    }));
  });

  it('lets app_api add and read versions, but never change or remove one', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const { text, values } = insertStatement(client, 'app.config_version', version());
      await client.query(text, values);
      const { rows } = await client.query(
        'SELECT version, created_at = now() AS stamped FROM app.config_version',
      );
      expect(rows).toEqual([{ version: 1, stamped: true }]);

      for (const change of ['diff = diff', 'version = 2', 'created_at = now()']) {
        expect(await outcome(client, `UPDATE app.config_version SET ${change}`), change).toBe(
          '42501',
        );
      }
      expect(await outcome(client, 'DELETE FROM app.config_version')).toBe('42501');
      for (const column of ['id', 'created_at']) {
        const supplied = insertStatement(client, 'app.config_version', {
          ...version(),
          [column]: column === 'id' ? randomUUID() : new Date(0),
        });
        expect(await outcome(client, supplied.text, supplied.values), column).toBe('42501');
      }
    });
  });

  it.each([
    ['accepts a module, an entity and an underscore', { entity_type: 'grants.form_version' }, 'ok'],
    ['refuses an entity type without a module', { entity_type: 'theme' }, '23514'],
    ['refuses an entity type in capitals', { entity_type: 'Grants.Programme' }, '23514'],
    ['refuses version 0', { version: 0 }, '23514'],
    ['refuses a diff that is not an object', { diff: JSON.stringify(['brandColour']) }, '23514'],
    ['refuses an author from another tenant', { author_id: 'stranger' }, '23503'],
  ])('%s', async (_, change: Row, expected) => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const fixed = { ...change, ...(change.author_id ? { author_id: stranger } : {}) };
      const { text, values } = insertStatement(client, 'app.config_version', version(fixed));
      expect(await outcome(client, text, values)).toBe(expected);
    });
  });

  it('numbers the versions of each entity once', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const { text, values } = insertStatement(client, 'app.config_version', version());
      await client.query(text, values);
      expect(await outcome(client, text, values)).toBe('23505');
    });
  });
});
