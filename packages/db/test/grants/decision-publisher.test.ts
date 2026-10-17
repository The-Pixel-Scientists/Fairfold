// SPDX-License-Identifier: AGPL-3.0-or-later
//
// grants.publisher_setting (migration 0013): isolation, one row per
// tenant, and the checks on the funder's org-id identifier, its name and
// its 360Giving identifier prefix.

import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial } from '../cross-tenant.ts';
import {
  asRoleIn,
  createTestTenant,
  insertRow,
  insertStatement,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import { publisherRow } from './decision-fixtures.ts';

let tenant: TestTenant;
beforeAll(async () => {
  tenant = await createTestTenant();
});

describe('grants.publisher_setting', { timeout: 30_000 }, () => {
  it("keeps each tenant's publisher settings from every other tenant", async () => {
    await expectCrossTenantDenial('grants.publisher_setting', (_, owner) => publisherRow(owner));
  });

  it.each([
    ['saves the settings', {}, 'ok'],
    ['takes a company number', { funder_identifier: 'GB-COH-01234567' }, 'ok'],
    ['takes a society number', { funder_identifier: 'GB-MPR-2468R(S)' }, 'ok'],
    ['refuses an identifier without a scheme', { funder_identifier: '1234567' }, '23514'],
    ['refuses a scheme in lower case', { funder_identifier: 'gb-chc-1234567' }, '23514'],
    ['refuses a space in an identifier', { funder_identifier: 'GB-CHC-123 4567' }, '23514'],
    ['refuses a long identifier', { funder_identifier: `GB-CHC-${'1'.repeat(94)}` }, '23514'],
    ['refuses an empty name', { funder_name: '' }, '23514'],
    ['refuses a name with a space at its end', { funder_name: 'Northfield ' }, '23514'],
    ['refuses a name with a line break', { funder_name: 'Northfield\nTrust' }, '23514'],
    ['refuses a long name', { funder_name: 'N'.repeat(201) }, '23514'],
    ['refuses a prefix not from 360Giving', { identifier_prefix: 'GB-northfield' }, '23514'],
    ['refuses a prefix with nothing after 360G-', { identifier_prefix: '360G-' }, '23514'],
    ['refuses a prefix with a full stop', { identifier_prefix: '360G-north.field' }, '23514'],
    ['refuses a long prefix', { identifier_prefix: `360G-${'n'.repeat(46)}` }, '23514'],
    ['refuses a time from the caller', { created_at: '2000-01-01' }, '42501'],
  ])('%s', async (_, change: Row, expected) => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const statement = insertStatement(
        client,
        'grants.publisher_setting',
        publisherRow(tenant, change),
      );
      expect(await outcome(client, statement.text, statement.values)).toBe(expected);
    });
  });

  it('keeps one row per tenant, which app_api changes but never removes', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const id = await insertRow(client, 'grants.publisher_setting', publisherRow(tenant));
      const again = insertStatement(client, 'grants.publisher_setting', publisherRow(tenant));
      expect(await outcome(client, again.text, again.values)).toBe('23505');
      const rename = "UPDATE grants.publisher_setting SET funder_name = 'Northfield Trust'";
      expect(await outcome(client, rename)).toBe('ok');
      for (const set of ['tenant_id = tenant_id', 'created_at = created_at']) {
        const update = `UPDATE grants.publisher_setting SET ${set} WHERE id = $1`;
        expect(await outcome(client, update, [id]), set).toBe('42501');
      }
      const remove = 'DELETE FROM grants.publisher_setting WHERE id = $1';
      expect(await outcome(client, remove, [id])).toBe('42501');
    });
  });
});
