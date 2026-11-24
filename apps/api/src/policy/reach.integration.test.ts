// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The reach predicate against the test database (ADR 0037): the detail
// resolvers and the shared list filter, built from one predicate, answer the
// same for every member. A scratch restrictable table, its access table and
// the real team, member and grant tables are used inside a transaction that
// is always rolled back, with the tenant set so row-level security applies
// as it does to a request.

import { randomUUID } from 'node:crypto';

import type { Kysely } from '@pixel-scientists/db';
import { beforeAll, describe, expect, it } from 'vitest';

import { kyselyOn } from '../../../../packages/db/src/database.ts';
import { asMigratorRolledBack } from '../../../../packages/db/test/connect.ts';
import {
  breakGlassRow,
  teamMemberRow,
  teamRow,
} from '../../../../packages/db/test/teams/fixtures.ts';
import {
  addMember,
  createTestTenant,
  insertRow,
  setTestTenant,
  type TestTenant,
} from '../../../../packages/db/test/tenants.ts';
import type { TenantTransaction } from '../database.ts';
import { reachDescriptor, reachFilter, reachResolvers, type ReachRule } from './reach.ts';

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
    kind text NOT NULL CHECK (kind IN ('assigned', 'named', 'break_glass')),
    membership_id uuid,
    team_id uuid,
    break_glass_id uuid,
    CHECK ((membership_id IS NULL) <> (team_id IS NULL)),
    CHECK ((kind = 'break_glass') = (break_glass_id IS NOT NULL)),
    FOREIGN KEY (tenant_id, record_id) REFERENCES app.reach_check (tenant_id, id),
    FOREIGN KEY (tenant_id, membership_id) REFERENCES app.membership (tenant_id, id),
    FOREIGN KEY (tenant_id, team_id) REFERENCES app.team (tenant_id, id),
    FOREIGN KEY (tenant_id, break_glass_id, membership_id, record_type, record_id)
      REFERENCES app.break_glass (tenant_id, id, membership_id, record_type, record_id));
  SELECT app.enable_tenant_rls('app.reach_check');
  SELECT app.enable_tenant_rls('app.reach_check_access');`;

const descriptor = reachDescriptor({
  record: 'cases.case',
  table: 'app.reach_check',
  access: { table: 'app.reach_check_access', recordColumn: 'record_id' },
  param: 'caseId',
});

type Scratch = Record<string, Record<string, unknown>>;

let tenant: TestTenant;
let other: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant();
  other = await createTestTenant();
}, 60_000);

const caller = (member: string) => ({ membership: { id: member, permissions: new Set<never>() } });

/** The labels a list returns for `member`, through the shared filter. */
async function listed(db: Kysely<Scratch>, member: string, rule: ReachRule): Promise<string[]> {
  const rows = await db
    .selectFrom('app.reach_check')
    .select('label')
    .where((eb) => reachFilter(eb, caller(member), descriptor, rule))
    .orderBy('label')
    .execute();
  return rows.map((row) => String(row.label));
}

/** The labels whose detail route answers `member`, by the resolver for `method`. */
async function answered(
  db: Kysely<Scratch>,
  records: Record<string, string>,
  member: string,
  rule: ReachRule,
  method: string,
): Promise<string[]> {
  const resolver = reachResolvers([descriptor])[rule];
  const out: string[] = [];
  for (const [label, id] of Object.entries(records)) {
    const ok = await resolver?.({
      tx: db as unknown as TenantTransaction,
      userId: randomUUID(),
      membershipId: member,
      input: { params: { caseId: id }, query: undefined, body: undefined },
      method,
      record: 'cases.case',
    });
    if (ok === true) out.push(label);
  }
  return out.sort();
}

describe('the reach predicate', { timeout: 60_000 }, () => {
  it('gives lists and detail routes the same answer for every member', async () => {
    await asMigratorRolledBack(async (client) => {
      await client.query(SCRATCH);
      const db = kyselyOn<Scratch>(client);

      await setTestTenant(client, other.id);
      const stranger = await addMember(client, other);
      const otherRecord = randomUUID();
      await client.query(
        'INSERT INTO app.reach_check (tenant_id, id, label, restricted) VALUES ($1, $2, $3, false)',
        [other.id, otherRecord, 'other tenant'],
      );

      await setTestTenant(client, tenant.id);
      const admin = await addMember(client, tenant);
      const [inX, inY, nobody, removed, inArchived, named, direct, holder, expiredHolder] =
        (await Promise.all(Array.from({ length: 9 }, () => addMember(client, tenant)))) as [
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
        ];
      const team = async (members: string[]) => {
        const id = await insertRow(client, 'app.team', teamRow(tenant, admin));
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

      const records: Record<string, string> = {};
      const record = async (label: string, restricted = true) => {
        records[label] = randomUUID();
        await client.query(
          'INSERT INTO app.reach_check (tenant_id, id, label, restricted) VALUES ($1, $2, $3, $4)',
          [tenant.id, records[label], label, restricted],
        );
        return records[label];
      };
      const access = (row: Record<string, unknown>) =>
        insertRow(client, 'app.reach_check_access', { tenant_id: tenant.id, ...row });
      await record('open', false);
      await access({ record_id: await record('x'), team_id: teamX, kind: 'assigned' });
      await access({ record_id: await record('y'), team_id: teamY, kind: 'assigned' });
      await access({ record_id: await record('z'), team_id: teamZ, kind: 'assigned' });
      await access({ record_id: await record('named'), membership_id: named, kind: 'named' });
      await access({ record_id: await record('direct'), membership_id: direct, kind: 'assigned' });
      await record('hidden');

      const live = await record('live grant');
      const grant = breakGlassRow(tenant, holder, { record_id: live });
      await insertRow(client, 'app.break_glass', grant);
      await access({
        record_id: live,
        membership_id: holder,
        break_glass_id: grant.id,
        kind: 'break_glass',
      });

      // An expired grant: only the trigger being off can insert one. The database's clock decides.
      const expired = await record('expired grant');
      // One reading of the clock: the table checks the grant lasts exactly an hour.
      const now = Date.now();
      const old = breakGlassRow(tenant, expiredHolder, {
        record_id: expired,
        granted_at: new Date(now - 2 * 3_600_000),
        expires_at: new Date(now - 3_600_000),
        retain_until: new Date(now + 400 * 86_400_000),
      });
      await client.query('ALTER TABLE app.break_glass DISABLE TRIGGER set_break_glass_times');
      await insertRow(client, 'app.break_glass', old);
      await client.query('ALTER TABLE app.break_glass ENABLE TRIGGER set_break_glass_times');
      await access({
        record_id: expired,
        membership_id: expiredHolder,
        break_glass_id: old.id,
        kind: 'break_glass',
      });

      const everyone = [admin, inX, inY, nobody, removed, inArchived, named, direct, holder];
      const expectedReachable: [string, string[]][] = [
        [inX, ['open', 'x']],
        [inY, ['open', 'y']],
        [named, ['named', 'open']],
        [direct, ['direct', 'open']],
        // A grant opens the record's own page, never a list.
        [holder, ['open']],
        [expiredHolder, ['open']],
        ...[admin, nobody, removed, inArchived].map((m): [string, string[]] => [m, ['open']]),
      ];
      for (const [member, labels] of expectedReachable) {
        expect(await listed(db, member, 'reachable')).toEqual(labels);
        // The list is exactly what the detail route answers on a request that is not a read.
        expect(await answered(db, records, member, 'reachable', 'PUT')).toEqual(labels);
      }

      // Break-glass counts on a read of the record's own page, for its member only, while live.
      expect(await answered(db, records, holder, 'reachable', 'GET')).toEqual([
        'live grant',
        'open',
      ]);
      expect(await answered(db, records, expiredHolder, 'reachable', 'GET')).toEqual(['open']);
      for (const member of everyone.filter((m) => m !== holder)) {
        expect(await answered(db, records, member, 'reachable', 'GET')).not.toContain('live grant');
      }
      // Caseload never counts a grant, a named row or an unrestricted record.
      for (const [member, labels] of [
        [inX, ['x']],
        [inY, ['y']],
        [direct, ['direct']],
        [named, []],
        [holder, []],
        [nobody, []],
        [removed, []],
        [inArchived, []],
      ] as [string, string[]][]) {
        expect(await listed(db, member, 'caseload')).toEqual(labels);
        expect(await answered(db, records, member, 'caseload', 'GET')).toEqual(labels);
      }

      // Another tenant: its member sees its own open record, and nothing here, by list or by id.
      await setTestTenant(client, other.id);
      expect(await listed(db, stranger, 'reachable')).toEqual(['other tenant']);
      expect(await listed(db, inX, 'reachable')).toEqual(['other tenant']);
      expect(await listed(db, inX, 'caseload')).toEqual([]);
      expect(
        await answered(db, { ...records, other: otherRecord }, inX, 'reachable', 'GET'),
      ).toEqual(['other']);
      expect(await answered(db, records, holder, 'reachable', 'GET')).toEqual([]);

      // With no tenant set nothing is read at all.
      await setTestTenant(client, '');
      expect(await listed(db, inX, 'reachable')).toEqual([]);
    });
  });

  it('refuses what a route cannot name', async () => {
    await asMigratorRolledBack(async (client) => {
      await client.query(SCRATCH);
      await setTestTenant(client, tenant.id);
      const db = kyselyOn<Scratch>(client);
      const resolver = reachResolvers([descriptor]).reachable;
      const check = (params: unknown, record: string | undefined = 'cases.case') =>
        resolver?.({
          tx: db as unknown as TenantTransaction,
          userId: randomUUID(),
          membershipId: randomUUID(),
          input: { params, query: undefined, body: undefined },
          method: 'GET',
          record,
        });
      expect(await check({ caseId: 'not-an-id' })).toBe(false);
      expect(await check({ caseId: randomUUID() })).toBe(false);
      expect(await check({ caseId: randomUUID() }, 'cases.other')).toBe(false);
      expect(await check({ caseId: randomUUID() }, undefined)).toBe(false);
      // A route with no id parameter lists, or creates, and filters in its handler.
      expect(await check(undefined)).toBe(true);
    });
  });
});
