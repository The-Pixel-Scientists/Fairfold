// SPDX-License-Identifier: AGPL-3.0-or-later
//
// grants.adjustment (migration 0051): denied across tenants, every check
// and key refused with a bad value, an extension closing after its round,
// the database's times, and revocation as the one change, once.

import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial } from '../cross-tenant.ts';
import {
  addApplication,
  addParts,
  applicationRow,
  type Parts,
} from '../grants/application-fixtures.ts';
import { addOrganisation } from '../party/fixtures.ts';
import {
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  insertStatement,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import { addAdjustment, adjustmentRow, EARLIER, EXTENSION, LATER } from './fixtures.ts';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

let tenant: TestTenant;
let parts: Parts;
let own: string;
let otherOrganisations: string;
let strangers: { round: string; organisation: string; member: string; application: string };
beforeAll(async () => {
  tenant = await createTestTenant();
  const stranger = await createTestTenant();
  ({ parts, own, otherOrganisations } = await asMigratorIn(tenant.id, async (client) => {
    const added = await addParts(client, tenant);
    return {
      parts: added,
      own: await insertRow(client, 'grants.application', applicationRow(tenant, added)),
      otherOrganisations: await insertRow(
        client,
        'grants.application',
        applicationRow(tenant, added, { organisation_id: await addOrganisation(client, tenant) }),
      ),
    };
  }));
  strangers = await asMigratorIn(stranger.id, async (client) => {
    const { id, parts: theirs } = await addApplication(client, stranger);
    return { ...theirs, application: id };
  });
}, 60_000);

function added(change: Row): Promise<string> {
  return asRoleIn('app_api', tenant.id, (client) => {
    const { text, values } = insertStatement(
      client,
      'grants.adjustment',
      adjustmentRow(tenant, parts, change),
    );
    return outcome(client, text, values);
  });
}

describe('grants.adjustment', { timeout: 30_000 }, () => {
  it('is denied across tenants, for every role with a grant', async () => {
    await expectCrossTenantDenial('grants.adjustment', async (client, row) =>
      adjustmentRow(row, await addParts(client, row)),
    );
  });

  it('accepts both kinds, and an extension naming its own application', async () => {
    expect(await added({})).toBe('ok');
    expect(await added(EXTENSION)).toBe('ok');
    expect(await added({ ...EXTENSION, application_id: own })).toBe('ok');
  });

  it.each([
    ['an unknown kind', { kind: 'more_time' }],
    ['an unknown reason code', { reason_code: 'illness' }],
    ['a route with a closing time', { closes_at: LATER }],
    ['an extension with no closing time', { ...EXTENSION, closes_at: null }],
    ['a route naming an application', { application_id: UNKNOWN_ID }],
    ['an extension no later than its round', { ...EXTENSION, closes_at: EARLIER }],
  ])('refuses %s', async (_name, change) => {
    expect(await added(change)).toBe('23514');
  });

  it.each([
    ["another tenant's round", () => ({ round_id: strangers.round })],
    ["another tenant's organisation", () => ({ organisation_id: strangers.organisation })],
    ["another tenant's member", () => ({ granted_by: strangers.member })],
    [
      "another tenant's application",
      () => ({ ...EXTENSION, application_id: strangers.application }),
    ],
    [
      "another organisation's application",
      () => ({ ...EXTENSION, application_id: otherOrganisations }),
    ],
  ])('refuses %s', async (_name, change) => {
    expect(await added(change())).toBe('23503');
  });

  it('leaves the grant and revocation times to the database', async () => {
    const supplied: Row = {
      granted_at: EARLIER,
      revoked_at: EARLIER,
      revoked_by: parts.member,
      id: UNKNOWN_ID,
    };
    for (const [column, value] of Object.entries(supplied)) {
      expect(await added({ [column]: value }), column).toBe('42501');
    }
  });

  it('sets the grant time itself, whatever a privileged caller sends', async () => {
    const granted = await asMigratorIn(tenant.id, async (client) => {
      const id = await addAdjustment(client, tenant, parts, { granted_at: EARLIER });
      const { rows } = await client.query<{ granted_at: Date }>(
        'SELECT granted_at FROM grants.adjustment WHERE id = $1',
        [id],
      );
      return rows[0]?.granted_at;
    });
    expect(granted?.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('is revoked once, all or nothing, with the time set by the database', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const id = await insertRow(client, 'grants.adjustment', adjustmentRow(tenant, parts));
      const revoke = (member: string | null, reason: string | null) =>
        outcome(
          client,
          'UPDATE grants.adjustment SET revoked_by = $2, revoke_reason_code = $3 WHERE id = $1',
          [id, member, reason],
        );
      expect(await revoke(parts.member, null), 'no reason').toBe('23514');
      expect(await revoke(null, 'other'), 'no member').toBe('23514');
      expect(await revoke(parts.member, 'unknown'), 'an unknown reason').toBe('23514');
      expect(await revoke(strangers.member, 'other'), "another tenant's member").toBe('23503');

      await client.query(
        "UPDATE grants.adjustment SET revoked_by = $2, revoke_reason_code = 'other' WHERE id = $1",
        [id, parts.member],
      );
      const { rows } = await client.query<{ revoked_at: Date | null }>(
        'SELECT revoked_at FROM grants.adjustment WHERE id = $1',
        [id],
      );
      expect(rows[0]?.revoked_at).toBeInstanceOf(Date);
      expect(await revoke(parts.member, 'other'), 'revoked twice').toBe('55000');
    });
  });

  it('refuses every other change and every delete', async () => {
    const id = await asMigratorIn(tenant.id, (client) => addAdjustment(client, tenant, parts));
    await asRoleIn('app_api', tenant.id, async (client) => {
      const set = 'UPDATE grants.adjustment SET reason_code = $2 WHERE id = $1';
      expect(await outcome(client, set, [id, 'other'])).toBe('42501');
      const remove = 'DELETE FROM grants.adjustment WHERE id = $1';
      expect(await outcome(client, remove, [id])).toBe('42501');
    });
    await expect(
      asMigratorIn(tenant.id, (client) =>
        client.query("UPDATE grants.adjustment SET reason_code = 'other' WHERE id = $1", [id]),
      ),
      'the trigger behind the grants',
    ).rejects.toMatchObject({ code: '55000' });
  });
});
