// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.team and app.team_member (migration 0099): denied across tenants, the
// name checks, a member of one tenant never in another's team, archiving and
// removal final with database-set times, and no row ever deleted.

import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { expectEveryRoleRefused, insertOutcome } from '../notes/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  outcome,
  type TestTenant,
} from '../tenants.ts';
import { addTeam, teamMemberRow, teamRow } from './fixtures.ts';

let tenant: TestTenant;
let other: TestTenant;
let member: string;
let otherMember: string;

beforeAll(async () => {
  tenant = await createTestTenant();
  other = await createTestTenant();
  member = await asMigratorIn(tenant.id, (client) => addMember(client, tenant));
  otherMember = await asMigratorIn(other.id, (client) => addMember(client, other));
}, 60_000);

const addTeamIn = (inTenant: TestTenant, by: string, name?: string) =>
  asMigratorIn(inTenant.id, (client) =>
    insertRow(client, 'app.team', teamRow(inTenant, by, name === undefined ? {} : { name })),
  );

describe('app.team', { timeout: 30_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial('app.team', async (client, row) =>
      teamRow(row, await addMember(client, row)),
    ));

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['untrimmed', ' Safeguarding'],
    ['over the limit', 'x'.repeat(101)],
    ['holding a control character', 'Safe\u0007guarding'],
    ['holding a hidden character', 'Safe\u200bguarding'],
  ])('refuses a name that is %s', async (_name, name) => {
    expect(
      await insertOutcome('app_api', tenant, 'app.team', teamRow(tenant, member, { name })),
    ).toBe('23514');
  });

  it('is unique per tenant among teams not archived, in any case', async () => {
    const id = await addTeamIn(tenant, member, 'Case team');
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'app.team',
        teamRow(tenant, member, { name: 'CASE TEAM' }),
      ),
    ).toBe('23505');
    expect(
      await insertOutcome(
        'app_api',
        other,
        'app.team',
        teamRow(other, otherMember, { name: 'Case team' }),
      ),
    ).toBe('ok');
    await asMigratorIn(tenant.id, (client) =>
      client.query('UPDATE app.team SET archived_by = $1 WHERE id = $2', [member, id]),
    );
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'app.team',
        teamRow(tenant, member, { name: 'Case team' }),
      ),
    ).toBe('ok');
  });

  it("refuses another tenant's member as creator, updater or archiver", async () => {
    for (const change of [{ created_by: otherMember }, { updated_by: otherMember }]) {
      expect(
        await insertOutcome('app_api', tenant, 'app.team', teamRow(tenant, member, change)),
      ).toBe('23503');
    }
    const id = await addTeamIn(tenant, member);
    await asRoleIn('app_api', tenant.id, async (client) => {
      expect(
        await outcome(client, 'UPDATE app.team SET archived_by = $1 WHERE id = $2', [
          otherMember,
          id,
        ]),
      ).toBe('23503');
    });
  });

  it('lets app_api rename and archive a team, with the time set by the database, and nothing else', async () => {
    const id = await addTeamIn(tenant, member);
    await asRoleIn('app_api', tenant.id, async (client) => {
      for (const statement of [
        'UPDATE app.team SET archived_at = now() WHERE id = $1',
        'UPDATE app.team SET created_by = created_by WHERE id = $1',
        'UPDATE app.team SET tenant_id = tenant_id WHERE id = $1',
        'UPDATE app.team SET id = id WHERE id = $1',
      ]) {
        expect(await outcome(client, statement, [id]), statement).toBe('42501');
      }
      expect(
        await outcome(client, "UPDATE app.team SET name = 'Renamed team' WHERE id = $1", [id]),
      ).toBe('ok');
      const { rows } = await client.query<{ archived: boolean }>(
        `UPDATE app.team SET archived_by = $1, updated_by = $1 WHERE id = $2
         RETURNING archived_at = now() AS archived`,
        [member, id],
      );
      expect(rows).toEqual([{ archived: true }]);
      expect(await outcome(client, "UPDATE app.team SET name = 'Again' WHERE id = $1", [id])).toBe(
        '55000',
      );
      expect(
        await outcome(client, 'UPDATE app.team SET archived_by = NULL WHERE id = $1', [id]),
      ).toBe('55000');
    });
  });

  it('refuses an insert that is archived already', async () => {
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'app.team',
        teamRow(tenant, member, { archived_by: member }),
      ),
    ).toBe('42501');
    expect(
      await asMigratorIn(tenant.id, (client) =>
        outcome(
          client,
          'INSERT INTO app.team (tenant_id, name, created_by, updated_by, archived_by) VALUES ($1, $2, $3, $3, $3)',
          [tenant.id, 'Archived on arrival', member],
        ),
      ),
    ).toBe('23514');
  });

  it('is never deleted by an app role', async () => {
    const id = await addTeamIn(tenant, member);
    await expectEveryRoleRefused(tenant, 'DELETE FROM app.team WHERE id = $1', [id]);
  });
});

describe('app.team_member', { timeout: 30_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial('app.team_member', async (client, row) => {
      const { member: by, team } = await addTeam(client, row);
      return teamMemberRow(row, team, await addMember(client, row), by);
    }));

  it("never puts a member of one tenant in another tenant's team", async () => {
    const team = await addTeamIn(tenant, member);
    const otherTeam = await addTeamIn(other, otherMember);
    // The other tenant's member in this tenant's team, and the reverse.
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'app.team_member',
        teamMemberRow(tenant, team, otherMember, member),
      ),
    ).toBe('23503');
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'app.team_member',
        teamMemberRow(tenant, otherTeam, member, member),
      ),
    ).toBe('23503');
    // Named as this tenant, the row is refused by the tenant policy instead.
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'app.team_member',
        teamMemberRow(other, otherTeam, otherMember, otherMember),
      ),
    ).toBe('42501');
  });

  it('holds one current row per team and member, and keeps each removed one', async () => {
    const team = await addTeamIn(tenant, member);
    const joining = await asMigratorIn(tenant.id, (client) => addMember(client, tenant));
    const row = teamMemberRow(tenant, team, joining, member);
    const first = await asMigratorIn(tenant.id, (client) =>
      insertRow(client, 'app.team_member', row),
    );
    expect(await insertOutcome('app_api', tenant, 'app.team_member', row)).toBe('23505');

    await asRoleIn('app_api', tenant.id, async (client) => {
      expect(
        await outcome(client, 'UPDATE app.team_member SET removed_at = now() WHERE id = $1', [
          first,
        ]),
      ).toBe('42501');
      expect(
        await outcome(
          client,
          'UPDATE app.team_member SET membership_id = membership_id WHERE id = $1',
          [first],
        ),
      ).toBe('42501');
      const { rows } = await client.query<{ removed: boolean }>(
        `UPDATE app.team_member SET removed_by = $1, updated_by = $1 WHERE id = $2
         RETURNING removed_at = now() AS removed`,
        [member, first],
      );
      expect(rows).toEqual([{ removed: true }]);
      expect(
        await outcome(client, 'UPDATE app.team_member SET removed_by = NULL WHERE id = $1', [
          first,
        ]),
      ).toBe('55000');
      expect(
        await outcome(
          client,
          'INSERT INTO app.team_member (tenant_id, team_id, membership_id, created_by, updated_by) VALUES ($1, $2, $3, $4, $4)',
          [tenant.id, team, joining, member],
        ),
      ).toBe('ok');
    });
  });

  it('is never deleted by an app role', async () => {
    const team = await addTeamIn(tenant, member);
    const id = await asMigratorIn(tenant.id, (client) =>
      insertRow(client, 'app.team_member', teamMemberRow(tenant, team, member, member)),
    );
    await expectEveryRoleRefused(tenant, 'DELETE FROM app.team_member WHERE id = $1', [id]);
  });
});
