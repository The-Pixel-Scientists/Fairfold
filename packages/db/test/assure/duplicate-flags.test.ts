// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Duplicate flags (migration 0110): denied across tenants as every app role
// with a grant; a flag is two different parties of the tenant and a signal
// from the list, raised once under its derived id; it keeps its parties,
// signal and author; it is dismissed once, with a reason from the list, by
// the member who last changed it, at the database's time; the worker reads
// it for subject access; and no app role removes one.

import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { addOrganisation, addPerson } from '../party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  insertStatement,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';

const TABLE = 'assure.duplicate_flag';

interface Parts {
  readonly member: string;
  readonly party: string;
  readonly other: string;
}

async function addParts(tenant: TestTenant): Promise<Parts> {
  return asMigratorIn(tenant.id, async (client) => ({
    member: await addMember(client, tenant, ['programme_manager']),
    party: await addOrganisation(client, tenant),
    other: await addOrganisation(client, tenant),
  }));
}

const flagRow = (tenant: TestTenant, parts: Parts, change: Row = {}): Row => ({
  tenant_id: tenant.id,
  id: randomUUID(),
  party_id: parts.party,
  other_party_id: parts.other,
  signal: 'shared_identifier',
  created_by: parts.member,
  updated_by: parts.member,
  ...change,
});

let tenant: TestTenant;
let parts: Parts;
let stranger: Parts;
beforeAll(async () => {
  tenant = await createTestTenant();
  parts = await addParts(tenant);
  stranger = await addParts(await createTestTenant());
}, 60_000);

const asApi = (text: string, values: readonly unknown[] = []) =>
  asRoleIn('app_api', tenant.id, (client) => outcome(client, text, values));
const insert = (row: Row) =>
  asRoleIn('app_api', tenant.id, (client) => {
    const { text, values } = insertStatement(client, TABLE, row);
    return outcome(client, text, values);
  });
const added = async (change: Row = {}) => {
  const fresh = { ...parts, other: await asMigratorIn(tenant.id, (c) => addPerson(c, tenant)) };
  return asMigratorIn(tenant.id, (client) =>
    insertRow(client, TABLE, flagRow(tenant, fresh, change)),
  );
};

describe(TABLE, { timeout: 60_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial(TABLE, async (client, rowTenant) =>
      flagRow(rowTenant, {
        member: await addMember(client, rowTenant, ['programme_manager']),
        party: await addOrganisation(client, rowTenant),
        other: await addPerson(client, rowTenant),
      }),
    ));

  it("refuses another tenant's party or member", async () => {
    expect(await insert(flagRow(tenant, { ...parts, other: stranger.party }))).toBe('23503');
    expect(await insert(flagRow(tenant, { ...parts, party: stranger.party }))).toBe('23503');
    expect(await insert(flagRow(tenant, { ...parts, member: stranger.member }))).toBe('23503');
  });

  it('is raised undismissed, for two parties and a signal from the list, once', async () => {
    expect(await insert(flagRow(tenant, parts))).toBe('ok');
    expect(await insert(flagRow(tenant, { ...parts, other: parts.party }))).toBe('23514');
    expect(await insert(flagRow(tenant, parts, { signal: 'shared_bank_details' }))).toBe('23514');
    expect(await insert(flagRow(tenant, parts, { dismiss_reason: 'duplicate_allowed' }))).toBe(
      '42501',
    );
    expect(await insert(flagRow(tenant, parts, { created_at: '2000-01-01T00:00:00Z' }))).toBe(
      '42501',
    );
    await asMigratorIn(tenant.id, (client) => insertRow(client, TABLE, flagRow(tenant, parts)));
    expect(await insert(flagRow(tenant, parts))).toBe('23505');
    expect(await insert(flagRow(tenant, parts, { signal: 'similar_name' }))).toBe('ok');
  });

  it('is dismissed once, by the member who changes it, at the database time', async () => {
    const id = await added();
    const dismiss = (reason: string, by: string, updatedBy = by) =>
      asApi(
        `UPDATE ${TABLE} SET dismiss_reason = $2, dismissed_by = $3, updated_by = $4 WHERE id = $1`,
        [id, reason, by, updatedBy],
      );
    const other = await asMigratorIn(tenant.id, (client) =>
      addMember(client, tenant, ['programme_manager']),
    );
    expect(await dismiss('not_a_reason', parts.member)).toBe('23514');
    expect(await dismiss('different_person', parts.member, other)).toBe('23514');
    expect(await dismiss('different_person', stranger.member)).toBe('23503');
    expect(
      await asApi(`UPDATE ${TABLE} SET dismiss_reason = 'different_person' WHERE id = $1`, [id]),
    ).toBe('23514');
    expect(await asApi(`UPDATE ${TABLE} SET dismissed_at = now() WHERE id = $1`, [id])).toBe(
      '42501',
    );

    const dismissed = await asMigratorIn(tenant.id, async (client) => {
      await client.query(
        `UPDATE ${TABLE} SET dismiss_reason = 'related_but_separate', dismissed_by = $2,
                updated_by = $2, dismissed_at = '2000-01-01' WHERE id = $1`,
        [id, other],
      );
      const { rows } = await client.query<{ dismissed_at: Date }>(
        `SELECT dismissed_at FROM ${TABLE} WHERE id = $1`,
        [id],
      );
      return rows[0]?.dismissed_at;
    });
    expect(dismissed?.getFullYear()).toBeGreaterThan(2000);
    expect(await dismiss('duplicate_allowed', other)).toBe('55000');
    expect(
      await asApi(`UPDATE ${TABLE} SET updated_by = $2 WHERE id = $1`, [id, parts.member]),
    ).toBe('55000');
    expect(await dismiss('related_but_separate', other)).toBe('ok');
  });

  it('keeps its parties, signal and author', async () => {
    const id = await added();
    const member = await asMigratorIn(tenant.id, (client) => addMember(client, tenant));
    await asMigratorIn(tenant.id, async (client) => {
      for (const [column, value] of [
        ['signal', 'similar_name'],
        ['party_id', parts.other],
        ['other_party_id', parts.other],
        ['created_by', member],
      ]) {
        const change = `UPDATE ${TABLE} SET ${String(column)} = $2 WHERE id = $1`;
        expect(await outcome(client, change, [id, value]), column).toBe('55000');
      }
    });
    expect(await asApi(`UPDATE ${TABLE} SET signal = 'similar_name' WHERE id = $1`, [id])).toBe(
      '42501',
    );
  });

  it('is read by the worker for subject access', async () => {
    const id = await added();
    const read = await asRoleIn('app_worker', tenant.id, async (client) => {
      const { rows } = await client.query<{ id: string }>(`SELECT id FROM ${TABLE} WHERE id = $1`, [
        id,
      ]);
      return rows;
    });
    expect(read).toEqual([{ id }]);
  });

  it('is never removed by an app role', async () => {
    const id = await added();
    for (const role of ['app_api', 'app_worker'] as const) {
      expect(
        await asRoleIn(role, tenant.id, (client) =>
          outcome(client, `DELETE FROM ${TABLE} WHERE id = $1`, [id]),
        ),
        role,
      ).toBe('42501');
    }
  });
});
