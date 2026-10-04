// SPDX-License-Identifier: AGPL-3.0-or-later
//
// party.relationship (migration 0005): isolation, what app_api may write,
// the kinds each type joins, and at most one current link of a type
// between the same two parties.

import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial } from '../cross-tenant.ts';
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
import { addOrganisation, addPerson } from './fixtures.ts';

/** A tenant with a member, two people and two organisations. */
let tenant: TestTenant;
let member: string;
let person: string;
let organisation: string;
let otherOrganisation: string;
let otherPerson: string;
beforeAll(async () => {
  tenant = await createTestTenant();
  [member, person, organisation, otherOrganisation, otherPerson] = await asMigratorIn(
    tenant.id,
    async (client) => [
      await addMember(client, tenant),
      await addPerson(client, tenant),
      await addOrganisation(client, tenant),
      await addOrganisation(client, tenant),
      await addPerson(client, tenant),
    ],
  );
}, 30_000);

/** `person` as a contact for `organisation`, with any change. */
function contactFor(change: Row = {}): Row {
  return {
    tenant_id: tenant.id,
    type: 'contact_for',
    subject_id: person,
    subject_kind: 'person',
    object_id: organisation,
    object_kind: 'organisation',
    ...change,
  };
}

describe('party.relationship', { timeout: 30_000 }, () => {
  it("keeps each tenant's relationships from every other tenant", async () => {
    await expectCrossTenantDenial('party.relationship', async (client, owner) => ({
      tenant_id: owner.id,
      type: 'contact_for',
      subject_id: await addPerson(client, owner),
      subject_kind: 'person',
      object_id: await addOrganisation(client, owner),
      object_kind: 'organisation',
    }));
  });

  it('lets app_api add links and end them, but not change who they join', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const { text, values } = insertStatement(
        client,
        'party.relationship',
        contactFor({ starts_on: '2026-10-01', created_by: member }),
      );
      expect((await client.query(text, values)).rowCount).toBe(1);
      const ended = await client.query(
        `UPDATE party.relationship SET ends_on = '2026-10-31', updated_by = $1
          RETURNING updated_by`,
        [member],
      );
      expect(ended.rows).toEqual([{ updated_by: member }]);

      for (const change of [
        'subject_id = subject_id',
        "object_kind = 'organisation'",
        "type = 'contact_for'",
      ]) {
        expect(await outcome(client, `UPDATE party.relationship SET ${change}`), change).toBe(
          '42501',
        );
      }
    });
  });

  it.each([
    ['refuses an unknown type', { type: 'trustee_of' }, '23514'],
    [
      'refuses an organisation as a contact',
      { subject_id: '<otherOrganisation>', subject_kind: 'organisation' },
      '23514',
    ],
    [
      'refuses a person as the organisation',
      { object_id: '<person>', object_kind: 'person' },
      '23514',
    ],
    [
      'refuses a subject whose kind is not the one given',
      { subject_id: '<otherOrganisation>' },
      '23503',
    ],
    ['refuses an object whose kind is not the one given', { object_id: '<otherPerson>' }, '23503'],
    [
      'refuses an end before the start',
      { starts_on: '2026-10-02', ends_on: '2026-10-01' },
      '23514',
    ],
    ['accepts an end on the start day', { starts_on: '2026-10-01', ends_on: '2026-10-01' }, 'ok'],
  ])('%s', async (_, change: Row, expected) => {
    await asRoleIn('migrator', tenant.id, async (client) => {
      // Party ids are known only once beforeAll has run, so cases name them.
      const ids: Readonly<Record<string, string>> = {
        '<person>': person,
        '<otherOrganisation>': otherOrganisation,
        '<otherPerson>': otherPerson,
      };
      const resolved = Object.fromEntries(
        Object.entries(change).map(([column, value]) => [
          column,
          typeof value === 'string' ? (ids[value] ?? value) : value,
        ]),
      );
      const { text, values } = insertStatement(client, 'party.relationship', contactFor(resolved));
      expect(await outcome(client, text, values)).toBe(expected);
    });
  });

  it('keeps one current link of a type between the same two parties', async () => {
    await asRoleIn('migrator', tenant.id, async (client) => {
      const first = await insertRow(client, 'party.relationship', contactFor());
      const again = insertStatement(client, 'party.relationship', contactFor());
      expect(await outcome(client, again.text, again.values)).toBe('23505');
      const another = insertStatement(
        client,
        'party.relationship',
        contactFor({ object_id: otherOrganisation }),
      );
      expect(await outcome(client, another.text, another.values)).toBe('ok');

      await client.query("UPDATE party.relationship SET ends_on = '2026-10-31' WHERE id = $1", [
        first,
      ]);
      expect(await outcome(client, again.text, again.values)).toBe('ok');
    });
  });
});
