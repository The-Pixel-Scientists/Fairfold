// SPDX-License-Identifier: AGPL-3.0-or-later
//
// party.value_history (migration 0020, ADR 0025): isolation, append-only
// for every app role, the time from the database, and the checks on field
// ids, kinds, values and actors. Only app_api may add a row; app_worker may
// only read, for the subject access export (migration 0044).

import { beforeAll, describe, expect, it } from 'vitest';

import { APP_ROLES, withClient } from '../connect.ts';
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

let tenant: TestTenant;
let staff: string;
let stranger: string;
let organisation: string;
let person: string;
let row: string;
beforeAll(async () => {
  tenant = await createTestTenant();
  const other = await createTestTenant();
  [staff, organisation, person] = await asMigratorIn(tenant.id, async (client) => [
    await addMember(client, tenant),
    await addOrganisation(client, tenant),
    await addPerson(client, tenant),
  ]);
  row = await asMigratorIn(tenant.id, (client) =>
    insertRow(client, 'party.value_history', change()),
  );
  stranger = await asMigratorIn(other.id, (client) => addMember(client, other));
}, 30_000);

/** A change to the person's family name by the member of staff. */
function change(values: Row = {}): Row {
  return {
    tenant_id: tenant.id,
    party_id: person,
    party_kind: 'person',
    field_id: 'person.family_name',
    old_value: 'Jones',
    new_value: 'Evans',
    changed_by: staff,
    ...values,
  };
}

describe('party.value_history', { timeout: 30_000 }, () => {
  it("keeps each tenant's history from every other tenant", async () => {
    await expectCrossTenantDenial('party.value_history', async (client, owner) => ({
      tenant_id: owner.id,
      party_id: await addOrganisation(client, owner),
      party_kind: 'organisation',
      field_id: 'organisation.name',
      old_value: 'Northfield Allotment Society',
      new_value: 'Northfield Allotments',
    }));
  });

  it('lets app_api alone add, app_worker only read, and no app role change or remove a row', async () => {
    const holders = (privilege: string) =>
      withClient('app_api', async (client) =>
        (
          await client.query<{ role: string }>(
            `SELECT r.role FROM pg_catalog.unnest($1::text[]) AS r(role)
              WHERE CASE WHEN $2 = 'DELETE'
                    THEN pg_catalog.has_table_privilege(r.role, 'party.value_history', $2)
                    ELSE pg_catalog.has_any_column_privilege(r.role, 'party.value_history', $2)
                    END
              ORDER BY 1`,
            [APP_ROLES, privilege],
          )
        ).rows.map(({ role }) => role),
      );
    expect(await holders('SELECT')).toEqual(['app_api', 'app_worker']);
    expect(await holders('INSERT')).toEqual(['app_api']);
    expect(await holders('UPDATE')).toEqual([]);
    expect(await holders('DELETE')).toEqual([]);
    for (const role of APP_ROLES) {
      await asRoleIn(role, tenant.id, async (client) => {
        for (const statement of [
          "UPDATE party.value_history SET new_value = 'Price'",
          'DELETE FROM party.value_history',
        ]) {
          expect(await outcome(client, statement), `${role}: ${statement}`).toBe('42501');
        }
      });
    }
  });

  it('lets app_api add a change, with the time and id from the database', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const { text, values } = insertStatement(client, 'party.value_history', change());
      const added = await client.query(`${text} RETURNING changed_at > now() AS clock`, values);
      expect(added.rows).toEqual([{ clock: true }]);
      for (const supplied of [{ changed_at: '2020-01-01T00:00:00Z' }, { id: row }]) {
        const forged = insertStatement(client, 'party.value_history', change(supplied));
        expect(await outcome(client, forged.text, forged.values)).toBe('42501');
      }
    });
    await asRoleIn('migrator', tenant.id, async (client) => {
      const { text, values } = insertStatement(
        client,
        'party.value_history',
        change({ changed_at: '2020-01-01T00:00:00Z' }),
      );
      const added = await client.query(`${text} RETURNING changed_at > now() AS clock`, values);
      expect(added.rows).toEqual([{ clock: true }]);
    });
  });

  it.each([
    ['accepts a change the system made', { changed_by: null }, 'ok'],
    ['accepts a value set for the first time', { old_value: null }, 'ok'],
    ['refuses an unknown field', { field_id: 'person.user_id' }, '23514'],
    ["refuses another kind's field", { field_id: 'organisation.name' }, '23514'],
    ['refuses a value that did not change', { new_value: 'Jones' }, '23514'],
    ['refuses a value over 64 KiB', { new_value: 'x'.repeat(65_537) }, '23514'],
    ["refuses another tenant's member", { changed_by: '<stranger>' }, '23503'],
    ['refuses a party of another kind', { party_id: '<organisation>' }, '23503'],
  ])('%s', async (_, values: Row, expected) => {
    const ids: Readonly<Record<string, string>> = {
      '<stranger>': stranger,
      '<organisation>': organisation,
    };
    const resolved = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        typeof value === 'string' ? (ids[value] ?? value) : value,
      ]),
    );
    await asRoleIn('app_api', tenant.id, async (client) => {
      const { text, values: parameters } = insertStatement(
        client,
        'party.value_history',
        change(resolved),
      );
      expect(await outcome(client, text, parameters)).toBe(expected);
    });
  });
});
