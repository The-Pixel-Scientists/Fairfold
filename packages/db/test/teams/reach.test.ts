// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Cross-team denial (ADR 0037, "Row-level security as a second line"). A
// scratch restrictable table, its access table and its reach function are
// built the way a module builds them, inside a transaction that is always
// rolled back, to prove what migration 0099 gives them: the member setting,
// teams that reach only while current, and break-glass grants that open
// exactly their record, for their member, until they expire.

import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { RIGHTS_ROLES, asMigratorRolledBack, withRoleClient } from '../connect.ts';
import { addMember, createTestTenant, insertRow, outcome, type TestTenant } from '../tenants.ts';
import { breakGlassRow, teamMemberRow, teamRow } from './fixtures.ts';

const SCRATCH = `
  CREATE TABLE app.reach_check (
    tenant_id uuid NOT NULL REFERENCES app.tenant (id),
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    label text NOT NULL,
    restricted boolean NOT NULL,
    UNIQUE (tenant_id, id));
  CREATE TABLE app.reach_check_access (
    tenant_id uuid NOT NULL,
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    record_id uuid NOT NULL,
    record_type text NOT NULL DEFAULT 'cases.case' CHECK (record_type = 'cases.case'),
    membership_id uuid,
    team_id uuid,
    break_glass_id uuid,
    CHECK ((membership_id IS NULL) <> (team_id IS NULL)),
    CHECK (break_glass_id IS NULL OR membership_id IS NOT NULL),
    FOREIGN KEY (tenant_id, record_id) REFERENCES app.reach_check (tenant_id, id),
    FOREIGN KEY (tenant_id, membership_id) REFERENCES app.membership (tenant_id, id),
    FOREIGN KEY (tenant_id, team_id) REFERENCES app.team (tenant_id, id),
    FOREIGN KEY (tenant_id, break_glass_id, membership_id, record_type, record_id)
      REFERENCES app.break_glass (tenant_id, id, membership_id, record_type, record_id));
  SELECT app.enable_tenant_rls('app.reach_check');
  SELECT app.enable_tenant_rls('app.reach_check_access');
  CREATE FUNCTION app.reach_check_named(target uuid, with_break_glass boolean)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
    RETURN EXISTS (
      SELECT 1 FROM app.reach_check_access a
       WHERE a.record_id = target
         AND (a.break_glass_id IS NULL OR (with_break_glass AND EXISTS (
               SELECT 1 FROM app.break_glass g
                WHERE g.tenant_id = a.tenant_id AND g.id = a.break_glass_id
                  AND g.expires_at > pg_catalog.now())))
         AND (a.membership_id = app.current_membership_id() OR EXISTS (
               SELECT 1 FROM app.team_member m
                 JOIN app.team t ON t.tenant_id = m.tenant_id AND t.id = m.team_id
                WHERE m.tenant_id = a.tenant_id AND m.team_id = a.team_id
                  AND m.membership_id = app.current_membership_id()
                  AND m.removed_at IS NULL AND t.archived_at IS NULL)));
  CREATE POLICY reach_select ON app.reach_check AS RESTRICTIVE FOR SELECT TO PUBLIC
    USING (NOT restricted OR app.reach_check_named(id, true));`;

let tenant: TestTenant;
let other: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant();
  other = await createTestTenant();
}, 60_000);

const setTenant = (client: pg.ClientBase, id: string) =>
  client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [id]);

const setMember = (client: pg.ClientBase, id: string) =>
  client.query("SELECT pg_catalog.set_config('app.membership_id', $1, true)", [id]);

async function visible(client: pg.ClientBase, member: string): Promise<string[]> {
  await setMember(client, member);
  const { rows } = await client.query<{ label: string }>(
    'SELECT label FROM app.reach_check ORDER BY label',
  );
  return rows.map((row) => row.label);
}

describe('restricted records and teams', { timeout: 60_000 }, () => {
  it('reach only the members a current team, a named row or a live grant names', async () => {
    await asMigratorRolledBack(async (client) => {
      await client.query(SCRATCH);
      await setTenant(client, other.id);
      const stranger = await addMember(client, other);
      await setTenant(client, tenant.id);

      const admin = await addMember(client, tenant);
      const members: string[] = [];
      for (let index = 0; index < 7; index += 1) members.push(await addMember(client, tenant));
      const [inX, inY, inNone, removed, inArchived, named, holder] = members as [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      const team = async (members: string[], change = {}) => {
        const id = await insertRow(client, 'app.team', teamRow(tenant, admin, change));
        for (const member of members) {
          await insertRow(client, 'app.team_member', teamMemberRow(tenant, id, member, admin));
        }
        return id;
      };
      const teamX = await team([inX, removed]);
      const teamY = await team([inY]);
      const teamZ = await team([inArchived]);
      await client.query('UPDATE app.team_member SET removed_by = $1 WHERE membership_id = $2', [
        admin,
        removed,
      ]);
      await client.query('UPDATE app.team SET archived_by = $1 WHERE id = $2', [admin, teamZ]);

      // No RETURNING: a restricted row is not one the inserter may read back.
      const record = async (label: string, restricted = true) => {
        const id = randomUUID();
        await client.query(
          'INSERT INTO app.reach_check (tenant_id, id, label, restricted) VALUES ($1, $2, $3, $4)',
          [tenant.id, id, label, restricted],
        );
        return id;
      };
      const access = (row: Record<string, unknown>) =>
        insertRow(client, 'app.reach_check_access', { tenant_id: tenant.id, ...row });
      await record('open', false);
      await access({ record_id: await record('x'), team_id: teamX });
      await access({ record_id: await record('y'), team_id: teamY });
      await access({ record_id: await record('z'), team_id: teamZ });
      await access({ record_id: await record('named'), membership_id: named });

      const live = await record('live grant');
      const grant = breakGlassRow(tenant, holder, { record_id: live });
      await insertRow(client, 'app.break_glass', grant);
      await access({ record_id: live, membership_id: holder, break_glass_id: grant.id });

      // An expired grant, which only the trigger being off can insert.
      const expired = await record('expired grant');
      const old = breakGlassRow(tenant, holder, {
        record_id: expired,
        granted_at: new Date(Date.now() - 2 * 3_600_000),
        expires_at: new Date(Date.now() - 3_600_000),
        retain_until: new Date(Date.now() + 400 * 86_400_000),
      });
      await client.query('ALTER TABLE app.break_glass DISABLE TRIGGER set_break_glass_times');
      await insertRow(client, 'app.break_glass', old);
      await client.query('ALTER TABLE app.break_glass ENABLE TRIGGER set_break_glass_times');
      await access({ record_id: expired, membership_id: holder, break_glass_id: old.id });

      // No member set yet on this connection: no restricted row, never all.
      expect((await client.query('SELECT label FROM app.reach_check')).rows).toEqual([
        { label: 'open' },
      ]);
      expect(await visible(client, inX)).toEqual(['open', 'x']);
      expect(await visible(client, inY)).toEqual(['open', 'y']);
      expect(await visible(client, named)).toEqual(['named', 'open']);
      expect(await visible(client, holder)).toEqual(['live grant', 'open']);
      for (const member of [inNone, removed, inArchived, admin, stranger, '']) {
        expect(await visible(client, member), member || 'empty').toEqual(['open']);
      }

      // A grant opens only its own record, for its own member.
      const elsewhere = await record('elsewhere');
      for (const row of [
        { record_id: elsewhere, membership_id: holder, break_glass_id: grant.id },
        { record_id: live, membership_id: inNone, break_glass_id: grant.id },
      ]) {
        const columns = Object.keys(row).join(', ');
        expect(
          await outcome(
            client,
            `INSERT INTO app.reach_check_access (tenant_id, ${columns}) VALUES ($1, $2, $3, $4)`,
            [tenant.id, ...Object.values(row)],
          ),
        ).toBe('23503');
      }

      // With a member set but no tenant there is no member, and no row.
      await setMember(client, inX);
      await setTenant(client, '');
      const { rows } = await client.query<{ member: string | null }>(
        'SELECT app.current_membership_id() AS member',
      );
      expect(rows).toEqual([{ member: null }]);
      expect((await client.query('SELECT 1 FROM app.reach_check')).rowCount).toBe(0);
    });
  });

  it('keeps app.current_membership_id() from every app role', async () => {
    for (const role of RIGHTS_ROLES) {
      await withRoleClient(role, async (client) => {
        await client.query('BEGIN');
        try {
          expect(await outcome(client, 'SELECT app.current_membership_id()'), role).toBe('42501');
        } finally {
          await client.query('ROLLBACK');
        }
      });
    }
  });
});
