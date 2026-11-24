// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Duplicate dismissals (migration 0109): denied across tenants as every app
// role with a grant; a pair is two parties of one kind in the tenant, lower
// id first, dismissed once with a reason from the list by a member of the
// tenant; the database sets the times; and no app role changes or removes
// a dismissal.

import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { addOrganisation, addPerson } from '../party/fixtures.ts';
import {
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import { addCrmParts, insertOutcome, type CrmParts } from './fixtures.ts';

const TABLE = 'crm.duplicate_dismissal';

/** Two parties' ids, lower first. */
const ordered = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

const dismissalRow = (
  tenant: TestTenant,
  [party, other]: [string, string],
  member: string,
  change: Row = {},
): Row => ({
  tenant_id: tenant.id,
  kind: 'person',
  party_id: party,
  other_party_id: other,
  reason: 'different_person',
  created_by: member,
  updated_by: member,
  ...change,
});

let tenant: TestTenant;
let parts: CrmParts;
let pair: [string, string];
let other: { tenant: TestTenant; parts: CrmParts };
beforeAll(async () => {
  tenant = await createTestTenant();
  [parts, pair] = await asMigratorIn(tenant.id, async (client) => {
    const made = await addCrmParts(client, tenant);
    return [made, ordered(made.person, await addPerson(client, tenant))] as const;
  });
  const otherTenant = await createTestTenant();
  other = {
    tenant: otherTenant,
    parts: await asMigratorIn(otherTenant.id, (client) => addCrmParts(client, otherTenant)),
  };
}, 60_000);

const insert = (row: Row) => insertOutcome('app_api', tenant, TABLE, row);

describe(TABLE, { timeout: 60_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial(TABLE, async (client, rowTenant) => {
      const { member, person } = await addCrmParts(client, rowTenant);
      return dismissalRow(rowTenant, ordered(person, await addPerson(client, rowTenant)), member);
    }));

  it("refuses another tenant's party or member", async () => {
    const [low, high] = ordered(parts.person, other.parts.person);
    expect(await insert(dismissalRow(tenant, [low, high], parts.member))).toBe('23503');
    expect(await insert(dismissalRow(tenant, pair, other.parts.member))).toBe('23503');
  });

  it('takes a pair of one kind, lower id first, once, with a reason from the list', async () => {
    expect(await insert(dismissalRow(tenant, pair, parts.member))).toBe('ok');
    expect(await insert(dismissalRow(tenant, [pair[1], pair[0]], parts.member))).toBe('23514');
    expect(await insert(dismissalRow(tenant, [pair[0], pair[0]], parts.member))).toBe('23514');
    expect(await insert(dismissalRow(tenant, pair, parts.member, { reason: 'other' }))).toBe(
      '23514',
    );
    expect(await insert(dismissalRow(tenant, pair, parts.member, { kind: 'organisation' }))).toBe(
      '23503',
    );
    const mixed = ordered(parts.person, parts.organisation);
    expect(await insert(dismissalRow(tenant, mixed, parts.member))).toBe('23503');
    const author = await asMigratorIn(tenant.id, (client) => addCrmParts(client, tenant));
    expect(
      await insert(dismissalRow(tenant, pair, parts.member, { updated_by: author.member })),
    ).toBe('23514');

    await asMigratorIn(tenant.id, (client) =>
      insertRow(client, TABLE, dismissalRow(tenant, pair, parts.member)),
    );
    expect(await insert(dismissalRow(tenant, pair, parts.member))).toBe('23505');
  });

  it('dismisses organisations too', async () => {
    const organisations = await asMigratorIn(tenant.id, async (client) =>
      ordered(await addOrganisation(client, tenant), await addOrganisation(client, tenant)),
    );
    const row = dismissalRow(tenant, organisations, parts.member, {
      kind: 'organisation',
      reason: 'different_organisation',
    });
    expect(await insert(row)).toBe('ok');
  });

  it('takes its times from the database, and no app role sets them', async () => {
    const past = '2000-01-01T00:00:00Z';
    const fresh = await asMigratorIn(tenant.id, async (client) =>
      ordered(await addPerson(client, tenant), await addPerson(client, tenant)),
    );
    expect(await insert(dismissalRow(tenant, fresh, parts.member, { created_at: past }))).toBe(
      '42501',
    );
    const times = await asMigratorIn(tenant.id, async (client) => {
      const id = await insertRow(
        client,
        TABLE,
        dismissalRow(tenant, fresh, parts.member, { created_at: past, updated_at: past }),
      );
      const { rows } = await client.query<{ created_at: Date; updated_at: Date }>(
        `SELECT created_at, updated_at FROM ${TABLE} WHERE id = $1`,
        [id],
      );
      return rows[0];
    });
    expect(times?.created_at.getFullYear()).toBeGreaterThan(2000);
    expect(times?.updated_at.getFullYear()).toBeGreaterThan(2000);
  });

  it('is never changed or removed by an app role', async () => {
    const fresh = await asMigratorIn(tenant.id, async (client) =>
      ordered(await addPerson(client, tenant), await addPerson(client, tenant)),
    );
    const id = await asMigratorIn(tenant.id, (client) =>
      insertRow(client, TABLE, dismissalRow(tenant, fresh, parts.member)),
    );
    for (const role of ['app_api', 'app_worker'] as const) {
      await asRoleIn(role, tenant.id, async (client) => {
        const change = `UPDATE ${TABLE} SET reason = 'duplicate_allowed' WHERE id = $1`;
        expect(await outcome(client, change, [id]), role).toBe('42501');
        expect(await outcome(client, `DELETE FROM ${TABLE} WHERE id = $1`, [id]), role).toBe(
          '42501',
        );
      });
    }
  });
});
